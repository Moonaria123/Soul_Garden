// SU-ITER-090a · code-N-2 — verify `__forTesting` hooks are sealed off
// in production bundles unless the sealed-environment escape hatch
// (`SU_ALLOW_TEST_HOOKS=1`) is set.

import { describe, it, expect, afterEach } from 'vitest';
import {
  assertTestingHooksAllowed,
  guardTestingHooks,
} from './testing-hooks-guard';

// `env.NODE_ENV` is typed as a read-only literal union by @types/node,
// but the runtime object is a mutable plain dictionary.  Cast through
// `Record<string, string | undefined>` so we can flip the value per-test.
const env = process.env as unknown as Record<string, string | undefined>;
const originalNodeEnv = env.NODE_ENV;
const originalAllow = env.SU_ALLOW_TEST_HOOKS;

function restoreEnv(): void {
  if (originalNodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = originalNodeEnv;
  if (originalAllow === undefined) delete env.SU_ALLOW_TEST_HOOKS;
  else env.SU_ALLOW_TEST_HOOKS = originalAllow;
}

describe('testing-hooks-guard', () => {
  afterEach(() => {
    restoreEnv();
  });

  describe('assertTestingHooksAllowed', () => {
    it('is a no-op when NODE_ENV=test (default for vitest)', () => {
      env.NODE_ENV = 'test';
      delete env.SU_ALLOW_TEST_HOOKS;
      expect(() => assertTestingHooksAllowed('ns/a')).not.toThrow();
    });

    it('is a no-op when NODE_ENV=development', () => {
      env.NODE_ENV = 'development';
      delete env.SU_ALLOW_TEST_HOOKS;
      expect(() => assertTestingHooksAllowed('ns/a')).not.toThrow();
    });

    it('is a no-op when NODE_ENV is undefined', () => {
      delete env.NODE_ENV;
      delete env.SU_ALLOW_TEST_HOOKS;
      expect(() => assertTestingHooksAllowed('ns/a')).not.toThrow();
    });

    it('throws in production with no override', () => {
      env.NODE_ENV = 'production';
      delete env.SU_ALLOW_TEST_HOOKS;
      expect(() => assertTestingHooksAllowed('ns/a')).toThrowError(
        /access to "ns\/a" is disabled in production/,
      );
    });

    it('is a no-op in production when SU_ALLOW_TEST_HOOKS=1', () => {
      env.NODE_ENV = 'production';
      env.SU_ALLOW_TEST_HOOKS = '1';
      expect(() => assertTestingHooksAllowed('ns/a')).not.toThrow();
    });

    it('still throws in production when override is any value other than exactly "1"', () => {
      env.NODE_ENV = 'production';
      env.SU_ALLOW_TEST_HOOKS = 'true';
      expect(() => assertTestingHooksAllowed('ns/a')).toThrow();
      env.SU_ALLOW_TEST_HOOKS = 'yes';
      expect(() => assertTestingHooksAllowed('ns/a')).toThrow();
      env.SU_ALLOW_TEST_HOOKS = '';
      expect(() => assertTestingHooksAllowed('ns/a')).toThrow();
    });

    it('includes the namespace label in the error for debugging', () => {
      env.NODE_ENV = 'production';
      delete env.SU_ALLOW_TEST_HOOKS;
      expect(() => assertTestingHooksAllowed('db/connection')).toThrowError(
        /"db\/connection"/,
      );
    });
  });

  describe('guardTestingHooks (Proxy wrapper)', () => {
    const raw = {
      value: 42,
      greet(name: string): string {
        return `hello ${name}`;
      },
    };

    it('returns a Proxy that transparently exposes properties in non-prod', () => {
      env.NODE_ENV = 'test';
      delete env.SU_ALLOW_TEST_HOOKS;
      const wrapped = guardTestingHooks('ns/hooks', raw);
      expect(wrapped.value).toBe(42);
      expect(wrapped.greet('world')).toBe('hello world');
    });

    it('throws on property read in production', () => {
      env.NODE_ENV = 'production';
      delete env.SU_ALLOW_TEST_HOOKS;
      const wrapped = guardTestingHooks('ns/hooks', raw);
      expect(() => wrapped.value).toThrowError(/"ns\/hooks"/);
      expect(() => wrapped.greet('x')).toThrow();
    });

    it('throws on `in` (has trap) in production', () => {
      env.NODE_ENV = 'production';
      delete env.SU_ALLOW_TEST_HOOKS;
      const wrapped = guardTestingHooks('ns/hooks', raw);
      expect(() => 'value' in wrapped).toThrow();
    });

    it('throws on Object.keys (ownKeys trap) in production', () => {
      env.NODE_ENV = 'production';
      delete env.SU_ALLOW_TEST_HOOKS;
      const wrapped = guardTestingHooks('ns/hooks', raw);
      expect(() => Object.keys(wrapped)).toThrow();
    });

    it('allows access in production when SU_ALLOW_TEST_HOOKS=1', () => {
      env.NODE_ENV = 'production';
      env.SU_ALLOW_TEST_HOOKS = '1';
      const wrapped = guardTestingHooks('ns/hooks', raw);
      expect(wrapped.value).toBe(42);
    });

    // SU-ITER-090a mini-Gate NIT — mutation traps added so production
    // callers cannot silently patch the namespace in a way the get-trap
    // would miss.
    it('throws on property assignment (set trap) in production', () => {
      env.NODE_ENV = 'production';
      delete env.SU_ALLOW_TEST_HOOKS;
      const local: { value: number } = { value: 1 };
      const wrapped = guardTestingHooks('ns/hooks', local);
      expect(() => { wrapped.value = 99; }).toThrow();
    });

    it('throws on property deletion in production', () => {
      env.NODE_ENV = 'production';
      delete env.SU_ALLOW_TEST_HOOKS;
      const local: { value: number } = { value: 1 };
      const wrapped = guardTestingHooks('ns/hooks', local);
      expect(() => {
        delete (wrapped as unknown as Record<string, unknown>).value;
      }).toThrow();
    });

    it('throws on Object.defineProperty in production', () => {
      env.NODE_ENV = 'production';
      delete env.SU_ALLOW_TEST_HOOKS;
      const local: { value: number } = { value: 1 };
      const wrapped = guardTestingHooks('ns/hooks', local);
      expect(() =>
        Object.defineProperty(wrapped, 'extra', { value: 2 }),
      ).toThrow();
    });
  });

  describe('integration with real module __forTesting namespaces', () => {
    it('connection.__forTesting is reachable in test env', async () => {
      env.NODE_ENV = 'test';
      delete env.SU_ALLOW_TEST_HOOKS;
      const mod = await import('../db/connection');
      expect(typeof mod.__forTesting.runCleanup).toBe('function');
      expect(typeof mod.__forTesting.resetDataDirCache).toBe('function');
    });

    it('key-derivation-server.__forTesting exposes v2 domain suffix in test env', async () => {
      env.NODE_ENV = 'test';
      delete env.SU_ALLOW_TEST_HOOKS;
      const mod = await import('../crypto/key-derivation-server');
      expect(typeof mod.__forTesting.DOMAIN_SUFFIX_V2).toBe('string');
      expect(typeof mod.__forTesting.PBKDF2_ITERATIONS).toBe('number');
    });

    it('migration-v2.__forTesting exposes MARKER_VERSION in test env', async () => {
      env.NODE_ENV = 'test';
      delete env.SU_ALLOW_TEST_HOOKS;
      const mod = await import('../db/migration-v2');
      expect(typeof mod.__forTesting.MARKER_VERSION).toBe('string');
    });
  });
});
