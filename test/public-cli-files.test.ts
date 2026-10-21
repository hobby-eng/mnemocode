import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { assertSafeMaterialArgv, parseArguments, value, values } from "../src/cli/arguments.js";
import { PublicCliFiles } from "./helpers/public-cli-files.js";
import { DATE, TEST_PHRASE } from "./helpers/test-phrase.js";

it("translates published fixture text into safe files and closes only its own directory", () => {
  using material = new PublicCliFiles([
    "encode",
    "--mnemonic",
    TEST_PHRASE,
    "--dates",
    DATE,
    "08-08-1988",
    "--format",
    "indexes",
  ]);
  const args = parseArguments(material.arguments.slice(1));
  const words = value(args, "mnemonic-file");
  const dates = value(args, "dates-file");
  if (words === undefined || dates === undefined) throw new Error("Fixture files are missing.");
  expect(() => assertSafeMaterialArgv(material.arguments)).not.toThrow();
  expect(args.mnemonic).toBeUndefined();
  expect(args.date).toBeUndefined();
  expect(readFileSync(words, "utf8")).toBe(`${TEST_PHRASE}\n`);
  expect(readFileSync(dates, "utf8")).toBe(`${DATE}\n08-08-1988\n`);
  material.close();
  material.close();
  expect(existsSync(words)).toBe(false);
  expect(existsSync(dates)).toBe(false);
});

it("keeps the original raw-share-before-file ordering through the file fixture adapter", () => {
  using material = new PublicCliFiles([
    "sskr-combine",
    "--share-file",
    "public-existing.txt",
    "--share",
    "public first",
    "--share",
    "public third",
  ]);
  const args = parseArguments(material.arguments.slice(1));
  const files = values(args, "share-file");
  expect(files).toHaveLength(2);
  const first = files[0];
  if (first === undefined) throw new Error("The raw-share fixture file is missing.");
  expect(readFileSync(first, "utf8")).toBe("public first\npublic third\n");
  expect(files[1]).toBe("public-existing.txt");
  expect(args.share).toBeUndefined();
});

it("never turns private/help or mixed-source refusals into accepted file operations", () => {
  for (const argv of [
    ["encode", "--ask-secrets", "--mnemonic", "public fixture"],
    ["encode", "--help", "--mnemonic", "public fixture"],
    ["encode", "--mnemonic", "public fixture", "--mnemonic-file", "public.txt"],
  ]) {
    using material = new PublicCliFiles(argv);
    expect(material.arguments).toEqual(argv);
    expect(() => assertSafeMaterialArgv(material.arguments)).toThrow("command-line value");
  }
});

it("leaves a malformed non-material option for the actual command parser to refuse", () => {
  using material = new PublicCliFiles([
    "encode",
    "--mnemonic",
    "public fixture",
    "--format",
    "indexes",
    "--output",
  ]);
  expect(material.arguments.at(-1)).toBe("--output");
  expect(() => assertSafeMaterialArgv(material.arguments)).not.toThrow();
  expect(() => parseArguments(material.arguments.slice(1))).toThrow("requires a value");
});
