// SU-ITER-092-batch1 · flat ESLint config — promoted to `error` gate.
//
// History:
//   • SU-ITER-090a (prereq②): introduced `typescript-eslint` recommended +
//     `eslint-plugin-security` + `@typescript-eslint/no-explicit-any` at
//     **warn** only, deliberately *not* fixing existing findings.
//   • SU-ITER-092-batch1 (this): baseline 133 warnings cleared to zero, rules
//     promoted from `warn` → `error`, and one rule (`detect-object-injection`)
//     relaxed off by user decision — see RLX-ESL-01 in ITERATION-LOG §SU-092.
//
// Why flat config: ESLint 10 removed legacy `.eslintrc.*` auto-loading.
// Why no Next.js plugin: out of scope; `next build` still runs its own
// lightweight route-level linting in CI.
//
// Relaxation policy (RLX-ESL-01 in ITERATION-LOG §SU-092):
//   `security/detect-object-injection` is **off** project-wide. 65 of 65
//   baseline hits were legitimate `Map.get(k)` / `Record<string,unknown>[k]` /
//   typed-enum-dispatch patterns where Zod already validates the wire-level
//   structure at the route boundary. Retaining the rule at `warn` was pure
//   noise with no true-positive signal at the current threat-model perimeter.
//   See relaxed-rules table for re-open triggers.

import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'drizzle/**',
      'next-env.d.ts',
      'scripts/**/*.js',
    ],
  },
  // Base TS-ESLint recommended rules at `error` (default severity retained).
  ...tseslint.configs.recommended,
  // `eslint-plugin-security` — promoted to `error`, except `detect-object-injection`
  // which is intentionally off (see RLX-ESL-01).
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    plugins: { security },
    rules: {
      'security/detect-bidi-characters': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'error',
      'security/detect-non-literal-regexp': 'error',
      'security/detect-non-literal-require': 'error',
      // RLX-ESL-01 (SU-092-batch1, 2026-04-19): off project-wide. Re-open on
      // (a) routes bypassing Zod and using `obj[userInput]` for persistence,
      // (b) new front-end eval/Function paths accepting user keys, or
      // (c) community reports of materially improved true-positive rate.
      'security/detect-object-injection': 'off',
      'security/detect-possible-timing-attacks': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-unsafe-regex': 'error',
    },
  },
  // Project-specific overrides — promoted to `error` at SU-092-batch1 close.
  // SU-ITER-092-batch3 · A4-MEDIUM cleanup adds `no-non-null-assertion` at
  // `error` after clearing every non-test call site (9 hits) in-place.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // TS convention: prefix with `_` to signal intentional non-use.
      // Supersedes the default which flagged legitimate _table / _options /
      // _err placeholders. Non-underscore unused names remain a hard error.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Test files: relax noisy rules that conflict with typical test scaffolding.
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/__tests__/**/*.{ts,tsx}',
      '**/vitest.setup.ts',
      // SU-ITER-092-batch3 · A4-MEDIUM — Playwright e2e specs live under
      // `e2e/**/*.spec.ts` and carry the same fixture-narrowing freedom
      // as vitest tests (e.g. `expect(locator).toBeVisible()` + trailing
      // `!` on precomputed selectors).  Same relaxation scope applies.
      'e2e/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // SU-ITER-092-batch3 · A4-MEDIUM — tests liberally use `expect(x).
      // toBe(y)` and fixture access patterns that would otherwise force
      // boilerplate narrowing with no safety upside, so the rule is
      // relaxed **in test files only**.  Production code stays at
      // `error`.
      '@typescript-eslint/no-non-null-assertion': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-unsafe-regex': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-possible-timing-attacks': 'off',
    },
  },
);
