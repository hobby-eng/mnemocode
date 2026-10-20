// The self-test rows of the composed features (AUD-037-FUN005) fail when what they check is
// broken: each is given a host or a part that gives another answer, and one that takes what the
// row must see refused, or refuses it for another reason.

import { afterEach, describe, expect, it, vi } from "vitest";
import { masterFingerprint } from "../src/bitcoin-evidence.js";
import * as candidateList from "../src/core/candidate-list.js";
import { CandidateListWriter } from "../src/core/candidate-list-writer.js";
import { checkCandidateListWriter } from "../src/core/candidate-list-writer-self-test.js";
import {
  MissingCodesSearch,
  type MissingCodesWaySearch,
} from "../src/core/missing-codes-search.js";
import { checkMissingCodesSearch } from "../src/core/missing-codes-search-self-test.js";
import { CardPdfReader, type CardPageDrawing } from "../src/export/card-drawing.js";
import { cardDrawingCheck } from "../src/export/card-drawing-self-test.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { ShareCombineRefusalError } from "../src/sskr/share-platform.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { checkShareRestore } from "../src/sskr/share-restore-self-test.js";
import { ShareSplit } from "../src/sskr/split.js";
import { checkShareSplit } from "../src/sskr/split-self-test.js";

/** A search that lists marked codes as `list` says, given how MnemoCode's own search lists them. */
function searchListing(list: (listed: () => MissingCodesWaySearch) => MissingCodesWaySearch): void {
  // oxlint-disable-next-line typescript/unbound-method -- the spy calls it on its own instance
  const listed = MissingCodesSearch.prototype.listed;
  vi.spyOn(MissingCodesSearch.prototype, "listed").mockImplementation(function (
    this: MissingCodesSearch,
    dates,
  ) {
    return list(() => listed.call(this, dates));
  });
}

/** A reader that reads card PDFs as `read` says, given how MnemoCode's own reader reads them. */
function readerReading(read: (pages: () => CardPageDrawing[]) => CardPageDrawing[]): void {
  // oxlint-disable-next-line typescript/unbound-method -- the spy calls it on its own instance
  const pages = CardPdfReader.prototype.pages;
  vi.spyOn(CardPdfReader.prototype, "pages").mockImplementation(function (this: CardPdfReader) {
    return read(() => pages.call(this));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the self-test rows of composed features", () => {
  it("pass with MnemoCode's own parts", async () => {
    await checkMissingCodesSearch(masterFingerprint);
    await checkShareSplit(nodeSharePlatform);
    await checkShareRestore(nodeSharePlatform);
    await checkCandidateListWriter();
    await cardDrawingCheck(nodeCardRenderer).run();
  });

  it("fail on a fingerprint that is not the phrase's", async () => {
    await expect(checkMissingCodesSearch(() => "00000000")).rejects.toThrow(
      "Marked codes by the encoded fingerprint mismatch.",
    );
  });

  it("fail on a list of the marked codes with a row more", async () => {
    searchListing((listed) => {
      const way = listed();
      const run = way.run.bind(way);
      vi.spyOn(way, "run").mockImplementation(async (options) => {
        const result = await run(options);
        return result.kind === "list"
          ? { ...result, rows: [...result.rows, result.rows[0]!] }
          : result;
      });
      return way;
    });
    await expect(checkMissingCodesSearch(masterFingerprint)).rejects.toThrow(
      "Marked codes listed: rows mismatch.",
    );
  });

  it("fail on a search that refuses too long a list for another reason", async () => {
    searchListing((listed) => {
      try {
        return listed();
      } catch {
        throw new Error("A fault of another kind.");
      }
    });
    await expect(checkMissingCodesSearch(masterFingerprint)).rejects.toThrow(
      "A list of more phrases than it holds was refused for another reason.",
    );
  });

  it("fail on an engine whose shares are of another seed", async () => {
    await expect(
      checkShareSplit({
        ...nodeSharePlatform,
        createShares: (secret, threshold, count, seed) =>
          nodeSharePlatform.createShares(secret, threshold, count, seed.fill(1)),
      }),
    ).rejects.toThrow("Split known answer mismatch.");
  });

  it("fail on a split that takes a threshold of 1", async () => {
    vi.spyOn(ShareSplit, "validateThreshold").mockImplementation(() => undefined);
    await expect(checkShareSplit(nodeSharePlatform)).rejects.toThrow(
      "A split with a threshold of 1 was accepted.",
    );
  });

  it("fail on an engine that restores nothing", async () => {
    await expect(
      checkShareRestore({
        ...nodeSharePlatform,
        combineShares: () => Promise.reject(new ShareCombineRefusalError()),
      }),
    ).rejects.toThrow("Shares restored: outcome mismatch.");
  });

  it("fail on a restore that tells too few shares as another trouble", async () => {
    // oxlint-disable-next-line typescript/unbound-method -- the spy calls it on its own instance
    const restoreComplete = ShareInput.prototype.restoreComplete;
    vi.spyOn(ShareInput.prototype, "restoreComplete").mockImplementation(async function (
      this: ShareInput,
      platform,
    ) {
      const read = await restoreComplete.call(this, platform);
      const { outcome } = read;
      if (outcome.kind !== "trouble" || outcome.trouble.kind !== "few") return read;
      const trouble = { kind: "refused", message: outcome.trouble.message } as const;
      return { ...read, outcome: { kind: "trouble", trouble } };
    });
    await expect(checkShareRestore(nodeSharePlatform)).rejects.toThrow(
      "One share of two mismatch.",
    );
  });

  it("fail on a writer that writes no list", async () => {
    vi.spyOn(CandidateListWriter.prototype, "write").mockResolvedValue({ kind: "empty" });
    await expect(checkCandidateListWriter()).rejects.toThrow("Candidate list written mismatch.");
  });

  it("wipe the BIP39 passphrase of the writer they make", async () => {
    const wipe = vi.spyOn(CandidateListWriter.prototype, "wipe");
    await checkCandidateListWriter();
    expect(wipe).toHaveBeenCalledOnce();
  });

  it("fail on a writer that takes a passphrase longer than a list stores", async () => {
    vi.spyOn(candidateList, "assertListPassphrase").mockImplementation(() => undefined);
    await expect(checkCandidateListWriter()).rejects.toThrow(
      "A BIP39 passphrase longer than a list stores was accepted.",
    );
  });

  it("fail on a reader that reads no page", async () => {
    vi.spyOn(CardPdfReader.prototype, "pages").mockReturnValue([]);
    await expect(cardDrawingCheck(nodeCardRenderer).run()).rejects.toThrow(
      /drawing steps mismatch\./u,
    );
  });

  it("fail on a reader that reads a page of another size", async () => {
    readerReading((pages) =>
      pages().map((page) => ({ ...page, width: page.height, height: page.width })),
    );
    await expect(cardDrawingCheck(nodeCardRenderer).run()).rejects.toThrow(
      /^[\w-]+ A6 landscape page mismatch\.$/u,
    );
  });

  it("fail on a reader that leaves out a drawing step", async () => {
    readerReading((pages) => pages().map((page) => ({ ...page, steps: page.steps.slice(1) })));
    await expect(cardDrawingCheck(nodeCardRenderer).run()).rejects.toThrow(
      "Rectangle drawing steps mismatch.",
    );
  });

  it("fail on a reader that reads a PDF in a standard font", async () => {
    readerReading((pages) => {
      try {
        return pages();
      } catch {
        return [];
      }
    });
    await expect(cardDrawingCheck(nodeCardRenderer).run()).rejects.toThrow(
      "A PDF whose font no card uses was accepted.",
    );
  });
});
