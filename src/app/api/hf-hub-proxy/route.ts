import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_HOSTNAMES = new Set(['hf-mirror.com']);

/**
 * Server-side forwarder for browser-blocked CORS fetches to hf-mirror.
 * Query: u = full https URL to hf-mirror.com (Xenova hub paths only).
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('u');
  if (!raw?.trim()) {
    return new NextResponse('Missing parameter u', { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  if (target.protocol !== 'https:') {
    return new NextResponse('Only https URLs are allowed', { status: 400 });
  }
  if (!ALLOWED_HOSTNAMES.has(target.hostname)) {
    return new NextResponse('Host not allowed', { status: 403 });
  }

  const res = await fetch(target, {
    headers: {
      'User-Agent': 'SoulUpload/1.0; local-embed; hf-mirror-proxy',
    },
    redirect: 'follow',
  });

  if (!res.ok) {
    return new NextResponse(res.statusText || 'Upstream error', { status: res.status });
  }

  const out = new Headers();
  const copy = [
    'content-type',
    'content-length',
    'cache-control',
    'etag',
    'last-modified',
  ] as const;
  for (const k of copy) {
    const v = res.headers.get(k);
    if (v) out.set(k, v);
  }

  return new NextResponse(res.body, { status: 200, headers: out });
}
