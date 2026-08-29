import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_NAME, isAuthBypassed, readSession, sessionOpensBoard } from './session';

/**
 * The board-scoping half of the gate, for the two server pages that render a
 * board.
 *
 * The proxy already proved there IS a valid session and, for a `/b/<slug>`
 * URL, that the session opens that slug. What it cannot do is resolve a
 * HOSTNAME to a board: middleware runs on the Edge runtime and can't read
 * config.json off disk. So `/` — the URL a kiosk actually points at — is
 * checked here, where the page has already resolved the board anyway.
 *
 * Redirects rather than 404s: on a panel with no keyboard, "type your PIN" is
 * the only recoverable answer.
 */
export async function requireBoardAccess(slug: string): Promise<void> {
  if (isAuthBypassed()) return;

  const secret = process.env.COOKIE_SECRET;
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const session = token && secret ? await readSession(token, secret) : null;

  // A missing or expired session is the proxy's job and it has already run;
  // reaching here with one means something is misconfigured, so fail closed.
  if (!session || !sessionOpensBoard(session, slug)) {
    redirect(`/login?board=${encodeURIComponent(slug)}`);
  }
}
