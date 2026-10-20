// The codes of the encryption of candidate lists (core.candidate-encryption): one list for the
// module of its age operations (candidate-cipher.ts) and the module that gates them behind their
// self-test (candidate-encryption.ts), so that a code keeps its name whichever of the two refuses.

import { ErrorCatalog } from "./error-catalog.js";

/** Stable refusal codes and default messages of the encryption of candidate lists. */
export const ERRORS = new ErrorCatalog("core.candidate-encryption", {
  "no-webcrypto": () =>
    "An age key (X25519) needs WebCrypto (crypto.subtle), which is missing here: a browser offers it only on a secure page, opened as a file, from localhost or over https.",
  "key-one-age-key-62-characters-starts-age1": () =>
    "The key must be one age key of 62 characters that starts with age1, as the Scanner shows it.",
  "use-at-least-characters-passphrase-all-protects-seed": (value0: string) =>
    `Use at least ${value0} characters for the passphrase: it is all that protects these seed phrases.`,
  "passphrase-candidates-empty": () => "The passphrase for the candidates is empty.",
  "not-protection-choice": {
    kind: "type",
    text: (choices: string) =>
      `The protection of a candidate list must be ${choices}, each field a text and no other field.`,
  },
  "not-session-identity": {
    kind: "type",
    text: () =>
      "The key of a candidate file must be a session identity, as createSessionIdentity or SessionIdentity.fromText makes it, or a passphrase.",
  },
  "self-test-failed": () => "Candidate encryption is unavailable because its self-test failed.",
  "unsupported-lock": () => "Candidate encryption needs either a Scanner key or a passphrase.",
});
