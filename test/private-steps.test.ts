import { afterEach, describe, expect, it } from "vitest";
import { PrivateSteps } from "../src/cli/private-steps.js";

// The step screens of the private screen: what each step's screen draws again under its title.

/** Opens the private steps with a redraw that records, in order, what each screen drew. */
function opened(): string[] {
  const drawn: string[] = [];
  PrivateSteps.open((warnings) => drawn.push(`title${warnings.map((w) => ` +${w}`).join("")}`));
  return drawn;
}

afterEach(() => PrivateSteps.close());

describe("the step screens of the private screen", () => {
  it("draw a kept context under the title until its question is answered", () => {
    const drawn = opened();
    PrivateSteps.keep(() => drawn.push("fingerprint"));
    expect(drawn).toEqual(["fingerprint"]);
    // The dates question, asked twice after a wrong answer: the fingerprint stays on both screens.
    PrivateSteps.begin();
    PrivateSteps.remember("A date is not valid.");
    PrivateSteps.begin();
    expect(drawn).toEqual([
      "fingerprint",
      "title",
      "fingerprint",
      "title +A date is not valid.",
      "fingerprint",
    ]);
    PrivateSteps.answerAccepted();
    PrivateSteps.begin();
    expect(drawn.at(-1)).toBe("title");
  });

  it("end an answered context with a chosen answer too, without ending its warning", () => {
    const drawn = opened();
    PrivateSteps.begin();
    PrivateSteps.remember("These codes are refused.");
    PrivateSteps.keep(() => drawn.push("why"));
    PrivateSteps.answered();
    PrivateSteps.begin();
    expect(drawn.at(-1)).toBe("title +These codes are refused.");
  });

  it("keep a page's context over every question until a new page", () => {
    const drawn = opened();
    PrivateSteps.keep(() => drawn.push("New backup"), "page");
    PrivateSteps.begin();
    PrivateSteps.answerAccepted();
    PrivateSteps.answered();
    PrivateSteps.begin();
    expect(drawn.filter((line) => line === "New backup")).toHaveLength(3);
    PrivateSteps.newPage();
    PrivateSteps.begin();
    expect(drawn.at(-1)).toBe("title");
  });

  it("draw a context once and keep nothing outside the private screen", () => {
    const drawn: string[] = [];
    PrivateSteps.keep(() => drawn.push("fingerprint"));
    expect(PrivateSteps.begin()).toBe(false);
    expect(drawn).toEqual(["fingerprint"]);
  });

  it("forget every context when the command ends", () => {
    const drawn = opened();
    PrivateSteps.keep(() => drawn.push("Protection"));
    PrivateSteps.close();
    const next = opened();
    PrivateSteps.begin();
    expect(next).toEqual(["title"]);
    expect(drawn).toEqual(["Protection"]);
  });
});
