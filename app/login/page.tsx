import { headers } from 'next/headers';
import PinPad from '@/components/auth/PinPad';
import { boardSlugForHost, resolveBoard } from '@/lib/config/boards';

export const dynamic = 'force-dynamic';

/**
 * PIN entry.
 *
 * Server half: work out which board is asking, so the right PIN is checked and
 * the panel says whose board it is. The hostname decides it on a subdomain
 * install; `?board=<slug>` covers a path-only one, where every board shares a
 * host. Both are resolved against config, so an unknown slug is simply the
 * family board rather than anything a URL can invent.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const { board: requested } = await searchParams;
  const h = await headers();

  const fromQuery = requested && resolveBoard(requested) ? requested : null;
  const slug = fromQuery ?? boardSlugForHost(h.get('host') ?? h.get('x-forwarded-host'));
  const board = slug ? resolveBoard(slug) : null;

  return (
    <PinPad
      boardSlug={slug}
      // The family board's `name` is its slug, which is no kind of greeting.
      boardName={board?.layout === 'personal' ? board.name : undefined}
      // Built from a board that exists, never from the raw query — this is a
      // redirect target, and the only safe kind is one config vouched for.
      returnTo={fromQuery ? `/b/${fromQuery}` : '/'}
    />
  );
}
