/**
 * Browser bundle stub for Node built-ins. @xenova/transformers `env.js` does
 * `Object.keys(fs)` at module load; an undefined `fs` from webpack throws.
 * An empty object yields `isEmpty` === true and disables Node file-system paths.
 */
const empty: Record<string, never> = {};
export default empty;
