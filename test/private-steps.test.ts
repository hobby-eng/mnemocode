import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { choose } from "../src/cli/terminal-choice.js";

const keyboard = vi.hoisted(() => ({ bytes: [] as number[] }));
vi.mock("../src/cli/terminal-input.js", async (original) => ({
  ...(await original<typeof import("../src/cli/terminal-input.js")>()),
  dropTypedAhead: async () => undefined,
  withRawTerminal: async <T>(
    body: (next: () => Promise<number | undefined>, more: () => Promise<boolean>) => Promise<T>,
  ) =>
    body(
      async () => keyboard.bytes.shift(),
      async () => keyboard.bytes.length > 0,
    ),
}));

// The step screens of the private screen: what each step's screen draws again under its title.

/** Opens the private steps with a heading and warnings that record, in order, what was drawn. */
function opened(): string[] {
  const drawn: string[] = [];
  PrivateSteps.open(
    () => drawn.push("title"),
    (warning) => drawn.push(`! ${warning}`),
  );
  return drawn;
}

afterEach(() => {
  PrivateSteps.close();
  vi.restoreAllMocks();
});

describe("the step screens of the private screen", () => {
  it("draw a kept context under the title until its question is answered", () => {
    const drawn = opened();
    PrivateSteps.keep(() => drawn.push("fingerprint"));
    expect(drawn).toEqual(["fingerprint"]);
    // The dates question, asked twice after a wrong answer: the fingerprint stays on both
    // screens, and the warning comes after it, right above the question.
    PrivateSteps.begin();
    PrivateSteps.remember("A date is not valid.");
    PrivateSteps.begin();
    expect(drawn).toEqual([
      "fingerprint",
      "title",
      "fingerprint",
      "title",
      "fingerprint",
      "! A date is not valid.",
    ]);
    PrivateSteps.answerAccepted();
    PrivateSteps.begin();
    expect(drawn.at(-1)).toBe("title");
  });

  it("end a question's context when it is left or answered by a choice, not its warning", () => {
    const drawn = opened();
    PrivateSteps.begin();
    PrivateSteps.remember("These codes are refused.");
    PrivateSteps.keep(() => drawn.push("why"));
    PrivateSteps.questionEnded();
    PrivateSteps.begin();
    expect(drawn.slice(-2)).toEqual(["title", "! These codes are refused."]);
  });

  it("end a question's context when its list is left with Escape", async () => {
    const drawn = opened();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    PrivateSteps.keep(() => drawn.push("why"));
    keyboard.bytes = [0x1b];
    const choices = [
      { label: "Yes", value: true },
      { label: "No", value: false },
    ];
    expect(await choose("Use Seedshift?", choices, { label: "Seedshift" })).toBeUndefined();
    PrivateSteps.begin();
    expect(drawn.slice(-2)).toEqual(["why", "title"]);
  });

  it("keep a page's context over every question until a new page", () => {
    const drawn = opened();
    PrivateSteps.keep(() => drawn.push("New backup"), "page");
    PrivateSteps.begin();
    PrivateSteps.answerAccepted();
    PrivateSteps.questionEnded();
    PrivateSteps.begin();
    expect(drawn.filter((line) => line === "New backup")).toHaveLength(3);
    PrivateSteps.newPage();
    PrivateSteps.begin();
    expect(drawn.at(-1)).toBe("title");
  });

  it("keep a command's context over every page", () => {
    const drawn = opened();
    PrivateSteps.keep(() => drawn.push("swap warning and its link"), "command");
    PrivateSteps.newPage();
    PrivateSteps.questionEnded();
    PrivateSteps.begin();
    expect(drawn.slice(-2)).toEqual(["title", "swap warning and its link"]);
  });

  it("retain no warning that a kept context draws: the context draws it", () => {
    const drawn = opened();
    PrivateSteps.begin();
    PrivateSteps.keep(() => {
      PrivateSteps.remember("Only 32 bits.");
      drawn.push("! Only 32 bits.");
    }, "page");
    PrivateSteps.remember("The name is too long.");
    PrivateSteps.begin();
    PrivateSteps.questionEnded();
    PrivateSteps.begin();
    // Once per screen, and the refusal stays on the screen after a chosen answer.
    expect(drawn.slice(1)).toEqual([
      "! Only 32 bits.",
      "title",
      "! Only 32 bits.",
      "! The name is too long.",
      "title",
      "! Only 32 bits.",
      "! The name is too long.",
    ]);
  });

  it("draw a context once and keep nothing outside the private screen", () => {
    const drawn: string[] = [];
    PrivateSteps.keep(() => drawn.push("fingerprint"));
    expect(PrivateSteps.begin()).toBe(false);
    expect(drawn).toEqual(["fingerprint"]);
  });

  it("forget every context when the command ends", () => {
    const drawn = opened();
    PrivateSteps.keep(() => drawn.push("swap warning"), "command");
    PrivateSteps.close();
    const next = opened();
    PrivateSteps.begin();
    expect(next).toEqual(["title"]);
    expect(drawn).toEqual(["swap warning"]);
  });
});
