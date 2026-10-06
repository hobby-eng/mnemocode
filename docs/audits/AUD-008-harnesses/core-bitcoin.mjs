// AUD-008, baseline 767ee995a91e98c1f9bde6b7930147e352fc5cff. Public synthetic data only.
import assert from "node:assert/strict";
import { createECDH, createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { masterFingerprint, matchBitcoinEvidence } from "../../../dist/bitcoin-evidence.js";

const HARDENED = 0x80000000;
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const sha = (bytes) => createHash("sha256").update(bytes).digest();
const hash160 = (bytes) => createHash("ripemd160").update(sha(bytes)).digest();
const integer = (bytes) => BigInt(`0x${bytes.toString("hex")}`);
const scalarBytes = (value) => Buffer.from(value.toString(16).padStart(64, "0"), "hex");
const uint32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};
function publicKey(key) {
  const curve = createECDH("secp256k1");
  curve.setPrivateKey(key);
  return curve.getPublicKey(undefined, "compressed");
}

// Separate BIP32 implementation using OpenSSL point multiplication and Node HMAC.
function rootOf(mnemonic, passphrase) {
  const seed = pbkdf2Sync(
    mnemonic.normalize("NFKD"),
    `mnemonic${passphrase}`.normalize("NFKD"),
    2048,
    64,
    "sha512",
  );
  const material = createHmac("sha512", "Bitcoin seed").update(seed).digest();
  return {
    key: material.subarray(0, 32),
    chain: material.subarray(32),
    depth: 0,
    index: 0,
    parent: Buffer.alloc(4),
  };
}
function childOf(parent, index) {
  const pub = publicKey(parent.key);
  const data = Buffer.concat([
    index >= HARDENED ? Buffer.concat([Buffer.from([0]), parent.key]) : pub,
    uint32(index),
  ]);
  const material = createHmac("sha512", parent.chain).update(data).digest();
  const tweak = integer(material.subarray(0, 32));
  const scalar = (tweak + integer(parent.key)) % ORDER;
  // The selected synthetic vectors do not hit BIP32's astronomically rare retry case.
  assert(tweak < ORDER && scalar !== 0n);
  return {
    key: scalarBytes(scalar),
    chain: material.subarray(32),
    depth: parent.depth + 1,
    index,
    parent: hash160(pub).subarray(0, 4),
  };
}
function derive(root, indexes) {
  return indexes.reduce(childOf, root);
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58check(payload) {
  const bytes = Buffer.concat([payload, sha(sha(payload)).subarray(0, 4)]);
  let value = integer(bytes);
  let result = "";
  while (value > 0n) {
    result = BASE58[Number(value % 58n)] + result;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = `1${result}`;
  }
  return result;
}
function xpub(node, network) {
  return base58check(
    Buffer.concat([
      uint32(network === "mainnet" ? 0x0488b21e : 0x043587cf),
      Buffer.from([node.depth]),
      node.parent,
      uint32(node.index),
      node.chain,
      publicKey(node.key),
    ]),
  );
}

// BIP173/BIP350: independent five-bit conversion and polynomial checksum.
function witnessAddress(program, version, network) {
  const hrp = network === "mainnet" ? "bc" : "tb";
  const data = [version];
  let accumulator = 0;
  let bitCount = 0;
  for (const byte of program) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      data.push((accumulator >>> bitCount) & 31);
    }
    accumulator &= (1 << bitCount) - 1;
  }
  if (bitCount > 0) data.push((accumulator << (5 - bitCount)) & 31);
  const expanded = [...hrp]
    .map((char) => char.charCodeAt(0) >> 5)
    .concat(
      [0],
      [...hrp].map((char) => char.charCodeAt(0) & 31),
    );
  let checksum = 1;
  for (const value of [...expanded, ...data, 0, 0, 0, 0, 0, 0]) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1)
      if ((top >>> i) & 1)
        checksum ^= [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][i];
  }
  checksum = (checksum ^ (version === 0 ? 1 : 0x2bc830a3)) >>> 0;
  for (let i = 0; i < 6; i += 1) data.push((checksum >>> (5 * (5 - i))) & 31);
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  return `${hrp}1${data.map((value) => alphabet[value]).join("")}`;
}
function addressOf(node, profile, network) {
  const pub = publicKey(node.key);
  if (profile === "legacy")
    return base58check(
      Buffer.concat([Buffer.from([network === "mainnet" ? 0 : 111]), hash160(pub)]),
    );
  if (profile === "nested-segwit")
    return base58check(
      Buffer.concat([
        Buffer.from([network === "mainnet" ? 5 : 196]),
        hash160(Buffer.concat([Buffer.from([0, 20]), hash160(pub)])),
      ]),
    );
  if (profile === "native-segwit") return witnessAddress(hash160(pub), 0, network);
  const tag = sha(Buffer.from("TapTweak"));
  const tweak = integer(sha(Buffer.concat([tag, tag, pub.subarray(1)])));
  assert(tweak < ORDER);
  const evenKey = pub[0] === 3 ? ORDER - integer(node.key) : integer(node.key);
  return witnessAddress(publicKey(scalarBytes((evenKey + tweak) % ORDER)).subarray(1), 1, network);
}
function phrase(entropy) {
  const checksumBits = entropy.length / 4;
  let value =
    (integer(entropy) << BigInt(checksumBits)) | BigInt(sha(entropy)[0] >>> (8 - checksumBits));
  const words = [];
  for (let i = 0; i < (entropy.length * 8 + checksumBits) / 11; i += 1) {
    words.unshift(wordlist[Number(value & 2047n)]);
    value >>= 11n;
  }
  return words.join(" ");
}

const mnemonic = "abandon ".repeat(11) + "about";
const root = rootOf(mnemonic, "");
assert.equal(hash160(publicKey(root.key)).subarray(0, 4).toString("hex"), "73c5da0a");
assert.equal(masterFingerprint(mnemonic), "73c5da0a");
const profiles = { legacy: 44, "nested-segwit": 49, "native-segwit": 84, taproot: 86 };
const literals = {
  legacy: "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA",
  "nested-segwit": "37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf",
  "native-segwit": "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  taproot: "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
};
let locatedChecks = 0;
for (const network of ["mainnet", "testnet"]) {
  assert.equal(
    matchBitcoinEvidence(mnemonic, { kind: "master-xpub", value: xpub(root, network), network })
      .matched,
    true,
  );
  for (const [profile, purpose] of Object.entries(profiles)) {
    for (const [account, branch, index] of [
      [0, 0, 0],
      [1, 1, 2],
      [2147483647, 2147483647, 2147483647],
    ]) {
      const location = { network, account, branch, index };
      const accountNode = derive(root, [
        purpose + HARDENED,
        (network === "mainnet" ? 0 : 1) + HARDENED,
        account + HARDENED,
      ]);
      const node = derive(accountNode, [branch, index]);
      const address = addressOf(node, profile, network);
      if (network === "mainnet" && account === 0) assert.equal(address, literals[profile]);
      for (const [kind, value] of [
        ["address", address],
        ["compressed-public-key", publicKey(node.key).toString("hex")],
        [
          "wif",
          base58check(
            Buffer.concat([
              Buffer.from([network === "mainnet" ? 128 : 239]),
              node.key,
              Buffer.from([1]),
            ]),
          ),
        ],
        ["account-xpub", xpub(accountNode, network)],
      ]) {
        const matched = matchBitcoinEvidence(mnemonic, {
          kind,
          value,
          profiles: [profile],
          location,
        });
        assert.equal(
          matched.matched,
          true,
          `${network} ${profile} ${account}/${branch}/${index} ${kind}`,
        );
        assert.equal(
          matched.path,
          kind === "account-xpub"
            ? `m/${purpose}'/${network === "mainnet" ? 0 : 1}'/${account}'`
            : `m/${purpose}'/${network === "mainnet" ? 0 : 1}'/${account}'/${branch}/${index}`,
        );
        locatedChecks += 1;
      }
    }
  }
}
let seedChecks = 0;
for (const length of [16, 20, 24, 28, 32]) {
  const source = phrase(Buffer.from(Array.from({ length }, (_, i) => i)));
  for (const passphrase of ["", "TREZOR", "café", "cafe\u0301", "ﾊﾟｽﾜｰﾄﾞ", "😀 two words"]) {
    const expected = hash160(publicKey(rootOf(source, passphrase).key))
      .subarray(0, 4)
      .toString("hex");
    assert.equal(masterFingerprint(source, passphrase), expected);
    seedChecks += 1;
  }
}
for (const field of ["account", "branch", "index"])
  for (const value of [-1, 0.5, NaN, Infinity, 2147483648, "0"])
    assert.throws(() =>
      matchBitcoinEvidence(mnemonic, {
        kind: "address",
        value: literals.legacy,
        profiles: ["legacy"],
        location: { network: "mainnet", account: 0, branch: 0, index: 0, [field]: value },
      }),
    );
assert.throws(() => masterFingerprint(mnemonic, "\ud800"), /well-formed/u);
console.log(
  JSON.stringify(
    {
      status: "passed",
      locatedEvidenceChecks: locatedChecks,
      independentSeedFingerprintChecks: seedChecks,
      literalAddressVectors: 4,
      invalidLocationChecks: 18,
      oracle:
        "separate BIP32/HMAC/addresses with Node/OpenSSL secp256k1 and PBKDF2; shared pinned English word list",
    },
    null,
    2,
  ),
);
