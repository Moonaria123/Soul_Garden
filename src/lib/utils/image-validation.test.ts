// SU-ITER-090a · P2-19 — tests for image MIME whitelist + magic check.

import { describe, it, expect } from 'vitest';
import { validateImageBytes, validateImageFile } from './image-validation';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

const JPEG_HEADER = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0);
const PNG_HEADER = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const GIF89_HEADER = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0);
const GIF87_HEADER = bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0);
const WEBP_HEADER = bytes(
  0x52, 0x49, 0x46, 0x46,
  0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
);
const HTML_HEADER = bytes(
  0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45, 0x20, 0x68, 0x74,
); // "<!DOCTYPE ht"

describe('validateImageBytes · magic + MIME', () => {
  it('accepts JPEG with correct MIME', () => {
    const r = validateImageBytes(JPEG_HEADER, 'image/jpeg');
    expect(r).toEqual({ ok: true, reason: 'ok', detectedMime: 'image/jpeg' });
  });

  it('accepts PNG with correct MIME', () => {
    const r = validateImageBytes(PNG_HEADER, 'image/png');
    expect(r.ok).toBe(true);
    expect(r.detectedMime).toBe('image/png');
  });

  it('accepts GIF89a and GIF87a', () => {
    expect(validateImageBytes(GIF89_HEADER, 'image/gif').ok).toBe(true);
    expect(validateImageBytes(GIF87_HEADER, 'image/gif').ok).toBe(true);
  });

  it('accepts WebP with correct MIME', () => {
    const r = validateImageBytes(WEBP_HEADER, 'image/webp');
    expect(r.ok).toBe(true);
    expect(r.detectedMime).toBe('image/webp');
  });

  it('rejects MIME not in whitelist (SVG)', () => {
    const r = validateImageBytes(PNG_HEADER, 'image/svg+xml');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mime_not_allowed');
  });

  it('rejects MIME not in whitelist (bmp)', () => {
    const r = validateImageBytes(PNG_HEADER, 'image/bmp');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mime_not_allowed');
  });

  it('rejects HTML disguised as PNG', () => {
    const r = validateImageBytes(HTML_HEADER, 'image/png');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('magic_mismatch');
  });

  it('rejects JPEG bytes reported as PNG', () => {
    const r = validateImageBytes(JPEG_HEADER, 'image/png');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('magic_mismatch');
    expect(r.detectedMime).toBe('image/jpeg');
  });

  it('rejects too-small buffer', () => {
    const r = validateImageBytes(bytes(0xff, 0xd8, 0xff), 'image/jpeg');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too_small');
  });
});

describe('validateImageFile · File wrapper', () => {
  function makeFile(header: Uint8Array, type: string): File {
    // Copy into a fresh ArrayBuffer so the TS lib.dom typing does not
    // reject the shared-buffer variant of Uint8Array.
    const ab = header.slice().buffer as ArrayBuffer;
    return new File([ab], 'x', { type });
  }

  it('accepts a valid PNG File', async () => {
    const f = makeFile(PNG_HEADER, 'image/png');
    const r = await validateImageFile(f);
    expect(r.ok).toBe(true);
  });

  it('rejects a disguised HTML file', async () => {
    const f = makeFile(HTML_HEADER, 'image/png');
    const r = await validateImageFile(f);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('magic_mismatch');
  });
});
