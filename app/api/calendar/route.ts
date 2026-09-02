import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { COOKIE_NAME, isAuthBypassed, readSession, sessionOpensBoard } from '@/lib/auth/session';
import { scopeEventsToBoard } from '@/lib/calendar/board-scope';
import { FAMILY_BOARD_SLUG, familyBoard, resolveBoard } from '@/lib/config/boards';
import { getEventsInRange } from '@/lib/db/events';
import { getSyncStatus } from '@/lib/db/sync-status';

/**
 * Which calendars this request may read, or `null` for all of them.
 *
 * The board is taken from the SESSION first and the query string only second.
 * A session minted by a board's own PIN is pinned to that board whatever it
 * asks for, so the scoping is a property of the credential rather than of the
 * client remembering to send a parameter — a panel cannot widen its own view by
 * dropping `?board=`, and it cannot borrow another board's by naming it.
 *
 * The family board stays unscoped on purpose. It draws every calendar, and its
 * edit form resolves both link membership and the membership LOCK client-side
 * against the full list; handing it a subset would quietly narrow what saving
 * an event keeps. Its response is therefore identical to the one this route has
 * always returned.
 */
async function allowedCalendars(
  request: NextRequest
): Promise<
  { ok: true; allowed: ReadonlySet<string> | null } | { ok: false; status: number; error: string }
> {
  const asked = request.nextUrl.searchParams.get('board');

  // The proxy has already proved there is a valid session (and bypassed the
  // whole gate in dev). Reading it again here is what turns "who is asking"
  // into "what may they see".
  let stamp: string | null = null;
  if (!isAuthBypassed()) {
    const secret = process.env.COOKIE_SECRET;
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    const session = token && secret ? await readSession(token, secret) : null;
    if (!session) return { ok: false, status: 401, error: 'Unauthorized' };
    if (asked && !sessionOpensBoard(session, asked)) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }
    stamp = session.board ?? null;
  }

  const slug = stamp ?? asked ?? FAMILY_BOARD_SLUG;
  // A config may name a board `family`; if it does, that board wins here just
  // as it does at `/b/family`. Otherwise the slug means the implicit wall.
  const board = resolveBoard(slug) ?? (slug === FAMILY_BOARD_SLUG ? familyBoard() : null);
  if (!board) return { ok: false, status: 404, error: `Unknown board: ${slug}` };

  // Scoped by LAYOUT, not by slug: the family layout needs the whole cache for
  // its edit form (see above), the personal layout draws one person and never
  // edits membership.
  if (board.layout !== 'personal') return { ok: true, allowed: null };
  return { ok: true, allowed: new Set(board.calendars.map((c) => c.id)) };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const start = params.get('start');
  const end = params.get('end');

  if (!start || !end) {
    return NextResponse.json(
      { error: 'start and end query params required (ISO 8601)' },
      { status: 400 }
    );
  }

  const scope = await allowedCalendars(request);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const events = scopeEventsToBoard(getEventsInRange(start, end), scope.allowed);
  const syncStatus = getSyncStatus('calendar');

  return NextResponse.json({
    events,
    sync: {
      lastSuccess: syncStatus?.last_success ?? null,
      lastAttempt: syncStatus?.last_attempt ?? null,
      lastError: syncStatus?.last_error ?? null,
    },
  });
}
