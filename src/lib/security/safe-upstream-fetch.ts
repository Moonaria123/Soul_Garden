// SU-ITER-089 · P1-4 · Server-side SSRF-safe upstream fetch helper.
//
// Problem: every server-side route that calls a user-supplied `baseUrl`
// (`/api/llm/chat`, `/api/llm/upstream-models`, `/api/llm/test-connection`,
// `/api/llm/test-capability`) delegates to Node's `fetch`, which, by
// default, transparently follows 3xx redirects.  `isUrlSafe` blocks
// obviously-internal hostnames in the initial URL, but a public attacker
// domain can 302 to `http://169.254.169.254/` (cloud metadata) or any
// private IP at runtime — defeating the allow-list.
//
// Fix: every upstream fetch from a route handler goes through
// `safeUpstreamFetch`, which:
//   1. forces `redirect: 'manual'`;
//   2. on each 3xx, re-validates the `Location` target with `isUrlSafe`
//      AND the existing `PRIVATE_IP_PATTERNS` list;
//   3. caps redirects at `maxRedirects` (default 3) to stop loops.
//
// This helper deliberately does NOT perform DNS pinning — that would
// require a custom dispatcher and is out of scope for P1-4.  The threat
// model §6 has a residual note: an attacker who controls authoritative
// DNS for a public name can still point at an internal IP on the first
// hop.  Mitigating that is scheduled as a SU-ITER-092 hardening item.

import { isUrlSafe } from '@/lib/llm/upstream-url';

export class SafeUpstreamError extends Error {
  constructor(
    message: string,
    public readonly code: 'blocked_by_policy' | 'too_many_redirects' | 'bad_location',
    public readonly status: number,
  ) {
    super(message);
    this.name = 'SafeUpstreamError';
  }
}

export interface SafeUpstreamInit extends RequestInit {
  /** Max redirect hops to follow.  Set to 0 to refuse any redirect. */
  maxRedirects?: number;
}

/**
 * Drop-in replacement for `fetch` that never follows a redirect to an
 * unsafe URL.  Behaviourally identical to `fetch` on success and on
 * non-3xx errors — the caller reads `response.body` / `response.json()`
 * as usual.
 *
 * On a redirect to an unsafe location, throws `SafeUpstreamError` with
 * `status = 403` (`blocked_by_policy`) so route handlers can map it to
 * a consistent HTTP error.
 *
 * On hop exhaustion, throws with `status = 502` (`too_many_redirects`).
 *
 * On a malformed / missing `Location` header (3xx but no target),
 * the original 3xx response is returned as-is so the caller can decide
 * whether to treat it as success or failure — callers never have to
 * interpret a redirect they didn't opt into.
 */
export async function safeUpstreamFetch(
  inputUrl: string,
  init: SafeUpstreamInit = {},
): Promise<Response> {
  const { maxRedirects = 3, ...fetchInit } = init;

  if (!isUrlSafe(inputUrl)) {
    throw new SafeUpstreamError(
      `URL blocked by SSRF policy: ${inputUrl}`,
      'blocked_by_policy',
      403,
    );
  }

  let currentUrl = inputUrl;
  let redirects = 0;

  while (true) {
    const res = await fetch(currentUrl, {
      ...fetchInit,
      redirect: 'manual',
    });

    const isRedirect = res.status >= 300 && res.status < 400;
    if (!isRedirect) {
      return res;
    }

    const location = res.headers.get('location');
    if (!location) {
      // Some gateways return 3xx without a Location (rare) — return the
      // response as-is so the caller can observe the status code.
      return res;
    }

    if (redirects >= maxRedirects) {
      // Drain prior response body so the underlying socket can be
      // released by the runtime's connection pool.
      await res.body?.cancel().catch(() => {});
      throw new SafeUpstreamError(
        `Too many redirects (limit ${maxRedirects})`,
        'too_many_redirects',
        502,
      );
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      await res.body?.cancel().catch(() => {});
      throw new SafeUpstreamError(
        `Malformed Location header: ${location}`,
        'bad_location',
        502,
      );
    }

    if (!isUrlSafe(nextUrl)) {
      await res.body?.cancel().catch(() => {});
      throw new SafeUpstreamError(
        `Redirect target blocked by SSRF policy: ${nextUrl}`,
        'blocked_by_policy',
        403,
      );
    }

    await res.body?.cancel().catch(() => {});
    currentUrl = nextUrl;
    redirects += 1;
  }
}
