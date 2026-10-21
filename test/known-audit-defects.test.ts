import { describe, expect, it } from "vitest";
import { assertWalletEvidence, matchBitcoinEvidence } from "../src/bitcoin-evidence.js";
import {
  decodeIndexes,
  decodeIndexesLegacy,
  decodeIndexesLegacyValid,
  parseDate,
  parseInput,
  representMnemonic,
  formatEncoded,
  type EncodedFormat,
  type OutputFormat,
} from "../src/core.js";
import { parseRecord, serializeRecord } from "../src/record.js";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { readBoundedFile } from "../src/cli/bounded-read.js";
import { decodeQrPngFile } from "../src/cli/qr-input.js";
import { publishNewPrivateFile } from "../src/export/private-file.js";
import { exportSskrCards } from "../src/export/sskr-cards.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { BUILT_CLI } from "./helpers/built-cli.js";
import { sskrVectors } from "./helpers/vectors.js";
import { DATE, TEST_ADDRESS, TEST_PHRASE } from "./helpers/test-phrase.js";

describe("AUD-001 regression contracts", () => {
  it("AUD-001-SEC002: protects input through an alias of its parent directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-alias-"));
    try {
      const real = join(directory, "real");
      await mkdir(real);
      await symlink(real, join(directory, "alias"), "junction");
      const source = join(real, "input.txt");
      const dateFile = join(directory, "public-dates.txt");
      await writeFile(source, TEST_PHRASE);
      await writeFile(dateFile, DATE, "utf8");
      const result = await promisify(execFile)(process.execPath, [
        BUILT_CLI,
        "encode",
        "--mode",
        "seedshift",
        "--mnemonic-file",
        source,
        "--dates-file",
        dateFile,
        "--output",
        join(directory, "alias", "input.txt"),
      ]).then(
        () => 0,
        (error: { code: number }) => error.code,
      );
      expect(await readFile(source, "utf8")).toBe(TEST_PHRASE);
      expect(result).not.toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("AUD-001-FUN001: accepts a valid uppercase BIP84 address", () => {
    expect(
      matchBitcoinEvidence(TEST_PHRASE, {
        kind: "address",
        value: TEST_ADDRESS.toUpperCase(),
        profiles: ["native-segwit"],
        location: { network: "mainnet", account: 0, branch: 0, index: 0 },
      }).matched,
    ).toBe(true);
  });

  const unsupportedFormat = { code: "core.encoded-form.unsupported-encoded-format" };

  it("AUD-001-API001: rejects an unknown input format from a JavaScript host", () => {
    // A format that no type allows, fed on purpose as a JavaScript host could.
    expect(() => parseInput(TEST_PHRASE, "misspelled" as EncodedFormat)).toThrow(
      expect.objectContaining(unsupportedFormat),
    );
  });

  it("AUD-001-API001: rejects an unknown output format from a JavaScript host", () => {
    expect(() =>
      // A format that no type allows, fed on purpose as a JavaScript host could.
      formatEncoded(representMnemonic(TEST_PHRASE), "misspelled" as OutputFormat),
    ).toThrow(expect.objectContaining(unsupportedFormat));
  });

  it("AUD-001-API001: cannot serialize an unreadable record format", () => {
    expect(() =>
      // A format that no type allows, fed on purpose as a JavaScript host could.
      serializeRecord("direct", "misspelled" as EncodedFormat, TEST_PHRASE),
    ).toThrow(expect.objectContaining({ code: "record.unsupported-format" }));
  });
});

describe("AUD-004 regression contracts", () => {
  it("AUD-004-API001: rejects an unknown evidence kind instead of reporting a non-match", () => {
    const typo = {
      kind: "address-typo",
      value: "irrelevant",
      profiles: ["native-segwit"],
      location: { network: "mainnet", account: 0, branch: 0, index: 0 },
    };
    // A kind that no type allows, fed on purpose as a JavaScript host could.
    expect(() => matchBitcoinEvidence(TEST_PHRASE, typo as never)).toThrow(
      "Unsupported Bitcoin evidence kind.",
    );
  });

  it("AUD-004-API001: rejects evidence that is no object as of an unknown kind", () => {
    for (const evidence of ["abc", 7, true])
      expect(() =>
        // Evidence that no type allows, fed on purpose as a JavaScript host could.
        assertWalletEvidence(evidence as never),
      ).toThrow(
        expect.objectContaining({ code: "core.wallet-evidence.unsupported-bitcoin-evidence-kind" }),
      );
  });

  it("AUD-004-SEC001: bounds what is read, not what the file reports", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-bounded-"));
    const limit = 16;
    try {
      const exact = join(directory, "exact");
      await writeFile(exact, "a".repeat(limit));
      expect(readBoundedFile(exact, limit, "too large").toString()).toBe("a".repeat(limit));
      const over = join(directory, "over");
      await writeFile(over, "a".repeat(limit + 1));
      expect(() => readBoundedFile(over, limit, "too large")).toThrow("too large");
      if (process.platform !== "win32") {
        // A named pipe reports size 0; the bound must still stop at the limit.
        const pipe = join(directory, "pipe");
        await promisify(execFile)("mkfifo", [pipe]);
        const writer = writeFile(pipe, "a".repeat(limit * 4));
        expect(() => readBoundedFile(pipe, limit, "too large")).toThrow("too large");
        await writer.catch(() => undefined);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "AUD-004-SEC001: stops endless input that reports size 0 at the limit",
    () => {
      // /dev/zero reports size 0 and never ends: the strongest form of a file that keeps growing.
      // A file that another process appends to is not read here, since whether the read meets it
      // growing depends on timing; the named pipe above has a reported size that says nothing too.
      expect(() => readBoundedFile("/dev/zero", 16, "too large")).toThrow("too large");
    },
  );

  it("AUD-004-SEC001: refuses a QR PNG one byte over 16 MiB before decoding it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-png-limit-"));
    try {
      const large = join(directory, "large.png");
      await writeFile(large, new Uint8Array(16 * 1024 * 1024 + 1));
      await expect(decodeQrPngFile(large)).rejects.toThrow("exceeds the 16 MiB safety limit");
      if (process.platform !== "win32") {
        await expect(decodeQrPngFile("/dev/zero")).rejects.toThrow(
          "exceeds the 16 MiB safety limit",
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("AUD-004 regression contracts", () => {
  /**
   * The steps of a publication at which pausedPublisher stops, in their order, and what it says
   * once it ran to the end.
   */
  const PUBLICATION_STEPS = [
    "before mkdtemp",
    "before writeFile",
    "half written",
    "before link",
    "before rm",
    "published",
  ] as const;

  /**
   * A program that publishes `size` bytes of "a" to `path` with publishNewPrivateFile, its file
   * system replaced at the edge so that it stops at step `pauseAt` of PUBLICATION_STEPS, says
   * which on standard output and waits there to be killed: before each call of the file system
   * that the publication makes, and half way through writing the file, which is written in two
   * halves for that. Past the last step it runs to the end and says so.
   */
  function pausedPublisher(path: string, size: number, pauseAt: number): string {
    const privateFile = pathToFileURL(resolve("src/export/private-file.ts")).href;
    return `
      import { createRequire, syncBuiltinESMExports } from "node:module";
      const files = createRequire(import.meta.url)("node:fs/promises");
      let step = 0;
      async function reached(name) {
        if (step++ !== ${pauseAt}) return;
        process.stdout.write(name + "\\n");
        setInterval(() => {}, 60_000);
        await new Promise(() => {});
      }
      for (const name of ["mkdtemp", "link", "rm"]) {
        const real = files[name];
        files[name] = async (...args) => (await reached("before " + name), real(...args));
      }
      const { writeFile, appendFile } = files;
      files.writeFile = async (path, bytes, options) => {
        await reached("before writeFile");
        await writeFile(path, bytes.subarray(0, bytes.length / 2), options);
        await reached("half written");
        await appendFile(path, bytes.subarray(bytes.length / 2));
      };
      syncBuiltinESMExports();
      const { publishNewPrivateFile } = await import(${JSON.stringify(privateFile)});
      await publishNewPrivateFile(${JSON.stringify(path)}, new Uint8Array(${size}).fill(97));
      process.stdout.write("published\\n");`;
  }

  it("AUD-004-DOC001: a publication killed at each of its steps leaves no partial file under the final name", async () => {
    const size = 4096;
    for (const [pauseAt, step] of PUBLICATION_STEPS.entries()) {
      const directory = await mkdtemp(join(tmpdir(), "mnemocode-killed-"));
      try {
        const path = join(directory, "shares.txt");
        const child = spawn(process.execPath, [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          pausedPublisher(path, size, pauseAt),
        ]);
        const closed = new Promise((done) => child.once("close", done));
        let said = "";
        let errors = "";
        child.stderr.on("data", (chunk) => (errors += String(chunk)));
        await new Promise<void>((done) => {
          child.stdout.on("data", (chunk) => {
            said += String(chunk);
            if (said.includes("\n")) done();
          });
          void closed.then(() => done());
        });
        child.kill("SIGKILL");
        await closed;
        expect(said.trim(), errors).toBe(step);
        // The final name holds the whole file once it is linked, and nothing before.
        if (pauseAt < PUBLICATION_STEPS.indexOf("before rm"))
          expect(await readdir(directory), step).not.toContain("shares.txt");
        else expect(await readFile(path), step).toEqual(Buffer.alloc(size, "a"));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it("AUD-004-DOC001: publishes a new private file whole and never replaces an existing one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-publish-"));
    try {
      const target = join(directory, "shares.txt");
      await publishNewPrivateFile(target, new TextEncoder().encode("complete\n"));
      expect(await readFile(target, "utf8")).toBe("complete\n");
      if (process.platform !== "win32") expect((await stat(target)).mode & 0o777).toBe(0o600);
      await expect(
        publishNewPrivateFile(target, new TextEncoder().encode("other\n")),
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(target, "utf8")).toBe("complete\n");
      // Nothing is left of the private staging folder.
      expect((await readdir(directory)).sort()).toEqual(["shares.txt"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("AUD-005 regression contracts", () => {
  it("AUD-005-API001: reads only the canonical record version", () => {
    const payload = `direct:english:${TEST_PHRASE}`;
    expect(parseRecord(`MNC1:${payload}`)?.payload).toBe(TEST_PHRASE);
    expect(parseRecord(serializeRecord("direct", "english", TEST_PHRASE))?.version).toBe(1);
    for (const header of ["MNC01", "MNC0001", "MNC0"])
      expect(() => parseRecord(`${header}:${payload}`)).toThrow(
        "Malformed MnemoCode record header.",
      );
    expect(() => parseRecord(`MNC2:${payload}`)).toThrow(
      "Unsupported MnemoCode record version. A newer MnemoCode reads it.",
    );
  });

  it("AUD-005-API002: every decoder reports an invalid index as an invalid index", () => {
    const dates = [parseDate("01-01-2000")];
    const message = "Every BIP39 index must be an integer from 0 through 2047.";
    for (const bad of [2048, -1, 1.5]) {
      const indexes = [bad, ...Array.from({ length: 11 }, () => 0)];
      expect(() => decodeIndexesLegacyValid(indexes, dates)).toThrow(message);
      expect(() => decodeIndexesLegacy(indexes, dates)).toThrow(message);
      expect(() => decodeIndexes(indexes, dates)).toThrow(message);
    }
  });

  it.skipIf(process.platform === "win32")(
    "AUD-005-SEC001: the folder of one share is private, like the export folder",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "mnemocode-share-folder-"));
      try {
        const vectors = sskrVectors();
        const target = join(directory, "cards");
        const cards = await ShareCardSet.create(nodeCardRenderer, [vectors.official.shares[0]!], {
          style: "it",
          pageSize: "business",
        });
        await exportSskrCards(cards, target);
        const [folder] = await readdir(target);
        expect(folder).toMatch(/^collection-/u);
        expect((await stat(join(target, folder!))).mode & 0o777).toBe(0o700);
        expect((await stat(target)).mode & 0o777).toBe(0o700);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
