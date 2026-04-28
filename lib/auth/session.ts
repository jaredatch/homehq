const COOKIE_NAME = 'homehq_session';
const encoder = new TextEncoder();

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
}

export async function createSession(secret: string): Promise<string> {
  const payload = btoa(JSON.stringify({ created: Date.now() }));
  const key = await getKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${bufferToHex(signature)}`;
}

export async function verifySession(token: string, secret: string): Promise<boolean> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const payload = token.substring(0, dotIndex);
  const sig = token.substring(dotIndex + 1);

  if (!payload || !sig || sig.length % 2 !== 0) return false;

  try {
    const key = await getKey(secret);
    return crypto.subtle.verify('HMAC', key, hexToBuffer(sig), encoder.encode(payload));
  } catch {
    return false;
  }
}

export { COOKIE_NAME };
