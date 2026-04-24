import { NextResponse, type NextRequest } from 'next/server';

// ============================================================
// SU-088 · P0-C: exact-match localhost guard.
//
// The previous implementation used `Host.startsWith('localhost')`
// which accepted attacker-controlled DNS such as `localhost.evil.com`
// or `127.0.0.1.attacker.tld` — both pass `startsWith` but resolve to
// a remote origin.  The fix: strip the optional port, lowercase the
// host, and compare against a fixed allow-list of loopback aliases.
//
// Implementation notes:
// - IPv6 `[::1]:3000` → host header is `[::1]:3000`; we accept both
//   `[::1]` and bare `::1`.
// - We ignore `x-forwarded-host` because this product is intended to
//   run directly on the user's machine (no trusted reverse proxy); if
//   a proxy is ever introduced it MUST be added to the allow-list
//   explicitly and go through a review (see BRD §5.1 threat model).
// ============================================================

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Return true when the Host header resolves to a loopback alias.
 * Uses `URL` to canonicalise bracketed IPv6 and port stripping, so
 * tricks like `[::1]x` or `localhost.evil.com` are never accepted.
 */
export function isLoopbackHost(rawHost: string | null | undefined): boolean {
  if (!rawHost) return false;
  const trimmed = rawHost.trim();
  if (!trimmed) return false;
  // Bare IPv6 literal without brackets is not a valid URL host; accept
  // the canonical `::1` alias explicitly before parsing.
  if (trimmed === '::1') return true;
  // `URL` understands IPv6 bracket syntax and trailing ports.  Any
  // malformed input (e.g. `[::1]x`) throws and is safely rejected.
  let hostname: string;
  try {
    hostname = new URL(`http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  // `URL.hostname` keeps brackets for IPv6 literals; normalise to bare.
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }
  return LOOPBACK_HOSTS.has(hostname);
}

/** Route handler helper: returns a 403 NextResponse when the caller is remote. */
export function localhostGuard(req: NextRequest): NextResponse | null {
  if (isLoopbackHost(req.headers.get('host'))) return null;
  return NextResponse.json({ error: 'Forbidden: localhost only' }, { status: 403 });
}
