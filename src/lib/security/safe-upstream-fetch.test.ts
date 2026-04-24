import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeUpstreamFetch, SafeUpstreamError } from './safe-upstream-fetch';

// SU-ITER-089 · P1-4 — pin the SSRF guard on upstream LLM fetches.
// Strategy: stub global `fetch` so we can drive arbitrary redirect
// sequences without any network access.

type FetchStub = ReturnType<typeof vi.fn<typeof fetch>>;

function mockResponse(status: number, location?: string): Response {
  const headers = new Headers();
  if (location) headers.set('location', location);
  // Response() rejects bodies on null-body statuses (204/205/304).  Use
  // `null` explicitly on 3xx (redirects are bodiless in practice) and
  // keep a dummy body on 2xx paths so callers can `.text()` / `.json()`.
  const body = status >= 300 && status < 400 ? null : 'ok';
  return new Response(body, { status, headers });
}

describe('safeUpstreamFetch', () => {
  let originalFetch: typeof fetch;
  let stub: FetchStub;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    stub = vi.fn<typeof fetch>();
    globalThis.fetch = stub as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns a non-3xx response directly without consulting Location', async () => {
    stub.mockResolvedValueOnce(mockResponse(200));
    const res = await safeUpstreamFetch('https://api.openai.com/v1/chat/completions');
    expect(res.status).toBe(200);
    expect(stub).toHaveBeenCalledTimes(1);
    const callArgs = stub.mock.calls[0]![1] as RequestInit;
    expect(callArgs.redirect).toBe('manual');
  });

  it('rejects the initial URL if it violates the SSRF allow-list', async () => {
    await expect(
      safeUpstreamFetch('http://169.254.169.254/latest/meta-data/'),
    ).rejects.toBeInstanceOf(SafeUpstreamError);
    expect(stub).not.toHaveBeenCalled();
  });

  it('follows a safe redirect and returns the terminal response', async () => {
    stub.mockResolvedValueOnce(mockResponse(302, 'https://api.anthropic.com/v1/messages'));
    stub.mockResolvedValueOnce(mockResponse(200));
    const res = await safeUpstreamFetch('https://proxy.example.com/messages');
    expect(res.status).toBe(200);
    expect(stub).toHaveBeenCalledTimes(2);
    expect(stub.mock.calls[1]![0]).toBe('https://api.anthropic.com/v1/messages');
  });

  it('refuses a redirect that targets a private IP', async () => {
    stub.mockResolvedValueOnce(mockResponse(302, 'http://169.254.169.254/metadata'));
    const err = await safeUpstreamFetch('https://proxy.example.com/chat').catch((e) => e);
    expect(err).toBeInstanceOf(SafeUpstreamError);
    expect((err as SafeUpstreamError).code).toBe('blocked_by_policy');
    expect((err as SafeUpstreamError).status).toBe(403);
  });

  it('refuses a redirect that targets a blocked cloud metadata hostname', async () => {
    stub.mockResolvedValueOnce(mockResponse(302, 'http://metadata.google.internal/latest'));
    const err = await safeUpstreamFetch('https://proxy.example.com/chat').catch((e) => e);
    expect(err).toBeInstanceOf(SafeUpstreamError);
    expect((err as SafeUpstreamError).code).toBe('blocked_by_policy');
  });

  it('caps the redirect chain at maxRedirects', async () => {
    // Chain: hop0 → hop1 → hop2 → hop3 (all safe), limit 2 trips.
    stub.mockResolvedValueOnce(mockResponse(302, 'https://a.example.com/b'));
    stub.mockResolvedValueOnce(mockResponse(302, 'https://b.example.com/c'));
    stub.mockResolvedValueOnce(mockResponse(302, 'https://c.example.com/d'));
    const err = await safeUpstreamFetch('https://start.example.com/x', {
      maxRedirects: 2,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SafeUpstreamError);
    expect((err as SafeUpstreamError).code).toBe('too_many_redirects');
    expect((err as SafeUpstreamError).status).toBe(502);
  });

  it('treats a malformed Location header as a 502 bad_location', async () => {
    stub.mockResolvedValueOnce(mockResponse(302, 'http://['));
    const err = await safeUpstreamFetch('https://proxy.example.com/chat').catch((e) => e);
    expect(err).toBeInstanceOf(SafeUpstreamError);
    expect((err as SafeUpstreamError).code).toBe('bad_location');
  });

  it('returns a 3xx response untouched when no Location header is present', async () => {
    // Use 302 instead of 304 because Response() disallows bodies on
    // 304 — the behaviour we want to pin is "any 3xx without Location
    // is returned verbatim".
    stub.mockResolvedValueOnce(mockResponse(302));
    const res = await safeUpstreamFetch('https://api.openai.com/v1/chat');
    expect(res.status).toBe(302);
  });

  it('honours maxRedirects: 0 to disable redirect following entirely', async () => {
    stub.mockResolvedValueOnce(mockResponse(302, 'https://other.example.com/chat'));
    const err = await safeUpstreamFetch('https://start.example.com/x', {
      maxRedirects: 0,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SafeUpstreamError);
    expect((err as SafeUpstreamError).code).toBe('too_many_redirects');
  });

  it('propagates method / headers / body on the first hop', async () => {
    stub.mockResolvedValueOnce(mockResponse(200));
    await safeUpstreamFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer abc' },
      body: '{"hi":true}',
    });
    const init = stub.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"hi":true}');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer abc');
  });
});
