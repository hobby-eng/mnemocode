import { describe, expect, it, vi } from "vitest";
import { searchMissingCodes } from "../src/cli/missing-codes-search.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import { MissingCodesSearch } from "../src/core/missing-codes-search.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { recoverLegacyValidLastWords } from "../src/core/words.js";
import { questionsOnPrivateScreen } from "./helpers/question-terminal.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
const watchEdge = vi.hoisted((): { failure: Error | undefined } => ({ failure: undefined }));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => {
  const input = harness.replacedTerminalInput(await importOriginal());
  class FailingWatch extends input.CtrlCWatch {
    static override async during<Value>(
      search: (signal: AbortSignal) => Promise<Value>,
    ): Promise<Value> {
      const result = await search(new AbortController().signal);
      if (watchEdge.failure !== undefined) throw watchEdge.failure;
      return result;
    }
  }
  return { ...input, CtrlCWatch: FailingWatch };
});

questionsOnPrivateScreen();

const ANSWERS = {
  place: undefined,
  passphrase: "",
  encodedFingerprint: TEST_FINGERPRINT,
  list: false,
};

describe("A list of more candidates than it holds", () => {
  it("is said, and the way is asked again (AUD-037-UI003)", async () => {
    // One more valid last word than a list holds: the estimate, about one candidate, offers the
    // list, and the real search finds every one of them.
    const endings = recoverLegacyValidLastWords(TEST_PHRASE)
      .slice(0, MissingCodesSearch.MAX_LISTED + 1)
      .map(({ word }) => word);
    using codes = MissingCodes.read("abandon ".repeat(11) + endings.join("|"), "english", "direct");
    expect(new MissingCodesSearch(codes, () => "00000000").fits("list")).toBe(true);
    const said: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      said.push(parts.join(" "));
    });
    const answers = { ...ANSWERS, encodedFingerprint: undefined, list: true };
    expect(await searchMissingCodes(codes, answers)).toEqual({ kind: "again" });
    expect(said.join("\n")).toContain(
      "More than 16 candidates fit these codes and dates. Narrow the codes or use a wallet check instead of listing them.",
    );
    // The way is asked again without the list, which would overflow again (AUD-037-FUN002).
    expect(harness.terminal.labels.at(-1)).not.toContain("List every candidate");
    expect(harness.terminal.labels.at(-1)).toContain("The wallet");
  });
});

describe("The found backup lifetime through terminal reporting", () => {
  it.each(["report", "progress", "watch"] as const)(
    "clears a found backup when its final %s output fails before handoff",
    async (edge) => {
      using codes = MissingCodes.read(`${TEST_PHRASE}|actual`, "english", "direct");
      const made = vi.spyOn(EncodedBackup, "of");
      const failure = new Error("Synthetic terminal output failure.");
      const tty = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
      if (edge === "report") {
        vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
          if (parts.join(" ").includes("Code 12 found:")) throw failure;
        });
      } else if (edge === "watch") {
        watchEdge.failure = failure;
      } else {
        Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
        vi.stubEnv("TERM", "xterm");
        let wall = 0;
        let monotonic = 0;
        vi.spyOn(Date, "now").mockImplementation(() => (wall += 3000));
        vi.spyOn(performance, "now").mockImplementation(() => (monotonic += 100));
        vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
          if (chunk === "\n") throw failure;
          return true;
        });
      }
      try {
        await expect(searchMissingCodes(codes, ANSWERS)).rejects.toBe(failure);
        expect(made.mock.results.length).toBeGreaterThan(0);
        for (const owner of made.mock.results)
          if (owner.type === "return") expect(() => owner.value.text()).toThrow("has been wiped");
      } finally {
        watchEdge.failure = undefined;
        if (tty === undefined) Reflect.deleteProperty(process.stderr, "isTTY");
        else Object.defineProperty(process.stderr, "isTTY", tty);
      }
    },
  );

  it("transfers the successfully reported backup to the decode caller", async () => {
    using codes = MissingCodes.read(`${TEST_PHRASE}|actual`, "english", "direct");
    const result = await searchMissingCodes(codes, ANSWERS);
    expect(result).toHaveProperty("kind", "found");
    if (typeof result === "symbol" || result.kind !== "found")
      throw new Error("The public wallet control must find its codes.");
    using backup = result.backup;
    expect(backup.text()).toBe(TEST_PHRASE);
  });
});
