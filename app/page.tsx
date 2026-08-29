import { headers } from 'next/headers';
import FamilyBoard from '@/components/board/FamilyBoard';
import PersonalBoard from '@/components/board/PersonalBoard';
import { boardSlugForHost, familyBoard, resolveBoard } from '@/lib/config/boards';

export const dynamic = 'force-dynamic';

/**
 * `/` — the family board, unless the hostname belongs to a configured board.
 *
 * A board that declares a `host` is served at the root of that host, so a
 * kiosk URL is just `https://kida.example.com` with no path. Resolving it here
 * rather than rewriting in the proxy keeps middleware on the Edge runtime,
 * where it can't read the config file off disk anyway.
 *
 * Any host no board claims — the kitchen's — falls through to the family board
 * untouched, which is what makes this safe to add to the wall.
 */
export default async function DashboardPage() {
  const h = await headers();
  const slug = boardSlugForHost(h.get('host') ?? h.get('x-forwarded-host'));
  const board = (slug ? resolveBoard(slug) : null) ?? familyBoard();

  return board.layout === 'personal' ? (
    <PersonalBoard board={board} />
  ) : (
    <FamilyBoard board={board} />
  );
}
