// Writes vectors/candidates-v1.json from the built core (run `pnpm build` first): the candidate
// order of docs/CANDIDATES.md, the list layout with its padding, and age files that hosts must
// open or refuse. age encryption is randomized, so its files are made once and then kept: run with
// --new-age-files to make them again. Every key and passphrase here is public test data.

import { readFileSync, writeFileSync } from "node:fs";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Encrypter, generateHybridIdentity, identityToRecipient } from "age-encryption";
import {
  parseMissingWord,
  parseUnknownWords,
  phraseOfWords,
  searchCandidates,
  searchCombinations,
  entropyOfWords,
} from "../dist/core/candidates.js";
import { encodeCandidateList, padmeLength } from "../dist/core/candidate-list.js";
import { crc32 } from "../dist/sskr/checksum.js";
import {
  createSessionIdentity,
  encryptCandidates,
  encryptCandidatesWithPassphrase,
  SCRYPT_LOG_N,
} from "../dist/core/candidate-encryption.js";

const PATH = new URL("../vectors/candidates-v1.json", import.meta.url);
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const fromHex = (text) => Uint8Array.from(Buffer.from(text, "hex"));
const repeat = (word, times) => Array(times).fill(word).join(" ");

/** Public BIP39 test phrases (BIP-0039 reference vectors). */
const LEGAL = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const LEGAL_18 =
  "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal will";
const LETTER_24 =
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless";

const searches = [
  { name: "one forgotten word", kind: "unknown-words", text: `${repeat("abandon", 11)} ?` },
  {
    name: "two forgotten words, the first and the last",
    kind: "unknown-words",
    text: `? ${repeat("abandon", 10)} ?`,
    samples: [1, 2, 128, 129, 131_072, 262_143, 262_144],
  },
  {
    name: "a prefix and a choice of words",
    kind: "unknown-words",
    text: `abandon ab* ${repeat("abandon", 9)} zoo|zone|about|abandon`,
  },
  {
    name: "a choice written out of list order",
    kind: "unknown-words",
    text: `zoo|abandon|about ${repeat("abandon", 10)} ?`,
  },
  {
    name: "a forgotten word in the middle",
    kind: "unknown-words",
    text: LEGAL.split(" ")
      .map((word, index) => (index === 4 ? "?" : word))
      .join(" "),
  },
  {
    name: "one forgotten word of 15",
    kind: "unknown-words",
    text: `${repeat("abandon", 7)} ? ${repeat("abandon", 6)} address`,
  },
  {
    name: "one forgotten word of 18",
    kind: "unknown-words",
    text: LEGAL_18.split(" ")
      .map((word, index) => (index === 0 ? "?" : word))
      .join(" "),
  },
  {
    name: "one forgotten word of 21",
    kind: "unknown-words",
    text: `${repeat("abandon", 20)} ?`,
  },
  {
    name: "one forgotten word of 24",
    kind: "unknown-words",
    text: LETTER_24.split(" ")
      .map((word, index) => (index === 23 ? "?" : word))
      .join(" "),
  },
  {
    name: "a missing word among repeated words",
    kind: "missing-word",
    text: `${repeat("abandon", 10)} about`,
    contains: `${repeat("abandon", 11)} about`,
  },
  {
    name: "a missing word of 24",
    kind: "missing-word",
    text: LETTER_24.split(" ")
      .filter((_, index) => index !== 9)
      .join(" "),
    contains: LETTER_24,
  },
];

function searchVector(search) {
  const parsed =
    search.kind === "unknown-words"
      ? parseUnknownWords(search.text)
      : parseMissingWord(search.text);
  const phrases = [];
  for (const words of searchCandidates(parsed)) phrases.push(phraseOfWords(words));
  const at = (number) => ({
    number,
    phrase: phrases[number - 1],
    entropy: hex(entropyOfWords(phrases[number - 1].split(" ").map((w) => wordlist.indexOf(w)))),
  });
  const samples = search.samples ?? [1, 2, phrases.length];
  const vector = {
    name: search.name,
    kind: search.kind,
    text: search.text,
    combinations: searchCombinations(parsed),
    count: phrases.length,
    candidates: [...new Set(samples)].map(at),
  };
  if (search.contains !== undefined) vector.contains = at(phrases.indexOf(search.contains) + 1);
  // Small lists are given whole, so that a host can compare every record.
  if (phrases.length <= 256) vector.all = phrases;
  return vector;
}

const entropy = (phrase) => entropyOfWords(phrase.split(" ").map((word) => wordlist.indexOf(word)));
const small = [`${repeat("abandon", 11)} about`, LEGAL, `${repeat("zoo", 11)} wrong`];
const lists = [
  { name: "three phrases", list: { records: small.map((p) => ({ entropy: entropy(p) })) } },
  {
    name: "a passphrase for all",
    list: { passphrase: "TREZOR", records: small.map((p) => ({ entropy: entropy(p) })) },
  },
  {
    name: "passphrases of their own, the second falling back to the one for all",
    list: {
      passphrase: "TREZOR",
      records: [
        { entropy: entropy(small[0]), passphrase: "pässwörd" },
        { entropy: entropy(small[1]) },
        { entropy: entropy(small[2]), passphrase: "ｐａｓｓ 🔑" },
      ],
    },
  },
  { name: "24 words", list: { records: [{ entropy: entropy(LETTER_24) }] } },
  {
    name: "15, 18 and 21 words are 20, 24 and 28 bytes: one length per list",
    list: { records: [{ entropy: Uint8Array.from({ length: 20 }, (_, i) => i) }] },
  },
  { name: "18 words", list: { records: [{ entropy: entropy(LEGAL_18) }] } },
  {
    name: "21 words",
    list: { records: [{ entropy: Uint8Array.from({ length: 28 }, (_, i) => 255 - i) }] },
  },
  {
    name: "passphrases that start with a byte order mark, kept as stored",
    list: {
      passphrase: "\uFEFFTREZOR",
      records: [
        { entropy: entropy(small[0]), passphrase: "\uFEFF" },
        { entropy: entropy(small[1]) },
      ],
    },
  },
].map(({ name, list }) => ({
  name,
  passphrase: list.passphrase,
  records: list.records.map((record) => ({
    phrase: entropyToMnemonic(record.entropy, wordlist),
    entropy: hex(record.entropy),
    ...(record.passphrase === undefined ? {} : { passphrase: record.passphrase }),
  })),
  bytes: hex(encodeCandidateList(list)),
}));

/**
 * Lists a reader must refuse, each a valid list with one thing broken and, where a field rule is
 * meant, its CRC-32 and padding written anew, so that only that rule can refuse it.
 */
const CRC_BYTES = 4;
/** A list from raw content: CRC-32 and Padmé padding as a writer would add them. */
function sealed(content) {
  const length = content.length + CRC_BYTES;
  const bytes = new Uint8Array(padmeLength(length));
  bytes.set(content);
  new DataView(bytes.buffer).setUint32(content.length, crc32(content));
  return bytes;
}
const three = fromHex(lists[0].bytes);
const threeContent = three.subarray(0, 11 + 3 * 16);
const withPassphraseField = (flags, fieldBytes) =>
  Uint8Array.from([
    ...threeContent.subarray(0, 5),
    flags,
    ...threeContent.subarray(6, 11),
    ...fieldBytes,
    ...threeContent.subarray(11),
  ]);
const changed = (offset, value) => {
  const content = Uint8Array.from(threeContent);
  content[offset] = value;
  return sealed(content);
};
const invalidLists = [
  { name: "wrong magic", refusal: "not a MnemoCode candidate list", bytes: changed(0, 0x4e) },
  { name: "version 2", refusal: "version", bytes: changed(4, 2) },
  { name: "an unknown flag", refusal: "flags", bytes: changed(5, 4) },
  { name: "entropy length 17", refusal: "entropy length", bytes: changed(6, 17) },
  {
    name: "no records",
    refusal: "record count",
    bytes: sealed(Uint8Array.from([...threeContent.subarray(0, 7), 0, 0, 0, 0])),
  },
  {
    name: `${2 ** 19 + 1} records`,
    refusal: "record count",
    bytes: sealed(
      Uint8Array.from([...threeContent.subarray(0, 7), 0, 8, 0, 1, ...threeContent.subarray(11)]),
    ),
  },
  {
    name: "a passphrase for all of length 0",
    refusal: "wrong length",
    bytes: sealed(withPassphraseField(1, [0, 0])),
  },
  {
    name: "a passphrase for all of 257 bytes",
    refusal: "wrong length",
    bytes: sealed(withPassphraseField(1, [1, 1, ...Array(257).fill(0x61)])),
  },
  {
    name: "a passphrase that is not UTF-8",
    refusal: "UTF-8",
    bytes: sealed(withPassphraseField(1, [0, 2, 0xc3, 0x28])),
  },
  {
    name: "a damaged record",
    refusal: "CRC-32",
    bytes: (() => {
      const bytes = Uint8Array.from(three);
      bytes[11] ^= 1;
      return bytes;
    })(),
  },
  {
    name: "a padding byte that is not zero",
    refusal: "padding",
    bytes: (() => {
      const bytes = Uint8Array.from(three);
      bytes[bytes.length - 1] = 1;
      return bytes;
    })(),
  },
  { name: "a byte too many", refusal: "padding", bytes: Uint8Array.from([...three, 0]) },
  { name: "a byte too few", refusal: "", bytes: three.subarray(0, three.length - 1) },
].map((vector) => ({ ...vector, bytes: hex(vector.bytes) }));

const padme = [31, 32, 63, 100, 1000, 4097, 65_536, 2 ** 19 * 16 + 15, 2 ** 19 * 32 + 15].map(
  (length) => ({ length, padded: padmeLength(length) }),
);

async function ageVectors(previous) {
  if (previous !== undefined && !process.argv.includes("--new-age-files")) return previous;
  const plain = fromHex(lists[0].bytes);
  const { identity, recipient } = await createSessionIdentity();
  const passphrase = "public candidate test passphrase";
  const other = await createSessionIdentity();
  const twoKeys = new Encrypter();
  twoKeys.addRecipient(recipient);
  twoKeys.addRecipient(other.recipient);
  const weak = new Encrypter();
  weak.setPassphrase(passphrase);
  weak.setScryptWorkFactor(SCRYPT_LOG_N - 2);
  // Kept, so that a reader can see that the file opens with it and must still be refused.
  const hybridIdentity = await generateHybridIdentity();
  const hybrid = new Encrypter();
  hybrid.addRecipient(await identityToRecipient(hybridIdentity));
  return {
    warning: "Public test keys and passphrase. Never use them for anything real.",
    identity,
    recipient,
    passphrase,
    hybridIdentity,
    plaintext: lists[0].bytes,
    open: [
      { name: "to the session key", file: hex(await encryptCandidates(plain, recipient)) },
      {
        name: "with the passphrase",
        file: hex(await encryptCandidatesWithPassphrase(plain, passphrase)),
      },
    ],
    refuse: [
      { name: "the session key and a second key", file: hex(await twoKeys.encrypt(plain)) },
      { name: "a post-quantum recipient", file: hex(await hybrid.encrypt(plain)) },
      { name: `the scrypt work factor ${SCRYPT_LOG_N - 2}`, file: hex(await weak.encrypt(plain)) },
    ],
  };
}

let previous;
try {
  previous = JSON.parse(readFileSync(PATH, "utf8")).age;
} catch {
  previous = undefined;
}
const vectors = {
  version: 1,
  description:
    "Candidate searches, lists and their age encryption (docs/CANDIDATES.md). Written by scripts/candidate-vectors.mjs.",
  searches: searches.map(searchVector),
  lists,
  invalidLists,
  padme,
  age: await ageVectors(previous),
};
writeFileSync(PATH, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`Wrote ${PATH.pathname}`);
