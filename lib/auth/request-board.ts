import { cookies } from 'next/headers';
import { resolveBoard, type ResolvedBoard } from '@/lib/config/boards';
import { COOKIE_NAME, isAuthBypassed, readSession } from './session';

/**
 * Which board the current request's session is stamped with.
 *
 * The proxy has already proved there is a valid session (and skipped the whole
 * gate in dev). Reading it again in a write route is what turns "who is
 * asking" into "what may they change" — the same move `GET /api/calendar`
 * makes for reads.
 *
 * `board: null` means no restriction: an unstamped session (the household
 * PIN, or any cookie issued before per-board PINs existed) or the dev bypass.
 * A stamp naming a board the config no longer has is refused rather than
 * widened to the household.
 */
export type RequestBoard =
  | { ok: true; board: ResolvedBoard | null }
  | { ok: false; status: number; error: string };

export async function requestBoard(): Promise<RequestBoard> {
  if (isAuthBypassed()) return { ok: true, board: null };

  const secret = process.env.COOKIE_SECRET;
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const session = token && secret ? await readSession(token, secret) : null;
  if (!session) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!session.board) return { ok: true, board: null };

  const board = resolveBoard(session.board);
  if (!board) return { ok: false, status: 403, error: 'Forbidden' };
  return { ok: true, board };
}
