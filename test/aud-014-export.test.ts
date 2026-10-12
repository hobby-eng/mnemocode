// AUD-014, the exports group: the capacity of a card design made by a host (AUD-014-API003), the
// facts of a sheet for heirs (AUD-014-API012), and the shared operations of recommendations 20 to
// 22, whose public messages must stay as they were. Public test data only.

import { readFileSync } from "node:fs";
import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { indexesToColors } from "../src/core.js";
import { heirSheetText } from "../src/cli/heir-sheet.js";
import { readCardPages } from "../src/export/card-drawing.js";
import { CardRenderer } from "../src/export/card-renderer.js";
import { HeirInstructions, type HeirSheetFacts } from "../src/export/heir-sheet-text.js";
import { checkedChoice, pickWith } from "../src/export/platform.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";
import { renderCards, renderIndividualCards } from "../src/export/render.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { cardTemplates, type CardTemplate } from "../src/export/templates.js";
import type { CardContent } from "../src/export/backup-cards.js";

/** The public phrase of BIP39's first vector as colors: eleven zeros and a checksum word. */
const colors = indexesToColors([...Array(11).fill(0), 3]);
const content: CardContent = {
  kind: "colors",
  title: "Public fixture",
  colors,
  payload: colors.join(" "),
  pageSize: "business",
};

/** A renderer whose random choices are counted, so that a test sees whether any was made. */
function countingRenderer(): { renderer: CardRenderer; choices: () => number } {
  let choices = 0;
  const renderer = new CardRenderer({
    ...nodeRenderPlatform,
    randomInt: (limit) => {
      choices++;
      return nodeRenderPlatform.randomInt(limit);
    },
  });
  return { renderer, choices: () => choices };
}

/** Thrown by a template's drawing, to stop the test before any card is drawn. */
const sentinel = new Error("audit stopped before rendering");

/** A stock design with its drawing replaced and the capacity `referencesPerCard`. */
function hostTemplate(referencesPerCard: number): { template: CardTemplate; calls: () => number } {
  const base = cardTemplates.find(
    (template) => template.kind === "colors" && template.renderIndividual,
  )!;
  let calls = 0;
  const draw = async (): Promise<Uint8Array> => {
    calls++;
    throw sentinel;
  };
  return {
    template: { ...base, referencesPerCard, render: draw, renderIndividual: draw },
    calls: () => calls,
  };
}

const REFERENCES_PER_CARD_REFUSAL =
  "The references that one card holds must be a whole number, at least 1.";

describe("AUD-014-API003: the capacity of a card design made by a host", () => {
  // The audit's reproduction (docs/audits/AUD-014-harnesses/template-facts-probes.mjs).
  it.each([-1, 0, 0.5, Infinity, Number.NaN])(
    "refuses %s references per card before any choice or drawing",
    async (referencesPerCard) => {
      const { template, calls } = hostTemplate(referencesPerCard);
      const { renderer, choices } = countingRenderer();
      await expect(renderIndividualCards(renderer, template, content)).rejects.toThrow(
        REFERENCES_PER_CARD_REFUSAL,
      );
      // The cards of a page size and a sheet are refused the same way, through renderCards.
      for (const pageSize of ["business", "a6"] as const)
        await expect(
          renderCards(renderer, [{ template, content: { ...content, pageSize } }]),
        ).rejects.toThrow(REFERENCES_PER_CARD_REFUSAL);
      expect(calls()).toBe(0);
      expect(choices()).toBe(0);
    },
  );

  it("draws a design of one reference per card, the valid control", async () => {
    const { template, calls } = hostTemplate(1);
    await expect(
      renderIndividualCards(countingRenderer().renderer, template, content),
    ).rejects.toBe(sentinel);
    expect(calls()).toBe(1);
  });

  it("keeps a capacity that no stock design has: three references, three cards", async () => {
    // The eight colors of the fixture, three to a card: 3, 3 and 2.
    expect(colors).toHaveLength(8);
    const base = hostTemplate(3).template;
    const indexes: number[] = [];
    const template: CardTemplate = {
      ...base,
      renderIndividual: async (_drawing, _content, index) => {
        indexes.push(index);
        return new Uint8Array([index]);
      },
    };
    const cards = await renderIndividualCards(countingRenderer().renderer, template, content);
    expect(indexes).toEqual([0, 1, 2]);
    // Each card is named after the first reference it holds: 1, 4 and 7.
    expect(cards.map((card) => card.name)).toEqual(
      [0, 3, 6].map((first, card) => `0${card + 1}-${colors[first]!.slice(1).toUpperCase()}`),
    );
  });
});

describe("AUD-014-API012: the facts of a sheet for heirs", () => {
  const facts = (backup: unknown): HeirSheetFacts =>
    ({ backup, mode: "direct", dates: 0 }) as HeirSheetFacts;

  it("refuses the audit's impossible quorum and unknown form", () => {
    // The audit's reproduction, through the command line's route.
    expect(() =>
      heirSheetText(facts({ kind: "shares", format: "ur", threshold: 4, count: 3 })),
    ).toThrow("A sheet for heirs needs a threshold from 1 to the number of shares");
    expect(() => heirSheetText(facts({ kind: "encoded", format: "unknown" }))).toThrow(
      "Unsupported encoded format: unknown.",
    );
  });

  it("refuses an unknown kind, an unknown share form and a quorum out of range", () => {
    expect(() => heirSheetText(facts({ kind: "paper", format: "english" }))).toThrow(
      "A sheet for heirs is made for an encoded backup or for Shamir shares.",
    );
    expect(() =>
      heirSheetText(facts({ kind: "shares", format: "unknown", threshold: 2, count: 3 })),
    ).toThrow("The share format must be one of:");
    for (const [threshold, count] of [
      [0, 3],
      [1.5, 3],
      [2, Number.NaN],
      [2, 17],
      [Infinity, Infinity],
    ])
      expect(() =>
        heirSheetText(facts({ kind: "shares", format: "ur", threshold, count })),
      ).toThrow("and at most 16 shares.");
  });

  it("keeps every valid fact: 2 of 3, all 16, and shares of threshold one made elsewhere", () => {
    const needs = (threshold: number, count: number) =>
      heirSheetText(facts({ kind: "shares", format: "ur", threshold, count })).needs[0];
    expect(needs(2, 3)).toMatch(/^Any 2 of the 3 Shamir shares/u);
    expect(needs(16, 16)).toMatch(/^Any 16 of the 16 Shamir shares/u);
    // A split never makes them (ShareSplit.validateThreshold), but a restore reads them.
    expect(needs(1, 2)).toMatch(/^Any 1 of the 2 Shamir shares/u);
    expect(heirSheetText(facts({ kind: "encoded", format: "colors" })).needs[0]).toMatch(
      /^The backup: color codes/u,
    );
    // The library's class refuses as the command line's route does.
    const route = {
      subtitle: "Made with a test host.",
      address: "",
      start: [],
      decode: () => [],
      restore: () => [],
      dateDigitHelp: undefined,
    };
    expect(() =>
      new HeirInstructions(route).text(
        facts({ kind: "shares", format: "words", threshold: 3, count: 2 }),
      ),
    ).toThrow("A sheet for heirs needs a threshold");
  });
});

describe("AUD-014 recommendation 21: one checked uniform choice", () => {
  it("passes a choice in range and refuses one out of range with the caller's words", () => {
    expect(checkedChoice(() => 2, 3, "refused")).toBe(2);
    for (const choice of [-1, 3, 0.5, Number.NaN])
      expect(() => checkedChoice(() => choice, 3, "refused")).toThrow("refused");
    expect(pickWith(["a", "b"], () => 1)).toBe("b");
    expect(() => pickWith(["a", "b"], () => 2)).toThrow("Invalid random selection for a card.");
  });

  it("keeps the refusal of the decorative colors of share cards", () => {
    // The shares are written as words, whose cards take decorative colors.
    const shares = sskrFixture();
    const options = { style: "it", shareFormat: "words" } as const;
    expect(
      () => new ShareCardSet(countingRenderer().renderer, shares, options, () => 1 << 24),
    ).toThrow("The random source of the card colors gave a number out of range.");
    expect(
      new ShareCardSet(countingRenderer().renderer, shares, options, () => 0).shares,
    ).toHaveLength(shares.length);
  });
});

describe("AUD-014 recommendation 22: point and RGB commands read as before", () => {
  /** A page whose content is `commands`, one to a line, as pdf-lib writes them. */
  async function pageWith(...commands: string[]): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const page = document.addPage([100, 100]);
    const stream = document.context.stream(commands.join("\n"));
    page.node.set(PDFName.of("Contents"), document.context.register(stream));
    return document.save();
  }

  it("reads moves, lines and both colors", async () => {
    const [page] = await readCardPages(
      await pageWith("0.25 0.5 0.75 rg", "1 0 0.5 RG", "1 2 m", "3 4 l", "n"),
    );
    expect(page!.steps).toEqual([
      { do: "fillColor", red: 0.25, green: 0.5, blue: 0.75 },
      { do: "strokeColor", red: 1, green: 0, blue: 0.5 },
      {
        do: "path",
        segments: [
          { to: "move", x: 1, y: 2 },
          { to: "line", x: 3, y: 4 },
        ],
        fill: false,
        stroke: false,
        clip: false,
        clipRule: "nonzero",
      },
    ]);
  });

  it.each([
    ["1 m", "the command m has 1 values"],
    ["1 2 3 l", "the command l has 3 values"],
    ["1 Infinity m", "the command m has the value Infinity"],
    ["1 0 rg", "the command rg has 2 values"],
    ["1 0 x RG", "the command RG has the value x"],
  ])("refuses %j, naming the command", async (command, refusal) => {
    await expect(readCardPages(await pageWith(command, "n"))).rejects.toThrow(refusal);
  });
});

/** SSKR shares of a public test entropy, made with a test-only seed (vectors/sskr-v1.json). */
function sskrFixture(): readonly string[] {
  const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
    readonly deterministic: readonly { readonly shares: readonly string[] }[];
  };
  return vectors.deterministic[0]!.shares;
}
