// Minimal HTTP client with timeouts, bounded retries for transient failures, and an injectable
// fetch so tests can simulate network failures. No request ever bypasses a provider's limits:
// 429 responses are surfaced, never hammered.

export type FetchFn = typeof fetch;

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly provider: string,
  ) {
    super(message);
  }
}

let fetchImpl: FetchFn = (...a) => fetch(...a);
export function setFetch(f: FetchFn): void {
  fetchImpl = f;
}
export function resetFetch(): void {
  fetchImpl = (...a) => fetch(...a);
}

const UA = "personal-investment-dashboard/1.0 (+self-hosted)";

export async function httpRequest(
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15000, retries = 1, ...rest } = init;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...rest, signal: ctrl.signal, headers: { "User-Agent": UA, ...(rest.headers ?? {}) } });
      if (res.status >= 500 && attempt < retries) {
        lastErr = new UpstreamError(`${provider} returned ${res.status}`, res.status, provider);
        await sleep(400 * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr instanceof UpstreamError) throw lastErr;
  const msg = lastErr instanceof Error ? (lastErr.name === "AbortError" ? "timed out" : lastErr.message) : String(lastErr);
  throw new UpstreamError(`${provider} unreachable: ${msg}`, null, provider);
}

export async function httpJson<T>(provider: string, url: string, init: Parameters<typeof httpRequest>[2] = {}): Promise<T> {
  const res = await httpRequest(provider, url, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new UpstreamError(`${provider} returned non-JSON (HTTP ${res.status})`, res.status, provider);
  }
  if (!res.ok) {
    const detail = (body as { errors?: { message?: string }[] })?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    throw new UpstreamError(`${provider}: ${detail}`, res.status, provider);
  }
  return body as T;
}

export async function httpText(provider: string, url: string, init: Parameters<typeof httpRequest>[2] = {}): Promise<string> {
  const res = await httpRequest(provider, url, init);
  if (!res.ok) throw new UpstreamError(`${provider} returned HTTP ${res.status}`, res.status, provider);
  return res.text();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
