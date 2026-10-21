import { describe, expect, it, vi } from "vitest";
import { searchMissingCodes } from "../src/cli/missing-codes-search.js";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { STYLE, STYLE_CODES } from "../src/cli/terminal-style.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import { questionsOnPrivateScreen, seen } from "./helpers/question-terminal.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

// The screens of Decode's search for codes marked with ?: the search has a step screen of its own
// (CORE-39), and the candidates it lists are a result, with its heading and grey labels (CORE-36).

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);

questionsOnPrivateScreen();

/** The public test phrase with its last word marked: about or actual. */
const MARKED = `${TEST_PHRASE}|actual`;

/** Decode's answers to the search: no wallet, no list, unless a test gives them. */
const ANSWERS = { place: undefined, passphrase: "", list: false };

describe("the search for codes marked with ?", () => {
  it("runs on a step screen of its own, under nothing typed before", async () => {
    using codes = MissingCodes.read(MARKED, "english", "direct");
    PrivateSteps.open(
      () => seen.notices.push("step screen"),
      () => undefined,
    );
    try {
      const found = await searchMissingCodes(codes, {
        ...ANSWERS,
        encodedFingerprint: TEST_FINGERPRINT,
      });
      expect(found).toHaveProperty("kind", "found");
      if (typeof found !== "symbol" && found.kind === "found") found.backup.wipe();
    } finally {
      PrivateSteps.close();
    }
    // Opened once the way is known, before anything the search says.
    const step = seen.notices.indexOf("step screen");
    expect(seen.notices.filter((line) => line === "step screen")).toHaveLength(1);
    expect(step).toBeGreaterThan(
      seen.notices.findIndex((line) => line.startsWith("Code 12 cannot be read")),
    );
    expect(step).toBeLessThan(seen.notices.findIndex((line) => line.includes("Code 12 found")));
  });

  it("lists its candidates under a result heading, each fact after a grey label", async () => {
    using codes = MissingCodes.read(MARKED, "english", "direct");
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("CLICOLOR_FORCE", "1");
    vi.stubEnv("TERM", "xterm");
    streamsAsTerminal();
    expect(await searchMissingCodes(codes, { ...ANSWERS, list: true })).toEqual({
      kind: "shown",
    });
    const plain = seen.out.map((line) => line.replace(STYLE_CODES, "").trim());
    expect(plain[0]).toBe("MnemoCode · Candidates");
    expect(plain).toContain("Candidate 1");
    for (const label of ["Codes", "Phrase", "Fingerprint"])
      expect(seen.out.some((line) => line.includes(`\x1b[${STYLE.muted}m${label}`))).toBe(true);
    expect(seen.notices.map((line) => line.replace(STYLE_CODES, ""))).toContain(
      "They do not reveal the phrase.",
    );
  });
});
