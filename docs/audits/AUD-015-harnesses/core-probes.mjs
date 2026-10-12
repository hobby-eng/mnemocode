// AUD-015: validate once and consume the validated values. Getter-bearing host inputs and a
// bounded microtask cancellation schedule; only the public zero-entropy BIP39 phrase is used.
import { protectionFor } from "../../../dist/core/candidate-encryption.js";
import { CandidateListWriter } from "../../../dist/core/candidate-list-writer.js";
import { checksumValid } from "../../../dist/core/candidates.js";
import { DatesAnswer, DateSearch } from "../../../dist/core/date-search.js";
import { encodeMnemonic } from "../../../dist/core.js";

const checks = [];
const phrase = `${"abandon ".repeat(11)}about`;
const date = { year: 2026, month: 9, day: 23 };
function search(walletCheck) {
  return new DateSearch({
    indexes: encodeMnemonic(phrase, [date]).shiftedIndexes,
    dates: DatesAnswer.of([date]),
    mode: "seedshift",
    keep: 1,
    walletCheck,
  });
}

let kindsRead = 0;
try {
  const choice = {
    get kind() {
      return ++kindsRead === 1 ? "passphrase" : "none";
    },
    passphrase: "synthetic public password",
  };
  const protection = protectionFor(choice);
  // Do not run scrypt: a selected encrypted class is sufficient. A plaintext selection is
  // demonstrated through the writer, with its real file header, then the public bytes are wiped.
  let magic;
  if (!protection.encrypted) {
    const output = await new CandidateListWriter(protection).writePhrases([phrase]);
    if (output.kind === "list") {
      magic = new TextDecoder().decode(output.list.bytes.subarray(0, 4));
      output.list.bytes.fill(0);
    }
  }
  checks.push({
    name: "protection discriminant snapshot",
    reads: kindsRead,
    encrypted: protection.encrypted,
    magic,
    passed: protection.encrypted === true,
  });
} catch (error) {
  checks.push({
    name: "protection discriminant snapshot",
    refused: error.name,
    passed: error instanceof TypeError,
  });
}

let answersRead = 0;
try {
  const answer = {
    get matched() {
      return ++answersRead === 1 ? false : "false";
    },
  };
  const result = await search(() => answer).run();
  checks.push({
    name: "wallet boolean snapshot",
    reads: answersRead,
    matchCount: result.matchCount,
    passed: result.matchCount === 0,
  });
} catch (error) {
  checks.push({
    name: "wallet boolean snapshot",
    refused: error.name,
    passed: error instanceof TypeError,
  });
}

let wordsRead = 0;
const words = [...Array(11).fill(0), 3];
Object.defineProperty(words, "0", {
  enumerable: true,
  get() {
    return ++wordsRead === 1 ? 0 : 1;
  },
});
try {
  const valid = checksumValid(words);
  checks.push({
    name: "checksum reads the validated word snapshot",
    valid,
    reads: wordsRead,
    passed: valid && wordsRead === 1,
  });
} catch (error) {
  checks.push({
    name: "checksum reads the validated word snapshot",
    refused: error.name,
    passed: error instanceof TypeError,
  });
}

const controller = new AbortController();
let published = 0;
let publishedAfterAbort = 0;
let resolved = false;
let reason;
try {
  await search(() => {
    queueMicrotask(() => queueMicrotask(() => controller.abort(new Error("public test stop"))));
    return { matched: true };
  }).run({
    signal: controller.signal,
    onMatch: () => {
      published++;
      if (controller.signal.aborted) publishedAfterAbort++;
    },
  });
  resolved = true;
} catch (error) {
  reason = error.message;
}
checks.push({
  name: "abort between helper and publication",
  resolved,
  aborted: controller.signal.aborted,
  published,
  publishedAfterAbort,
  reason,
  passed: !resolved && published === 0 && reason === "public test stop",
});
console.log(JSON.stringify({ checks }, null, 2));
process.exitCode = checks.every((check) => check.passed) ? 0 : 1;
