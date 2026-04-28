import { getDb } from './index';

interface TokenRow {
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  updated_at: string;
}

export function getToken(provider: string): TokenRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM oauth_tokens WHERE provider = ?').get(provider) as
    | TokenRow
    | undefined;
  return row ?? null;
}

export function saveToken(
  provider: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: number | null
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(provider) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
       expires_at = excluded.expires_at,
       updated_at = datetime('now')`
  ).run(provider, accessToken, refreshToken, expiresAt);
}
