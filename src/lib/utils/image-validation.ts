// SU-ITER-090a · P2-19 — image upload MIME whitelist + magic-number check.
//
// Problem
// -------
// Client-side `accept="image/*"` trusts the browser-reported MIME type,
// which in turn trusts the file's extension.  An attacker can rename
// `payload.html` → `payload.png` and the browser will happily report
// `type: 'image/png'`.  While we never execute user-supplied bytes,
// data-URL avatars that bypass the image-decoder path (e.g. an SVG
// with embedded script, or a crafted HTML file mislabelled as PNG)
// could still end up rendered via `<img src>` in contexts where the
// browser sniffs.
//
// Fix
// ---
// Before compressing / storing any uploaded image, run:
//   1. MIME whitelist — reject anything outside the 4 formats we render.
//   2. Magic-number (byte signature) check on the first 12 bytes to
//      catch type-mismatched files regardless of the `File.type`
//      attribute.
//
// Both checks are cheap; combined they run in well under 1ms on a 5MB
// file because we only read 12 bytes.

export const ALLOWED_IMAGE_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export type ImageValidationReason =
  | 'ok'
  | 'mime_not_allowed'
  | 'magic_mismatch'
  | 'read_failed'
  | 'too_small';

export interface ImageValidationResult {
  ok: boolean;
  reason: ImageValidationReason;
  /** The MIME type inferred from the byte signature, if one matched. */
  detectedMime: string | null;
}

function matchesSignature(bytes: Uint8Array): string | null {
  // JPEG — FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG — 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // GIF — "GIF87a" or "GIF89a"
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 /* G */ &&
    bytes[1] === 0x49 /* I */ &&
    bytes[2] === 0x46 /* F */ &&
    bytes[3] === 0x38 /* 8 */ &&
    (bytes[4] === 0x37 /* 7 */ || bytes[4] === 0x39 /* 9 */) &&
    bytes[5] === 0x61 /* a */
  ) {
    return 'image/gif';
  }
  // WebP — "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 /* R */ &&
    bytes[1] === 0x49 /* I */ &&
    bytes[2] === 0x46 /* F */ &&
    bytes[3] === 0x46 /* F */ &&
    bytes[8] === 0x57 /* W */ &&
    bytes[9] === 0x45 /* E */ &&
    bytes[10] === 0x42 /* B */ &&
    bytes[11] === 0x50 /* P */
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Inspect an image file's first 12 bytes and confirm its reported MIME
 * type matches the magic number.  Call this before any compression or
 * server-side persistence.
 *
 * Note: exported as `validateImageBytes` for testability (takes a
 * pre-read `Uint8Array`).  UI code should use {@link validateImageFile}
 * which handles the FileReader dance.
 */
export function validateImageBytes(
  bytes: Uint8Array,
  reportedMime: string,
): ImageValidationResult {
  if (bytes.length < 12) {
    return { ok: false, reason: 'too_small', detectedMime: null };
  }
  if (!ALLOWED_IMAGE_MIME.has(reportedMime)) {
    return { ok: false, reason: 'mime_not_allowed', detectedMime: null };
  }
  const detected = matchesSignature(bytes);
  if (detected === null) {
    return { ok: false, reason: 'magic_mismatch', detectedMime: null };
  }
  if (detected !== reportedMime) {
    // Reported MIME lies about the bytes — reject even if both are in
    // the whitelist, because the mismatch itself is a red flag.
    return { ok: false, reason: 'magic_mismatch', detectedMime: detected };
  }
  return { ok: true, reason: 'ok', detectedMime: detected };
}

export async function validateImageFile(file: File): Promise<ImageValidationResult> {
  try {
    const slice = file.slice(0, 12);
    const buf = await slice.arrayBuffer();
    return validateImageBytes(new Uint8Array(buf), file.type);
  } catch {
    return { ok: false, reason: 'read_failed', detectedMime: null };
  }
}
