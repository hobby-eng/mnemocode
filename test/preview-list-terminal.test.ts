import { describe, expect, it, vi } from "vitest";
import { runPreview } from "../src/cli/preview-command.js";
import { STYLE_CODES, TEXT_WIDTH } from "../src/cli/terminal-style.js";
import { CARD_TEMPLATES } from "../src/export/templates.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";

/** What `preview --list` prints on standard output, without colour, line by line. */
async function listedLines(): Promise<string[]> {
  const printed: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    printed.push(String(line));
  });
  try {
    await runPreview({ list: true });
  } finally {
    log.mockRestore();
  }
  return printed.join("\n").replace(STYLE_CODES, "").split("\n");
}

describe("preview --list at a terminal", () => {
  it("wraps each description within the text width, on lines of its own under the id", async () => {
    streamsAsTerminal();
    const lines = await listedLines();
    expect(lines.filter((line) => line.length > TEXT_WIDTH)).toEqual([]);
    for (const [index, template] of CARD_TEMPLATES.entries()) {
      const at = lines.findIndex((line) => /^ ?\d+ {2}/u.test(line) && line.includes(template.id));
      expect(lines[at]?.trim()).toMatch(new RegExp(`^${index + 1} {2}${template.id} +`, "u"));
      expect(lines[at]).not.toContain(template.description);
      // The lines under the id, up to the next template, give the description again.
      const under = lines.slice(at + 1).findIndex((line) => /^ ?\d+ {2}/u.test(line));
      const description = lines.slice(at + 1, under < 0 ? undefined : at + 1 + under);
      expect(description.every((line) => line.startsWith("    ") && line[4] !== " ")).toBe(true);
      expect(description.map((line) => line.trim()).join(" ")).toBe(template.description);
    }
  });
});
