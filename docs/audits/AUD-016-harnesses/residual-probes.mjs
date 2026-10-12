// AUD-016: omitted cancellation path, valid getter-based WalletMatch implementations, and
// owned partial transport allocations. Public fixtures only; no rendering or full vector replay.
import { readFileSync } from "node:fs";
import { MissingCodes } from "../../../dist/core/missing-codes.js";
import { MissingCodesSearch } from "../../../dist/core/missing-codes-search.js";
import { parseDate } from "../../../dist/core/dates.js";
import { askWallet } from "../../../dist/core/wallet-check.js";
import { ShareSplit } from "../../../dist/sskr/split.js";
import { nodeSharePlatform } from "../../../dist/sskr/share-platform-node.js";
import { bytewordsToUr, urToBytewords, urToTransport } from "../../../dist/sskr/transport.js";

const checks = [];
const controller = new AbortController();
let returned;
let reason;
try {
  returned = await new MissingCodesSearch(
    MissingCodes.read("2027 10 2? 2027 10 24 2027 10 24 2027 10 377", "indexes", "seedshift"),
    async () => {
      controller.abort(new Error("public list stop"));
      return "00000000";
    },
  )
    .listed([parseDate("23-09-2026")])
    .run({ signal: controller.signal });
} catch (error) {
  reason = error.message;
}
checks.push({
  name: "listed codes reject abort during fingerprint",
  returnedKind: returned?.kind,
  aborted: controller.signal.aborted,
  reason,
  passed: reason === "public list stop",
});

class GetterMatch {
  get matched() {
    return true;
  }
  get path() {
    return "m";
  }
}
try {
  const answer = await askWallet(() => new GetterMatch(), "public fixture");
  checks.push({
    name: "valid class wallet answer",
    passed: answer.matched === true && answer.path === "m",
  });
} catch (error) {
  checks.push({ name: "valid class wallet answer", passed: false, refusal: error.message });
}
const ownMatch = Object.create({
  get path() {
    return "m";
  },
});
ownMatch.matched = true;
const copied = await askWallet(() => ownMatch, "public fixture");
checks.push({
  name: "wallet evidence from prototype getter survives",
  observedPath: copied.path,
  passed: copied.path === "m",
});

const vector = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[0];
const share = vector.shares[0];
const words = urToBytewords(share).split(" ");
words[words.length - 1] = "zzzz";
for (const [name, read] of [
  ["unknown late UR pair wipes partial bytes", () => urToTransport(share.slice(0, -2) + "zz")],
  ["unknown late Byteword wipes partial bytes", () => bytewordsToUr(words.join(" "))],
]) {
  const allocations = [];
  class CapturedArray extends Uint8Array {
    constructor(...args) {
      super(...args);
      allocations.push(this);
    }
  }
  const original = Uint8Array.from;
  let refusal;
  Uint8Array.from = (...args) => Reflect.apply(original, CapturedArray, args);
  try {
    read();
  } catch (error) {
    refusal = error.message;
  } finally {
    Uint8Array.from = original;
  }
  const nonzero = allocations.filter((array) => array.some((byte) => byte !== 0)).length;
  checks.push({
    name,
    refusal,
    allocations: allocations.length,
    nonzero,
    passed: allocations.length > 0 && nonzero === 0,
  });
  for (const array of allocations) array.fill(0);
}

// An executable host getter is a robustness observation, not a passive input/CLI attack.
const first = `${"abandon ".repeat(11)}about`;
const second = `${"zoo ".repeat(11)}wrong`;
let reads = 0;
const request = {
  get mnemonic() {
    return reads++ === 0 ? first : second;
  },
  mode: "direct",
  dates: [],
  threshold: 2,
  count: 3,
};
const split = await new ShareSplit(nodeSharePlatform, (seed) => seed.fill(0)).splitBackup(request);
checks.push({
  name: "split snapshot getter observation",
  reads,
  consistent: split.original === split.held,
  passed: split.original === split.held,
});

console.log(JSON.stringify({ checks }, null, 2));
process.exitCode = checks.every((check) => check.passed) ? 0 : 1;
