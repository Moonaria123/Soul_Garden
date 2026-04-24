// SU-ITER-090a · P2-04 — Centralised "hidden require" helper.
//
// Build-time safety: `import 'server-only'` throws a compile-time error
// if any `'use client'` surface ever tries to pull this module in.
// Without it, a mis-import would surface only at runtime as
// `require is not defined`.  Added during SU-090a mini-Gate review.
import 'server-only';

//
// Why this exists
// ---------------
// Server-side modules under `src/lib/db/` need the Node.js built-ins
// (`fs`, `path`) at runtime.  A straightforward `import * as fs from 'fs'`
// causes two problems under Next.js 16 + Turbopack:
//
//   1. **NFT bloat** — Vercel's Node File Trace statically walks every
//      `require('fs')` / `fs.readFile(...)` call to decide which files
//      to include in the deployed bundle.  Because our DB code is
//      parameterised over runtime-resolved paths (not static string
//      literals), the tracer pulls in the entire project tree to be
//      safe, bloating the deployment size.
//
//   2. **Accidental client bundling** — if a file that imports
//      `fs`/`path` were ever transitively pulled into a client bundle,
//      the build would fail with a hard error.  Hiding the resolution
//      gives us a runtime-only failure mode (`ReferenceError: require
//      is not defined in browser`) that is easier to spot.
//
// The accepted mitigation is `eval('require')`: opaque to Turbopack's
// static analyser, legal at runtime under Node's CommonJS interop, and
// still behind the same access checks as a normal `require`.
//
// Why not `createRequire(import.meta.url)`?
// -----------------------------------------
// `createRequire` would be cleaner and eliminates the lint disable, but
// empirically it does not reliably hide the subsequent `_require('fs')`
// calls from Turbopack's tracer in every build configuration we ship
// (dev server, `next build`, Vercel NFT).  Revisit when Turbopack grows
// an explicit "don't trace this" annotation or when the team migrates
// off NFT entirely.
//
// Security notes
// --------------
// * This helper is server-only.  It MUST NOT be imported from a
//   `'use client'` surface.  ESLint is asked to allow the eval here via
//   an inline disable so we can escalate `no-eval` to `error` globally
//   in SU-092 without rewriting every call site.
// * The evaluated string is a fixed literal; no user input flows into
//   the `eval` argument.
// * Callers should only pass in string literals to the returned
//   `hiddenRequire` function.  Dynamic path arguments defeat the NFT
//   benefit and should be avoided.

// NB: `eval('require')` escapes Next.js/Turbopack static analysis (see
// module-level rationale). `no-eval` is not in the active rule set, and
// `security/detect-eval-with-expression` only fires on non-literal `eval`
// arguments, so no explicit disable directive is needed.
const _hiddenRequire: NodeRequire = eval('require');

/**
 * Server-only `require`, hidden from Turbopack static analysis.
 *
 * Use for Node built-ins (`fs`, `path`, `node:crypto`, …) from modules
 * that must not be traced into the deployment bundle.  Do not pass
 * dynamic strings.
 */
export const hiddenRequire: NodeRequire = _hiddenRequire;
