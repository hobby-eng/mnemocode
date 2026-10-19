// The self-test rows of the composed features (AUD-037-FUN005) fail when what they check is
// broken: each is given a host or a part that gives another answer.

import { afterEach, describe, expect, it, vi } from "vitest";
import { masterFingerprint } from "../src/bitcoin-evidence.js";
import { CandidateListWriter } from "../src/core/candidate-list-writer.js";
import { checkCandidateListWriter } from "../src/core/candidate-list-writer-self-test.js";
import { checkMissingCodesSearch } from "../src/core/missing-codes-search-self-test.js";
import { CardPdfReader } from "../src/export/card-drawing.js";
import { cardDrawingCheck } from "../src/export/card-drawing-self-test.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { ShareCombineRefusalError } from "../src/sskr/share-platform.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { checkShareRestore } from "../src/sskr/share-restore-self-test.js";
import { checkShareSplit } from "../src/sskr/split-self-test.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the self-test rows of composed features", () => {
  it("pass with MnemoCode's own parts", async () => {
    await checkMissingCodesSearch(masterFingerprint);
    await checkShareSplit(nodeSharePlatform);
    await checkShareRestore(nodeSharePlatform);
    await checkCandidateListWriter();
  });

  it("fail on a fingerprint that is not the phrase's", async () => {
    await expect(checkMissingCodesSearch(() => "00000000")).rejects.toThrow(
      "Marked codes by the encoded fingerprint mismatch.",
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

  it("fail on an engine that restores nothing", async () => {
    await expect(
      checkShareRestore({
        ...nodeSharePlatform,
        combineShares: () => Promise.reject(new ShareCombineRefusalError()),
      }),
    ).rejects.toThrow("Shares restored: outcome mismatch.");
  });

  it("fail on a writer that writes no list", async () => {
    vi.spyOn(CandidateListWriter.prototype, "write").mockResolvedValue({ kind: "empty" });
    await expect(checkCandidateListWriter()).rejects.toThrow("Candidate list written mismatch.");
  });

  it("fail on a reader that reads no page", async () => {
    vi.spyOn(CardPdfReader.prototype, "pages").mockReturnValue([]);
    await expect(cardDrawingCheck(nodeCardRenderer).run()).rejects.toThrow(
      /drawing steps mismatch\./u,
    );
  });
});
