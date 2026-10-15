// File paths and manual recovery input share one private prompt. Public BIP39/SSKR fixtures only.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askSecretUntil } from "../src/cli/ask.js";
import { runDecode } from "../src/cli/decode-command.js";
import { runRecoverWord } from "../src/cli/recover-word-command.js";
import { runSskrCombine } from "../src/cli/sskr-command.js";
import { encodeMnemonic, formatEncoded, parseDate } from "../src/core.js";
import { ENCODED_FORMATS } from "../src/core/types.js";
import { serializeRecord } from "../src/record.js";
import { MAX_TEXT_INPUT_BYTES } from "../src/cli/bounded-read.js";
import { TEXT_FILE_INPUT_CHECK } from "../src/cli/self-test.js";
import { SHARE_FORMATS, writeShare } from "../src/sskr/transport.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { PHRASE, SHARES } from "./helpers/share-questions.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/private-screen.js", async (importOriginal) =>
  harness.replacedPrivateScreen(await importOriginal()),
);
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) =>
  harness.replacedTerminalChoice(await importOriginal()),
);

questionsOnPrivateScreen();
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mnemocode-file-answer-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** A synthetic file, named with spaces as paths dragged into a terminal often are. */
async function file(text: string, name = "backup with spaces.txt"): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, text);
  return path;
}

describe("a private file-or-text prompt", () => {
  it("reads a quoted path without showing the file's contents", async () => {
    const text = "synthetic first line\nsynthetic second line\n";
    terminal.answers = [`'${await file(text)}'\r`];
    expect(
      await askSecretUntil("Input:", (answer) => answer, { textFile: "The backup file" }),
    ).toBe(text);
    expect(seen.screen).not.toContain(text.trim());
  });

  it("accepts a local file URL", async () => {
    const path = await file("synthetic text");
    terminal.answers = [`${pathToFileURL(path).href}\r`];
    expect(
      await askSecretUntil("Input:", (answer) => answer, { textFile: "The backup file" }),
    ).toBe("synthetic text");
  });

  it("keeps inline UR shares and word patterns as text", async () => {
    for (const text of [SHARES[0], "ab* rich|rice ?", "http://example.invalid/backup.txt"]) {
      terminal.answers = [`${text}\r`];
      expect(
        await askSecretUntil("Input:", (answer) => answer, { textFile: "The backup file" }),
      ).toBe(text);
    }
  });

  it("keeps file-looking passwords literal when file input was not enabled", async () => {
    const path = await file("synthetic file contents");
    terminal.answers = [`${path}\r`];
    expect(await askSecretUntil("Password:", (answer) => answer)).toBe(path);
  });

  it("does not follow a second path written inside the first file", async () => {
    const inner = await file("synthetic nested content", "inner.txt");
    terminal.answers = [`${await file(inner)}\r`];
    expect(
      await askSecretUntil("Input:", (answer) => answer, { textFile: "The backup file" }),
    ).toBe(inner);
  });

  it("asks again for a missing file without repeating its path", async () => {
    const path = join(directory, "missing.txt");
    terminal.answers = [`${path}\r`, "manual replacement\r"];
    expect(
      await askSecretUntil("Input:", (answer) => answer, { textFile: "The backup file" }),
    ).toBe("manual replacement");
    expect(seen.notices).toContain(
      "The backup file could not be read. Check that the file exists and is readable.",
    );
    expect(seen.notices.join("\n")).not.toContain(path);
  });

  it.each(["empty", "invalid UTF-8", "too large", "directory", "remote file URL"])(
    "refuses an unusable %s file and keeps the prompt open",
    async (kind) => {
      let path = await file("");
      if (kind === "invalid UTF-8") await writeFile(path, Uint8Array.of(0xff));
      if (kind === "too large") await writeFile(path, new Uint8Array(MAX_TEXT_INPUT_BYTES + 1));
      if (kind === "directory") path = directory;
      if (kind === "remote file URL") path = "file://example.invalid/backup.txt";
      terminal.answers = [`${path}\r`, "manual replacement\r"];
      const read = (text: string): string => {
        if (text.length === 0) throw Error("The synthetic file is empty.");
        return text;
      };
      expect(await askSecretUntil("Input:", read, { textFile: "The backup file" })).toBe(
        "manual replacement",
      );
      expect(seen.notices).not.toEqual([]);
      expect(seen.notices.join("\n")).not.toContain(path);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a named pipe without waiting for a writer",
    async () => {
      const path = join(directory, "pipe.txt");
      execFileSync("mkfifo", [path]);
      terminal.answers = [`${path}\r`, "manual replacement\r"];
      expect(await askSecretUntil("Input:", (text) => text, { textFile: "The backup file" })).toBe(
        "manual replacement",
      );
      expect(seen.notices).not.toEqual([]);
    },
  );
});

it.each(SHARE_FORMATS)(
  "reads a MnemoCode %s share export from the share prompt",
  async (format) => {
    const text = [SHARES[0], SHARES[2]].map((share) => writeShare(share, format)).join("\n");
    terminal.answers = [`'${await file(`${text}\n`)}'\r`];
    expect(await runSskrCombine({ "ask-secrets": true })).toBeUndefined();
    expect(seen.out).toContain(PHRASE);
    expect(terminal.questions).toEqual([]);
  },
);

it.each(ENCODED_FORMATS)("keeps the metadata of an exported %s record", async (format) => {
  const date = "23-09-2026";
  const encoded = encodeMnemonic(TEST_PHRASE, [parseDate(date)]);
  const record = serializeRecord("seedshift", format, formatEncoded(encoded, format));
  terminal.answers = [`${await file(`${record}\n`)}\r`, `${date}\r`];
  expect(await runDecode({ "ask-secrets": true })).toBeUndefined();
  expect(seen.out).toContain(TEST_PHRASE);
  expect(terminal.questions).toEqual([]);
});

it("reads forgotten-word patterns from a seed phrase text file", async () => {
  terminal.answers = [`${await file(TEST_PHRASE.replace(/about$/u, "abo*"))}\r`];
  expect(await runRecoverWord({ "ask-secrets": true })).toBeUndefined();
  expect(seen.out.join("\n")).toContain(TEST_PHRASE);
});

it("runs the file-input part of the full self-test without generating documents", async () => {
  await TEXT_FILE_INPUT_CHECK.run();
});

it("adds shares from a file after one was typed by hand", async () => {
  terminal.answers = [`${SHARES[0]}\r`, `${await file(SHARES[2])}\r`];
  expect(await runSskrCombine({ "ask-secrets": true })).toBeUndefined();
  expect(seen.out).toContain(PHRASE);
});

it("replaces one unreadable share from a single-share file and refuses a whole set there", async () => {
  terminal.answers = [
    `${SHARES[0]};not-a-share\r`,
    `${await file(`${SHARES[1]}\n${SHARES[2]}`, "whole-set.txt")}\r`,
    `${await file(SHARES[2], "single-share.txt")}\r`,
  ];
  terminal.choices = ["again"];
  expect(await runSskrCombine({ "ask-secrets": true })).toBeUndefined();
  expect(seen.notices).toContain("Give one share here, or a text file containing just that share.");
  expect(seen.out).toContain(PHRASE);
});
