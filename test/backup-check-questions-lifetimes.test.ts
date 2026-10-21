import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { offerEncodedCheck, offerShareCheck } from "../src/cli/backup-check.js";
import { CANCELLED, type MoreWithin, type NextByte } from "../src/cli/terminal-keys.js";
import {
  KeptShares,
  RestoredShares,
  WrittenCodes,
  type EncodedOriginal,
} from "../src/core/backup-check.js";
import { DatesAnswer } from "../src/core/date-search.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { ShareSplit } from "../src/sskr/split.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

interface ReadEdges {
  reads: number;
  beforeRead: ((read: number) => void) | undefined;
}

const edges = vi.hoisted((): ReadEdges => ({ reads: 0, beforeRead: undefined }));
const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => {
  const input = harness.replacedTerminalInput(await importOriginal());
  // Observe the next terminal read, keeping the existing terminal fixture and real parsers.
  class ObservedKeys extends input.TerminalKeys {
    static override async withRawMode<T>(
      body: (next: NextByte, moreWithin: MoreWithin) => Promise<T>,
    ): Promise<T> {
      edges.reads += 1;
      edges.beforeRead?.(edges.reads);
      return super.withRawMode(body);
    }
  }
  return { ...input, TerminalKeys: ObservedKeys };
});

// Independent checksum-valid-seedshift-12 literals from vectors/mnemocode-v1.json.
const MASKED_PHRASE = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
const MASKED_INDEXES = [2026, 9, 23, 2026, 9, 23, 2026, 9, 23, 2026, 9, 376];
const WRONG_CODES = "wool abuse wool wool abuse actual wool abuse actual wool abuse congress";
const DATE = { year: 2026, month: 9, day: 23 };
const DATE_LINE = "23-09-2026";
const OTHER_DATE = "24-09-2026";
const RESTORES = "The backup restores this seed phrase.";
// Public bip39-128-2-of-3 shares restore a different phrase from this backup's mask.
const OTHER_SHARES =
  "ur:sskr/goemjzaeadaejoinoyvotkwlptsskispvwbkbwjnamstlubnampf;ur:sskr/goemjzaeadadflihpkmhspcheycndschfhcmkelyvaveiesolrls";
const ORIGINAL: EncodedOriginal = {
  mnemonic: TEST_PHRASE,
  format: "english",
  mode: "seedshift",
  codes: MASKED_INDEXES,
  dates: [DATE],
};
type BackupKind = "codes" | "shares";
type WrittenOwner = WrittenCodes | RestoredShares;
let maskedShares: readonly string[] = [];

function observeAnswers() {
  // These are passthrough observations of real public factories, not replacement owners.
  const codes = vi.spyOn(WrittenCodes, "read");
  const shares = vi.spyOn(RestoredShares, "of");
  const dates = vi.spyOn(DatesAnswer, "parse");
  const kept = vi.spyOn(KeptShares, "of");
  const written = (kind: BackupKind): WrittenOwner[] =>
    kind === "codes"
      ? codes.mock.results.flatMap((result) => (result.type === "return" ? [result.value] : []))
      : shares.mock.results.flatMap((result) => (result.type === "return" ? [result.value] : []));
  const dateOwners = (): DatesAnswer[] =>
    dates.mock.results.flatMap((result) => (result.type === "return" ? [result.value] : []));
  return {
    written,
    dates: dateOwners,
    allClosed: (kind: BackupKind): void => {
      for (const owner of written(kind)) expectClosed(owner);
      for (const owner of dateOwners()) expect(() => owner.known).toThrow("has been wiped");
      for (const result of kept.mock.results)
        if (result.type === "return") expect(() => result.value.texts).toThrow("has been wiped");
    },
  };
}

function expectLive(owner: WrittenOwner | undefined): void {
  if (owner === undefined) throw new Error("The real public reader must have returned its owner.");
  if (owner instanceof WrittenCodes) expect(owner.indexes).toEqual(MASKED_INDEXES);
  else expect(owner.holds(MASKED_PHRASE)).toBe(true);
}

function expectClosed(owner: WrittenOwner | undefined): void {
  if (owner === undefined) throw new Error("The real public reader must have returned its owner.");
  if (owner instanceof WrittenCodes) expect(() => owner.indexes).toThrow("has been wiped");
  else expect(() => owner.holds(MASKED_PHRASE)).toThrow("has been wiped");
}

function correctAnswer(kind: BackupKind): string {
  return kind === "codes" ? MASKED_PHRASE : maskedShares.join(";");
}

function offer(kind: BackupKind) {
  return kind === "codes"
    ? offerEncodedCheck(ORIGINAL, () => undefined, "yes")
    : offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, "yes", [DATE]);
}

questionsOnPrivateScreen();
beforeEach(() => {
  edges.reads = 0;
  edges.beforeRead = undefined;
});
beforeAll(async () => {
  // A single two-share fixture of the public masked phrase; real split and recovery services.
  const split = new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(7));
  maskedShares = await split.split(MASKED_PHRASE, 2, 2);
});

describe("Backup-check children through the public terminal questions", () => {
  it.each(["codes", "shares"] as const)(
    "replaces wrong %s, retains the matching owner through a dates retry and closes it on success",
    async (kind) => {
      const observed = observeAnswers();
      terminal.answers = [
        `${kind === "codes" ? WRONG_CODES : OTHER_SHARES}\r`,
        `${correctAnswer(kind)}\r`,
        `${OTHER_DATE}\r`,
        `${DATE_LINE}\r`,
      ];
      terminal.choices = [
        kind === "codes" ? "Type the codes again" : "Type the shares again",
        "Type the dates again",
      ];
      // Reads 2 and 5 are the questions "What now?", 3 and 6 the answers typed again.
      edges.beforeRead = (read) => {
        if (read === 3) {
          expect(observed.written(kind)).toHaveLength(1);
          expectClosed(observed.written(kind)[0]);
        }
        if (read === 4) {
          expect(observed.written(kind)).toHaveLength(2);
          expectLive(observed.written(kind)[1]);
          expect(observed.dates()).toHaveLength(0);
        }
        if (read === 6) {
          expect(observed.written(kind)).toHaveLength(2);
          expectLive(observed.written(kind)[1]);
          expect(observed.dates()).toHaveLength(1);
          expect(() => observed.dates()[0]!.known).toThrow("has been wiped");
        }
      };
      await expect(offer(kind)).resolves.toBeUndefined();
      expect(edges.reads).toBe(6);
      expect(observed.written(kind)).toHaveLength(2);
      expect(observed.dates()).toHaveLength(2);
      expect(terminal.questions).toEqual(["What now?", "What now?"]);
      expect(seen.notices).toContain("Date 1 is not one of the dates of this backup.");
      expect(seen.notices).toContain(RESTORES);
      observed.allClosed(kind);
    },
  );

  it.each(["codes", "shares"] as const)(
    "closes acquired %s and date owners when the mismatch question is cancelled",
    async (kind) => {
      const observed = observeAnswers();
      terminal.answers = [`${correctAnswer(kind)}\r`, `${OTHER_DATE}\r`];
      terminal.choices = [CANCELLED];
      edges.beforeRead = (read) => {
        if (read === 2) expectLive(observed.written(kind)[0]);
      };
      await expect(offer(kind)).resolves.toBe(CANCELLED);
      expect(observed.written(kind)).toHaveLength(1);
      expect(observed.dates()).toHaveLength(1);
      observed.allClosed(kind);
    },
  );

  it.each(["codes", "shares"] as const)(
    "closes acquired %s and dates if final terminal output throws",
    async (kind) => {
      const observed = observeAnswers();
      const failure = new Error("Synthetic backup-check terminal output failure.");
      vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
        const line = parts.join(" ");
        if (line.includes(RESTORES)) throw failure;
        seen.notices.push(line);
      });
      terminal.answers = [`${correctAnswer(kind)}\r`, `${DATE_LINE}\r`];
      await expect(offer(kind)).rejects.toBe(failure);
      expect(observed.written(kind)).toHaveLength(1);
      expect(observed.dates()).toHaveLength(1);
      observed.allClosed(kind);
    },
  );
});
