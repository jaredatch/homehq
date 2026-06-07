const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * fetch with a hard timeout. Provider calls (Google, Open-Meteo) run inside
 * interval schedulers — a hung socket would otherwise stall a sync forever
 * and let the next interval stack a second one on top.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
