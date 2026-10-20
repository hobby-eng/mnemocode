import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { sskrVectors } from "./helpers/vectors.js";
import { SskrRuntime } from "../src/sskr/runtime.js";
import { readBundledFile } from "../src/bundled-files.js";
import { bytesOfHex } from "../src/core/bits.js";
import { PROTECTION_FLAGS } from "../src/cli/protection.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { PublicCliFiles } from "./helpers/public-cli-files.js";
import { UNREACHED_FAULT_EXIT } from "./helpers/unreached-fault.js";
import { RUN_OUTPUT_BYTES } from "./helpers/limits.js";
// The SHA-256 digest of each pinned file of the bridge, by its path.
import pins from "../sskr-wasm/integrity.json" with { type: "json" };

const execute = promisify(execFile);
const bridge = resolve("sskr-wasm");
const ENGINE_FILES = ["generated/recovery_sskr_wasm_bg.wasm", "generated/recovery_sskr_wasm.js"];
const INTEGRITY_MESSAGE = "SSKR dependency integrity check failed. No secret was processed.";
/**
 * The most one protected run of the CLI may take: it reads two shares and ends in about a second.
 * A run that hangs is killed and reported as such, before Vitest's limit for the whole test.
 */
const CLI_TIMEOUT_MS = 10_000;

// A child-process filesystem adapter: the checkout and imported JS are never modified or copied.
// Built-in exports are synchronized before the real CLI imports its bundled-file reader.
const corruptEngineRead = `
import files from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const target = pathToFileURL(resolve("sskr-wasm", process.env.MNEMOCODE_TEST_CORRUPT_ENGINE));
const originalRead = files.readFile.bind(files);
let targetReads = 0;
files.readFile = async (path, ...options) => {
  const bytes = await originalRead(path, ...options);
  const url = path instanceof URL ? path : typeof path === "string" ? pathToFileURL(path) : undefined;
  if (url?.href === target.href && bytes instanceof Uint8Array) {
    targetReads += 1;
    if (process.env.MNEMOCODE_TEST_ENGINE_MUTATE === "0") return bytes;
    const altered = Uint8Array.from(bytes);
    altered[altered.length - 1] ^= 0x01;
    return altered;
  }
  return bytes;
};
syncBuiltinESMExports();
// A different exit from both application success and refusal exposes a missed interception.
process.on("exit", () => {
  if (targetReads === 0) process.exitCode = ${UNREACHED_FAULT_EXIT};
});
`;

interface CliResult {
  readonly code: number | null;
  readonly signal: string | null;
  readonly killed: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

async function protectedCli(
  engineFile: string,
  mutate: boolean,
  quorum: readonly string[],
): Promise<CliResult> {
  using material = new PublicCliFiles([
    "sskr-combine",
    ...quorum.flatMap((share) => ["--share", share]),
  ]);
  try {
    const output = await execute(
      process.execPath,
      [
        ...PROTECTION_FLAGS,
        "--import",
        `data:text/javascript,${encodeURIComponent(corruptEngineRead)}`,
        resolve("dist/mnemocode.js"),
        ...material.arguments,
      ],
      {
        env: {
          ...process.env,
          NO_COLOR: "1",
          MNEMOCODE_TEST_CORRUPT_ENGINE: engineFile,
          MNEMOCODE_TEST_ENGINE_MUTATE: mutate ? "1" : "0",
        },
        maxBuffer: RUN_OUTPUT_BYTES,
        timeout: CLI_TIMEOUT_MS,
      },
    );
    return { code: 0, signal: null, killed: false, ...output };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const code: unknown = Reflect.get(error, "code");
    const signal: unknown = Reflect.get(error, "signal");
    const killed: unknown = Reflect.get(error, "killed");
    const stdout: unknown = Reflect.get(error, "stdout");
    const stderr: unknown = Reflect.get(error, "stderr");
    if (
      (typeof code !== "number" && code !== null) ||
      (typeof signal !== "string" && signal !== null) ||
      typeof killed !== "boolean" ||
      typeof stdout !== "string" ||
      typeof stderr !== "string"
    )
      throw error;
    return { code, signal, killed, stdout, stderr };
  }
}

async function filesBelow(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(bridge, join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}

describe("SSKR integrity (AUD-005-BLD005)", () => {
  it.each(["integrity.json", ...ENGINE_FILES])(
    "passes through a failed host read of %s and caches only its successful retry",
    async (damaged) => {
      const fault = Object.assign(new Error("Synthetic bundled-file reader failure."), {
        code: "EIO",
      });
      let refuses = true;
      let reads = 0;
      const runtime = new SskrRuntime(async (path) => {
        reads += 1;
        if (refuses && path === `sskr-wasm/${damaged}`) throw fault;
        return readBundledFile(path);
      });
      const failed = runtime.load();
      expect(runtime.load()).toBe(failed);
      await expect(failed).rejects.toBe(fault);
      refuses = false;
      const pending = runtime.load();
      expect(runtime.load()).toBe(pending);
      const engine = await pending;
      const secret = engine.recover_sskr_shares(SSKR_SET_VECTOR.shares.slice(0, 2).join("\n"));
      try {
        expect(secret).toEqual(bytesOfHex(SSKR_SET_VECTOR.entropy));
      } finally {
        secret.fill(0);
      }
      const afterLoad = reads;
      expect(runtime.load()).toBe(pending);
      expect(await runtime.load()).toBe(engine);
      expect(reads).toBe(afterLoad);
    },
  );

  it.each([
    "null",
    '{"synthetic-private-token',
    "[]",
    '"synthetic-private-token"',
    "{}",
    '{"generated/recovery_sskr_wasm.js":42}',
  ])(
    "refuses malformed manifest %s with a safe code and permits a healthy retry",
    async (damaged) => {
      let corrupt = true;
      const runtime = new SskrRuntime((path) =>
        corrupt && path === "sskr-wasm/integrity.json"
          ? Promise.resolve(new TextEncoder().encode(damaged))
          : readBundledFile(path),
      );
      const failed = runtime.load();
      expect(runtime.load()).toBe(failed);
      await expect(failed).rejects.toMatchObject({
        code: "sskr.runtime.sskr-dependency-integrity-check-failed-no-secret-was",
        message: INTEGRITY_MESSAGE,
      });
      await expect(failed).rejects.not.toHaveProperty("cause");
      corrupt = false;
      const pending = runtime.load();
      expect(runtime.load()).toBe(pending);
      const engine = await pending;
      const secret = engine.recover_sskr_shares(SSKR_SET_VECTOR.shares.slice(0, 2).join("\n"));
      try {
        expect(secret).toEqual(bytesOfHex(SSKR_SET_VECTOR.entropy));
      } finally {
        secret.fill(0);
      }
    },
  );

  it("pins every bridge source, build and generated file with its current hash", async () => {
    for (const [path, digest] of Object.entries(pins)) {
      const bytes = await readFile(join(bridge, path));
      expect(createHash("sha256").update(bytes).digest("hex"), path).toBe(digest);
    }
    // A refreshed or added file must be pinned too; a Cargo build folder is not part of the bridge.
    const pinnable = [
      ...(await filesBelow(join(bridge, "generated"))),
      ...(await filesBelow(join(bridge, "rust"))),
    ].filter((path) => !path.startsWith("rust/target/"));
    pinnable.push("../Dockerfile.sskr", "../scripts/build-sskr-wasm.mjs");
    expect(Object.keys(pins).sort()).toEqual(pinnable.sort());
  });

  it.each(ENGINE_FILES)("refuses Shamir work when %s differs by one byte", async (damaged) => {
    const vectors = sskrVectors();
    const quorum: string[] = vectors.official.validQuorums[0]!.map(
      (index: number) => vectors.official.shares[index]!,
    );
    let corrupt = true;
    const runtime = new SskrRuntime(async (path) => {
      const bytes = await readBundledFile(path);
      if (corrupt && path === `sskr-wasm/${damaged}`) {
        const altered = Uint8Array.from(bytes);
        altered[altered.length - 1]! ^= 0x01;
        return altered;
      }
      return bytes;
    });
    // Only the filesystem edge is replaced; actual pins, hashing, loader and bridge run.
    const failed = runtime.load();
    expect(runtime.load()).toBe(failed);
    await expect(failed).rejects.toMatchObject({
      code: "sskr.runtime.sskr-dependency-integrity-check-failed-no-secret-was",
      message: INTEGRITY_MESSAGE,
    });
    corrupt = false;
    const loaded = runtime.load();
    expect(runtime.load()).toBe(loaded);
    const engine = await loaded;
    const secret = engine.recover_sskr_shares(quorum.join("\n"));
    try {
      expect(secret).toEqual(bytesOfHex(vectors.official.entropy));
    } finally {
      secret.fill(0);
    }
  });

  it.each(ENGINE_FILES)(
    "restores the public phrase with the healthy protected CLI reader for %s",
    async (engineFile) => {
      const result = await protectedCli(engineFile, false, SSKR_SET_VECTOR.shares.slice(0, 2));
      expect(result).toMatchObject({ code: 0, signal: null, killed: false });
      expect(result.stdout.split(/\r?\n/u)).toContain(SSKR_SET_VECTOR.phrase);
      expect(result.stderr).not.toContain(INTEGRITY_MESSAGE);
    },
  );

  it.each(ENGINE_FILES)(
    "keeps the protected CLI from processing shares when %s differs by one byte",
    async (damaged) => {
      const vectors = sskrVectors();
      const quorum = vectors.official.validQuorums[0]!.map(
        (index) => vectors.official.shares[index]!,
      );
      const result = await protectedCli(damaged, true, quorum);
      expect(result).toMatchObject({ code: 1, signal: null, killed: false });
      expect(result.stdout).toBe("");
      expect(result.stderr, `Damaged engine exit: ${result.code}`).toContain(INTEGRITY_MESSAGE);
      for (const share of quorum) expect(result.stderr).not.toContain(share);
    },
  );
});
