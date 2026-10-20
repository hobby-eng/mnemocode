// re-encode: an encoded backup made again, with other dates, another mode or in another form
// (owner, 2026-10-13), without its seed phrase being typed. The old backup is read and decoded as
// Decode reads and decodes it, every code and date complete, its dates asked right after its
// codes; a backup of the Original Seedshift with a valid last word also takes the last word of the
// original phrase, which the person remembers. The phrase is shown, and encoded again only once
// it is confirmed (core/re-encoding.ts): the person recognises it or its fingerprint, or the
// wallet has an address or the fingerprint they name. Its checksum confirms nothing. Then the new
// backup is made as Encode makes it, shares and cards included: from its options, or, with
// --ask-secrets and none of them, from Encode's questions, asked on the private screen once the
// phrase is confirmed (encode-questions.ts).
//
// Every option given is checked before the first question, and a refusal of an option of the old
// backup says so (ofOldBackup). On the command line the options give every answer: a wallet option
// or --recognised confirms the phrase.

import {
  assertAskedNotGiven,
  OLD_DATES_KEY,
  parseArguments,
  value,
  type ParsedArguments,
} from "./arguments.js";
import { matchWalletEvidence, type WalletEvidence } from "../bitcoin-evidence.js";
import { NO_SUCH_LAST_WORD, RE_ENCODING_WORDS, ReEncoding } from "../core/re-encoding.js";
import { EVIDENCE_MATCHED_BY } from "../core/wallet-evidence.js";
import { WordList } from "../core/word-hints.js";
import type { DateShiftDate, DecodedResult, EncodedFormat, MaskingMode } from "../core/types.js";
import { Masking } from "../core/masking.js";
import type { EncodedBackup } from "../core/encoded-backup.js";
import {
  askAfterFailure,
  askOrCancel,
  askSecretUntil,
  askWalletEvidence,
  WHAT_NOW,
} from "./ask.js";
import { warnOfCloudCopies } from "./cloud-folders.js";
import { givenWallet, type GivenWallet } from "./bitcoin-options.js";
import { backupChoice, datesAgainChoice } from "./date-search.js";
import {
  DATES_OPTION,
  ENCODED_SECRET_OPTIONS,
  givenInputFormat,
  textInput,
  transformMode,
} from "./input.js";
import {
  backupAndDatesFromOptions,
  comparedPassphrase,
  decodeWithQuestions,
  showRecovered,
  type AfterDecoded,
} from "./decode-command.js";
import { prepareEncode } from "./encode-command.js";
import type { PreparedEncode } from "./encode-types.js";
import { askEncoding } from "./encode-questions.js";
import { forgetClaimedOutputs } from "./output-questions.js";
import { reportChecksumAndFingerprint } from "./fingerprint-report.js";
import { settleOutputPaths } from "./output-paths.js";
import { clearPrivateScreen, showProtection } from "./private-screen.js";
import { PrivateSteps } from "./private-steps.js";
import { dropUnneededAfterAnswers } from "./protection.js";
import {
  asksNewBackup,
  LAST_WORD_OPTION,
  OLD_BACKUP_OPTIONS,
  RECOGNISED_OPTION,
} from "./re-encode-options.js";
import { readmeLink, terminalNotice, terminalPart, type NoticeKind } from "./terminal.js";
import { waitForEnter, type Choice, type Explanation } from "./terminal-choice.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.re-encode-command", {
  refused: (value0: string, value1: string) => `${value0}${value1}`,
  "recognised-wallet-option-two-ways-confirm-seed-phrase": () =>
    "--recognised and a wallet option are two ways to confirm the seed phrase: give one.",
  "say-how-seed-phrase-old-backup-confirmed-since": () =>
    "Say how the seed phrase of the old backup is confirmed, since its checksum confirms nothing: a wallet option, such as --master-fingerprint or --bitcoin-address, or --recognised if you check it yourself.",
  "nothing-was-re-encoded": () => "Nothing was re-encoded.",
});

/** The options of the old backup by Decode's names, and those of the new one by Encode's. */
interface SplitOptions {
  readonly old: ParsedArguments;
  readonly fresh: ParsedArguments;
}

/**
 * Sorts `args` into the old backup's options and the new one's; --ask-secrets goes to both, and
 * --recognised, which answers the confirmation, to neither.
 */
export function splitOptions(args: ParsedArguments): SplitOptions {
  // Without a prototype, as parseArguments makes them (AUD-014-API010). An object without keys is
  // a ParsedArguments, which Object.create cannot type.
  const old = Object.create(null) as ParsedArguments;
  const fresh = Object.create(null) as ParsedArguments;
  for (const [key, entry] of Object.entries(args)) {
    if (key === RECOGNISED_OPTION) continue;
    if (key === "ask-secrets") {
      old[key] = entry;
      fresh[key] = entry;
    } else if (Object.hasOwn(OLD_BACKUP_OPTIONS, key))
      old[defined(OLD_BACKUP_OPTIONS[key])] = entry;
    else fresh[key] = entry;
  }
  return { old, fresh };
}

/** What a refusal of an option of the old backup begins with. */
export const OLD_BACKUP_REFUSAL = "The old backup: ";

/**
 * Runs `read`, which reads or checks the old backup from its options, and names the old backup in
 * a refusal it raises, keeping the refusal as its cause: the old backup's options are Decode's
 * under other names, and the new backup's, Encode's, are refused in the same words (--old-dates
 * and --dates, --old-mode and --mode). Faults that are no Error pass through.
 */
async function ofOldBackup<T>(read: () => T | Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw ERRORS.create("refused", [`${OLD_BACKUP_REFUSAL}`, `${error.message}`], { cause: error });
  }
}

/** How the phrase is confirmed, where the options say it: by the person, or by the wallet. */
type GivenConfirmation = "recognised" | "wallet" | undefined;

/**
 * How the options confirm the phrase, checked before any secret is read: --recognised or a wallet
 * option, not both; on the command line one of them is needed, since the checksum confirms
 * nothing. With --ask-secrets, without either, the screen asks.
 */
function givenConfirmation(args: ParsedArguments, given: GivenWallet): GivenConfirmation {
  const recognised = args[RECOGNISED_OPTION] === true;
  if (recognised && given.evidence !== undefined)
    throw ERRORS.create("recognised-wallet-option-two-ways-confirm-seed-phrase", []);
  if (recognised) return "recognised";
  if (given.evidence !== undefined) return "wallet";
  if (args["ask-secrets"] !== true)
    throw ERRORS.create("say-how-seed-phrase-old-backup-confirmed-since", []);
  return undefined;
}

/** A line that says how the phrase was confirmed, as terminalNotice writes it. */
interface Notice {
  readonly text: string;
  readonly kind: NoticeKind;
}

/**
 * How the phrase was confirmed: the warning of the wallet's check, if it gave one, such as that a
 * fingerprint is only a filter, then the confirmation. They are shown under the phrase, and again
 * at the top of each screen of the new backup.
 */
type Notices = readonly Notice[];

/**
 * The phrase of the old backup, confirmed, the notices that say how, and what makes the new backup
 * of it.
 */
interface Confirmed {
  readonly reEncoding: ReEncoding;
  readonly notices: Notices;
  readonly encode: PreparedEncode;
}

/** The notice of a phrase that the person recognised. */
const RECOGNISED: Notices = [{ text: RE_ENCODING_WORDS.recognised, kind: "success" }];

/**
 * The phrase of the old backup, shown for the person to confirm it: on the terminal only, never
 * on standard output, which carries the new backup, so that a redirected run saves no plaintext
 * beside it (AUD-022-SEC001). Where standard error is no terminal, only its fingerprint.
 */
function showOldPhrase(result: DecodedResult, mode: MaskingMode, format: EncodedFormat): void {
  if (process.stderr.isTTY === true) showRecovered(result, mode, format, "stderr");
  else showOldFingerprint(result);
}

/** The old backup's checksum and fingerprint, on standard error, without the phrase. */
function showOldFingerprint(result: DecodedResult): void {
  reportChecksumAndFingerprint(result.recoveredMnemonic, result.checksumValid);
}

function showNotices(notices: Notices): void {
  for (const { text, kind } of notices) terminalNotice(text, kind);
}

/**
 * A screen of the new backup: the phrase of the old one leaves the private screen, and the notices
 * of its confirmation stay under the title of each step screen, above a warning about the question
 * asked. Without a private screen nothing is cleared, and the notices were shown already.
 */
function newBackupScreen(notices: Notices): void {
  if (!clearPrivateScreen()) return;
  PrivateSteps.keep(() => {
    terminalPart("New backup", true, "stderr");
    showNotices(notices);
  }, "page");
}

/** Makes a new backup of an old one's phrase; CANCELLED when the person cancelled or stopped. */
export async function runReEncode(args: ParsedArguments): Promise<Cancelled | undefined> {
  // The secrets of both backups are asked on the private screen; none may be given beside it.
  assertAskedNotGiven(args, [
    ...ENCODED_SECRET_OPTIONS,
    OLD_DATES_KEY,
    "old-dates-file",
    LAST_WORD_OPTION,
    "last-word-file",
    DATES_OPTION,
    "dates-file",
  ]);
  const { old, fresh } = splitOptions(args);
  // The new backup's options, its destinations and cards, are checked before any question; without
  // them it is asked once the phrase is confirmed.
  const encode = asksNewBackup(args) ? undefined : await prepareEncode(fresh);
  const given = givenWallet(old);
  const confirmedBy = givenConfirmation(args, given);
  const confirmed =
    args["ask-secrets"] === true
      ? await askedReEncoding(old, given, confirmedBy, encode)
      : await confirmedFromOptions(old, given, defined(encode));
  if (confirmed === CANCELLED) return CANCELLED;
  using reEncoding = confirmed.reEncoding;
  newBackupScreen(confirmed.notices);
  // The rights that the answers do not need were given up after the questions: what holds now.
  if (encode === undefined) showProtection();
  if ((await confirmed.encode(reEncoding.confirmedPhrase())) === CANCELLED) return CANCELLED;
  terminalNotice(RE_ENCODING_WORDS.oldBackupStillOpens, "warning");
  return undefined;
}

/**
 * The old backup from the options, decoded, its fingerprint shown but never its phrase, and
 * confirmed by the wallet that an option gives, or by --recognised (givenConfirmation). A wallet
 * that does not match ends the command. CANCELLED when the person left the question about the
 * form of the codes (backupFromOptions).
 */
async function reEncodingFromOptions(
  old: ParsedArguments,
  given: GivenWallet,
): Promise<{ readonly reEncoding: ReEncoding; readonly notices: Notices } | Cancelled> {
  const reEncoding = await ofOldBackup(async () => {
    const read = await backupAndDatesFromOptions(old);
    if (read === CANCELLED) return CANCELLED;
    using backup = read.backup;
    const lastWord =
      value(old, "last-word-file") === undefined
        ? value(old, LAST_WORD_OPTION)
        : textInput(old, "last-word").trim();
    return ReEncoding.of(backup, read.dates, lastWord);
  });
  if (reEncoding === CANCELLED) return CANCELLED;
  try {
    showOldFingerprint(reEncoding.result);
    if (given.evidence === undefined) {
      reEncoding.confirmByPerson();
      return { reEncoding, notices: RECOGNISED };
    }
    const notices = await walletConfirms(reEncoding, given.evidence, given.passphrase);
    if (notices === undefined) throw ERRORS.create("nothing-was-re-encoded", []);
    return { reEncoding, notices };
  } catch (error) {
    reEncoding.wipe();
    throw error;
  }
}

/** The old backup confirmed from the options (reEncodingFromOptions), made new by `encode`. */
async function confirmedFromOptions(
  old: ParsedArguments,
  given: GivenWallet,
  encode: PreparedEncode,
): Promise<Confirmed | Cancelled> {
  const confirmed = await reEncodingFromOptions(old, given);
  return confirmed === CANCELLED ? CANCELLED : { ...confirmed, encode };
}

/** The choice that ends re-encode before the new backup, beside typing again. */
const STOP: Choice<"done"> = { label: "Stop", note: "nothing is re-encoded", value: "done" };

/**
 * The old backup asked on the private screen with Decode's questions, every code and date
 * complete, and for a backup that gives several phrases the last word of the original one; its
 * phrase is confirmed below it (confirmation), and then the new backup asked where no option gives
 * it (`encode`). Stop cancels (CANCELLED), as Ctrl+C does.
 */
async function askedReEncoding(
  old: ParsedArguments,
  given: GivenWallet,
  confirmedBy: GivenConfirmation,
  encode: PreparedEncode | undefined,
): Promise<Confirmed | Cancelled> {
  // Decode checks these before its first question too, in its own words.
  await ofOldBackup(() => {
    transformMode(old);
    givenInputFormat(old);
  });
  let confirmed: Confirmed | undefined;
  /**
   * Confirms the phrase, then takes the new backup; Escape at its first question goes back. A new
   * backup that Encode refuses is asked again, with the reason (AUD-022-UI001).
   */
  const confirmAndAsk = async (
    reEncoding: ReEncoding,
    backup: EncodedBackup,
  ): Promise<AfterDecoded | Cancelled> => {
    let handedOut = false;
    try {
      for (;;) {
        const next = await confirmation(reEncoding, backup, old, given, confirmedBy);
        if (next === CANCELLED || typeof next === "string") return next;
        const chosen = encode ?? (await newBackupAskedUntilTaken(next.notices));
        if (chosen === CANCELLED) return CANCELLED;
        if (chosen !== undefined) {
          confirmed = { reEncoding, notices: next.notices, encode: chosen };
          handedOut = true;
          return "done";
        }
        clearPrivateScreen();
        showOldPhrase(reEncoding.result, backup.mode, backup.format);
      }
    } finally {
      if (!handedOut) reEncoding.wipe();
    }
  };
  const decoded = await decodeWithQuestions(old, {
    searches: false,
    stop: STOP,
    async several(backup, dates) {
      const reEncoding = await askLastWord(backup, dates, old);
      if (reEncoding === CANCELLED || typeof reEncoding === "string") return reEncoding;
      try {
        clearPrivateScreen();
        showOldPhrase(reEncoding.result, backup.mode, backup.format);
        return await confirmAndAsk(reEncoding, backup);
      } catch (error) {
        reEncoding.wipe();
        throw error;
      }
    },
    decoded: (backup, dates) => confirmAndAsk(ReEncoding.of(backup, dates), backup),
    show: showOldPhrase,
  });
  // Stop, before the phrase was confirmed or a new backup was given, cancels as Ctrl+C does.
  return decoded === CANCELLED ? CANCELLED : (confirmed ?? CANCELLED);
}

/** What is typed again after a last word that no phrase of the backup ends with, or Stop. */
type AfterLastWord = "word" | AfterDecoded;

/**
 * The last word of the original seed phrase, for a backup of the Original Seedshift with a valid
 * last word, which keeps nothing of it, picking the phrase of the backup that ends with it. Where
 * none does, the word may be mistyped, or a wrong date gave other phrases: the person chooses what
 * to type again, or stops (Escape too); the dates and the codes are given back to Decode's
 * questions, which keep the other answers. CANCELLED when the person cancelled.
 */
async function askLastWord(
  backup: EncodedBackup,
  dates: readonly DateShiftDate[],
  old: ParsedArguments,
): Promise<ReEncoding | AfterDecoded | Cancelled> {
  for (;;) {
    const reEncoding = await askSecretUntil(
      "Last word of the original seed phrase:",
      (answer) => phraseEndingWith(backup, dates, answer),
      { what: "the last word of the original seed phrase", hints: WordList.BIP39 },
    );
    if (reEncoding === CANCELLED) return CANCELLED;
    if (reEncoding !== undefined) return reEncoding;
    terminalNotice(NO_SUCH_LAST_WORD, "warning");
    const next = await askAfterFailure<AfterLastWord>(WHAT_NOW, [
      { label: "Type the last word again", value: "word" },
      // Only the Original Seedshift gives several phrases, and only with its dates.
      datesAgainChoice(),
      backupChoice(old),
      STOP,
    ]);
    if (next !== "word") return next;
  }
}

/**
 * The phrase of `backup` and its `dates` that ends with `lastWord` (ReEncoding.of); undefined
 * where none does, since the dates may be what is wrong (askLastWord). Any other refusal is
 * thrown, for the question to ask again with it.
 */
function phraseEndingWith(
  backup: EncodedBackup,
  dates: readonly DateShiftDate[],
  lastWord: string,
): ReEncoding | undefined {
  try {
    return ReEncoding.of(backup, dates, lastWord);
  } catch (error) {
    if (error instanceof Error && error.message === NO_SUCH_LAST_WORD) return undefined;
    throw error;
  }
}

/**
 * The new backup, asked until Encode takes it (askedNewBackup): a refusal, such as text that does
 * not fit the cards, is shown at the top of the questions asked again; undefined at Escape,
 * CANCELLED at Ctrl+C.
 */
async function newBackupAskedUntilTaken(
  notices: Notices,
): Promise<PreparedEncode | undefined | Cancelled> {
  let refusal: string | undefined;
  for (;;) {
    try {
      return await askedNewBackup(notices, refusal);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      refusal = error.message;
    }
  }
}

/**
 * The new backup asked with Encode's questions on a screen of its own, under the `notices` of the
 * confirmation and the `refusal` of the answers before, if any, each answer checked at once;
 * undefined at Escape at the first of them. The names of the files are settled as the command
 * line settles them, and every option checked as Encode checks it (prepareEncode); only then are
 * the rights of the permission model that the answers do not need given up, so that answers
 * asked again after a refusal still have every right they may need.
 */
async function askedNewBackup(
  notices: Notices,
  refusal: string | undefined,
): Promise<PreparedEncode | undefined | Cancelled> {
  newBackupScreen(notices);
  if (refusal !== undefined) terminalNotice(refusal, "warning");
  forgetClaimedOutputs();
  // Encode's command line: its name, then the options.
  const encoding = await askEncoding();
  if (encoding === undefined || encoding === CANCELLED) return encoding;
  const fresh = parseArguments(encoding.slice(1));
  await settleOutputPaths(fresh);
  const prepared = await prepareEncode(fresh);
  dropUnneededAfterAnswers(fresh);
  // Only answers that are taken name files that will be saved: a refused one warns of none. The
  // warning is given when the new backup is made, on the screen of its result.
  return async (known) => {
    warnOfCloudCopies(fresh);
    return prepared(known);
  };
}

/** The question below the phrase shown, and why it is asked. */
const CONFIRM_QUESTION = "Is this the seed phrase to re-encode?";
const CONFIRM_EXPLANATION: Explanation = {
  lines: ["A valid checksum proves nothing: with MnemoCode Seedshift every date gives one."],
  more: [readmeLink("re-encoding-a-backup")],
};

/** How the person confirms the phrase, or what they type again. */
type Way = "person" | "wallet" | "dates" | "backup";

/** A phrase confirmed, with the notices that say how, or what is typed again. */
type Confirmation = { readonly notices: Notices } | Exclude<AfterDecoded, "done">;

/**
 * Confirms the phrase of `reEncoding`, shown above: as the options say (`confirmed`), --recognised
 * once the person has read it and pressed Enter, a wallet option at once; otherwise, or when that
 * wallet does not match, as the person chooses: by recognising it, or by an address or fingerprint
 * compared with the wallet, which may be tried again. They may also type the dates or the backup
 * again. CANCELLED when the person cancelled, or stopped with Escape after --recognised.
 */
async function confirmation(
  reEncoding: ReEncoding,
  backup: EncodedBackup,
  old: ParsedArguments,
  given: GivenWallet,
  confirmed: GivenConfirmation,
): Promise<Confirmation | Cancelled> {
  if (confirmed === "recognised") {
    if ((await waitForEnter("Press Enter to make the new backup (Esc stops).")) !== "enter")
      return CANCELLED;
    reEncoding.confirmByPerson();
    return { notices: RECOGNISED };
  }
  if (confirmed === "wallet") {
    const notices = await walletConfirms(reEncoding, defined(given.evidence), given.passphrase);
    if (notices !== undefined) return { notices };
  }
  const ways: Choice<Way>[] = [
    {
      label: "Yes, I recognise it",
      note: "the phrase or its fingerprint above",
      value: "person",
    },
    {
      label: "Check it against the wallet",
      note: "an address or the fingerprint",
      value: "wallet",
    },
    ...(Masking.of(backup.mode).masked ? [datesAgainChoice()] : []),
    backupChoice(old),
  ];
  for (;;) {
    const way = await askOrCancel(CONFIRM_QUESTION, ways, {
      label: "Confirm",
      explanation: CONFIRM_EXPLANATION,
    });
    if (way === CANCELLED) return CANCELLED;
    if (way === "person") {
      reEncoding.confirmByPerson();
      return { notices: RECOGNISED };
    }
    if (way !== "wallet") return way;
    const answer = await askWalletEvidence({
      optional: false,
      place: given.place,
      explanation: { lines: [comparedPassphrase("Re-encode", given.passphrase)] },
    });
    if (answer === CANCELLED) return CANCELLED;
    if (answer.kind !== "wallet") continue;
    const notices = await walletConfirms(reEncoding, answer.evidence, given.passphrase);
    if (notices !== undefined) return { notices };
  }
}

/**
 * Compares the phrase with `evidence` and the wallet's BIP39 `passphrase`, and says whether it
 * matched: a match confirms it, and its notices are shown and given back: the check's own warning
 * first, which the library gives with a fingerprint (AUD-020-SEC001), then the library's line. A
 * fingerprint's match is no proof where a search tries many phrases; here it is one phrase, which
 * a wrong one matches once in four billion times, so it is accepted, with that warning.
 */
async function walletConfirms(
  reEncoding: ReEncoding,
  evidence: WalletEvidence,
  passphrase: string,
): Promise<Notices | undefined> {
  const match = await reEncoding.confirmByWallet((mnemonic) =>
    matchWalletEvidence(mnemonic, evidence, passphrase),
  );
  if (!match.matched) {
    terminalNotice(RE_ENCODING_WORDS.notMatched, "warning");
    return undefined;
  }
  const notices: Notices = [
    ...(match.warning === undefined ? [] : [{ text: match.warning, kind: "warning" as const }]),
    { text: reEncoding.confirmationLine(EVIDENCE_MATCHED_BY[evidence.kind]), kind: "success" },
  ];
  showNotices(notices);
  return notices;
}
