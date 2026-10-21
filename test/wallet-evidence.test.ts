// The host-neutral wallet check of src/core/wallet-evidence.ts, built as a browser page builds it:
// with a PBKDF2 function of its own. Published test vectors of the public test phrase only.
import { pbkdf2Sync } from "node:crypto";
import { afterEach, describe, expect, it, vi, type MockResult } from "vitest";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { HDKey, type Versions } from "@scure/bip32";
import {
  DEFAULT_ADDRESS_COUNT,
  defaultAddressCount,
  EVIDENCE_MATCHED_BY,
  isPlacedEvidence,
  isTestNetwork,
  MAX_ADDRESS_COUNT,
  WalletEvidenceCheck,
  BITCOIN_PROFILES,
  parseBitcoinAddress,
  parseMasterFingerprint,
  type BitcoinEvidence,
  type BitcoinProfile,
  type DerivationLocation,
  type EvidenceMatch,
  type Pbkdf2HmacSha512,
  type WalletEvidence,
} from "../src/core/wallet-evidence.js";
import {
  masterFingerprint,
  matchBitcoinEvidence,
  assertBitcoinEvidence,
} from "../src/bitcoin-evidence.js";
import { BITCOIN } from "../src/core/coins/bitcoin-like.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

/** The pure JavaScript PBKDF2 that @scure/bip39 uses, as a page passes it. */
const noblePbkdf2 = ((password, salt, rounds, bytes) =>
  pbkdf2(sha512, password, salt, { c: rounds, dkLen: bytes })) satisfies Pbkdf2HmacSha512;
const browserCheck = new WalletEvidenceCheck(noblePbkdf2, [BITCOIN]);

/** The BIP84 vectors of the public phrase (BIP-0084, "Test vectors"). */
const BIP84 = {
  rootZpub:
    "zpub6jftahH18ngZxLmXaKw3GSZzZsszmt9WqedkyZdezFtWRFBZqsQH5hyUmb4pCEeZGmVfQuP5bedXTB8is6fTv19U1GQRyQUKQGUTzyHACMF",
  accountZpub:
    "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs",
  firstReceiving: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  firstReceivingPublicKey: "0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c",
  firstReceivingWif: "KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d",
  firstChange: "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el",
};
/** BIP-0086, "Test vectors": account 0 and its first receiving address. */
const BIP86 = {
  accountXpub:
    "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ",
  firstReceiving: "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
};
/** BIP-0049, "Test vectors", which are on testnet. */
const BIP49_TESTNET = {
  accountUpub:
    "upub5EFU65HtV5TeiSHmZZm7FUffBGy8UKeqp7vw43jYbvZPpoVsgU93oac7Wk3u6moKegAEWtGNF8DehrnHtv21XXEMYRUocHqguyjknFHYfgY",
  firstReceiving: "2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2",
};
/** The BIP39 vector of the public phrase with the passphrase TREZOR (trezor/python-mnemonic). */
const TREZOR_ROOT_XPRV =
  "xprv9s21ZrQH143K3h3fDYiay8mocZ3afhfULfb5GX8kCBdno77K4HiA15Tg23wpbeF1pLfs1c5SPmYHrEpTuuRhxMwvKDwqdKiGJS9XFKzUsAF";

/** SLIP-0132 version bytes of every extended public key form, by prefix. */
const VERSIONS: Readonly<Record<string, Versions>> = {
  xpub: { private: 0x0488ade4, public: 0x0488b21e },
  ypub: { private: 0x049d7878, public: 0x049d7cb2 },
  zpub: { private: 0x04b2430c, public: 0x04b24746 },
  Ypub: { private: 0x0295b005, public: 0x0295b43f },
  Zpub: { private: 0x02aa7a99, public: 0x02aa7ed3 },
  tpub: { private: 0x04358394, public: 0x043587cf },
  upub: { private: 0x044a4e28, public: 0x044a5262 },
  vpub: { private: 0x045f18bc, public: 0x045f1cf6 },
  Upub: { private: 0x024285b5, public: 0x024289ef },
  Vpub: { private: 0x02575048, public: 0x02575483 },
};

/** The same public key written in the form of `prefix`. */
function inForm(key: HDKey, prefix: string): string {
  return new HDKey({
    versions: VERSIONS[prefix]!,
    depth: key.depth,
    index: key.index,
    parentFingerprint: key.parentFingerprint,
    chainCode: key.chainCode!,
    publicKey: key.publicKey!,
  }).publicExtendedKey;
}

const MAINNET_LOCATION: DerivationLocation = {
  network: "mainnet",
  account: 0,
  branch: 0,
  index: 0,
};
const TESTNET_LOCATION: DerivationLocation = { ...MAINNET_LOCATION, network: "testnet" };

function located(
  kind: "address" | "compressed-public-key" | "wif" | "account-xpub",
  value: string,
  profiles: readonly BitcoinProfile[],
  location: DerivationLocation = MAINNET_LOCATION,
): BitcoinEvidence {
  return { kind, value, profiles, location };
}

/** A host PBKDF2 that records what it gets and keeps every seed it gives, to look at them later. */
function recordingHost() {
  const calls: { password: string; salt: string; rounds: number; bytes: number }[] = [];
  const seeds: Uint8Array[] = [];
  const host: Pbkdf2HmacSha512 = (password, salt, rounds, bytes) => {
    calls.push({ password, salt, rounds, bytes });
    const seed = noblePbkdf2(password, salt, rounds, bytes);
    seeds.push(seed);
    return seed;
  };
  return { check: new WalletEvidenceCheck(host, [BITCOIN]), calls, seeds };
}

const cases: readonly [string, BitcoinEvidence, EvidenceMatch][] = [
  [
    "a master fingerprint",
    { kind: "master-fingerprint", value: "73C5DA0A", network: "mainnet" },
    {
      matched: true,
      kind: "master-fingerprint",
      derived: TEST_FINGERPRINT,
      path: "m",
      warning: "A master fingerprint is only 32 bits and is a filter, not proof of recovery.",
    },
  ],
  [
    "a master zpub",
    { kind: "master-xpub", value: BIP84.rootZpub, network: "mainnet" },
    {
      matched: true,
      kind: "master-xpub",
      derived: inForm(HDKey.fromExtendedKey(BIP84.rootZpub, VERSIONS.zpub), "xpub"),
      path: "m",
    },
  ],
  [
    "an account zpub",
    located("account-xpub", BIP84.accountZpub, ["legacy", "native-segwit"]),
    {
      matched: true,
      kind: "account-xpub",
      derived: inForm(HDKey.fromExtendedKey(BIP84.accountZpub, VERSIONS.zpub), "xpub"),
      path: "m/84'/0'/0'",
    },
  ],
  [
    "a Taproot account xpub",
    located("account-xpub", BIP86.accountXpub, ["taproot"]),
    { matched: true, kind: "account-xpub", derived: BIP86.accountXpub, path: "m/86'/0'/0'" },
  ],
  [
    "a native SegWit address among all four profiles",
    located("address", BIP84.firstReceiving, [
      "legacy",
      "nested-segwit",
      "native-segwit",
      "taproot",
    ]),
    { matched: true, kind: "address", derived: BIP84.firstReceiving, path: "m/84'/0'/0'/0/0" },
  ],
  [
    "a change address on branch 1",
    located("address", BIP84.firstChange, ["native-segwit"], { ...MAINNET_LOCATION, branch: 1 }),
    { matched: true, kind: "address", derived: BIP84.firstChange, path: "m/84'/0'/0'/1/0" },
  ],
  [
    "a Taproot address in upper case",
    located("address", BIP86.firstReceiving.toUpperCase(), ["taproot"]),
    { matched: true, kind: "address", derived: BIP86.firstReceiving, path: "m/86'/0'/0'/0/0" },
  ],
  [
    "a compressed public key",
    located("compressed-public-key", BIP84.firstReceivingPublicKey.toUpperCase(), [
      "native-segwit",
    ]),
    {
      matched: true,
      kind: "compressed-public-key",
      derived: BIP84.firstReceivingPublicKey,
      path: "m/84'/0'/0'/0/0",
    },
  ],
  [
    "a WIF given as its value",
    located("wif", ` ${BIP84.firstReceivingWif}\n`, ["native-segwit"]),
    // The public key of the WIF's key, never the private key (AUD-037-SEC009).
    { matched: true, kind: "wif", derived: BIP84.firstReceivingPublicKey, path: "m/84'/0'/0'/0/0" },
  ],
  [
    "a nested SegWit address on testnet",
    located("address", BIP49_TESTNET.firstReceiving, ["nested-segwit"], TESTNET_LOCATION),
    {
      matched: true,
      kind: "address",
      derived: BIP49_TESTNET.firstReceiving,
      path: "m/49'/1'/0'/0/0",
    },
  ],
  [
    "a testnet account upub",
    located("account-xpub", BIP49_TESTNET.accountUpub, ["nested-segwit"], TESTNET_LOCATION),
    {
      matched: true,
      kind: "account-xpub",
      derived: inForm(HDKey.fromExtendedKey(BIP49_TESTNET.accountUpub, VERSIONS.upub), "tpub"),
      path: "m/49'/1'/0'",
    },
  ],
  [
    "an address of another index",
    located("address", BIP84.firstReceiving, ["native-segwit"], { ...MAINNET_LOCATION, index: 1 }),
    { matched: false, kind: "address" },
  ],
  [
    "a key at another account",
    located("compressed-public-key", BIP84.firstReceivingPublicKey, ["native-segwit"], {
      ...MAINNET_LOCATION,
      account: 1,
    }),
    { matched: false, kind: "compressed-public-key" },
  ],
];

describe("every kind of wallet evidence, with a page's PBKDF2", () => {
  it.each(cases)("gives the declared wallet-check result for %s", (_, evidence, expected) => {
    expect(browserCheck.match(TEST_PHRASE, evidence)).toEqual(expected);
    // The Node.js module gives the same result from node:crypto.
    expect(matchBitcoinEvidence(TEST_PHRASE, evidence)).toEqual(expected);
  });

  it("compares a master key in every form, on its own network", () => {
    const root = HDKey.fromExtendedKey(BIP84.rootZpub, VERSIONS.zpub);
    for (const [prefix, network] of [
      ["xpub", "mainnet"],
      ["ypub", "mainnet"],
      ["zpub", "mainnet"],
      ["Ypub", "mainnet"],
      ["Zpub", "mainnet"],
      ["tpub", "testnet"],
      ["upub", "testnet"],
      ["vpub", "testnet"],
      ["Upub", "testnet"],
      ["Vpub", "testnet"],
    ] as const) {
      const value = inForm(root, prefix);
      expect(value.startsWith(prefix)).toBe(true);
      const result = browserCheck.match(TEST_PHRASE, { kind: "master-xpub", value, network });
      expect(result.matched, prefix).toBe(true);
      expect(result.derived).toBe(inForm(root, network === "mainnet" ? "xpub" : "tpub"));
      // The other network's form is refused, not compared.
      const other = network === "mainnet" ? "testnet" : "mainnet";
      expect(() =>
        browserCheck.match(TEST_PHRASE, { kind: "master-xpub", value, network: other }),
      ).toThrow("The extended-key prefix does not match the selected Bitcoin network.");
    }
  });

  it("uses the BIP39 passphrase", () => {
    const root = HDKey.fromExtendedKey(TREZOR_ROOT_XPRV);
    const evidence: BitcoinEvidence = {
      kind: "master-xpub",
      value: root.publicExtendedKey,
      network: "mainnet",
    };
    expect(browserCheck.match(TEST_PHRASE, evidence, "TREZOR").matched).toBe(true);
    expect(browserCheck.match(TEST_PHRASE, evidence).matched).toBe(false);
    const fingerprint = root.fingerprint.toString(16).padStart(8, "0");
    expect(browserCheck.fingerprint(TEST_PHRASE, "TREZOR")).toBe(fingerprint);
    expect(masterFingerprint(TEST_PHRASE, "TREZOR")).toBe(fingerprint);
    expect(browserCheck.fingerprint(TEST_PHRASE)).toBe(TEST_FINGERPRINT);
  });
});

describe("the host's PBKDF2", () => {
  it("gets NFKD text, the BIP39 salt, 2048 rounds and 64 bytes", () => {
    const { check, calls } = recordingHost();
    // A composed e-acute (U+00E9) in the passphrase and a no-break space (U+00A0) in the phrase:
    // NFKD decomposes the one and makes the other a space.
    check.fingerprint(TEST_PHRASE.replace(" ", "\u00a0"), "caf\u00e9");
    expect(calls).toEqual([
      { password: TEST_PHRASE, salt: "mnemoniccafe\u0301", rounds: 2048, bytes: 64 },
    ]);
  });

  it("gives seeds that are wiped before the check returns", () => {
    const { check, seeds } = recordingHost();
    check.fingerprint(TEST_PHRASE);
    check.match(TEST_PHRASE, located("wif", BIP84.firstReceivingWif, ["native-segwit"]));
    expect(seeds).toHaveLength(2);
    for (const seed of seeds) expect(seed.every((byte) => byte === 0)).toBe(true);
  });

  it("is not called for text that BIP39 refuses (AUD-008-API005)", () => {
    const { check, calls } = recordingHost();
    expect(() => check.fingerprint("abandon about")).toThrow(/Invalid mnemonic/u);
    expect(() => check.fingerprint(TEST_PHRASE, "\ud800")).toThrow(/well-formed/u);
    expect(() => check.fingerprint(`${TEST_PHRASE}\udc00`)).toThrow(/well-formed/u);
    // Passphrases and a phrase that are no text, given on purpose as a JavaScript host could.
    for (const passphrase of [null, 123, false, [], {}])
      expect(() => check.fingerprint(TEST_PHRASE, passphrase as never)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "core.master-fingerprint.expected-string-passphrase",
        }),
      );
    // A phrase that is no text, given on purpose too.
    expect(() => check.fingerprint(null as never)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "core.master-fingerprint.expected-string",
      }),
    );
    expect(calls).toEqual([]);
  });

  it("is not called for evidence that no wallet can match", () => {
    const { check, calls } = recordingHost();
    const evidenceCode = (code: string) => ({ code: `core.wallet-evidence.${code}` });
    const refused: readonly (readonly [BitcoinEvidence, { code: string; message?: string }])[] = [
      [
        located("address", "tb1qfm7ydz3n82zjh8m223yr6y6un0arn82u8w7a4r", ["native-segwit"]),
        evidenceCode("address-not-valid-bitcoin"),
      ],
      [
        located("wif", "L1-invalid-value", ["native-segwit"]),
        evidenceCode("wif-not-valid-bitcoin"),
      ],
      [
        located("compressed-public-key", `02${"ff".repeat(32)}`, ["native-segwit"]),
        evidenceCode("compressed-public-key-not-point-secp256k1-curve"),
      ],
      [
        located("account-xpub", BIP49_TESTNET.accountUpub, ["nested-segwit"]),
        evidenceCode("extended-key-prefix-does-not-match-selected-bitcoin"),
      ],
      [
        located("address", BIP84.firstReceiving, []),
        evidenceCode("at-least-one-bitcoin-address-profile-selected"),
      ],
      [
        located("address", BIP84.firstReceiving, ["native-segwit"], {
          ...MAINNET_LOCATION,
          index: -1,
        }),
        // The account, the branch and the index share this code; the message names the index.
        {
          code: "core.coins.coin.assert-address-location-refused",
          message: "index must be an integer from 0 through 2147483647.",
        },
      ],
      [
        { kind: "master-fingerprint", value: "73c5da0", network: "mainnet" },
        { code: "core.wallet-check.master-fingerprint-eight-hexadecimal-characters" },
      ],
      [
        {
          kind: "master-xpub",
          value: BIP84.accountZpub.replace("zpub", "zprv"),
          network: "mainnet",
        },
        evidenceCode("unsupported-extended-key-prefix-supported-public-forms-include"),
      ],
      [
        // A kind that no evidence has, given on purpose as a JavaScript host could:
        // assertBitcoinEvidence's check of the kind is what this case tests.
        { kind: "address-typo", value: "x" } as unknown as BitcoinEvidence,
        evidenceCode("unsupported-bitcoin-evidence-kind"),
      ],
    ];
    for (const [evidence, refusal] of refused) {
      expect(() => check.match(TEST_PHRASE, evidence), refusal.code).toThrow(
        expect.objectContaining(refusal),
      );
      expect(() => assertBitcoinEvidence(evidence), refusal.code).toThrow(
        expect.objectContaining(refusal),
      );
    }
    expect(calls).toEqual([]);
  });

  it("must give 64 bytes", () => {
    const short = new Uint8Array(32).fill(1);
    const check = new WalletEvidenceCheck(() => short, [BITCOIN]);
    expect(() => check.fingerprint(TEST_PHRASE)).toThrow("gave 32 bytes, not 64");
    expect(short.every((byte) => byte === 0)).toBe(true);
    // A host function that gives text, given on purpose as a JavaScript host could.
    const text = new WalletEvidenceCheck((() => "seed") as unknown as Pbkdf2HmacSha512, [BITCOIN]);
    expect(() => text.fingerprint(TEST_PHRASE)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "core.master-fingerprint.host-s-pbkdf2-gave-no-bytes",
      }),
    );
    // No host function at all, given on purpose too.
    expect(() => new WalletEvidenceCheck(undefined as never, [BITCOIN])).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "core.master-fingerprint.wallet-check-host-s-pbkdf2-hmac-sha512-function",
      }),
    );
  });

  it("can be node:crypto's, with the same result", () => {
    const node = new WalletEvidenceCheck(
      (password, salt, rounds, bytes) =>
        Uint8Array.from(pbkdf2Sync(password, salt, rounds, bytes, "sha512")),
      [BITCOIN],
    );
    for (const passphrase of ["", "TREZOR", "😀 two words"])
      expect(node.fingerprint(TEST_PHRASE, passphrase)).toBe(
        browserCheck.fingerprint(TEST_PHRASE, passphrase),
      );
  });
});

describe("a PBKDF2 that answers later, as WebCrypto's does", () => {
  /** WebCrypto's PBKDF2-HMAC-SHA512, which answers with a promise, as a page has it. */
  const webCryptoPbkdf2: Pbkdf2HmacSha512 = async (password, salt, rounds, bytes) => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
      "deriveBits",
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-512", salt: encoder.encode(salt), iterations: rounds },
      key,
      bytes * 8,
    );
    return new Uint8Array(bits);
  };
  const webCheck = new WalletEvidenceCheck(webCryptoPbkdf2, [BITCOIN]);

  it("matches and fingerprints with matchAsync and fingerprintAsync, as the synchronous forms do", async () => {
    await expect(webCheck.fingerprintAsync(TEST_PHRASE)).resolves.toBe(TEST_FINGERPRINT);
    const evidence: BitcoinEvidence = {
      kind: "address",
      value: BIP84.firstReceiving,
      profiles: ["native-segwit"],
      location: { network: "mainnet", account: 0, branch: 0, index: 0 },
    };
    await expect(webCheck.matchAsync(TEST_PHRASE, evidence)).resolves.toEqual(
      browserCheck.match(TEST_PHRASE, evidence),
    );
    await expect(webCheck.fingerprintAsync(TEST_PHRASE, "TREZOR")).resolves.toBe(
      browserCheck.fingerprint(TEST_PHRASE, "TREZOR"),
    );
    // The synchronous forms of the page's own PBKDF2 answer in the same way.
    await expect(browserCheck.fingerprintAsync(TEST_PHRASE)).resolves.toBe(TEST_FINGERPRINT);
  });

  it("is refused by the synchronous forms, with a line that names the forms to use", () => {
    expect(() => webCheck.fingerprint(TEST_PHRASE)).toThrow(
      "The host's PBKDF2 answers later: use matchAsync or fingerprintAsync with it.",
    );
  });

  it("checks the phrase before the host's work, and the bytes it gives", async () => {
    const pbkdf2Spy = vi.fn(webCryptoPbkdf2);
    await expect(
      new WalletEvidenceCheck(pbkdf2Spy, [BITCOIN]).fingerprintAsync("abandon"),
    ).rejects.toThrow("Invalid mnemonic");
    expect(pbkdf2Spy).not.toHaveBeenCalled();
    const short = new WalletEvidenceCheck(async () => new Uint8Array(32), [BITCOIN]);
    await expect(short.fingerprintAsync(TEST_PHRASE)).rejects.toThrow(
      "The host's PBKDF2 gave 32 bytes, not 64.",
    );
  });
});

describe("the validators, which need no phrase", () => {
  it("read a master fingerprint as typed", () => {
    expect(parseMasterFingerprint(" 73C5DA0A ")).toBe("73c5da0a");
    expect(() => parseMasterFingerprint("73c5da0g")).toThrow(
      "A master fingerprint must be eight hexadecimal characters.",
    );
  });

  it("read an address in the form the comparison derives, or name what it is", () => {
    expect(parseBitcoinAddress(BIP86.firstReceiving.toUpperCase(), "mainnet")).toBe(
      BIP86.firstReceiving,
    );
    expect(() => parseBitcoinAddress(BIP49_TESTNET.firstReceiving, "mainnet")).toThrow(
      "The address is not valid for Bitcoin mainnet; it is a testnet address.",
    );
    expect(() => parseBitcoinAddress("bc1q-invalid", "mainnet")).toThrow(
      /^The address is not valid for Bitcoin mainnet\.$/u,
    );
    // A P2WSH address, of a script and not of one key (BIP-0173 test vector).
    expect(() =>
      parseBitcoinAddress(
        "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
        "mainnet",
      ),
    ).toThrow(
      "The address cannot be used for the check: it is not the address of a single key; only bc1q with 42 characters or bc1p can be checked.",
    );
  });

  it("tell testnet as the test network and mainnet as none (CORE-14)", () => {
    expect(isTestNetwork("testnet")).toBe(true);
    expect(isTestNetwork("mainnet")).toBe(false);
  });

  it("accept every kind that a wallet can match", () => {
    expect(() =>
      assertBitcoinEvidence({ kind: "master-xpub", value: BIP84.rootZpub, network: "mainnet" }),
    ).not.toThrow();
    expect(() =>
      assertBitcoinEvidence(located("wif", BIP84.firstReceivingWif, ["native-segwit"])),
    ).not.toThrow();
    expect(() =>
      assertBitcoinEvidence(
        located("account-xpub", BIP49_TESTNET.accountUpub, ["nested-segwit"], TESTNET_LOCATION),
      ),
    ).not.toThrow();
  });
});

describe("what a line about a match names, for each kind of evidence", () => {
  const named: readonly (readonly [WalletEvidence["kind"], string])[] = [
    ["master-fingerprint", "fingerprint"],
    ["master-xpub", "key"],
    ["account-xpub", "key"],
    ["address", "address"],
    ["compressed-public-key", "key"],
    ["wif", "key"],
    ["coin-address", "address"],
  ];

  it.each(named)("a line about a match of %s evidence names the %s", (kind, subject) => {
    expect(EVIDENCE_MATCHED_BY[kind]).toBe(subject);
  });

  it("names every kind of evidence, and nothing else", () => {
    expect(Object.keys(EVIDENCE_MATCHED_BY).sort()).toEqual(named.map(([kind]) => kind).sort());
  });
});

describe("evidence of a key at a place of an account", () => {
  const coinAddress: WalletEvidence = {
    kind: "coin-address",
    coin: "bitcoin",
    value: BIP84.firstReceiving,
    location: { account: 0, branch: 0, index: 0 },
  };
  const every: readonly WalletEvidence[] = [...cases.map(([, evidence]) => evidence), coinAddress];
  const kindsOf = (evidence: readonly WalletEvidence[]) =>
    [...new Set(evidence.map(({ kind }) => kind))].sort();

  it("is every kind but the master key's, each with its location", () => {
    const placed = every.filter(isPlacedEvidence);
    expect(kindsOf(placed)).toEqual([
      "account-xpub",
      "address",
      "coin-address",
      "compressed-public-key",
      "wif",
    ]);
    for (const evidence of placed) expect(evidence.location).toHaveProperty("index");
    expect(kindsOf(every.filter((evidence) => !isPlacedEvidence(evidence)))).toEqual([
      "master-fingerprint",
      "master-xpub",
    ]);
  });

  it("is not evidence of a kind that has no level, such as an inherited name", () => {
    // A kind that no evidence has, fed on purpose with the wrong type: it names no place.
    expect(isPlacedEvidence({ ...coinAddress, kind: "toString" } as never)).toBe(false);
  });
});

describe("several addresses in a row, from the location's index on", () => {
  /** BIP-0084, "Test vectors": account 0, second receiving address, m/84'/0'/0'/0/1. */
  const SECOND_RECEIVING = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g";
  const second = (
    addresses: number | undefined,
    location: DerivationLocation = MAINNET_LOCATION,
  ): BitcoinEvidence => ({
    kind: "address",
    value: SECOND_RECEIVING,
    profiles: BITCOIN_PROFILES,
    location,
    ...(addresses === undefined ? {} : { addresses }),
  });

  it("finds an address among them, at its own path, and only there", () => {
    expect(browserCheck.match(TEST_PHRASE, second(undefined)).matched).toBe(false);
    expect(browserCheck.match(TEST_PHRASE, second(1)).matched).toBe(false);
    for (const addresses of [2, DEFAULT_ADDRESS_COUNT])
      expect(browserCheck.match(TEST_PHRASE, second(addresses))).toEqual({
        matched: true,
        kind: "address",
        derived: SECOND_RECEIVING,
        path: "m/84'/0'/0'/0/1",
      });
    // From the third address on, the second is not among them.
    expect(
      browserCheck.match(
        TEST_PHRASE,
        second(DEFAULT_ADDRESS_COUNT, { ...MAINNET_LOCATION, index: 2 }),
      ).matched,
    ).toBe(false);
  });

  it("compares a public key and a WIF the same way", () => {
    const later = { ...MAINNET_LOCATION, index: 0 };
    const profiles: readonly BitcoinProfile[] = ["native-segwit"];
    const wide: readonly BitcoinEvidence[] = [
      {
        kind: "compressed-public-key",
        value: BIP84.firstReceivingPublicKey,
        profiles,
        location: later,
        addresses: 5,
      },
      { kind: "wif", value: BIP84.firstReceivingWif, profiles, location: later, addresses: 5 },
    ];
    for (const evidence of wide)
      expect(browserCheck.match(TEST_PHRASE, evidence).path).toBe("m/84'/0'/0'/0/0");
  });

  it("refuses a count on evidence that names no address, and trims as the coin checks do", () => {
    const counted = [
      { kind: "master-fingerprint", value: "73c5da0a", network: "mainnet", addresses: 0 },
      { kind: "master-xpub", value: BIP84.rootZpub, network: "mainnet", addresses: 2 },
      { ...located("account-xpub", BIP84.accountZpub, ["native-segwit"]), addresses: 1 },
    ];
    // Counts on kinds that take none, given on purpose as a JavaScript host could.
    for (const evidence of counted as BitcoinEvidence[])
      expect(() => assertBitcoinEvidence(evidence), evidence.kind).toThrow(
        "Only an address, an address of another coin, a compressed public key or a WIF is compared with several addresses.",
      );
    expect(defaultAddressCount(0)).toBe(DEFAULT_ADDRESS_COUNT);
    expect(defaultAddressCount(0x7fffffff)).toBe(1);
    // White space as Unicode defines it, as Rust's trim takes it: NEL is, a byte order mark is not.
    expect(parseBitcoinAddress(`\u0085${BIP84.firstReceiving}`, "mainnet")).toBe(
      BIP84.firstReceiving,
    );
    expect(() => parseBitcoinAddress(`\ufeff${BIP84.firstReceiving}`, "mainnet")).toThrow(
      expect.objectContaining({ code: "core.wallet-evidence.address-not-valid-bitcoin" }),
    );
  });

  it("refuses a number that is no count, or that would pass the last index", () => {
    for (const addresses of [0, -1, 1.5, MAX_ADDRESS_COUNT + 1, Number.NaN])
      expect(() => assertBitcoinEvidence(second(addresses)), String(addresses)).toThrow(
        `The number of addresses compared must be an integer from 1 through ${MAX_ADDRESS_COUNT}.`,
      );
    const last = { ...MAINNET_LOCATION, index: 0x7fffffff };
    expect(() => assertBitcoinEvidence(second(1, last))).not.toThrow();
    expect(() => assertBitcoinEvidence(second(2, last))).toThrow("would pass index 2147483647");
  });
});

describe("the keys that a comparison derives", () => {
  afterEach(() => vi.restoreAllMocks());

  /** The keys that the derivations of `results` returned; none of them may have failed. */
  function returnedKeys(results: readonly MockResult<HDKey>[]): HDKey[] {
    return results.map((result) => {
      if (result.type !== "return") throw new Error("A derivation gave no key.");
      return result.value;
    });
  }

  it("hold no private key when it returns, on the way to the key it compares too", async () => {
    const roots = vi.spyOn(HDKey, "fromMasterSeed");
    const children = vi.spyOn(HDKey.prototype, "deriveChild");
    const later = new WalletEvidenceCheck(
      async (...parameters) => noblePbkdf2(...parameters),
      [BITCOIN],
    );
    // The Taproot ones are found in the last of the four profiles, after the other three paths.
    const evidence = [
      located("address", BIP86.firstReceiving, BITCOIN_PROFILES),
      located("account-xpub", BIP86.accountXpub, BITCOIN_PROFILES),
      located("wif", BIP84.firstReceivingWif, ["native-segwit"]),
    ];
    for (const each of evidence) {
      expect(browserCheck.match(TEST_PHRASE, each).matched).toBe(true);
      expect((await later.matchAsync(TEST_PHRASE, each)).matched).toBe(true);
    }
    const nodes = returnedKeys([...roots.mock.results, ...children.mock.results]);
    // Each comparison twice: a root and 4 × 5 steps, a root and 4 × 3, a root and 5.
    expect(nodes).toHaveLength(2 * (1 + 20 + 1 + 12 + 1 + 5));
    for (const node of nodes) expect(node.privateKey).toBeNull();
  });

  it("hold no private key either when several addresses in a row are compared", () => {
    const roots = vi.spyOn(HDKey, "fromMasterSeed");
    const children = vi.spyOn(HDKey.prototype, "deriveChild");
    const evidence: BitcoinEvidence = {
      kind: "wif",
      value: BIP84.firstReceivingWif,
      profiles: ["legacy"],
      location: MAINNET_LOCATION,
      addresses: 3,
    };
    expect(browserCheck.match(TEST_PHRASE, evidence).matched).toBe(false);
    const nodes = returnedKeys([...roots.mock.results, ...children.mock.results]);
    // A root, 4 steps down to the branch, and 3 addresses below it.
    expect(nodes).toHaveLength(1 + 4 + 3);
    for (const node of nodes) expect(node.privateKey).toBeNull();
  });
});
