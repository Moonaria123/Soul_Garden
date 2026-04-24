import { NextRequest, NextResponse } from 'next/server';
import type { ZodError } from 'zod';

// ============================================================
// SU-ITER-091-batch2 · code-C-3
//
// Route helpers shared by `src/app/api/db/[...path]/route.ts` and its
// satellite routes.  The helpers move the small body-parsing utilities
// (`readString`, `readField<T>`, `requireField`) out of the route
// module so both the dispatch table and each handler stay focused on
// its own concern and the helpers can carry their own tests.
//
// Everything below operates on `unknown` body payloads: the routes
// promote them to specific shapes via Zod schemas in
// `db-route-schemas.ts`, so these helpers only need to enforce the
// shallowest invariants (`body is object`, `key present`, `string
// value type`).  That keeps them reusable for routes that read a
// single scalar out of the body before deciding whether full Zod is
// worth the cost.
// ============================================================

/**
 * Parse the JSON body of a NextRequest, returning `{}` on failure.
 *
 * The returned value is `unknown` so callers must narrow it before
 * access.  Downstream code uses the other helpers in this module
 * (plus Zod schemas in `db-route-schemas.ts`) to do the narrowing
 * safely instead of the old `body.id` style access that silently
 * turned `null`/`123`/`undefined` into crashes or incorrect rows.
 */
export async function parseBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/**
 * Read a string field from an `unknown` body.  Returns `null` if the
 * body isn't a plain object, the key is missing, or the value is not
 * a string.  Use this for identifier-style fields that are optional
 * *at the HTTP layer* — when the field is required, combine with
 * `requireField` to produce a uniform 400 response.
 */
export function readString(body: unknown, key: string): string | null {
  if (body && typeof body === 'object' && key in body) {
    const val = (body as Record<string, unknown>)[key];
    return typeof val === 'string' ? val : null;
  }
  return null;
}

/**
 * Read an arbitrary field from an `unknown` body.  The caller supplies
 * the expected type as `T`; this helper only guarantees the field is
 * present on the body object (or returns `undefined`).  Callers must
 * still narrow `T` via Zod or a runtime guard before passing the value
 * to SQL.  Used for array fields (e.g. `events`, `facts`) before
 * element-level Zod takes over.
 */
export function readField<T = unknown>(body: unknown, key: string): T | undefined {
  if (body && typeof body === 'object' && key in body) {
    return (body as Record<string, unknown>)[key] as T;
  }
  return undefined;
}

/**
 * Assert that a scalar identifier is non-empty; return a canonical
 * 400 response otherwise.  The caller threads the returned response
 * through to the dispatcher so that a missing-field request never
 * reaches the storage layer (and thus can't silently no-op against
 * an empty `WHERE id = ''`).
 *
 * Use as:
 *   const guard = requireField(idField, 'id');
 *   if (guard) return guard;
 */
export function requireField(value: string, field: string): NextResponse | null {
  return value === ''
    ? NextResponse.json({ error: `missing_${field}` }, { status: 400 })
    : null;
}

/**
 * Convert a Zod validation failure into the canonical 400 response.
 * Only field *paths* leak out — never the offending values — so logs
 * and error responses remain safe under a PII-handling review.  The
 * route label is included in the server-side `console.warn` so the
 * log maps back to a specific endpoint during debugging.
 */
export function zodErrorResponse(err: ZodError, route: string): NextResponse {
  const fields = err.issues.map((i) => i.path.join('.')).filter(Boolean);
  console.warn(`[db-api] ${route} validation failed:`, fields.join(', ') || '(root)');
  return NextResponse.json(
    { error: 'invalid_body', fields },
    { status: 400 },
  );
}

/**
 * Wrap an unknown error into a safe 500 response.  In development the
 * error message flows back to the caller to speed up local debugging;
 * in production only a stable "Internal server error" string is
 * returned so users (and log scrapers) never see filesystem paths,
 * stack traces, or database column names.
 */
export function safeErrorResponse(err: unknown, route: string): NextResponse {
  const isDev = process.env.NODE_ENV === 'development';
  const msg = err instanceof Error ? err.message : 'Internal error';
  console.error(`[db-api] ${route} error:`, msg);
  return NextResponse.json(
    { error: isDev ? msg : 'Internal server error' },
    { status: 500 },
  );
}
