// AUD-014, the findings and recommendations of the secrets group: the chooser of a candidate
// list's protection (SEC001) and the strict UTF-8 decoding of a file or of standard input
// (API002, recommendation 30). Public test data only: the BIP39 test phrase and synthetic
// passphrases.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessionIdentity,
  listFileLock,
  NoProtection,
  PassphraseProtection,
  protectionFor,
  ScannerKeyProtection,
  type ListProtectionChoice,
} from "../src/core/candidate-encryption.js";
import { CandidateListWriter } from "../src/core/candidate-list-writer.js";
import { bip39Passphrase } from "../src/cli/bitcoin-options.js";
import { CandidatesFile } from "../src/cli/candidates-file.js";
import { givenInputFormat, textInput } from "../src/cli/input.js";
import { readBoundedTextFile } from "../src/cli/text-file.js";
import { strictUtf8Text } from "../src/cli/utf8.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

/** What the readers of bounded-read.ts returned, so that a test can see they were wiped. */
const returned: Buffer[] = [];
/** The bytes that standard input gives while a test sets them. */
let standardInput: Buffer | undefined;

vi.mock("../src/cli/bounded-read.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/cli/bounded-read.js")>();
  const kept = (bytes: Buffer): Buffer => {
    returned.push(bytes);
    return bytes;
  };
  return {
    ...original,
    readBoundedDescriptor: (descriptor: number, limit: number, what: string): Buffer =>
      kept(
        descriptor === 0 && standardInput !== undefined
          ? Buffer.from(standardInput)
          : original.readBoundedDescriptor(descriptor, limit, what),
      ),
    readFileOrRefuse: (path: string, limit: number, what: string, unreadable: string): Buffer =>
      kept(original.readFileOrRefuse(path, limit, what, unreadable)),
  };
});

const LIST_PASSPHRASE = "synthetic public password";
/** The bytes of the audit's probe: a passphrase file ending in byte FF and a line feed. */
const MALFORMED = Buffer.concat([Buffer.from("synthetic-passphrase-"), Buffer.from([0xff, 0x0a])]);

const directory = mkdtempSync(join(tmpdir(), "mnemocode-aud014-secrets-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
let files = 0;
/** A new file in the test's directory with `bytes`. */
function fileWith(bytes: Uint8Array | string): string {
  const path = join(directory, `file-${(files += 1)}.txt`);
  writeFileSync(path, bytes);
  return path;
}

describe("AUD-014-SEC001: only the three known protections, none only when chosen", () => {
  it("refuses the audit's misspelt, unknown and missing kinds before any list is written", () => {
    for (const kind of ["passpharse", "unknown", undefined])
      expect(
        () => protectionFor({ kind, passphrase: LIST_PASSPHRASE } as never),
        String(kind),
      ).toThrow(
        new TypeError(
          'The protection of a candidate list must be { kind: "key", recipient }, { kind: "passphrase", passphrase } or { kind: "none" }, each field a text and no other field.',
        ),
      );
  });

  it("refuses a malformed choice of any kind, and repeats none of its fields", () => {
    const malformed: unknown[] = [
      undefined,
      null,
      "none",
      42,
      {},
      [],
      Object.create({ kind: "none" }),
      { kind: "NONE" },
      { kind: "toString" },
      { kind: "__proto__" },
      { kind: "none", passphrase: LIST_PASSPHRASE },
      { kind: "none", recipient: "age1" },
      { kind: "key" },
      { kind: "key", recipient: 1 },
      { kind: "key", passphrase: LIST_PASSPHRASE },
      { kind: "passphrase" },
      { kind: "passphrase", passphrase: null },
      { kind: "passphrase", passphrase: LIST_PASSPHRASE, recipient: "age1" },
    ];
    for (const choice of malformed) {
      let refusal: unknown;
      try {
        protectionFor(choice as ListProtectionChoice);
      } catch (error) {
        refusal = error;
      }
      expect(refusal, JSON.stringify(choice)).toBeInstanceOf(TypeError);
      expect((refusal as Error).message).not.toContain(LIST_PASSPHRASE);
    }
  });

  it("still takes the three well-formed choices, and writes in the open only for none", async () => {
    const none = protectionFor({ kind: "none" });
    expect(none).toBeInstanceOf(NoProtection);
    const open = await new CandidateListWriter(none).writePhrases([TEST_PHRASE]);
    if (open.kind !== "list") throw new Error("expected a list");
    expect(open.list.encrypted).toBe(false);
    expect(new TextDecoder().decode(open.list.bytes.subarray(0, 4))).toBe("MNCL");
    open.list.bytes.fill(0);

    // No scrypt here: the passphrase protection is checked by its class and what it reports.
    const locked = protectionFor({ kind: "passphrase", passphrase: LIST_PASSPHRASE });
    expect(locked).toBeInstanceOf(PassphraseProtection);
    expect(locked.encrypted).toBe(true);

    const { recipient } = await createSessionIdentity();
    const key = protectionFor({ kind: "key", recipient });
    expect(key).toBeInstanceOf(ScannerKeyProtection);
    const sealed = await new CandidateListWriter(key).writePhrases([TEST_PHRASE]);
    if (sealed.kind !== "list") throw new Error("expected a list");
    expect(sealed.list.encrypted).toBe(true);
    expect(listFileLock(sealed.list.bytes)).toBe("key");
  });
});

describe("AUD-014-API002: a file or standard input is valid UTF-8 or refused", () => {
  beforeEach(() => {
    returned.length = 0;
    standardInput = undefined;
  });

  /** Whether every buffer that the readers returned is all zero now. */
  const allWiped = () => returned.length > 0 && returned.every((bytes) => bytes.every((b) => !b));

  it("refuses the audit's passphrase file with byte FF instead of reading U+FFFD", () => {
    const path = fileWith(MALFORMED);
    expect(() => bip39Passphrase({ "bip39-passphrase-file": path })).toThrow(
      new Error("The BIP39 passphrase file is not valid UTF-8 text."),
    );
    expect(() => readBoundedTextFile(path)).toThrow(
      new Error("The text input is not valid UTF-8 text."),
    );
    expect(allWiped()).toBe(true);
  });

  it("refuses malformed standard input, and wipes what it read", () => {
    standardInput = MALFORMED;
    expect(() => textInput({ "input-file": "-" }, "input")).toThrow(
      new Error("Text input is not valid UTF-8 text."),
    );
    expect(allWiped()).toBe(true);
  });

  it("refuses a malformed passphrase file for a candidate list before any search", async () => {
    const passphraseFile = fileWith(
      Buffer.concat([Buffer.from(LIST_PASSPHRASE), Buffer.from([0xc0, 0x80, 0x0a])]),
    );
    await expect(
      CandidatesFile.of({
        "candidates-file": join(directory, "list.age"),
        "candidates-passphrase-file": passphraseFile,
      }),
    ).rejects.toThrow(new Error("The passphrase file is not valid UTF-8 text."));
  });

  it("refuses a surrogate, an overlong form and a cut character", () => {
    for (const bad of [
      [0xed, 0xa0, 0x80],
      [0xc0, 0x80],
      [0xe2, 0x82],
      [0xf5, 0x80, 0x80, 0x80],
    ])
      expect(() => strictUtf8Text(Uint8Array.from(bad), "The file"), String(bad)).toThrow(
        new Error("The file is not valid UTF-8 text."),
      );
  });

  it("keeps a valid U+FFFD, and each reader's byte order mark and line-break rule", async () => {
    expect(bip39Passphrase({ "bip39-passphrase-file": fileWith("synthetic-�\r\n") })).toBe(
      "synthetic-�",
    );
    // The BIP39 passphrase file keeps a byte order mark, as it did before; only one line break goes.
    expect(bip39Passphrase({ "bip39-passphrase-file": fileWith("﻿synthetic\n\n") })).toBe(
      "﻿synthetic\n",
    );
    expect(strictUtf8Text(Buffer.from("﻿a\r\n"), "The file")).toBe("﻿a\r\n");
    // The list's passphrase drops the mark and the white space at its ends (parseListPassphrase).
    const target = await CandidatesFile.of({
      "candidates-file": join(directory, "list.age"),
      "candidates-passphrase-file": fileWith(`﻿${LIST_PASSPHRASE}\n`),
    });
    expect(target).toBeInstanceOf(CandidatesFile);
    standardInput = Buffer.from(`${TEST_PHRASE}\n`);
    expect(textInput({ "mnemonic-file": "-" }, "mnemonic")).toBe(`${TEST_PHRASE}\n`);
    expect(allWiped()).toBe(true);
  });
});

describe("AUD-014 recommendation 29: one reader of --format", () => {
  it("gives the form that --format names, none without it, and refuses an unknown one", () => {
    expect(givenInputFormat({})).toBeUndefined();
    expect(givenInputFormat({ format: "indexes" })).toBe("indexes");
    expect(givenInputFormat({ format: "1" })).toBe("english");
    expect(() => givenInputFormat({ format: "latin" })).toThrow(/representation format/u);
  });
});
