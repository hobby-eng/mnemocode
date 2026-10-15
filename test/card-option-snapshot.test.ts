import { expect, it, vi } from "vitest";
import { businessOptions } from "../src/cli/business-options.js";
import { EncodeCardExport } from "../src/cli/encode-export.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";
import { ExportDetails } from "../src/export/export-details.js";

it("keeps the checked public card details when the export snapshots its options", async () => {
  let checked = false;
  let choices = 0;
  const random = vi.spyOn(nodeRenderPlatform, "randomInt").mockImplementation((upper) => {
    choices += 1;
    return checked ? upper - 1 : 0;
  });
  try {
    const args = { "page-size": "business", template: "business-it" };
    const preview = businessOptions(args);
    const beforeConstruction = choices;
    checked = true;
    const encoding = EncodedBackup.encode(TEST_PHRASE, [], "colors", "direct");
    using backup = encoding.backup;
    using cards = new EncodeCardExport(args, { encoding, mode: "direct", enteredDates: [] });
    expect(choices).toBe(beforeConstruction);
    const job = await cards.job();
    expect(job.content.profile).toEqual(preview.profile);
    expect(job.content.presentation).toEqual(preview.presentation);
    expect(job.content.payload).toBe(backup.text());
    const afterPlan = choices;
    expect((await cards.job()).content).toEqual(job.content);
    expect(choices).toBe(afterPlan);
  } finally {
    random.mockRestore();
  }
});

it("keeps unchecked card options lazy until the first plan", async () => {
  let choices = 0;
  const random = vi.spyOn(nodeRenderPlatform, "randomInt").mockImplementation(() => {
    choices += 1;
    return 0;
  });
  try {
    const encoding = EncodedBackup.encode(TEST_PHRASE, [], "colors", "direct");
    using backup = encoding.backup;
    using cards = new EncodeCardExport(
      { "page-size": "business" },
      { encoding, mode: "direct", enteredDates: [] },
    );
    expect(choices).toBe(0);
    expect((await cards.job()).content.payload).toBe(backup.text());
    expect(choices).toBeGreaterThan(0);
  } finally {
    random.mockRestore();
  }
});

it("keeps an existing snapshot's public details when another key is copied", () => {
  const original = {};
  const snapshot = {};
  const first = ExportDetails.drawnFor(() => 0, original, {}, {});
  const retained = ExportDetails.drawnFor((upper) => upper - 1, snapshot, {}, {});
  expect(retained.profile).not.toEqual(first.profile);
  ExportDetails.reuseForSnapshot(original, snapshot);
  expect(ExportDetails.drawnFor(() => 0, snapshot, {}, {})).toBe(retained);
});

it.each([null, undefined, 17, "synthetic fixture"])(
  "refuses invalid snapshot cache keys: %s",
  (key) => {
    for (const keys of [
      [key, {}],
      [{}, key],
    ])
      expect(() => {
        Reflect.apply(ExportDetails.reuseForSnapshot.bind(ExportDetails), undefined, keys);
      }).toThrow(expect.objectContaining({ code: "export.export-details.snapshot-keys" }));
  },
);
