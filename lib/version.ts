import { readFileSync } from 'fs';
import { resolve } from 'path';

const DEFAULT_VERSION_PATH = resolve(process.cwd(), 'data/deploy-version');

/**
 * The currently-deployed build token the kiosk polls to know when to hard-reload.
 *
 * `scripts/deploy.sh` writes the git SHA here on every deploy, so a new build
 * auto-refreshes the wall display within one poll interval — no need to touch the
 * Pi. `scripts/kiosk-reload.sh` writes a `manual-<epoch>` value to force a refresh
 * after a config-only change (which doesn't rebuild, so the SHA wouldn't move).
 *
 * The dashboard records the token it loaded with and reloads only when this value
 * *differs* — so flipping it triggers exactly one reload per open client, with no
 * ack and no possible reload loop (the reloaded page adopts the new token as its
 * baseline). A missing file (local dev) returns a stable `dev`, so nothing ever
 * reloads in development.
 */
export function getDeployVersion(path: string = DEFAULT_VERSION_PATH): string {
  try {
    return readFileSync(path, 'utf-8').trim() || 'dev';
  } catch {
    return 'dev';
  }
}
