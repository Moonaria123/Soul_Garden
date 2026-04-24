// @vitest-environment jsdom
//
// SU-ITER-090a · 前置③ — jsdom smoke test.
//
// Confirms the vitest jsdom environment is wired in so future batches
// (SU-092 RTL behavioural snapshots for chat/settings) can opt-in with a
// single top-of-file pragma.  This test deliberately does NOT pull in
// `@testing-library/react` — RTL is out of scope for SU-090a.
//
// If this smoke test fails, the root cause is almost certainly the
// `jsdom` devDep missing from `package.json` or a vitest config change
// that overrode the per-file environment pragma.

import { describe, it, expect } from 'vitest';

describe('jsdom environment (smoke)', () => {
  it('exposes the global `window` object', () => {
    expect(typeof window).toBe('object');
    expect(window).toBeDefined();
  });

  it('exposes `document` with a working DOM API', () => {
    expect(typeof document).toBe('object');
    const div = document.createElement('div');
    div.textContent = 'SU-090a';
    expect(div.textContent).toBe('SU-090a');
  });

  it('supports basic DOM mutations used by RTL under the hood', () => {
    const host = document.createElement('section');
    host.setAttribute('data-testid', 'smoke');
    document.body.appendChild(host);
    expect(document.querySelector('[data-testid="smoke"]')).toBe(host);
    host.remove();
    expect(document.querySelector('[data-testid="smoke"]')).toBeNull();
  });

  it('exposes localStorage / sessionStorage so P2-03 evaluation can simulate it', () => {
    expect(typeof window.localStorage).toBe('object');
    expect(typeof window.sessionStorage).toBe('object');
    window.sessionStorage.setItem('k', 'v');
    expect(window.sessionStorage.getItem('k')).toBe('v');
    window.sessionStorage.removeItem('k');
    expect(window.sessionStorage.getItem('k')).toBeNull();
  });
});
