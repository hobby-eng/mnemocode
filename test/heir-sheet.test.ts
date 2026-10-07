import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { heirSheetText, type HeirSheetFacts } from "../src/cli/heir-sheet.js";
import { A5, A6, renderHeirSheet } from "../src/export/heir-sheet.js";
import { HeirInstructions, type HeirRoute } from "../src/export/heir-sheet-text.js";

// The public BIP39 test phrase and public dates of the examples.
const PHRASE = `${"abandon ".repeat(11)}about`;
const DATES = ["23-09-2026", "08-08-1988"];

function cli(args: string[]) {
  const result = spawnSync(process.execPath, ["dist/mnemocode.js", ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  return result;
}

/** The most dates MnemoCode takes: one for every three words of a 24-word phrase. */
const MOST_DATES = 8;

/** The size of the first page of a PDF file, in whole millimetres. */
async function pageSize(path: string): Promise<number[]> {
  const page = (await PDFDocument.load(readFileSync(path))).getPage(0);
  return [page.getWidth(), page.getHeight()].map((points) => Math.round((points * 25.4) / 72));
}

/** Every kind of backup the sheet describes, with the longest wording of each. */
const EVERY_SHEET: readonly HeirSheetFacts[] = [
  ...(["words", "ur", "colors"] as const).flatMap((format) =>
    (["direct", "seedshift"] as const).map((mode) => ({
      backup: { kind: "shares" as const, format, threshold: 16, count: 16 },
      mode,
      dates: mode === "direct" ? 0 : MOST_DATES,
    })),
  ),
  ...(["english", "indexes", "unicode", "colors", "colors-unicode"] as const).flatMap((format) =>
    (["direct", "seedshift", "seedshift-legacy"] as const).map((mode) => ({
      backup: { kind: "encoded" as const, format },
      mode,
      dates: mode === "direct" ? 0 : MOST_DATES,
    })),
  ),
];

describe("instructions for heirs", () => {
  it("names the threshold, the share form and the dates, and the menu steps", () => {
    const text = heirSheetText({
      backup: { kind: "shares", format: "words", threshold: 3, count: 5 },
      mode: "seedshift",
      dates: 2,
    });
    expect(text.needs[0]).toContain("Any 3 of the 5 Shamir shares");
    expect(text.needs[0]).toContain("tuna next keep gyro");
    expect(text.needs[1]).toContain("The owner's 2 secret dates (see the back)");
    expect(text.steps).toContain(
      'Type any 3 shares, separated by ";", then the secret dates as day-month-year (23-09-2026). MnemoCode shows the seed phrase.',
    );
    expect(text.basics.map((section) => section.heading)).toContain("Secret dates");
    // One address, the repository's, printed once; its README leads to the guide for heirs.
    const words = JSON.stringify(text);
    expect(words.match(/https:\/\//gu)).toHaveLength(1);
    expect(words).toContain("https://github.com/hobby-eng/mnemocode,");
    expect(text.steps.join(" ")).toContain('answer "Yes"');
    const direct = heirSheetText({
      backup: { kind: "encoded", format: "indexes" },
      mode: "direct",
      dates: 0,
    });
    expect(direct.needs[1]).toBe("No secret dates are needed.");
    expect(direct.warning).not.toContain("dates");
    expect(direct.basics.map((section) => section.heading)).not.toContain("Secret dates");
  });

  it("leads through the route of any program, which prints its own address once", () => {
    // A stand-in for another program, such as a page with tabs.
    const address = "https://example.com/wallet-tool";
    const route: HeirRoute = {
      subtitle: "Made with the Wallet Tool, free and offline.",
      address,
      start: [`Open ${address} on a computer you trust, then go offline.`],
      decode: (mode) => [`Open the Decode tab in ${mode} mode and type the backup.`],
      restore: (mode, threshold, dates) => [
        `Open the Shares tab and type ${threshold} shares${dates === undefined ? "" : `, then ${dates}`}.`,
      ],
      dateDigitHelp: undefined,
    };
    const instructions = new HeirInstructions(route);
    const facts: HeirSheetFacts = {
      backup: { kind: "shares", format: "words", threshold: 2, count: 3 },
      mode: "seedshift",
      dates: 1,
    };
    const text = instructions.text(facts);
    // The route names its own program under the title, and MnemoCode's names MnemoCode.
    expect(text.subtitle).toBe("Made with the Wallet Tool, free and offline.");
    expect(heirSheetText(facts).subtitle).toMatch(/^Made with MnemoCode \d+\.\d+\.\d+, /u);
    expect(text.steps).toEqual([
      `Open ${address} on a computer you trust, then go offline.`,
      "Open the Shares tab and type 2 shares, then the secret date as day-month-year (23-09-2026).",
      "Open the wallet with this seed phrase in a wallet program (see below).",
    ]);
    // What every program shares stays the same: what is needed, the warning and the basics.
    expect(text.needs).toEqual(heirSheetText(facts).needs);
    expect(text.basics).toEqual(heirSheetText(facts).basics);
    // Without a search for a date digit, the advice offers none.
    expect(text.trouble).not.toContain("digit");
    expect(heirSheetText(facts).trouble).toContain("menu entry 5 tries every possibility");
    // A route that prints another address as well makes no sheet.
    const elsewhere = new HeirInstructions({
      ...route,
      start: [...route.start, "Read more at https://elsewhere.example/guide."],
    });
    expect(() => elsewhere.text(facts)).toThrow("may print the route's address once and no other");
    // Nor do facts that would print a wrong sheet.
    expect(() => instructions.text({ ...facts, dates: 0 })).toThrow("at least one");
    expect(() =>
      instructions.text({
        backup: { kind: "encoded", format: "unicode" },
        mode: "direct",
        dates: 1,
      }),
    ).toThrow("no dates in direct mode");
    expect(() => instructions.text({ ...facts, mode: "seedshift-legacy" })).toThrow(
      "Shares cannot use the original Seedshift.",
    );
  });

  it("fits every kind of backup on one sheet, both sides, in A5 and in A6", async () => {
    // Rendering refuses a front without room for the hint and a back the basics overflow.
    for (const format of [A5, A6])
      for (const facts of EVERY_SHEET) {
        const document = await PDFDocument.load(
          await renderHeirSheet(heirSheetText(facts), format),
        );
        expect(document.getPageCount(), JSON.stringify(facts)).toBe(2);
        expect(document.getTitle() ?? "").toBe("");
      }
  });

  it("is saved by encode next to the shares, in A5 or A6, never over an existing file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mnc-heirs-"));
    try {
      const path = join(directory, "heirs.pdf");
      const split = [
        "encode",
        "--sskr",
        "--mnemonic",
        PHRASE,
        "--dates",
        ...DATES,
        "--threshold",
        "3",
        "--shares",
        "5",
        "--heir-sheet",
        path,
      ];
      const saved = cli(split);
      expect(saved.status, saved.stderr).toBe(0);
      expect(saved.stderr).toContain(`Saved instructions for heirs: ${path}`);
      // A5 unless --heir-sheet-size says otherwise: 148 x 210 mm.
      const [width, height] = await pageSize(path);
      expect([width, height]).toEqual([148, 210]);
      const small = join(directory, "heirs-a6.pdf");
      const a6 = cli([...split.slice(0, -1), small, "--heir-sheet-size", "a6"]);
      expect(a6.status, a6.stderr).toBe(0);
      expect(await pageSize(small)).toEqual([105, 148]);
      // sskr-split, the older name of encode --sskr, saves it as well.
      const older = join(directory, "heirs-split.pdf");
      const splitSheet = cli(["sskr-split", "--mode", "seedshift", ...split.slice(2, -1), older]);
      expect(splitSheet.status, splitSheet.stderr).toBe(0);
      expect(await pageSize(older)).toEqual([148, 210]);
      // A taken name does not stop the command: the sheet is saved as "heirs-1.pdf".
      const before = readFileSync(path);
      const again = cli(split);
      expect(again.status, again.stderr).toBe(0);
      const numbered = join(directory, "heirs-1.pdf");
      expect(again.stderr).toContain(`${path} already exists: saved as ${numbered} instead.`);
      expect(readFileSync(path)).toEqual(before);
      expect(await pageSize(numbered)).toEqual([148, 210]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses a size without a sheet and a size that does not exist", () => {
    const base = ["encode", "--mnemonic", PHRASE, "--dates", DATES[0]!];
    const alone = cli([...base, "--heir-sheet-size", "a6"]);
    expect(alone.status).not.toBe(0);
    expect(alone.stderr).toContain("--heir-sheet-size needs --heir-sheet");
    const wrong = cli([
      ...base,
      "--heir-sheet",
      join(tmpdir(), "mnc-heirs-a4.pdf"),
      "--heir-sheet-size",
      "a4",
    ]);
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toContain("must be a5 or a6");
  });

  it("is refused with a replaced last word, which the menu cannot decode", () => {
    const refused = cli([
      "encode",
      "--mode",
      "seedshift-legacy",
      "--legacy-valid-last-word",
      "--mnemonic",
      PHRASE,
      "--dates",
      DATES[0]!,
      "--heir-sheet",
      join(tmpdir(), "mnc-heirs-refused.pdf"),
    ]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("not available with the legacy checksum-word replacement");
  });
});
