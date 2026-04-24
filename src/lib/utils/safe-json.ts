// SU-ITER-091-batch2 · P3-03 — shared helper for permissive JSON parsing
// of columns that may legitimately be `null`, `undefined`, or the empty
// string.  Previously both `entity-store` and `chat-store` declared
// their own local copies (`safeParseJson<T>` / `safeParse<T>`) with the
// same body, which meant any future hardening (e.g. logging, schema
// validation, size guards) had to be replicated.
//
// This module intentionally stays minimal — if a store needs stricter
// validation it should compose `safeParseJson` with a Zod schema rather
// than forking the helper.

/**
 * Parse a JSON string, returning `fallback` when the input is nullish,
 * empty, or syntactically invalid JSON.
 *
 * No logging here: callers that want to know about corruption should
 * wrap this with a Zod-based parser (see `entity-schemas.ts` for the
 * shape-validated flavour) instead of decorating every call site.
 *
 * @typeParam T - expected output shape (caller-asserted; no runtime
 *   validation)
 * @param json  candidate JSON string, or `null` / `undefined`
 * @param fallback value returned when parsing fails or input is empty
 */
export function safeParseJson<T>(
  json: string | null | undefined,
  fallback: T,
): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}
