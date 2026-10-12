// AUD-017: independent remediation controls, including branded host fields and owned transport
// allocations. Public fixtures only; no renderer, network or full vector replay.
import { readFileSync } from "node:fs";
import { WordCandidateSearch } from "../../../dist/core/candidates.js";
import { MissingCodes } from "../../../dist/core/missing-codes.js";
import { MissingCodesSearch } from "../../../dist/core/missing-codes-search.js";
import { askWallet } from "../../../dist/core/wallet-check.js";
import { ShareSplit } from "../../../dist/sskr/split.js";
import { nodeSharePlatform } from "../../../dist/sskr/share-platform-node.js";
import {
  bytewordsToUr,
  CHECKSUM_BYTES,
  transportToUr,
  urToBytewords,
  urToTransport,
} from "../../../dist/sskr/transport.js";
import { crc32 } from "../../../dist/sskr/checksum.js";
import { MEMBER_BYTE, NIBBLE_BITS } from "../../../dist/sskr/share-layout.js";
import { SHARE_UNITS } from "../../../dist/sskr/share-units.js";

const checks = [];
function check(name, passed, detail = {}) {
  checks.push({ name, passed, ...detail });
}

const phrase = `${"abandon ".repeat(23)}art`;
class Answer {
  #derived = "public-address-fixture";
  get matched() {
    return true;
  }
  get path() {
    return "m";
  }
  get derived() {
    return this.#derived;
  }
}
const original = new Answer();
check("original host class reads its derived field", original.derived === "public-address-fixture");
const wrapped = await askWallet(() => original, phrase);
check(
  "basic inherited wallet fields are captured",
  wrapped.matched === true && wrapped.path === "m",
);
try {
  check("branded host getter survives askWallet", wrapped.derived === "public-address-fixture");
} catch (error) {
  check("branded host getter survives askWallet", false, { error: error.message });
}
try {
  const result = await WordCandidateSearch.parse(`${"abandon ".repeat(23)}?`, "unknown-words").run({
    walletCheck: (candidate) => (candidate === phrase ? new Answer() : { matched: false }),
  });
  const match = result.shown.find((row) => row.match?.matched)?.match;
  check(
    "actual word search preserves the branded derived field",
    match?.derived === "public-address-fixture",
  );
} catch (error) {
  check("actual word search preserves the branded derived field", false, { error: error.message });
}
const own = await askWallet(() => ({ matched: true, derived: "public-own-field" }), phrase);
check("ordinary extra field remains readable", own.derived === "public-own-field");
check("observed own-field enumeration", true, {
  serializedContainsDerived: JSON.stringify(own).includes("derived"),
  ownsDerived: Object.hasOwn(own, "derived"),
  meaning:
    "Additional compatibility observation; not a separate finding without a serialization contract.",
});

let reads = 0;
const changing = await askWallet(
  () => ({
    get matched() {
      reads++;
      return reads === 1;
    },
  }),
  phrase,
);
check("matched is read once and kept", changing.matched === true && reads === 1);
try {
  await askWallet(() => ({ matched: "true" }), phrase);
  check("malformed matched is still refused", false);
} catch (error) {
  check("malformed matched is still refused", /must answer with an object/u.test(error.message));
}

const controller = new AbortController();
let fingerprints = 0;
try {
  await new MissingCodesSearch(
    MissingCodes.read(`${"abandon ".repeat(23)}?`, "english", "direct"),
    async () => {
      fingerprints++;
      controller.abort(new Error("public list stop"));
      return "00000000";
    },
  )
    .listed([])
    .run({ signal: controller.signal });
  check("list cancellation refuses publication", false);
} catch (error) {
  check("list cancellation refuses publication", error.message === "public list stop", {
    fingerprints,
  });
}

const share = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[0].shares[0];
const words = urToBytewords(share).split(" ");
function refusedBuffers(name, read, expected) {
  const allocations = [];
  const Original = globalThis.Uint8Array;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      allocations.push(this);
    }
  }
  globalThis.Uint8Array = Captured;
  let refusal;
  try {
    read();
  } catch (error) {
    refusal = error.message;
  } finally {
    globalThis.Uint8Array = Original;
  }
  const nonzero = allocations.filter((array) => array.some((byte) => byte !== 0)).length;
  check(name, allocations.length > 0 && nonzero === 0 && expected.test(refusal ?? ""), {
    allocations: allocations.length,
    nonzero,
    refusal,
  });
  for (const array of allocations) array.fill(0);
}
const body = share.slice("ur:sskr/".length);
for (const [name, index] of [
  ["first", 0],
  ["middle", Math.floor(words.length / 2)],
  ["last", words.length - 1],
]) {
  const broken = [...words];
  broken[index] = "zzzz";
  refusedBuffers(
    `unknown ${name} Byteword wipes an allocated buffer`,
    () => bytewordsToUr(broken.join(" ")),
    /Unknown SSKR Byteword/u,
  );
  // The UR form omits the registered tag; choose its own first/middle/last pair positions.
  const pair =
    name === "first" ? 0 : name === "last" ? body.length / 2 - 1 : Math.floor(body.length / 4);
  refusedBuffers(
    `unknown ${name} UR pair wipes an allocated buffer`,
    () => urToTransport(`ur:sskr/${body.slice(0, pair * 2)}zz${body.slice(pair * 2 + 2)}`),
    /Unknown Bytewords pair/u,
  );
}
const bytes = urToTransport(share);
try {
  const minimal = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[0];
  check(
    "caller-owned transport remains nonzero",
    bytes.some((byte) => byte !== 0),
  );
  check("known transport still converts exactly", transportToUr(bytes) === minimal.shares[0]);
  // This fixed 128-bit fixture has a short CBOR header of one byte, followed by its metadata.
  const HEADER_BYTES = 1;
  bytes[HEADER_BYTES + MEMBER_BYTE] |= 1 << NIBBLE_BITS;
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    bytes.length - CHECKSUM_BYTES,
    crc32(bytes.subarray(0, -CHECKSUM_BYTES)),
  );
  const invalid = SHARE_UNITS.ur.text(Array.from(bytes));
  refusedBuffers(
    "invalid metadata with valid CRC wipes its decoded buffer",
    () => urToTransport(invalid),
    /Invalid SSKR share metadata/u,
  );
} finally {
  bytes.fill(0);
}
refusedBuffers(
  "invalid CRC wipes its decoded buffer",
  () => urToTransport(`${share.slice(0, -2)}ae`),
  /checksum/u,
);

let mnemonicReads = 0;
const source = `${"abandon ".repeat(11)}about`;
const split = await new ShareSplit(nodeSharePlatform, (seed) => seed.fill(0)).splitBackup({
  get mnemonic() {
    return mnemonicReads++ === 0
      ? source
      : "legal winner thank year wave sausage worth useful legal winner thank yellow";
  },
  mode: "direct",
  dates: [],
  threshold: 2,
  count: 3,
});
check(
  "split captures its mnemonic once",
  mnemonicReads === 1 && split.original === source && split.held === source,
);

console.log(JSON.stringify({ checks }, null, 2));
process.exitCode = checks.every((row) => row.passed) ? 0 : 1;
