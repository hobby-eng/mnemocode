// Small public-fixture checks; no drawing, search, vectors replay or host writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathWithin } from "../../../src/cli/path-within.js";
import { cloudServiceOf } from "../../../src/cli/cloud-folders.js";
import { assertColorCardContent } from "../../../src/export/card-content.js";
import { printedCode } from "../../../src/export/card-codes.js";
import { indexesToColors } from "../../../src/core/colors.js";
import { pageDimensions, parseOrientation } from "../../../src/export/card-settings.js";
import { writeShare } from "../../../src/sskr/transport.js";
import { LAST_NORMAL_INDEX, defaultAddressCount } from "../../../src/core/address-scan.js";

const publicShare = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[0]
  .shares[0];
const labels = writeShare(publicShare, "indexes").split(" ");
const share = { kind: "sskr" as const, colors: ["#000000"], labels, payload: labels.join(" ") };
assertColorCardContent(share);
assert.ok(labels.length > share.colors.length);
assert.equal(share.colors.map((_, index) => printedCode(share, index)).length, 1);
const colors = indexesToColors(Array.from({ length: 12 }, () => 0));
const phrase = {
  kind: "colors" as const,
  colors,
  payload: colors.join(" "),
  labels: ["unrelated"],
};
assertColorCardContent(phrase);
assert.equal(printedCode(phrase, 0), "unrelated");
assert.throws(() => parseOrientation("sideways"), /Orientation must/u);
assert.deepEqual(pageDimensions("business", "sideways" as never), [90, 50]);

const folder = "/synthetic/Work";
const contained = folder + "/..\\notes/cards.pdf";
assert.equal(pathWithin(folder, contained), false);
assert.equal(cloudServiceOf(contained, { OneDrive: folder }, "/synthetic/home"), undefined);
assert.equal(defaultAddressCount(LAST_NORMAL_INDEX), 1);

// Observe cold menu imports in a separate process in the command below: this process already
// loaded transport/export helpers, so its package cache would not isolate menu initialization.
console.log(
  JSON.stringify(
    {
      share: { labels: labels.length, printedReferences: 1, accepted: true },
      phrase: { accepted: true, firstPrintedReference: printedCode(phrase, 0) },
      orientation: { parserRefuses: true, dimensionsAccept: [90, 50] },
      posixPath: { parent: folder, child: contained, containment: false, cloudService: null },
      finalAddressDefault: defaultAddressCount(LAST_NORMAL_INDEX),
    },
    null,
    2,
  ),
);

// Constructor-only card probe. Supplying an identity prevents unrelated random name choices.
const { ShareCardSet } = await import("../../../src/export/sskr-render.js");
const options = { style: "it", shareFormat: "unsupported", profile: { name: "Public fixture" } };
// Resolve its ordinary host dependency; this reads no asset and makes no document.
await import("../../../src/export/platform-node.js");
const actual = new ShareCardSet([publicShare], options as never, () => 0);
assert.ok(actual.printedCodes(0).length > 0);
console.log(
  JSON.stringify({
    unsupportedShareFormat: "accepted",
    printedCodes: actual.printedCodes(0).length,
  }),
);
