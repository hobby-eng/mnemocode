// The self-test of the writing of a candidate list (core/candidate-list-writer.ts), which every
// --candidate-list and the menu's lists go through: the entropy of three public phrases written in
// the open gives the published list; no candidate writes no list; and a BIP39 passphrase longer
// than a list stores is refused before any search (AUD-037-FUN005). It answers later, so
// core/self-test.ts runs it only in the full self-test.
//
// It needs nothing from the host. It holds public test data, no secret.
//
// Host-neutral: it imports only core modules.

import { protectionFor } from "./candidate-encryption.js";
import { CandidateListWriter } from "./candidate-list-writer.js";
import { MAX_PASSPHRASE_BYTES } from "./candidate-list.js";
import { THREE_PHRASES_ENTROPY, THREE_PHRASES_LIST } from "./candidate-list-self-test.js";
import { bytesOfHex, expectRefused, expectSame, hexOfBytes } from "./self-test-check.js";

/** One byte more than the BIP39 passphrase that a list stores. */
const TOO_LONG_PASSPHRASE = "x".repeat(MAX_PASSPHRASE_BYTES + 1);

/** The published list written, a list of no candidate, and a passphrase refused. */
export async function checkCandidateListWriter(): Promise<void> {
  using protection = protectionFor({ kind: "none" });
  using writer = new CandidateListWriter(protection);
  const written = await writer.write(THREE_PHRASES_ENTROPY.map((entropy) => bytesOfHex(entropy)));
  expectSame(written.kind, "list", "Candidate list written");
  if (written.kind === "list") {
    const { list } = written;
    try {
      expectSame(hexOfBytes(list.bytes), THREE_PHRASES_LIST, "Candidate list written: bytes");
      expectSame(list.records, THREE_PHRASES_ENTROPY.length, "Candidate list written: records");
      expectSame(list.encrypted, false, "Candidate list written in the open");
    } finally {
      list.bytes.fill(0);
    }
  }
  expectSame((await writer.write([])).kind, "empty", "Candidate list of no candidate");
  expectRefused(
    // A writer that takes it after all is wiped at once.
    () => new CandidateListWriter(protection, TOO_LONG_PASSPHRASE).wipe(),
    /longer than/u,
    "A BIP39 passphrase longer than a list stores",
  );
}
