import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { displayWidth, rowsOfText } from "../src/cli/terminal-geometry.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { backupCardContent } from "../src/export/backup-cards.js";
import { renderBusinessCards } from "../src/export/business-cards.js";
import { CardRenderer } from "../src/export/card-renderer.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";
import { WIPED_CODE } from "./helpers/owner-lifetime.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

afterEach(() => vi.restoreAllMocks());

describe("temporary private-text geometry allocations", () => {
  it("retires actual UTF-8 scratch while preserving exact width and wrapping", () => {
    const fixture = "PUBLIC PRIVATE FIXTURE";
    const allocations = vi.spyOn(Buffer, "from");
    expect(displayWidth(fixture)).toBe(22);
    expect(rowsOfText(fixture, 80)).toBe(1);
    const seen: Buffer[] = [];
    for (const [index, args] of allocations.mock.calls.entries()) {
      if (args[0] !== fixture) continue;
      const result = allocations.mock.results[index]!;
      if (result.type !== "return") throw new Error("The real allocation must return bytes.");
      seen.push(result.value);
    }
    expect(seen).toHaveLength(2);
    for (const bytes of seen) expect(bytes.every((byte) => byte === 0)).toBe(true);
  });
});

describe("run-owned code candidates", () => {
  it.each(["success", "failure", "stopped", "disposed"] as const)(
    "retires borrowed candidate storage after a %s callback without recalling owned outputs",
    async (outcome) => {
      using search = MissingCodes.read(`${TEST_PHRASE}|actual`, "english", "direct");
      const separate = search.candidates();
      const first = separate.next();
      if (first.done) throw new Error("The public fixture must have a candidate.");
      const callerCopy = first.value;
      const callerSnapshot = [...callerCopy];
      separate.return(undefined);
      const stop = new AbortController();
      const observed: (readonly number[])[] = [];
      const fault = new Error("Synthetic check failure.");
      const pending = search.run({
        signal: stop.signal,
        maxFound: 1,
        check: async (codes) => {
          observed.push(codes);
          expect(codes.some((index) => index !== 0)).toBe(true);
          if (outcome === "failure") throw fault;
          if (outcome === "stopped") stop.abort();
          if (outcome === "disposed") search.wipe();
          return true;
        },
      });
      if (outcome === "failure") await expect(pending).rejects.toBe(fault);
      else if (outcome === "disposed")
        await expect(pending).rejects.toHaveProperty("code", WIPED_CODE);
      else {
        const result = await pending;
        try {
          expect(result.stopped).toBe(outcome === "stopped");
          if (outcome === "success") {
            expect(result.found).toHaveLength(1);
            expect(result.found[0]!.decode([]).recoveredMnemonic).toBe(TEST_PHRASE);
          }
        } finally {
          for (const backup of result.found) backup.wipe();
        }
      }
      expect(observed.length).toBeGreaterThan(0);
      for (const codes of observed) expect(codes.every((index) => index === 0)).toBe(true);
      expect(callerCopy).toEqual(callerSnapshot);
      expect(callerCopy.some((index) => index !== 0)).toBe(true);
      callerCopy.fill(0);
    },
  );
});

describe("private artwork PNG ownership at the real embedding seam", () => {
  it.each(["saved", "rejected"] as const)(
    "retires encoded PNG bytes after the real PDF embedder has %s them",
    async (outcome) => {
      const encoded: Uint8Array[] = [];
      const renderer = new CardRenderer({
        ...nodeRenderPlatform,
        randomInt: () => 0,
        encodePng: (image, level) => {
          const bytes =
            outcome === "rejected"
              ? Uint8Array.of(1, 2, 3)
              : nodeRenderPlatform.encodePng(image, level);
          encoded.push(bytes);
          return bytes;
        },
      });
      const encoding = EncodedBackup.encode(TEST_PHRASE, [], "colors", "direct");
      using backup = encoding.backup;
      const pending = renderBusinessCards(
        renderer,
        "it",
        { ...backupCardContent(backup), pageSize: "business" },
        0,
      );
      // pdf-lib's PNG reader refuses the three bytes with a string of its own.
      if (outcome === "rejected")
        await expect(pending).rejects.toBe("The input is not a PNG file!");
      else {
        const bytes = await pending;
        try {
          expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
        } finally {
          bytes.fill(0);
        }
      }
      expect(encoded).toHaveLength(1);
      for (const bytes of encoded) expect(bytes.every((byte) => byte === 0)).toBe(true);
    },
  );
});
