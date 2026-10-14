// Exercise Encode's real per-destination loop and decoy planner with passive save adapters.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

const observed = vi.hoisted(() => ({ jobs: [] as any[], next: 0 }));
vi.mock("../../../src/export/platform-node.js", async (original) => {
  const actual = await original<typeof import("../../../src/export/platform-node.js")>();
  // The real service object is frozen. Replace the host service, never mutate it.
  return {
    ...actual,
    nodeCardRenderer: {
      ...actual.nodeCardRenderer,
      randomInt: (upper: number) => observed.next++ % upper,
    },
  };
});
vi.mock("../../../src/export/templates.js", async (original) => {
  const actual = await original<typeof import("../../../src/export/templates.js")>();
  return {
    ...actual,
    selectTemplate: (...args: Parameters<typeof actual.selectTemplate>) => ({
      ...actual.selectTemplate(...args),
      sheetShape: async () => ({
        font: { widthOfTextAtSize: (text: string, size: number) => text.length * size / 2 },
        aspect: 1.5,
        captions: (count: number) => Array.from({ length: count }, () => ["Public fixture"]),
      }),
    }),
  };
});
vi.mock("../../../src/export/pdf.js", async (original) => ({
  ...(await original<typeof import("../../../src/export/pdf.js")>()),
  exportCards: async (jobs: any[]) => { observed.jobs.push({ destination: "pdf", ...jobs[0] }); },
  renderCards: async (_drawing: unknown, jobs: any[]) => {
    observed.jobs.push({ destination: "images", ...jobs[0] });
    return new Uint8Array();
  },
}));
vi.mock("../../../src/export/image-export.js", async (original) => ({
  ...(await original<typeof import("../../../src/export/image-export.js")>()),
  assertImageRenderer: async () => undefined,
  exportPageImages: async () => 1,
}));
vi.mock("../../../src/export/individual-cards.js", async (original) => ({
  ...(await original<typeof import("../../../src/export/individual-cards.js")>()),
  exportIndividualCards: async (template: unknown, content: unknown) => {
    observed.jobs.push({ destination: "cards", template, content });
    return 1;
  },
}));

const { runEncode } = await import("../../../src/cli/encode-command.js");

it("reproduces separate decoy planning through the real Encode dispatcher", async () => {
  const folder = await mkdtemp(join(tmpdir(), "mnemocode-aud021-plan-"));
  try {
    await runEncode({
      mnemonic: "abandon ".repeat(11) + "about", mode: "direct", format: "4",
      template: "business-it", "page-size": "business",
      pdf: join(folder, "public.pdf"), "images-dir": join(folder, "images"),
      "cards-dir": join(folder, "cards"),
    });
    expect(observed.jobs.map((job) => job.destination)).toEqual(["pdf", "images", "cards"]);
    const contents = observed.jobs.map((job) => job.content);
    expect(contents.every((content) => content.decoys > 0)).toBe(true);
    expect(contents[1].colors.slice(0, 8)).toEqual(contents[0].colors.slice(0, 8));
    expect(contents[1].colors).not.toEqual(contents[0].colors);
    console.log(JSON.stringify({
      dispatcherDestinations: observed.jobs.length,
      ownBackupCodesEqual: true,
      plannedDecoysDiffer: true,
      renderedPdfOrImage: false,
    }));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
