// The owner's OpenPGP release key, which signs SHA256SUMS of every release (docs/RELEASING.md):
// sign-release.mjs signs with it, and verify-markdown.mjs checks that the documents a person reads
// before trusting a download show this fingerprint and no other.

/** The fingerprint of the release key. */
export const SIGNING_KEY = "28FC51B1DB80DF2101128CB30EDD4814591DD095";

/**
 * The documents that show the fingerprint. The changelog and the release notes are frozen records
 * of their releases and are not checked.
 */
export const KEY_DOCUMENTS = Object.freeze(["README.md", "docs/CLI.md", "docs/RELEASING.md"]);

/**
 * A fingerprint of an OpenPGP v4 key: 40 hexadecimal digits in either case, maybe in groups of
 * four with any whitespace between them, such as the two spaces after the fifth group that
 * `gpg --fingerprint` prints, or a line break.
 */
const FINGERPRINT = /\b[0-9A-Fa-f]{4}(?:\s*[0-9A-Fa-f]{4}){9}\b/gu;

/**
 * The fingerprints that `text` shows, each without its whitespace and in upper case, the form of
 * SIGNING_KEY, so that a key written in another form is still compared with it.
 */
export function shownFingerprints(text) {
  return [...text.matchAll(FINGERPRINT)].map((match) => match[0].replace(/\s/gu, "").toUpperCase());
}
