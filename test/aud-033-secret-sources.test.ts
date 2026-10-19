import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  assertPrivateFileSources,
  assertSafeMaterialArgv,
  parseArguments,
} from "../src/cli/arguments.js";
import { runCommandLine } from "../src/cli/command-line.js";
import {
  assertDateInputMode,
  dateInputText,
  dates,
  textInput,
  transformMode,
} from "../src/cli/input.js";
import { MAX_TEXT_INPUT_BYTES } from "../src/cli/bounded-read.js";
import { validateOutputPaths } from "../src/cli/output-paths.js";

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "mnemocode-public-secret-sources-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

it.each([
  "--mnemonic",
  "--input",
  "--share",
  "--date",
  "--dates",
  "--old-date",
  "--old-dates",
  "--last-word",
])(
  "refuses %s at the actual dispatcher before protection or material reads without echo",
  async (flag) => {
    const marker = "PUBLIC_SYNTHETIC_WRONG_FIELD_SENTINEL";
    const failure: unknown = await runCommandLine(["encode", flag, marker]).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toHaveProperty("code", "cli.arguments.private-material-argv");
    expect(String(failure)).not.toContain(marker);
  },
);

it("preserves non-secret selectors, public references and safe file/stdin option names", () => {
  expect(() =>
    assertSafeMaterialArgv([
      "encode",
      "--mode",
      "direct",
      "--format",
      "indexes",
      "--sskr",
      "--threshold",
      "2",
      "--shares",
      "3",
      "--mnemonic-file",
      "-",
      "--dates-file",
      "public-dates.txt",
      "--input-file",
      "public-record.txt",
      "--share-file",
      "public-shares.txt",
      "--last-word-file",
      "public-word.txt",
      "--master-fingerprint",
      "73c5da0a",
      "--candidates-key",
      "public-recipient",
    ]),
  ).not.toThrow();
});

it.each(["input-file", "share-file", "dates-file", "old-dates-file", "last-word-file"])(
  "refuses competing %s and mnemonic standard-input sources before reading",
  (key) => {
    expect(() => assertPrivateFileSources({ "mnemonic-file": "-", [key]: "-" })).toThrow(
      "only one material source",
    );
    expect(() => assertPrivateFileSources({ [key]: "-" })).not.toThrow();
  },
);

it.each(["dates-file", "old-dates-file", "last-word-file"])(
  "refuses %s beside private questions before attempting to read its path",
  (key) => {
    expect(() =>
      assertPrivateFileSources({ "ask-secrets": true, [key]: "must-not-be-read" }),
    ).toThrow("--ask-secrets cannot be combined");
  },
);

it("reads complete UTF-8 file dates and infers masking without putting dates in argv", async () => {
  const path = join(folder, "public-dates.txt");
  await writeFile(path, "\ufeff23-09-2026\n", "utf8");
  const args = parseArguments(["--dates-file", path]);
  expect(transformMode(args)).toBe("seedshift");
  expect(dates(args)).toEqual([{ year: 2026, month: 9, day: 23 }]);
  expect(args.date).toBeUndefined();
});

it("refuses a date-file source in direct mode before reading either backup or file contents", () => {
  const args = { "dates-file": join(folder, "must-not-be-read") };
  expect(() => assertDateInputMode(args, "direct")).toThrow("Dates cannot be used in direct mode.");
  expect(() => assertDateInputMode(args, "seedshift")).not.toThrow();
});

it("keeps date-pattern text intact for the existing recovery parser", async () => {
  const path = join(folder, "public-patterns.txt");
  await writeFile(path, "23-09-202?\n", "utf8");
  expect(dateInputText({ "dates-file": path })).toBe("23-09-202?\n");
  expect(() => dates({ "dates-file": path })).toThrow("only where MnemoCode can search dates");
});

it("keeps final-word file text and refuses mixed in-process sources before reading", async () => {
  const path = join(folder, "public-word.txt");
  await writeFile(path, "about\n", "utf8");
  expect(textInput({ "last-word-file": path }, "last-word")).toBe("about\n");
  expect(() =>
    textInput({ "last-word": "about", "last-word-file": "must-not-be-read" }, "last-word"),
  ).toThrow("but not both");
  expect(() => dates({ date: "23-09-2026", "dates-file": "must-not-be-read" })).toThrow(
    "but not both",
  );
});

it("refuses oversized and malformed UTF-8 date files through the common input boundary", async () => {
  const path = join(folder, "public-malformed.txt");
  await writeFile(path, Buffer.alloc(MAX_TEXT_INPUT_BYTES + 1, 0x20));
  expect(() => dates({ "dates-file": path })).toThrow("safety limit");
  await writeFile(path, Uint8Array.of(0xff));
  expect(() => dates({ "dates-file": path })).toThrow("UTF-8");
});

it("prevents a new output from overlapping a date or original-final-word input file", async () => {
  const path = join(folder, "public-input.txt");
  await writeFile(path, "public fixture");
  for (const key of ["dates-file", "old-dates-file", "last-word-file"])
    await expect(validateOutputPaths({ [key]: path, output: path })).rejects.toThrow("overlap");
});
