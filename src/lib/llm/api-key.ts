// ============================================================
// API key normalization — used before encrypt, after decrypt, and
// on server routes before upstream fetch (SU-ITER-030)
// ============================================================

/**
 * Trim whitespace and strip a leading `Bearer ` prefix if the user
 * pasted a full Authorization value into the key field (common 401 cause).
 */
export function normalizeApiKeySecret(raw: string): string {
  let s = raw.trim();
  if (/^bearer\s+/i.test(s)) {
    s = s.replace(/^bearer\s+/i, '').trim();
  }
  return s;
}
