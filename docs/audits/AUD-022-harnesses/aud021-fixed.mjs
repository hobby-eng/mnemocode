// AUD-022: checks that every AUD-021 finding is absent from the built tree, with variants beyond
// the AUD-021 acceptance tests. Public fixtures and synthetic bytes only. Run from the MnemoCode
// repository root after `pnpm build`:
//
//   node <this file>
//
// One line per check, PASS or FAIL; exit 1 when any fails.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import zlib from "node:zlib";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = process.cwd();
// Dependencies resolve from the repository, not from this harness's folder.
const require = createRequire(join(root, "package.json"));
const { PNG } = require("pngjs");
const load = (path) => import(join(root, "dist", path));
const { crc32 } = await load("sskr/checksum.js");
const { decodeQrPngFile } = await load("cli/qr-input.js");
const { INVALID_PNG_INPUT, PngAdmission } = await load("core/png-admission.js");
const { decryptCandidates } = await load("core/candidate-encryption.js");
const { BackupReading } = await load("core/backup-reading.js");
const { EncodedBackup } = await load("core/encoded-backup.js");
const { ReEncoding } = await load("core/re-encoding.js");
const { encodeCandidateList, decodeCandidateList } = await load("core/candidate-list.js");
const { readRepairableShare, repairCandidates } = await load("sskr/repair.js");
const { sskrSetVector } = await load("sskr/known-answers.js");
const { formatEncoded } = await load("core/representations.js");
const { representMnemonic } = await load("core/seedshift.js");
const { entropyToMnemonic } = await import(require.resolve("@scure/bip39"));
const { wordlist } = await import(require.resolve("@scure/bip39/wordlists/english.js"));
const run = promisify(execFile);
const cli = (...args) =>
  run(process.execPath, [join(root, "dist/mnemocode.js"), ...args], { env: { ...process.env, NO_COLOR: "1" } });

let failures = 0;
async function check(name, run) {
  try {
    const ok = await run();
    if (ok !== true) throw new Error(`returned ${inspect(ok)}`);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error?.message ?? error}`);
  }
}
async function refuses(run, pattern) {
  try {
    await run();
  } catch (error) {
    if (pattern === undefined || pattern.test(String(error?.message))) return true;
    throw new Error(`refused with another reason: ${error?.message}`);
  }
  throw new Error("was accepted");
}

// --- SEC001 and SEC002: PNG admission before the decoder ---
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, sum]);
}
function header(width, height, { depth = 8, color = 0, interlace = 0 } = {}) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = depth;
  data[9] = color;
  data[12] = interlace;
  return chunk("IHDR", data);
}
const end = chunk("IEND", Buffer.alloc(0));
/** Raw scanlines of an 8-bit grey image, filter 0, row by row, in Adam7 order when interlaced. */
function scanlines(width, height, interlace) {
  if (!interlace) return Buffer.alloc(height * (1 + width), 0);
  const passes = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ];
  let total = 0;
  for (const [x, y, dx, dy] of passes) {
    const columns = Math.max(0, Math.ceil((width - x) / dx));
    const rows = Math.max(0, Math.ceil((height - y) / dy));
    if (columns > 0 && rows > 0) total += rows * (1 + columns);
  }
  return Buffer.alloc(total, 0);
}
const folder = await mkdtemp(join(tmpdir(), "mnemocode-aud022-"));
const png = async (name, bytes) => {
  const path = join(folder, name);
  await writeFile(path, bytes);
  return path;
};
const NO_QR = /No readable QR/u;
const INVALID = new RegExp(INVALID_PNG_INPUT.replace(/[.]/gu, "\\."), "u");
try {
  await check("SEC001 a second IHDR is refused before decoding", async () => {
    const original = PNG.sync.read;
    let decoded = 0;
    PNG.sync.read = (...args) => {
      decoded += 1;
      return original(...args);
    };
    try {
      const bytes = Buffer.concat([
        signature,
        header(1, 1),
        header(4097, 1),
        chunk("IDAT", zlib.deflateSync(Buffer.alloc(4098))),
        end,
      ]);
      await refuses(async () => decodeQrPngFile(await png("dup.png", bytes)), INVALID);
      return decoded === 0;
    } finally {
      PNG.sync.read = original;
    }
  });
  await check("SEC001 IHDR after IDAT, unknown critical chunk, data after IEND are refused", async () => {
    const image = chunk("IDAT", zlib.deflateSync(scanlines(1, 1, false)));
    // An IHDR after the IDAT is refused at the start, with its own reason since the AUD-022-API001
    // remediation; the reviewed snapshot gave the general refusal for it too.
    await refuses(
      async () => decodeQrPngFile(await png("late.png", Buffer.concat([signature, image, header(1, 1), end]))),
      new RegExp(`${INVALID.source}|does not begin with an IHDR chunk`, "u"),
    );
    for (const [name, bytes] of [
      ["critical", Buffer.concat([signature, header(1, 1), chunk("ABCD", Buffer.alloc(1)), image, end])],
      ["trailing", Buffer.concat([signature, header(1, 1), image, end, Buffer.from([0])])],
      ["split-idat", Buffer.concat([signature, header(1, 1), image, chunk("tEXt", Buffer.from("a\0b")), image, end])],
      ["palette-missing", Buffer.concat([signature, header(1, 1, { color: 3 }), image, end])],
      ["bad-crc", Buffer.concat([signature, header(1, 1), image.subarray(0, -1), Buffer.from([0]), end])],
      ["depth", Buffer.concat([signature, header(1, 1, { depth: 3 }), image, end])],
    ])
      await refuses(async () => decodeQrPngFile(await png(`${name}.png`, bytes)), INVALID);
    return true;
  });
  await check("SEC001 dimensions above the limit are refused, at the limit admitted", async () => {
    await refuses(() =>
      PngAdmission.read(Buffer.concat([signature, header(4097, 1), chunk("IDAT", zlib.deflateSync(Buffer.alloc(4098))), end])),
    /4096 px/u);
    const admitted = PngAdmission.read(
      Buffer.concat([signature, header(4096, 1), chunk("IDAT", zlib.deflateSync(Buffer.alloc(4097))), end]),
    );
    return admitted.filteredBytes === 4097;
  });
  await check("SEC002 an interlaced image that inflates beyond its layout is refused, bounded", async () => {
    const original = zlib.inflateSync;
    const bounds = [];
    zlib.inflateSync = (data, options) => {
      bounds.push(options?.maxOutputLength);
      return original(data, options);
    };
    // qr-input.ts imports inflateSync by name: named builtin exports follow only after a sync.
    syncBuiltinESMExports();
    try {
      const bytes = Buffer.concat([
        signature,
        header(1, 1, { color: 6, interlace: 1 }),
        chunk("IDAT", zlib.deflateSync(Buffer.alloc(65_536))),
        end,
      ]);
      await refuses(async () => decodeQrPngFile(await png("bomb.png", bytes)), INVALID);
      // The admission's own inflation is bounded by the 1x1 RGBA layout: one filter byte, 4 bytes.
      return bounds.length >= 1 && bounds[0] === 5;
    } finally {
      zlib.inflateSync = original;
      syncBuiltinESMExports();
    }
  });
  await check("SEC002 valid interlaced and non-interlaced grey images pass admission", async () => {
    for (const [width, height] of [[1, 1], [3, 5], [9, 9], [17, 2]])
      for (const interlace of [0, 1]) {
        const bytes = Buffer.concat([
          signature,
          header(width, height, { interlace }),
          chunk("IDAT", zlib.deflateSync(scanlines(width, height, interlace === 1))),
          end,
        ]);
        await refuses(async () => decodeQrPngFile(await png(`ok-${width}x${height}-${interlace}.png`, bytes)), NO_QR);
      }
    return true;
  });
  await check("SEC002 truncated scanlines are refused", async () => {
    const bytes = Buffer.concat([
      signature,
      header(4, 4),
      chunk("IDAT", zlib.deflateSync(Buffer.alloc(19))),
      end,
    ]);
    await refuses(async () => decodeQrPngFile(await png("short.png", bytes)), INVALID);
    return true;
  });

  // --- SEC003: a malformed age identity never appears in the error ---
  await check("SEC003 a malformed identity is absent from message, cause and inspection", async () => {
    const vectors = JSON.parse(await readFile(join(root, "vectors/candidates-v1.json"), "utf8"));
    const identity = vectors.age.identity;
    const payload = identity.slice("AGE-SECRET-KEY-1".length, -6);
    for (const changed of [
      identity.slice(0, -1) + (identity.endsWith("Q") ? "A" : "Q"),
      identity.toLowerCase(),
      `${identity}X`,
      identity.slice(0, 40),
    ]) {
      let error;
      try {
        await decryptCandidates(Buffer.from(vectors.age.open[0].file, "hex"), { identity: changed });
      } catch (caught) {
        error = caught;
      }
      if (!(error instanceof Error)) {
        // A lower-case identity is valid Bech32 and may still decrypt; that is not a leak.
        if (changed === identity.toLowerCase()) continue;
        throw new Error(`no refusal for ${changed.length}-character identity`);
      }
      const shown = `${error.message} ${inspect(error, { depth: 5 })} ${String(error.cause ?? "")} ${JSON.stringify(Object.getOwnPropertyNames(error).map((key) => String(error[key])))}`;
      if (shown.includes(changed) || shown.includes(payload.slice(0, 20)) || shown.toUpperCase().includes(payload.slice(0, 20).toUpperCase()))
        throw new Error("identity text appears in the error");
    }
    return true;
  });

  // --- FUN001: marks in Color Unicode survive a declared word count, decoys left out ---
  await check("FUN001 Color Unicode marks with a declared word count, every length, both spellings", async () => {
    for (const bytes of [16, 20, 24, 28, 32]) {
      const phrase = entropyToMnemonic(Uint8Array.from({ length: bytes }, (_, i) => (i * 37 + 5) & 255), wordlist);
      const words = phrase.split(" ").length;
      const codes = formatEncoded(representMnemonic(phrase), "colors-unicode").match(/.{4}/gu);
      for (const at of [0, codes.length - 1]) {
        const marked = [...codes];
        marked[at] = "?";
        // Two decoy colors: four codes of other colors after the phrase.
        const withDecoys = [...marked, "E0FF", "E0FF", "E1AA", "E1AA"];
        for (const text of [
          withDecoys.join(" "),
          withDecoys.map((code) => (code === "?" ? code : String.fromCodePoint(parseInt(code, 16)))).join(""),
        ]) {
          for (const record of [text, `MNC1:direct:colors-unicode:${text}`]) {
            const reading = BackupReading.of(record, { words, seedshiftOnly: false, shareReader: "Shares" });
            if (reading.marked !== true) throw new Error(`${words} words, mark at ${at}: not marked (${record.startsWith("MNC1") ? "record" : "raw"})`);
          }
        }
      }
    }
    return true;
  });

  // --- FUN002: a marked share with trailing decoy cards repairs ---
  await check("FUN002 a marked share in colors with decoys repairs to the canonical share", async () => {
    const colors = sskrSetVector.colors[0].split(" ");
    const marked = [...colors];
    marked[5] = "?";
    for (const decoys of [["#000000"], ["#123456", "#ABCDEF", "#00FF00"]]) {
      const share = readRepairableShare([...marked, ...decoys].join(" "));
      if (share.ur !== sskrSetVector.shares[0]) throw new Error(`decoys ${decoys.length}: ${share.ur}`);
    }
    return true;
  });
  await check("FUN002 a marked share and an intact one restore together, decoys after both", async () => {
    const first = sskrSetVector.colors[0].split(" ");
    first[3] = "?";
    const second = sskrSetVector.colors[1];
    const file = await png("shares.txt", `${first.join(" ")} #000000 #111111\n${second} #222222\n`);
    const { stdout } = await cli("sskr-combine", "--share-file", file);
    return stdout.includes(sskrSetVector.phrase);
  });

  // --- API001: candidate lists take only genuine byte arrays ---
  await check("API001 non-byte entropy is refused; Buffer and subarray accepted", async () => {
    for (const entropy of [
      new Uint16Array(16).fill(256),
      new Int8Array(16),
      Array.from({ length: 16 }, () => 1),
      new DataView(new ArrayBuffer(16)),
      Object.setPrototypeOf(new Uint16Array(8), Uint8Array.prototype),
      null,
    ])
      await refuses(() => encodeCandidateList({ records: [{ entropy }] }), /BIP39 entropy/u);
    for (const entropy of [Buffer.alloc(16, 1), new Uint8Array(40).fill(1).subarray(4, 20)]) {
      const list = encodeCandidateList({ records: [{ entropy }] });
      const back = decodeCandidateList(list);
      if ([...back.records[0].entropy].join() !== new Array(16).fill(1).join()) throw new Error("round trip");
    }
    return true;
  });
  await check("API001 a getter cannot give one entropy to validation and another to the list", async () => {
    let reads = 0;
    const record = {
      get entropy() {
        reads += 1;
        return reads === 1 ? new Uint8Array(16).fill(7) : new Uint16Array(16).fill(300);
      },
    };
    const list = encodeCandidateList({ records: [record] });
    const back = decodeCandidateList(list);
    return reads === 1 && back.records[0].entropy.every((byte) => byte === 7);
  });

  // --- API002: re-encoding keeps the phrase it confirmed ---
  await check("API002 the result cannot be changed while a wallet answer is awaited", async () => {
    const phrase = `${"abandon ".repeat(11)}about`;
    const reEncoding = ReEncoding.of(EncodedBackup.read(phrase, "english", "direct"), []);
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let checked;
    const confirming = reEncoding.confirmByWallet(async (given) => {
      checked = given;
      await gate;
      return { matched: true };
    });
    let threw = false;
    try {
      reEncoding.result.recoveredMnemonic = "legal winner thank year wave sausage worth useful legal winner thank yellow";
    } catch {
      threw = true;
    }
    try {
      reEncoding.result.recoveredIndexes[0] = 5;
    } catch {
      threw = true;
    }
    release();
    await confirming;
    return threw && checked === phrase && reEncoding.confirmedPhrase() === phrase && Object.isFrozen(reEncoding.result.dates);
  });
} finally {
  await rm(folder, { recursive: true, force: true });
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
