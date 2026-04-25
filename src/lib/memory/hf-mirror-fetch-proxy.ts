/**
 * hf-mirror.com does not send CORS headers; browser fetch to it fails. We proxy
 * those requests through a same-origin Next.js route (server has no CORS).
 */

const INSTALLED = '__soulUploadHfMirrorFetchProxy';

function toUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

function isHfMirrorHttpsUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.protocol === 'https:' && u.hostname === 'hf-mirror.com';
  } catch {
    return false;
  }
}

/**
 * One-time: wrap `window.fetch` so requests to https://hf-mirror.com/... go
 * through `/api/hf-hub-proxy?u=...` (GET-only hub traffic as used by @xenova).
 */
export function installHfMirrorFetchProxy(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, boolean>;
  if (w[INSTALLED]) return;
  w[INSTALLED] = true;

  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = toUrlString(input);
    if (!isHfMirrorHttpsUrl(urlStr)) {
      return orig(input as RequestInfo, init);
    }
    const proxy = new URL('/api/hf-hub-proxy', window.location.origin);
    proxy.searchParams.set('u', urlStr);
    if (input instanceof Request) {
      if (input.method !== 'GET' && input.method !== 'HEAD') {
        return orig(input, init);
      }
      return orig(
        new Request(proxy.toString(), {
          method: input.method,
          headers: input.headers,
          mode: 'cors',
          cache: input.cache,
          redirect: 'follow',
          referrer: input.referrer,
          signal: input.signal,
        }),
        init,
      );
    }
    return orig(proxy.toString(), init);
  };
}
