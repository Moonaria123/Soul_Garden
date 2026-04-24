// SU-ITER-092-batch2 · Vitest setup.
//
// `@testing-library/jest-dom` ships a vitest-compatible entry that
// extends `expect` with DOM matchers (toBeInTheDocument, toBeDisabled,
// toHaveTextContent, ...).  Importing it here ensures matchers are
// available across every test file — including pure-logic specs that
// happen to import from a shared helper that pulls in DOM utilities.
// The matchers themselves are only meaningful inside a jsdom file, but
// the side-effect import is cheap (<1ms) on node.
import '@testing-library/jest-dom/vitest';
