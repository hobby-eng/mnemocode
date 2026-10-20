// The exit of a test child whose declared fault was never reached. The child preload
// (virtual-build.mjs) imports this module through Node's own type stripping, so it stays erasable
// TypeScript with no imports.

/**
 * The exit code of a child whose declared fault was not reached: it differs from both application
 * success (0) and refusal (1), so that an unreached fault cannot pass as a result of the program.
 */
export const UNREACHED_FAULT_EXIT = 97;
