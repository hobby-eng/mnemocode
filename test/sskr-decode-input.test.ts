// Decode must retain every share in a file or a paste, including member 3 after member 2 was
// removed. Public vectors only: vectors/sskr-v1.json and the published abandon/about phrase.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { describe, expect, it, vi } from "vitest";
import { runDecode } from "../src/cli/decode-command.js";
import { BackupReading } from "../src/core/backup-reading.js";
import { encodeMnemonic, parseDate } from "../src/core.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { MAX_GROUPS, MAX_GROUP_MEMBERS } from "../src/sskr/share-layout.js";
import { SHARE_FORMATS, writeShare } from "../src/sskr/transport.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";
import { sskrVectors } from "./helpers/vectors.js";

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

const vectors = sskrVectors().deterministic;
const selected = [vectors[0]!, vectors.at(-1)!];
const DATE = "23-09-2026";

describe.each(SHARE_FORMATS)("Decode of several %s shares", (format) => {
  it.each(selected)("restores members 1 and 3 from a $name file", async (vector) => {
    const phrase = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
    const text = [vector.shares[0]!, vector.shares[2]!]
      .map((share) => writeShare(share, format))
      .join("\r\n");
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-decode-shares-"));
    try {
      const path = join(directory, "shares.txt");
      await writeFile(path, `${text}\r\n`);
      expect(
        await runDecode({ "ask-secrets": true, mode: "direct", "input-file": path }),
      ).toBeUndefined();
      expect(seen.out).toContain(phrase);
      expect(seen.screen).not.toContain("More shares or text file path (");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("restores the two pasted lines of a Seedshift backup with their dates", async () => {
    const masked = encodeMnemonic(TEST_PHRASE, [parseDate(DATE)]).shiftedEnglish.join(" ");
    const shares = await splitSskrMnemonic(masked, 2, 3);
    terminal.answers = [
      `${writeShare(shares[0]!, format)}\n${writeShare(shares[2]!, format)}\r`,
      `${DATE}\r`,
    ];
    expect(await runDecode({ "ask-secrets": true, mode: "seedshift" })).toBeUndefined();
    expect(seen.out).toContain(TEST_PHRASE);
    expect(seen.screen).not.toContain("More shares or text file path (");
  });

  it("recognises a share followed by an unreadable line without dropping that line", async () => {
    const first = writeShare(selected[0]!.shares[0]!, format);
    expect(BackupReading.shareKind(`${first}\nnot-a-share`)).toBe("share");
    terminal.answers = [`${first}\nnot-a-share\r`];
    await runDecode({ "ask-secrets": true, mode: "direct" });
    expect(seen.notices.some((line) => line.startsWith("Share 2 cannot be read:"))).toBe(true);
    expect(terminal.labels).toContainEqual(["Leave share 2 out", "Type share 2 again"]);
  });
});

it("still reads English phrase words pasted one per line", async () => {
  const masked = encodeMnemonic(TEST_PHRASE, [parseDate(DATE)]).shiftedEnglish.join("\n");
  terminal.answers = [`${masked}\r`, `${DATE}\r`];
  expect(await runDecode({ "ask-secrets": true, mode: "seedshift" })).toBeUndefined();
  expect(seen.out).toContain(TEST_PHRASE);
});

it("asks again for too many share lines instead of throwing out of Decode", async () => {
  const shares = selected[0]!.shares;
  terminal.answers = [
    `${Array.from({ length: MAX_GROUPS * MAX_GROUP_MEMBERS + 1 }, () => shares[0]!).join("\n")}\r`,
    `${shares[0]}\n${shares[2]}\r`,
  ];
  expect(await runDecode({ "ask-secrets": true, mode: "direct" })).toBeUndefined();
  expect(seen.notices).toContain(
    `Provide between 1 and ${MAX_GROUPS * MAX_GROUP_MEMBERS} SSKR shares.`,
  );
  expect(seen.out).toContain(entropyToMnemonic(Buffer.from(selected[0]!.entropy, "hex"), wordlist));
});

it("recognises one share wrapped over lines before asking for another", async () => {
  const shares = selected[0]!.shares;
  const first = shares[0]!;
  const at = Math.floor(first.length / 2);
  const wrapped = `${first.slice(0, at)}\n${first.slice(at)}`;
  expect(BackupReading.shareKind(wrapped)).toBe("share");
  terminal.answers = [`${wrapped}\r`, `${shares[2]}\r`];
  expect(await runDecode({ "ask-secrets": true, mode: "direct" })).toBeUndefined();
  expect(seen.out).toContain(entropyToMnemonic(Buffer.from(selected[0]!.entropy, "hex"), wordlist));
});
