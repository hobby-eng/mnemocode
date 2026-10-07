// White space around what a person types or pastes, removed the same way by every wallet check,
// whether it reads an address, a key, a WIF or a fingerprint.
//
// Host-neutral: it imports nothing (test/portable-modules.test.ts).

/** White space at either end of `text`, as people paste and type it. */
const WHITE_SPACE_AT_ENDS = /^\p{White_Space}+|\p{White_Space}+$/gu;

/**
 * `text` without white space at its ends: Unicode's White_Space, as Rust's str::trim takes it, so
 * that a value reads the same here as in the Rust implementations of these checks.
 * String.prototype.trim differs in two characters: it removes a byte order mark (U+FEFF), which is
 * no white space, and keeps NEL (U+0085), which is.
 */
export function trimWhiteSpace(text: string): string {
  return text.replace(WHITE_SPACE_AT_ENDS, "");
}
