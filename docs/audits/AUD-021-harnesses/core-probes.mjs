// Public BIP39/SSKR fixtures only; baseline probes reproduce reported contract failures.
import assert from "node:assert/strict";
import { BackupReading } from "../../../dist/core/backup-reading.js";
import { EncodedBackup } from "../../../dist/core/encoded-backup.js";
import { ReEncoding } from "../../../dist/core/re-encoding.js";
import { encodeCandidateList, decodeCandidateList } from "../../../dist/core/candidate-list.js";
import { DateSearch, DatesAnswer } from "../../../dist/core/date-search.js";
import { encodeMnemonic } from "../../../dist/core/seedshift.js";
import { parseDate } from "../../../dist/core/dates.js";
import { Share } from "../../../dist/sskr/transport.js";
import { readRepairableShare } from "../../../dist/sskr/repair.js";
import { sskrSetVector } from "../../../dist/sskr/known-answers.js";

const phrase = "abandon ".repeat(11) + "about";
const other = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const hex = "E000 E064 E13A E191 E271 E064 E3AB E191 E4E2 E064 E61C E191 E753 E064 E88D ?";
const rules = { seedshiftOnly: false, shareReader: "Shares" };
const read = (text, words) => BackupReading.of(text, { ...rules, words });
const without = read(`MNC1:direct:colors-unicode:${hex}`);
const withCount = read(`MNC1:direct:colors-unicode:${hex}`, 12);
assert.equal(without.marked, true);
assert.equal(withCount.marked, false);
assert.doesNotThrow(() => withCount.missingCodes("colors-unicode"));
const symbols = hex.split(" ").map((code) => code === "?" ? code : String.fromCodePoint(parseInt(code, 16))).join("");
assert.equal(read(`MNC1:direct:colors-unicode:${symbols}`).marked, true);
assert.equal(read(`MNC1:direct:colors-unicode:${symbols}`, 12).marked, false);

const markedShare = sskrSetVector.colors[0].replace("#1F9121", "?");
assert.equal(readRepairableShare(markedShare).ur, sskrSetVector.shares[0]);
assert.equal(Share.read(`${sskrSetVector.colors[0]} #000000`).ur, sskrSetVector.shares[0]);
assert.throws(() => readRepairableShare(`${markedShare} #000000`), /No valid share fits/u);

const encoded = encodeCandidateList({ records: [{ entropy: new Uint16Array(16).fill(256) }] });
const decoded = decodeCandidateList(encoded);
assert.deepEqual([...decoded.records[0].entropy], new Array(16).fill(0));
decoded.records[0].entropy.fill(0);
encoded.fill(0);
const valid = encodeCandidateList({ records: [{ entropy: new Uint8Array(16).fill(1) }] });
const validDecoded = decodeCandidateList(valid);
assert.deepEqual([...validDecoded.records[0].entropy], new Array(16).fill(1));
validDecoded.records[0].entropy.fill(0);
valid.fill(0);

let release;
let checkedPhrase;
const gate = new Promise((resolve) => { release = resolve; });
const reencoding = ReEncoding.of(EncodedBackup.read(phrase, "english", "direct"), []);
const confirming = reencoding.confirmByWallet(async (given) => {
  checkedPhrase = given;
  await gate;
  return { matched: true };
});
reencoding.result.recoveredMnemonic = other;
release();
await confirming;
assert.equal(checkedPhrase, phrase);
assert.equal(reencoding.confirmedPhrase(), other);

let enterWallet;
let finishWallet;
const entered = new Promise((resolve) => { enterWallet = resolve; });
const walletResult = new Promise((resolve) => { finishWallet = resolve; });
const controller = new AbortController();
const progress = [];
const date = parseDate("23-09-2026");
const search = new DateSearch({
  indexes: encodeMnemonic(phrase, [date]).shiftedIndexes,
  dates: DatesAnswer.of([date]),
  mode: "seedshift",
  walletCheck: async () => { enterWallet(); return walletResult; },
});
const searching = search.run({
  signal: controller.signal,
  onProgress: (event) => progress.push({ aborted: controller.signal.aborted, ...event }),
});
await entered;
controller.abort();
finishWallet({ matched: false });
await assert.rejects(searching);
assert.equal(progress.length, 1);
assert.equal(progress[0].aborted, true);

console.log(JSON.stringify({
  colorUnicodeMarkLostWithWordCount: true,
  privateUseMarkLostWithWordCount: true,
  completeShareWithDecoyAccepted: true,
  markedShareWithDecoyRefused: true,
  nonByteEntropySilentlyNarrowed: true,
  reencodingConfirmsDifferentPhraseFromCheckedOne: true,
  progressAfterAbortedUnmatchedWallet: true,
  expensiveSearchesOrRendering: false,
}));
