/**
 * SU-ITER-090a · code-N-2 · Production guard for `__forTesting` namespaces.
 *
 * Every module that exposes test-only hooks (`export const __forTesting = …`)
 * must wrap them with {@link guardTestingHooks} so that accidental access
 * from production code (Next.js build sets `NODE_ENV=production`) throws
 * loudly instead of silently allowing state mutation or internal leakage.
 *
 * The `SU_ALLOW_TEST_HOOKS=1` escape hatch is deliberate: it lets sealed
 * integration environments (e.g. a CI job bundling the app in production
 * mode to run smoke tests) opt-in without patching the guard. Regular
 * vitest runs never need it because `vitest` sets `NODE_ENV='test'`.
 *
 * Scope: this guard is advisory — it prevents honest mistakes, not a
 * determined attacker with code-execution privileges. The defence-in-depth
 * value is that test hooks which mutate sessions, reset DEK caches, or
 * inject stubs can no longer be reached by third-party code paths that
 * accidentally import from `connection`, `migration-v2`, or
 * `key-derivation-server` in a production bundle.
 */

function isTestingHooksAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.SU_ALLOW_TEST_HOOKS === '1';
}

export function assertTestingHooksAllowed(namespace: string): void {
  if (!isTestingHooksAllowed()) {
    throw new Error(
      `[__forTesting] access to "${namespace}" is disabled in production. ` +
        'Set SU_ALLOW_TEST_HOOKS=1 to override (use only in sealed test environments).',
    );
  }
}

/**
 * Wrap a test-only hook object with a Proxy that enforces the guard on
 * every property access. The returned value has the identical TS shape
 * as the input so downstream tests can keep using
 * `__forTesting.someHook(...)` unchanged.
 */
export function guardTestingHooks<T extends object>(namespace: string, hooks: T): T {
  // SU-ITER-090a mini-Gate NIT — cover every mutation trap in addition
  // to the read traps below.  Without `set` / `deleteProperty` /
  // `defineProperty`, a production-mode caller could quietly patch the
  // namespace (e.g. `__forTesting.evictAll = () => …`) and then read
  // back through a differently-bound reference.  The read guard would
  // still throw on subsequent access, but the inconsistency would
  // hide the mistake from tests that walked the pre-mutation shape.
  return new Proxy(hooks, {
    get(target, prop, receiver) {
      assertTestingHooksAllowed(namespace);
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      assertTestingHooksAllowed(namespace);
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      assertTestingHooksAllowed(namespace);
      return Reflect.ownKeys(target);
    },
    set(target, prop, value, receiver) {
      assertTestingHooksAllowed(namespace);
      return Reflect.set(target, prop, value, receiver);
    },
    deleteProperty(target, prop) {
      assertTestingHooksAllowed(namespace);
      return Reflect.deleteProperty(target, prop);
    },
    defineProperty(target, prop, descriptor) {
      assertTestingHooksAllowed(namespace);
      return Reflect.defineProperty(target, prop, descriptor);
    },
  });
}
