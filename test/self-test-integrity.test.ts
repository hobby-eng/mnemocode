import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
const publicMnemonic = "abandon ".repeat(11) + "about";

/** Damage disposable installation files only, never the real build or vectors. */
async function withInstallation(check: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "mnemocode-integrity-"));
  try {
    await cp(resolve("dist"), join(directory, "dist"), { recursive: true });
    await cp(resolve("vectors"), join(directory, "vectors"), { recursive: true });
    await writeFile(join(directory, "package.json"), '{"type":"module"}');
    for (const name of ["node_modules", "assets", "sskr-wasm"]) {
      await symlink(resolve(name), join(directory, name), "junction");
    }
    await check(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("Installed self-test integrity", () => {
  it("fails before encoding when the pinned word-list expectation is damaged", async () => {
    await withInstallation(async (directory) => {
      const module = join(directory, "dist/core/self-test.js");
      const source = await readFile(module, "utf8");
      const corrupted = source.replace(
        "187db04a869dd9bc7be80d21a86497d692c0db6abd3aa8cb6be5d618ff757fae",
        "0".repeat(64),
      );
      expect(corrupted).not.toBe(source);
      await writeFile(module, corrupted);
      const result = await execute(process.execPath, [
        join(directory, "dist/mnemocode.js"),
        "encode",
        "--mode",
        "direct",
        "--mnemonic",
        publicMnemonic,
      ]).then(
        (output) => ({ code: 0, ...output }),
        (error: { code: number; stdout: string; stderr: string }) => error,
      );
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("CRITICAL: MnemoCode core self-test failed.");
      expect(result.stderr).not.toContain(publicMnemonic);
    });
  });

  it("AUD-001-FUN002: refuses an empty public-vector catalogue", async () => {
    await withInstallation(async (directory) => {
      await writeFile(
        join(directory, "vectors/mnemocode-v1.json"),
        JSON.stringify({ version: 1, vectors: [] }),
      );
      const exitCode = await execute(process.execPath, [
        join(directory, "dist/mnemocode.js"),
        "self-test",
      ]).then(
        () => 0,
        (error: { code: number }) => error.code,
      );
      expect(exitCode).not.toBe(0);
    });
  }, 20_000);
});

/**
 * Runs `expression` in a fresh Node.js process against the installation in `directory`, with `m`
 * the module `file` of its dist and `s` the host's services: the master fingerprint, PBKDF2 and the
 * SSKR library of Node.js, with the render platform configured. Gives its exit code and stderr.
 */
async function runCheck(
  directory: string,
  file: string,
  expression: string,
): Promise<{ code: number; stderr: string }> {
  const dist = pathToFileURL(join(directory, "dist")).href;
  const script = `
    import { pbkdf2Sync } from "node:crypto";
    const [dist, file, expression] = process.argv.slice(1);
    const { MasterFingerprintCheck } = await import(dist + "/core/master-fingerprint.js");
    const { nodeSharePlatform } = await import(dist + "/sskr/share-platform-node.js");
    await import(dist + "/export/platform-node.js");
    const pbkdf2 = (p, salt, r, b) => new Uint8Array(pbkdf2Sync(p, salt, r, b, "sha512"));
    const fingerprints = new MasterFingerprintCheck(pbkdf2);
    const s = { fingerprint: (m) => fingerprints.fingerprint(m), pbkdf2, platform: nodeSharePlatform };
    const m = await import(dist + "/" + file);
    await new Function("m", "s", "return " + expression)(m, s);
  `;
  return execute(process.execPath, [
    "--input-type=module",
    "-e",
    script,
    dist,
    file,
    expression,
  ]).then(
    (output) => ({ code: 0, stderr: output.stderr }),
    (error: { code: number; stderr: string }) => ({ code: error.code, stderr: error.stderr }),
  );
}

/** Replaces the first `from` in the installed `file` by `to`; the text must be there. */
async function patchInstalled(directory: string, file: string, from: string, to: string) {
  const path = join(directory, file);
  const source = await readFile(path, "utf8");
  const patched = source.replace(from, to);
  expect(patched, `${file} holds ${from}`).not.toBe(source);
  await writeFile(path, patched);
}

/** One check, the change made to the installation, and what the check must then say. */
interface DamagedCase {
  readonly name: string;
  /** The installed file changed, its text and what replaces it. */
  readonly file: string;
  readonly from: string;
  readonly to: string;
  /** The module of the check, and the call that runs it (`m` the module, `s` the services). */
  readonly module: string;
  readonly run: string;
  readonly fails: RegExp;
}

const WALLET = "dist/core/wallet-evidence-self-test.js";

/**
 * Each check of the self-test with one of its known answers damaged: it must fail, naming what
 * did not match. Public test data only; the damage is made to a disposable copy of the build.
 */
const DAMAGED_ANSWERS: readonly DamagedCase[] = [
  {
    name: "master fingerprint of the first BIP39 vector",
    file: "dist/core/master-fingerprint-self-test.js",
    from: '"b4e3f5ed"',
    to: '"b4e3f5ee"',
    module: "core/master-fingerprint-self-test.js",
    run: "m.checkMasterFingerprintStartup()",
    fails: /Master fingerprint of the first BIP39 vector mismatch/u,
  },
  {
    name: "seed of a BIP39 vector",
    file: "dist/core/master-fingerprint-self-test.js",
    from: '"2e8905819b8723fe',
    to: '"2e8905819b8723ff',
    module: "core/master-fingerprint-self-test.js",
    run: "m.checkMasterFingerprint(s.pbkdf2)",
    fails: /BIP39 seed vector mismatch/u,
  },
  {
    name: "date of the Seedshift vector",
    file: "dist/core/date-search-self-test.js",
    from: 'const MASKED_DATE = "23-09-2026"',
    to: 'const MASKED_DATE = "24-09-2026"',
    module: "core/date-search-self-test.js",
    run: "m.checkDateSearchStartup()",
    fails: /Date search of the Seedshift vector mismatch/u,
  },
  {
    name: "combinations of a date pattern",
    file: "dist/core/date-search-self-test.js",
    from: '["2?-0?-19??", 8_924]',
    to: '["2?-0?-19??", 8_925]',
    module: "core/date-search-self-test.js",
    run: "m.checkDateSearch(s.fingerprint)",
    fails: /Date pattern 2\?-0\?-19\?\? combinations mismatch/u,
  },
  {
    name: "encoded fingerprint",
    file: "dist/core/backup-reading-self-test.js",
    from: '"0d05289e"',
    to: '"0d05289f"',
    module: "core/backup-reading-self-test.js",
    run: "m.checkBackupReading(s.fingerprint)",
    fails: /Encoded fingerprint mismatch/u,
  },
  {
    name: "candidates of marked word numbers",
    file: "dist/core/backup-reading-self-test.js",
    from: "candidates: 4,",
    to: "candidates: 5,",
    module: "core/backup-reading-self-test.js",
    run: "m.checkBackupReadingStartup()",
    fails: /Marked indexes candidates mismatch/u,
  },
  {
    name: "entropy of a word-search candidate",
    file: "dist/core/candidates-self-test.js",
    from: '"00000400000000000000000000000000"',
    to: '"00000800000000000000000000000000"',
    module: "core/candidates-self-test.js",
    run: "m.checkWordSearchStartup()",
    fails: /Word search entropy 2 mismatch/u,
  },
  {
    name: "bytes of a candidate list",
    file: "dist/core/candidate-list-self-test.js",
    from: '98854aa000";',
    to: '98854aa001";',
    module: "core/candidate-list-self-test.js",
    run: "m.checkCandidateListStartup()",
    fails: /Candidate list mismatch/u,
  },
  {
    name: "list that the age files hold",
    file: "dist/core/candidate-list-self-test.js",
    from: '98854aa000";',
    to: '98854aa001";',
    module: "core/candidate-encryption-self-test.js",
    run: "m.checkCandidateEncryption()",
    fails: /Candidate file to the session key mismatch/u,
  },
  {
    name: "finding of a wrong date",
    file: "dist/core/backup-check-self-test.js",
    from: '"differs dates 1"',
    to: '"differs dates 2"',
    module: "core/backup-check-self-test.js",
    run: "m.checkBackupCheck(s.platform)",
    fails: /Backup check with a wrong date mismatch/u,
  },
  {
    name: "elements a share repair fills in",
    file: "dist/sskr/repair-self-test.js",
    from: '"4:#EE44D3 6:#E75FF8"',
    to: '"4:#EE44D4 6:#E75FF8"',
    module: "sskr/repair-self-test.js",
    run: "m.checkShareRepairStartup()",
    fails: /filled elements mismatch/u,
  },
  {
    name: "phrase of shares repaired together",
    file: "dist/sskr/known-answers.js",
    from: 'drum buyer"',
    to: 'drum burst"',
    module: "sskr/repair-self-test.js",
    run: "m.checkShareRepair(s.platform)",
    fails: /Shares repaired together: phrase mismatch/u,
  },
  {
    name: "refusal of too many dates for masked shares",
    file: "dist/sskr/share-unmasking-self-test.js",
    from: '"12-word phrases support at most 4 dates."',
    to: '"12-word phrases support at most 5 dates."',
    module: "sskr/share-unmasking-self-test.js",
    run: "m.checkShareUnmasking(s.fingerprint, s.platform)",
    fails: /Shares unmasked with five dates mismatch/u,
  },
  {
    name: "place of BIP84's first address",
    file: WALLET,
    from: '"matched at m/84\'/0\'/0\'/0/0", "BIP84 address"',
    to: '"matched at m/84\'/0\'/0\'/0/1", "BIP84 address"',
    module: "core/wallet-evidence-self-test.js",
    run: "m.WALLET_EVIDENCE_SELF_TEST.startup()",
    fails: /BIP84 address mismatch/u,
  },
  {
    name: "path of a Litecoin address",
    file: "dist/core/coins/bitcoin-like-self-test.js",
    from: "\"m/44'/2'/0'/0/0\"",
    to: "\"m/44'/2'/0'/0/1\"",
    module: "core/coins-self-test.js",
    run: "m.COIN_ADDRESS_SELF_TEST.startup()",
    fails: /Litecoin m\/44'\/2'\/0'\/0\/1 mismatch/u,
  },
  {
    name: "the second Dash Platform address, for a host of Dash alone",
    file: "dist/core/coins/dash-self-test.js",
    from: '"dash1kzjl7qzxy9lar37j8r37z3kvt07epqe20ckxfezw"',
    to: '"dash1krma5z3ttj75la4m93xcndna9ullamq9y5e9n5rs"',
    module: "core/coins/dash-self-test.js",
    run: "m.DASH_ADDRESS_SELF_TEST.startup()",
    fails: /Dash second address among two mismatch/u,
  },
  {
    name: "words of the heir sheet",
    file: "dist/export/heir-sheet-self-test.js",
    from: '"Any 2 of the 3 Shamir shares',
    to: '"Any 3 of the 3 Shamir shares',
    module: "export/heir-sheet-self-test.js",
    run: "m.HEIR_SHEET_SELF_TEST.startup()",
    fails: /Heir sheet for shares mismatch/u,
  },
  {
    name: "references of share cards",
    file: "dist/export/sskr-render-self-test.js",
    from: '"4BBF-1-1 4BBF-1-2"',
    to: '"4BBF-1-1 4BBF-1-3"',
    module: "export/sskr-render-self-test.js",
    run: "m.SHARE_CARDS_SELF_TEST.startup()",
    fails: /Share card references mismatch/u,
  },
];

/**
 * A feature that accepts a case it must refuse, its refusal taken out of a copy of the build: the
 * check of the feature must fail, saying that the case was accepted or refused for another reason.
 */
const LOST_REFUSALS: readonly DamagedCase[] = [
  {
    name: "a candidate list with a damaged record",
    file: "dist/core/candidate-list.js",
    from: 'throw new Error("The candidate list is damaged: its CRC-32 does not match.")',
    to: "void 0",
    module: "core/candidate-list-self-test.js",
    run: "m.checkCandidateListStartup()",
    fails: /A list with a damaged record was accepted/u,
  },
  {
    name: "an age file at another scrypt work factor",
    file: "dist/core/candidate-encryption.js",
    from: "if (expected === SCRYPT_STANZA && stanzas[0][2] !== String(SCRYPT_LOG_N))",
    to: "if (false)",
    module: "core/candidate-encryption-self-test.js",
    run: "m.checkCandidateEncryption()",
    fails: /scrypt work factor 16 was accepted/u,
  },
  {
    name: "dates beyond the safety limit",
    file: "dist/core/date-search.js",
    from: "if (this.combinations > HARD_MAX_COMBINATIONS)",
    to: "if (false)",
    module: "core/date-search-self-test.js",
    run: "m.checkDateSearchStartup()",
    fails: /was accepted/u,
  },
  {
    name: "codes without a mark",
    file: "dist/core/missing-codes.js",
    from: 'throw new Error("No code is marked: mark each code that cannot be read with ?.")',
    to: "void 0",
    module: "core/backup-reading-self-test.js",
    run: "m.checkBackupReadingStartup()",
    fails: /Codes without a mark was accepted/u,
  },
  {
    name: "a word search without a forgotten word",
    file: "dist/core/candidates.js",
    from: 'throw new Error("Mark each forgotten word with ?, a prefix with *, or a|b.")',
    to: "void 0",
    module: "core/candidates-self-test.js",
    run: "m.checkWordSearchStartup()",
    fails: /A refused word search was accepted/u,
  },
  {
    name: "a share with seven marks",
    file: "dist/sskr/repair.js",
    from: "markCount(text) > MAX_MARKED_ELEMENTS)",
    to: "false)",
    module: "sskr/repair-self-test.js",
    run: "m.checkShareRepairStartup()",
    fails: /A share with seven marks was refused for another reason/u,
  },
  {
    name: "a public key that is not compressed",
    file: "dist/core/wallet-evidence.js",
    from: 'throw new Error("A compressed public key must start with 02 or 03.")',
    to: "void 0",
    module: "core/wallet-evidence-self-test.js",
    run: "m.WALLET_EVIDENCE_SELF_TEST.check.run()",
    fails: /A public key that is not compressed was refused for another reason/u,
  },
  {
    name: "an Ethereum address with a wrong EIP-55 checksum",
    file: "dist/core/coins/evm.js",
    from: 'throw invalidAddress("its EIP-55 checksum, the mix of capital and small letters, is wrong")',
    to: "void 0",
    module: "core/coins-self-test.js",
    run: "m.COIN_ADDRESS_SELF_TEST.check.run()",
    fails: /A refused Ethereum and EVM networks address was accepted/u,
  },
  {
    name: "a heir sheet for shares of the Original Seedshift",
    file: "dist/export/heir-sheet-text.js",
    from: 'throw new Error("Shares cannot use the original Seedshift.")',
    to: "void 0",
    module: "export/heir-sheet-self-test.js",
    run: "m.HEIR_SHEET_SELF_TEST.startup()",
    fails: /Heir sheet for shares of the Original Seedshift was accepted/u,
  },
  {
    name: "a share card QR code of another share",
    file: "dist/sskr/transport.js",
    from: 'throw new Error("Share QR does not match the printed references.")',
    to: "void 0",
    module: "export/sskr-render-self-test.js",
    run: "m.SHARE_CARDS_SELF_TEST.check.run()",
    fails: /A QR code of another share was accepted/u,
  },
];

describe("Each self-test check can fail", () => {
  it("passes on the build as it is", async () => {
    await withInstallation(async (directory) => {
      for (const { module, run } of [...DAMAGED_ANSWERS, ...LOST_REFUSALS]) {
        const result = await runCheck(directory, module, run);
        expect(result, `${module}: ${run}`).toEqual({ code: 0, stderr: "" });
      }
    });
  }, 180_000);

  for (const damaged of [...DAMAGED_ANSWERS, ...LOST_REFUSALS])
    it(`fails with ${damaged.name}`, async () => {
      await withInstallation(async (directory) => {
        await patchInstalled(directory, damaged.file, damaged.from, damaged.to);
        const result = await runCheck(directory, damaged.module, damaged.run);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toMatch(damaged.fails);
      });
    });

  it("stops every command before a secret when a feature's startup answer is damaged", async () => {
    await withInstallation(async (directory) => {
      const { file, from, to } = DAMAGED_ANSWERS.find((damaged) => damaged.file === WALLET)!;
      await patchInstalled(directory, file, from, to);
      const result = await execute(process.execPath, [
        join(directory, "dist/mnemocode.js"),
        "encode",
        "--mode",
        "direct",
        "--mnemonic",
        publicMnemonic,
      ]).then(
        (output) => ({ code: 0, ...output }),
        (error: { code: number; stdout: string; stderr: string }) => error,
      );
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("CRITICAL: MnemoCode core self-test failed.");
      expect(result.stderr).toContain("BIP84 address mismatch.");
      expect(result.stderr).not.toContain(publicMnemonic);
    });
  });
});
