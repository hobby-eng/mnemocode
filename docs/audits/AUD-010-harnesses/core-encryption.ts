// AUD-010 core probe (CHECK-SEC-004, CHECK-API-004): candidate list encryption.
//
// An independent age v1 reader, written here from age-encryption.org/v1 with node:crypto (X25519,
// HKDF-SHA-256, HMAC-SHA-256, ChaCha20-Poly1305, scrypt) and @scure/base (Bech32) only, opens:
//   - the published files of vectors/candidates-v1.json (src/core/candidate-encryption-self-test.ts),
//   - files that MnemoCode writes to a one-time key and with a passphrase;
// and the plain list is checked against an independent MNCL encoding (docs/CANDIDATES.md, zlib CRC-32).
// Then: fresh randomness per file and per key; refusals of other keys, work factors, two stanzas,
// truncation and tampering, without partial plaintext; WebCrypto and getRandomValues missing;
// the passphrase and recipient rules; the protection classes. Public test keys and data only.
// scrypt at log2 N = 18 needs 256 MiB per run; the probe runs it six times, one after another.

import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  createDecipheriv,
  diffieHellman,
  hkdfSync,
  scryptSync,
} from "node:crypto";
import { crc32 } from "node:zlib";
import { bech32 } from "@scure/base";
import { Encrypter } from "age-encryption";
import {
  ageStanzas,
  createSessionIdentity,
  decryptCandidates,
  encryptCandidates,
  encryptCandidatesWithPassphrase,
  MIN_LIST_PASSPHRASE_LENGTH,
  NoProtection,
  parseListPassphrase,
  parseRecipient,
  PassphraseProtection,
  ScannerKeyProtection,
  SCRYPT_LOG_N,
} from "../../../src/core/candidate-encryption.js";
import { decodeCandidateList, encodeCandidateList } from "../../../src/core/candidate-list.js";

let failures = 0;
function check(label: string, ok: boolean, values: Record<string, unknown> = {}): void {
  if (!ok) failures += 1;
  console.log(JSON.stringify({ check: label, outcome: ok ? "passed" : "failed", ...values }));
}
async function refusal(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return String(error);
  }
  return undefined;
}
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const fromHex = (text: string) => Uint8Array.from(Buffer.from(text, "hex"));

// ---- Published vectors (src/core/candidate-encryption-self-test.ts, vectors/candidates-v1.json).
const TEST_IDENTITY = "AGE-SECRET-KEY-1J3DXH7J0XJ7HDQ5KT55PD474ZU2S9E0X7N37UZERQSWG4H3Q8NASPUWJ89";
const TEST_PASSPHRASE = "public candidate test passphrase";
const TO_THE_SESSION_KEY =
  "6167652d656e6372797074696f6e2e6f72672f76310a2d3e20583235353139206136356439553562555137474f6b35622b3652746b5963424f494650435a54716561665571764e5a4a326f0a54557678394c374742754f746a473346792f4b454f4c2b526344612f613971456c4b41552f517155306e630a2d2d2d204e363162377937377063536b6654314e34384a7177506c6b516b74723268432f71355856665a6f446275380ac627d2859a80b6da35a28846ac0b28c759492f215288a81f00fab74592a8ad30661a38e24bea23b0471d1eee33c7f03509aed8e68eab614d0fa3655102bc25272799f15a1203ceca9dcd57dc00caff920523cac73e2cac07876a7c7ea4e2c8c8";
const WITH_THE_PASSPHRASE =
  "6167652d656e6372797074696f6e2e6f72672f76310a2d3e20736372797074205870525a634577686a5772633579485174772b6843672031380a3273444e75712f66773558356f2b6169326c5244557844733753335a374b3335357a584c58536b2b4a68490a2d2d2d20756e415248654a6f756e436f303350616e58692b733030795239624e7976426849544249617250726465730a2c9d8c5ab6187d40f723d29b32b3e7a700040053411d2ab9923f2ceb2f4f9b24db3c85a38bacab3e6739f621f9b36803f0fb1114f6d9b29ddebf067e976c78439064dda175a4b27e25da4b6ba415caa4bc4128dd532df80e73545c2e5e9f29ab";

// ---- Independent MNCL encoding of three public entropies (docs/CANDIDATES.md "The list").
function oracleList(entropies: readonly Uint8Array[]): Uint8Array {
  const length = entropies[0]!.length;
  const header = Buffer.from([0x4d, 0x4e, 0x43, 0x4c, 1, 0, length, 0, 0, 0, 0]);
  header.writeUInt32BE(entropies.length, 7);
  const content = Buffer.concat([header, ...entropies.map((entropy) => Buffer.from(entropy))]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(content), 0);
  const unpadded = content.length + 4;
  const e = Math.floor(Math.log2(unpadded));
  const s = Math.floor(Math.log2(e)) + 1;
  const step = 2 ** (e - s);
  const padded = Math.ceil(unpadded / step) * step;
  return Uint8Array.from(Buffer.concat([content, crc, Buffer.alloc(padded - unpadded)]));
}
const ENTROPIES = ["00".repeat(16), "7f".repeat(16), "ff".repeat(16)].map(fromHex);
const PLAIN = oracleList(ENTROPIES);
check(
  "MNCL: independent encoding equals encodeCandidateList and the published list",
  hex(PLAIN) === hex(encodeCandidateList({ records: ENTROPIES.map((entropy) => ({ entropy })) })) &&
    hex(PLAIN) ===
      "4d4e434c01001000000003000000000000000000000000000000007f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7fffffffffffffffffffffffffffffffff98854aa000",
  {
    oracle: hex(PLAIN),
  },
);
check(
  "CRC-32 of ASCII 123456789 is 0xCBF43926 (docs/CANDIDATES.md)",
  crc32(Buffer.from("123456789")) === 0xcbf43926,
);

// ---- Independent age v1 reader.
const X25519_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI = Buffer.from("302a300506032b656e032100", "hex");
const b64 = (text: string) => Buffer.from(text, "base64");
const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: string) =>
  Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from(info), 32));
function chachaOpen(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array): Buffer {
  const decipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
}
function scalarOf(identity: string): Buffer {
  const decoded = bech32.decode(identity.toLowerCase() as `${string}1${string}`, 1000);
  if (decoded.prefix !== "age-secret-key-") throw new Error("not an age identity");
  return Buffer.from(bech32.fromWords(decoded.words));
}
interface Opened {
  readonly stanzas: string[][];
  readonly plain: Buffer;
}
function ageOpen(file: Uint8Array, key: { identity: string } | { passphrase: string }): Opened {
  const bytes = Buffer.from(file);
  const macAt = bytes.indexOf("\n--- ");
  const macEnd = bytes.indexOf("\n", macAt + 1);
  const headerText = bytes.subarray(0, macAt).toString("latin1");
  const lines = headerText.split("\n");
  if (lines[0] !== "age-encryption.org/v1") throw new Error("not age v1");
  const stanzas: { args: string[]; body: Buffer }[] = [];
  for (let at = 1; at < lines.length; at += 1) {
    if (!lines[at]!.startsWith("-> ")) throw new Error("bad stanza");
    const args = lines[at]!.slice(3).split(" ");
    let body = "";
    // A body is base64 lines of 64 characters, ending with a shorter one.
    while (at + 1 < lines.length && !lines[at + 1]!.startsWith("-> ")) {
      at += 1;
      body += lines[at]!;
      if (lines[at]!.length < 64) break;
    }
    stanzas.push({ args, body: b64(body) });
  }
  let fileKey: Buffer | undefined;
  for (const stanza of stanzas) {
    try {
      if ("identity" in key && stanza.args[0] === "X25519") {
        const share = b64(stanza.args[1]!);
        const privateKey = createPrivateKey({
          key: Buffer.concat([X25519_PKCS8, scalarOf(key.identity)]),
          format: "der",
          type: "pkcs8",
        });
        const recipient = Buffer.from(
          createPublicKey(privateKey).export({ format: "der", type: "spki" }),
        ).subarray(-32);
        const publicKey = createPublicKey({
          key: Buffer.concat([X25519_SPKI, share]),
          format: "der",
          type: "spki",
        });
        const shared = diffieHellman({ privateKey, publicKey });
        const wrap = hkdf(
          shared,
          Buffer.concat([share, recipient]),
          "age-encryption.org/v1/X25519",
        );
        fileKey = chachaOpen(wrap, Buffer.alloc(12), stanza.body);
      } else if ("passphrase" in key && stanza.args[0] === "scrypt") {
        const salt = Buffer.concat([
          Buffer.from("age-encryption.org/v1/scrypt"),
          b64(stanza.args[1]!),
        ]);
        const logN = Number(stanza.args[2]);
        const wrap = scryptSync(Buffer.from(key.passphrase, "utf8"), salt, 32, {
          N: 2 ** logN,
          r: 8,
          p: 1,
          maxmem: 300 * 1024 * 1024,
        });
        fileKey = chachaOpen(wrap, Buffer.alloc(12), stanza.body);
      }
    } catch {
      // Not this stanza's key.
    }
  }
  if (fileKey === undefined) throw new Error("no stanza opened");
  const mac = createHmac("sha256", hkdf(fileKey, new Uint8Array(0), "header"))
    .update(bytes.subarray(0, macAt + 4))
    .digest();
  if (!mac.equals(b64(bytes.subarray(macAt + 5, macEnd).toString("latin1"))))
    throw new Error("header MAC");
  const nonce = bytes.subarray(macEnd + 1, macEnd + 17);
  const payloadKey = hkdf(fileKey, nonce, "payload");
  const payload = bytes.subarray(macEnd + 17);
  const chunks: Buffer[] = [];
  const size = 64 * 1024 + 16;
  for (
    let offset = 0, counter = 0;
    offset < payload.length || counter === 0;
    offset += size, counter += 1
  ) {
    const last = offset + size >= payload.length;
    const streamNonce = Buffer.alloc(12);
    streamNonce.writeUIntBE(counter, 5, 6);
    streamNonce[11] = last ? 1 : 0;
    chunks.push(chachaOpen(payloadKey, streamNonce, payload.subarray(offset, offset + size)));
    if (last) break;
  }
  return { stanzas: stanzas.map((stanza) => stanza.args), plain: Buffer.concat(chunks) };
}

// ---- 1. Published vectors: the oracle and production open them to the same list.
{
  const byKey = ageOpen(fromHex(TO_THE_SESSION_KEY), { identity: TEST_IDENTITY });
  const byPass = ageOpen(fromHex(WITH_THE_PASSPHRASE), { passphrase: TEST_PASSPHRASE });
  const productionKey = await decryptCandidates(fromHex(TO_THE_SESSION_KEY), {
    identity: TEST_IDENTITY,
  });
  const productionPass = await decryptCandidates(fromHex(WITH_THE_PASSPHRASE), {
    passphrase: TEST_PASSPHRASE,
  });
  check(
    "published X25519 file: oracle and production open the list",
    byKey.plain.equals(PLAIN) && hex(productionKey) === hex(PLAIN),
    {
      stanzas: byKey.stanzas.map((args) => args[0]),
    },
  );
  check(
    "published scrypt file: oracle and production open the list; work factor 18",
    byPass.plain.equals(PLAIN) &&
      hex(productionPass) === hex(PLAIN) &&
      byPass.stanzas.length === 1 &&
      byPass.stanzas[0]![2] === "18",
    { stanzas: byPass.stanzas },
  );
}

// ---- 2. Files that MnemoCode writes open in the oracle; fresh randomness for each.
{
  const one = await createSessionIdentity();
  const two = await createSessionIdentity();
  check(
    "session identities: two calls give two keys; recipient age1 + 58 characters",
    one.identity !== two.identity &&
      one.recipient !== two.recipient &&
      /^age1[02-9ac-hj-np-z]{58}$/u.test(one.recipient),
    {
      recipientLength: one.recipient.length,
    },
  );
  const first = await encryptCandidates(PLAIN, one.recipient.toUpperCase());
  const second = await encryptCandidates(PLAIN, one.recipient);
  const opened = ageOpen(first, { identity: one.identity });
  check(
    "X25519 file by MnemoCode: one X25519 stanza; the oracle opens it",
    opened.plain.equals(PLAIN) && opened.stanzas.length === 1 && opened.stanzas[0]![0] === "X25519",
    {
      stanzas: opened.stanzas.map((args) => args[0]),
    },
  );
  const share = (file: Uint8Array) => ageStanzas(file)[0]![1];
  check(
    "X25519 files: fresh ephemeral share, nonce and ciphertext each time",
    share(first) !== share(second) && hex(first) !== hex(second),
    {},
  );
  check(
    "X25519 file opened with another key is refused",
    (await refusal(() => decryptCandidates(first, { identity: two.identity }))) !== undefined,
  );
  check(
    "X25519 file opened with a passphrase is refused before any scrypt",
    /exactly one scrypt recipient/u.test(
      (await refusal(() => decryptCandidates(first, { passphrase: TEST_PASSPHRASE }))) ?? "",
    ),
  );
  // Two recipients, written with age-encryption directly: refused by the reader.
  const encrypter = new Encrypter();
  encrypter.addRecipient(one.recipient);
  encrypter.addRecipient(two.recipient);
  const twoKeys = await encrypter.encrypt(PLAIN);
  check(
    "a file to two keys is refused",
    /exactly one X25519 recipient/u.test(
      (await refusal(() => decryptCandidates(twoKeys, { identity: one.identity }))) ?? "",
    ),
  );
  // Tampering: payload byte, header MAC byte, truncation. No plaintext comes back.
  const payload = Uint8Array.from(first);
  payload[payload.length - 20]! ^= 1;
  const header = Uint8Array.from(first);
  const macAt = Buffer.from(header).indexOf("\n--- ") + 6;
  header[macAt] = header[macAt] === 0x41 ? 0x42 : 0x41;
  for (const [name, file] of [
    ["with a changed payload byte", payload],
    ["with a changed header MAC", header],
    ["truncated by 10 bytes", first.subarray(0, first.length - 10)],
    ["truncated after the header", first.subarray(0, Buffer.from(first).indexOf("\n--- ") + 50)],
  ] as const) {
    let returned: Uint8Array | undefined;
    const message = await refusal(async () => {
      returned = await decryptCandidates(file, { identity: one.identity });
    });
    check(
      `X25519 file ${name} is refused, nothing returned`,
      message !== undefined && returned === undefined,
      { message },
    );
  }
  const passFirst = await encryptCandidatesWithPassphrase(PLAIN, TEST_PASSPHRASE);
  const passSecond = await encryptCandidatesWithPassphrase(PLAIN, TEST_PASSPHRASE);
  const passOpened = ageOpen(passFirst, { passphrase: TEST_PASSPHRASE });
  check(
    "scrypt file by MnemoCode: one scrypt stanza at 18; the oracle opens it",
    passOpened.plain.equals(PLAIN) &&
      passOpened.stanzas.length === 1 &&
      passOpened.stanzas[0]![0] === "scrypt" &&
      passOpened.stanzas[0]![2] === String(SCRYPT_LOG_N) &&
      SCRYPT_LOG_N === 18,
    { stanzas: passOpened.stanzas },
  );
  check(
    "scrypt files: fresh salt each time",
    passOpened.stanzas[0]![1] !== ageStanzas(passSecond)[0]![1],
    {},
  );
  check(
    "scrypt file with a wrong passphrase is refused",
    (await refusal(() => decryptCandidates(passFirst, { passphrase: `${TEST_PASSPHRASE}!` }))) !==
      undefined,
  );
  check(
    "scrypt file opened with an identity is refused",
    /exactly one X25519 recipient/u.test(
      (await refusal(() => decryptCandidates(passFirst, { identity: one.identity }))) ?? "",
    ),
  );
  // Another work factor, written with age-encryption directly (log2 N = 10, quick): refused before scrypt.
  const low = new Encrypter();
  low.setPassphrase(TEST_PASSPHRASE);
  low.setScryptWorkFactor(10);
  const lowFile = await low.encrypt(PLAIN);
  const started = performance.now();
  const lowMessage = await refusal(() =>
    decryptCandidates(lowFile, { passphrase: TEST_PASSPHRASE }),
  );
  check("scrypt file at work factor 10 is refused", /work factor 18/u.test(lowMessage ?? ""), {
    message: lowMessage,
    milliseconds: Math.round(performance.now() - started),
  });
  check(
    "encrypting with an empty passphrase is refused",
    (await refusal(() => encryptCandidatesWithPassphrase(PLAIN, ""))) !== undefined,
  );
  check(
    "decodeCandidateList of the opened file gives the three entropies",
    decodeCandidateList(opened.plain)
      .records.map((record) => hex(record.entropy))
      .join(",") === ENTROPIES.map(hex).join(","),
  );
}

// ---- 3. Hosts without WebCrypto or without a random source.
{
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
  const real = globalThis.crypto;
  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues: real.getRandomValues.bind(real) },
    });
    const noSubtle = [
      await refusal(() => createSessionIdentity()),
      await refusal(() => encryptCandidates(PLAIN, "age1" + "q".repeat(58))),
      await refusal(() =>
        decryptCandidates(fromHex(TO_THE_SESSION_KEY), { identity: TEST_IDENTITY }),
      ),
    ];
    check(
      "without crypto.subtle the X25519 operations refuse with one line",
      noSubtle.every((message) => /needs WebCrypto/u.test(message ?? "")),
      { messages: noSubtle },
    );
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    const noRandom = await refusal(() => encryptCandidatesWithPassphrase(PLAIN, TEST_PASSPHRASE));
    check(
      "without crypto.getRandomValues a passphrase file is refused, not written",
      noRandom !== undefined,
      { message: noRandom },
    );
  } finally {
    Object.defineProperty(globalThis, "crypto", descriptor);
  }
}

// ---- 4. Recipient and passphrase rules; the protection classes.
{
  const session = await createSessionIdentity();
  check(
    "parseRecipient: upper case and white space are read as the key",
    parseRecipient(`  ${session.recipient.toUpperCase()}\n`) === session.recipient,
  );
  const wrongChecksum =
    session.recipient.slice(0, -1) + (session.recipient.endsWith("q") ? "p" : "q");
  for (const [name, text] of [
    ["changed checksum", wrongChecksum],
    ["61 characters", session.recipient.slice(0, -1)],
    ["identity instead of recipient", session.identity],
    ["two keys", `${session.recipient} ${session.recipient}`],
  ] as const)
    check(
      `parseRecipient refuses ${name}`,
      (await refusal(() => parseRecipient(text))) !== undefined,
    );
  const eleven = "x".repeat(MIN_LIST_PASSPHRASE_LENGTH - 1);
  check(
    "parseListPassphrase: 11 characters refused, 12 accepted",
    (await refusal(() => parseListPassphrase(eleven))) !== undefined &&
      parseListPassphrase(`${eleven}y`) === `${eleven}y`,
  );
  check(
    "parseListPassphrase: 11 characters padded with spaces are still 11",
    (await refusal(() => parseListPassphrase(`  ${eleven}  `))) !== undefined,
  );
  check(
    "parseListPassphrase: 12 emoji count as 12 characters (24 UTF-16 units)",
    parseListPassphrase("\u{1F511}".repeat(12)).length === 24,
  );
  check(
    "parseListPassphrase: 6 emoji (12 UTF-16 units) are refused",
    (await refusal(() => parseListPassphrase("\u{1F511}".repeat(6)))) !== undefined,
  );
  check(
    "parseListPassphrase: a leading byte order mark is removed",
    parseListPassphrase(`${String.fromCodePoint(0xfeff)}${eleven}y\n`) === `${eleven}y`,
  );
  const protection = new PassphraseProtection(`${eleven}y`);
  const scanner = new ScannerKeyProtection(session.recipient);
  const none = new NoProtection();
  const overwrite = (target: object) =>
    refusal(
      () =>
        Reflect.set(target, "encrypted", false) ||
        (() => {
          throw new Error("ignored");
        })(),
    );
  await overwrite(protection);
  await overwrite(scanner);
  check(
    "protection classes: encrypted cannot be overwritten; descriptions",
    protection.encrypted &&
      scanner.encrypted &&
      !none.encrypted &&
      none.description === "NOT encrypted" &&
      scanner.recipient === session.recipient,
    {},
  );
  check(
    "PassphraseProtection redacts itself",
    String(protection) === "[PassphraseProtection: redacted]" &&
      JSON.stringify(protection) === '"[PassphraseProtection: redacted]"',
  );
  const same = await none.protect(PLAIN);
  check("NoProtection returns the same bytes", same === PLAIN);
}

console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;
