import { notFound } from 'next/navigation';
import FamilyBoard from '@/components/board/FamilyBoard';
import PersonalBoard from '@/components/board/PersonalBoard';
import { resolveBoard } from '@/lib/config/boards';

export const dynamic = 'force-dynamic';

/**
 * A configured board at `/b/<slug>`.
 *
 * An unknown slug 404s rather than falling back to the family board: a typo in
 * a kiosk URL must not quietly put the whole family's calendar on a bedroom
 * dresser.
 */
export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const board = resolveBoard(slug);
  if (!board) notFound();

  return board.layout === 'personal' ? (
    <PersonalBoard board={board} />
  ) : (
    <FamilyBoard board={board} />
  );
}
