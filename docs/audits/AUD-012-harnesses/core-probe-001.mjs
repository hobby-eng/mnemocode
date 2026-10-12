// Bounded public-fixture baseline probe; original input/output hashes are in the report.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeMnemonic, formatEncoded, parseDate, formatDate } from "../../../src/core.ts";
import { DatesAnswer } from "../../../src/core/date-search.ts";
import { MissingCodes } from "../../../src/core/missing-codes.ts";
import { MissingCodesSearch } from "../../../src/core/missing-codes-search.ts";
import { masterFingerprint } from "../../../src/bitcoin-evidence.ts";
const publicPhrase = "abandon ".repeat(11) + "about";
const known = parseDate("01-01-2025");
const guessed = parseDate("23-09-2026");
const encoded = encodeMnemonic(publicPhrase, [known, guessed]);
const tokens = formatEncoded(encoded, "indexes").split(" ");
tokens[3] = tokens[3].slice(0, -1) + "?";
const codes = MissingCodes.read(tokens.join(" "), "indexes", "seedshift");
const candidates = [...codes.candidates()];
assert(codes.combinations <= 10 && candidates.length <= 10);
const answer = DatesAnswer.parse("01-01-2025 23-09-202?", { wordCount: 12, patterns: true });
assert(answer.combinations <= 10);
let calls = 0;
const check = async (mnemonic) => {
  if (++calls > 100) throw new Error("synthetic probe wallet-call bound exceeded");
  return { matched: mnemonic === publicPhrase, path: "synthetic-exact-public-phrase" };
};
const search = new MissingCodesSearch(codes, () => "00000000");
const result = await search.byWallet(check, answer).run({ signal: AbortSignal.timeout(5000) });
assert.equal(result.kind, "found");
const decoded = result.backup.decode(result.dates);
const reconstructed = result.backup.decode([...answer.known, ...result.dates]);
const completeOnly = await search.byWallet(check, DatesAnswer.of([known, guessed])).run({
  signal: AbortSignal.timeout(5000),
});
assert.equal(completeOnly.kind, "found");
const completeDecoded = completeOnly.backup.decode(completeOnly.dates);
assert.equal(masterFingerprint(publicPhrase), "73c5da0a");
const observed = {
  id: "CORE-NEW-001",
  markedInput: tokens.join(" "),
  codeCombinations: codes.combinations,
  actualCodeCandidates: candidates.length,
  dateCombinations: answer.combinations,
  walletCalls: calls,
  resultKind: result.kind,
  knownInputDates: answer.known.map(formatDate),
  returnedDates: result.dates.map(formatDate),
  foundDatesDisplay: result.foundDates,
  returnedDecodeIsPublicSource: decoded.recoveredMnemonic === publicPhrase,
  returnedDecodeChecksumValid: decoded.checksumValid,
  expectedPublicFingerprint: masterFingerprint(publicPhrase),
  returnedDecodeFingerprint: masterFingerprint(decoded.recoveredMnemonic),
  returnedMnemonicSha256: createHash("sha256").update(decoded.recoveredMnemonic).digest("hex"),
  addingKnownDateRecoversPublicSource: reconstructed.recoveredMnemonic === publicPhrase,
  completeOnlyReturnedDates: completeOnly.dates.map(formatDate),
  completeOnlyDecodeIsPublicSource: completeDecoded.recoveredMnemonic === publicPhrase,
};
assert.equal(observed.returnedDates.length, 1);
assert.equal(observed.returnedDecodeIsPublicSource, false);
assert.equal(observed.returnedDecodeChecksumValid, true);
assert.equal(observed.addingKnownDateRecoversPublicSource, true);
assert.equal(observed.completeOnlyDecodeIsPublicSource, true);
console.log(JSON.stringify(observed));
