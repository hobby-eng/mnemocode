// The self-test of the candidate list (core/candidate-list.ts, docs/CANDIDATES.md, "The list"):
// the published bytes of a list of three phrases, written and read, the padded lengths of Padmé,
// and the lists that a reader refuses. core/self-test.ts runs it before every command of the
// command line and in the full self-test.
//
// It needs nothing from the host. It holds public test data, no secret.
//
// Host-neutral: it imports only core/candidate-list.ts and core/self-test-check.ts.

import { decodeCandidateList, encodeCandidateList, padmeLength } from "./candidate-list.js";
import { bytesOfHex, expectRefused, expectSame, hexOfBytes } from "./self-test-check.js";

/**
 * vectors/candidates-v1.json, "three phrases": the entropy of the public phrases of BIP39's first,
 * second and fourth vectors, and their list without passphrases. The bytes were written again
 * independently with Python's struct and zlib from docs/CANDIDATES.md.
 */
export const THREE_PHRASES_ENTROPY = [
  "00000000000000000000000000000000",
  "7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f",
  "ffffffffffffffffffffffffffffffff",
] as const;
export const THREE_PHRASES_LIST =
  "4d4e434c01001000000003000000000000000000000000000000007f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7fffffffffffffffffffffffffffffffff98854aa000";

/** Lists that a reader refuses (vectors/candidates-v1.json, "invalidLists"), and why. */
const REFUSED_LISTS: readonly (readonly [string, string, RegExp])[] = [
  [
    "a damaged record",
    "4d4e434c01001000000003010000000000000000000000000000007f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7fffffffffffffffffffffffffffffffff98854aa000",
    /CRC-32/u,
  ],
  [
    "version 2",
    "4d4e434c02001000000003000000000000000000000000000000007f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7ffffffffffffffffffffffffffffffffffe819f9000",
    /version 2/u,
  ],
  ["a byte too many", `${THREE_PHRASES_LIST}00`, /padding/u],
];

/**
 * Lengths before and after Padmé (vectors/candidates-v1.json, "padme"), computed again
 * independently with Python from the formula of docs/CANDIDATES.md.
 */
const PADME_LENGTHS: readonly (readonly [number, number])[] = [
  [100, 104],
  [4_097, 4_352],
  [8_388_623, 8_650_752],
];

/** The list of three phrases written and read, the padded lengths, and the lists refused. */
export function checkCandidateListStartup(): void {
  const records = THREE_PHRASES_ENTROPY.map((entropy) => ({ entropy: bytesOfHex(entropy) }));
  expectSame(hexOfBytes(encodeCandidateList({ records })), THREE_PHRASES_LIST, "Candidate list");
  const list = decodeCandidateList(bytesOfHex(THREE_PHRASES_LIST));
  expectSame(list.passphrase, undefined, "Candidate list passphrase");
  expectSame(
    list.records.map((record) => hexOfBytes(record.entropy)).join(" "),
    THREE_PHRASES_ENTROPY.join(" "),
    "Candidate list records",
  );
  for (const [length, padded] of PADME_LENGTHS)
    expectSame(padmeLength(length), padded, `Padmé length of ${length}`);
  for (const [name, bytes, because] of REFUSED_LISTS)
    expectRefused(() => decodeCandidateList(bytesOfHex(bytes)), because, `A list with ${name}`);
}
