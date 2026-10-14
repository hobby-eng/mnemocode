// The menu that MnemoCode shows when it starts without arguments at a terminal, as from a
// double-click; the same idea as the menu of `mhfe` (src/bin/mhfe/menu.rs). An entry asks its
// questions as lists chosen with the arrow keys, builds the command line that does the same, shows
// it in grey and runs it exactly as if it had been typed after `mnemocode`, so that the person can
// type it later. A secret is never part of that command line: the command asks for it on its
// private screen (--ask-secrets, private-screen.ts), and what is typed before that screen shows is
// not echoed on the main one (withEchoOff).
//
// The menu checks each of its own answers at once, none of which is a secret: a file name, a
// fingerprint, an address, a key or a lookup that the command would refuse is explained in one
// line and asked again, with the earlier answers kept (askLine). Nothing is read from the files,
// and the menu writes nothing (dropForMenu); the command checks everything again, since a file
// may change in between.

import type { SplitMode } from "../core/masking.js";
import { UNICODE_CODE_HINT, wordTableRow } from "../core/words.js";
import { parseRecipient } from "../core/candidate-encryption.js";
import { askWalletEvidence, type WalletValueAsker } from "./ask.js";
import { MAX_TEXT_INPUT_BYTES } from "./bounded-read.js";
import { MAX_PNG_BYTES } from "../core/png-admission.js";
import { BIP39_WORD_COUNTS, WORD_NUMBERS, type Bip39WordCount } from "../core/bip39-sizes.js";
import {
  SEEDSHIFT_CHOICES,
  ENCODED_SEEDSHIFT_QUESTION,
  SHARE_SEEDSHIFT_CHOICES,
  SHARE_SEEDSHIFT_QUESTION,
  WHICH_SEEDSHIFT_QUESTION,
  ENCODED_SEEDSHIFT_CHOICES,
} from "./seedshift-choices.js";
import {
  MENU_ENTRY_NAMES,
  PHRASE_WORDS_QUESTION,
  phraseWordsAnswer,
  TYPED_SOURCE,
} from "./menu-entries.js";
import { PRIVATE_SCREEN_COMMANDS } from "./command-line.js";
import { CANCELLED_EXIT_CODE, privateScreenAvailable } from "./private-screen.js";
import { assertProtected, dropForMenu } from "./protection.js";
import { assertCoreSelfTest } from "./self-test.js";
import {
  answerMark,
  askLine,
  choose,
  eraseAnswersSince,
  notesRoom,
  startRecord,
  waitForEnter,
  type Explanation,
} from "./terminal-choice.js";
import { terminalAvailable } from "./terminal-input.js";
import {
  readmeLink,
  STYLE,
  terminalFailure,
  terminalMore,
  terminalNotice,
  terminalPaint,
} from "./terminal.js";
import { printUsage } from "./usage.js";
import { REPAIR_ANCHOR } from "../sskr/repair-report.js";
import { walletNeeded } from "../core/date-search.js";
import { walletExplanation } from "./date-search.js";
import { WordList, type WordHints } from "../core/word-hints.js";
import { commandDisplay, typedCommand } from "./shell-command.js";
import { runCommand } from "./menu-runner.js";
import { walletEvidenceArguments } from "./bitcoin-options.js";
import { headingLine } from "./terminal-style.js";
import { describeError } from "../core/refusal.js";
import { SAMPLE_FILE_BASE } from "../export/card-preview.js";

import {
  QR_FILE,
  RECORD_FILE,
  SEEDSHIFT_EXPLANATION,
  VARIANT_EXPLANATION,
  askDesign,
  askEncoding,
  askHeirSheet,
  askOutputFile,
  askSeedshift,
  askShareSet,
  askShares,
  example,
  forgetClaimedOutputs,
  inputFile,
  sampleOf,
  type Mode,
} from "./encode-questions.js";
import { defined } from "../core/defined.js";

/** The menu reads keys from a terminal and draws on one; anything else gets the help instead. */
export function menuAvailable(): boolean {
  return terminalAvailable();
}

/**
 * What an entry does once its questions are answered; undefined means that the person went back.
 */
type Action = { readonly run: readonly string[] } | "help" | "quit" | undefined;

/** What standard shares are, shown with the question how many to make in entry 4. */
const STANDARD_SHARES_EXPLANATION: Explanation = {
  lines: ["Standard SSKR shares of the seed phrase itself, which other SSKR tools read."],
  more: [readmeLink("splitting-a-mnemonic-into-shares")],
};

/** `action` with no file of an earlier entry claimed. */
function askedAfresh(action: () => Promise<Action>): () => Promise<Action> {
  return () => {
    forgetClaimedOutputs();
    return action();
  };
}

/**
 * Entry 1: the seed phrase in another form, masked with Seedshift and split into Shamir shares if
 * wanted.
 */
async function encodeAction(): Promise<Action> {
  const run = await askEncoding();
  return run === undefined ? undefined : { run };
}

/**
 * Entry 2, a backup made before encoded again (owner, 2026-10-13): where it is and how it was
 * masked, as Decode asks it. Re-encode asks the rest on its private screen: the codes, at once
 * their dates, then the phrase to confirm, and only then the new backup, with Encode's questions.
 */
async function reEncodeAction(): Promise<Action> {
  const old = await askBackupSource("--old-mode");
  return old === undefined ? undefined : { run: ["re-encode", "--ask-secrets", ...old] };
}

/**
 * How many words the seed phrase has, for codes typed from printed cards, which end with codes
 * that belong to nothing (--words): null where all the codes typed are read, undefined for back.
 */
function askPhraseWords(): Promise<Bip39WordCount | null | undefined> {
  return choose<Bip39WordCount | null>(
    PHRASE_WORDS_QUESTION,
    [
      { label: "All the codes I type", note: "from paper or a record", value: null },
      ...BIP39_WORD_COUNTS.map((words) => ({
        label: phraseWordsAnswer(words),
        note: "from printed cards",
        value: words,
      })),
    ],
    { label: "Words" },
  );
}

/** What stands between the two samples beside the answer that types the codes (askSource). */
const SAMPLES_APART = " · ";

/**
 * Where an encoded seed phrase is read from: typed on the private screen, with how many words the
 * phrase has, or a file encode saved.
 */
async function askSource(): Promise<{ readonly options: string[] } | undefined> {
  const files = [
    { label: "In a record file", note: "the text file that Encode saved", value: "record" },
    { label: "In a QR code image", note: "the PNG file that Encode saved", value: "qr" },
  ] as const;
  const typed = { label: TYPED_SOURCE, note: "numbers, codes, colors or a record", value: "typed" };
  // Two samples share the room beside the labels, with what stands between them.
  const room = Math.floor((notesRoom([typed, ...files]) - SAMPLES_APART.length) / 2);
  const samples = [example("indexes"), example("colors")].map((text) => sampleOf(text, room));
  const source = await choose(
    "Where is the encoded seed phrase?",
    [{ ...typed, example: samples.join(SAMPLES_APART) }, ...files] as const,
    { label: "Source" },
  );
  if (source === undefined) return undefined;
  if (source === "typed") {
    const words = await askPhraseWords();
    if (words === undefined) return undefined;
    return { options: words === null ? [] : ["--words", String(words)] };
  }
  const path =
    source === "record"
      ? await askLine("Record file name", "File", {
          fallback: RECORD_FILE,
          check: (answer) => inputFile(answer, MAX_TEXT_INPUT_BYTES),
        })
      : await askLine("QR code file name", "File", {
          fallback: QR_FILE,
          check: (answer) => inputFile(answer, MAX_PNG_BYTES),
        });
  if (path === undefined) return undefined;
  return { options: [source === "record" ? "--input-file" : "--qr-file", path] };
}

/** Entry 3: an encoded seed phrase turned back into the words. */
async function decodeAction(): Promise<Action> {
  const source = await askBackupSource("--mode");
  return source === undefined ? undefined : { run: ["decode", "--ask-secrets", ...source] };
}

/**
 * Where an encoded backup is and how it was masked, as options with its mode under `modeFlag`
 * (Decode's --mode, re-encode's --old-mode); undefined for back. A record file names its mode; a QR
 * code or typed codes do not, unless a whole record is typed. Every answer gives the mode, No too:
 * the command asks itself for codes that name no mode, and a typed record that names another mode
 * is questioned there, before any date is asked.
 */
async function askBackupSource(modeFlag: string): Promise<string[] | undefined> {
  const source = await askSource();
  if (source === undefined) return undefined;
  if (source.options[0] === "--input-file") return source.options;
  const mode = await askEncodedMode();
  return mode === undefined ? undefined : [...source.options, modeFlag, mode];
}

/**
 * Which Seedshift masked the codes, for decode, which reads typed codes. The menu says what
 * follows rather than what each variant does: the variants are told apart where the codes are
 * read (decode), and the explanation here says what Seedshift is.
 */
function askEncodedMode(): Promise<Mode | undefined> {
  return choose(
    ENCODED_SEEDSHIFT_QUESTION,
    ENCODED_SEEDSHIFT_CHOICES.map((choice) =>
      choice.value === "direct" ? choice : { ...choice, note: "the dates are asked next" },
    ),
    { label: "Seedshift", explanation: SEEDSHIFT_EXPLANATION },
  );
}

/**
 * Entry 6, codes of an encoded seed phrase that cannot be read: typed with ? at their places, as
 * Decode reads them, which searches the codes the marks leave open (owner, 2026-10-13).
 */
async function markedCodesAction(): Promise<Action> {
  const words = await askPhraseWords();
  if (words === undefined) return undefined;
  const mode = await askEncodedMode();
  if (mode === undefined) return undefined;
  return {
    run: [
      "decode",
      "--ask-secrets",
      ...(words === null ? [] : ["--words", String(words)]),
      "--mode",
      mode,
    ],
  };
}

/**
 * Entry 4: standard Shamir shares of the seed phrase itself, in Bytewords or as a short code, as
 * other SSKR tools write and read them; restoring them gives the seed phrase in words.
 */
async function splitAction(): Promise<Action> {
  const mode = await askSeedshift("Use Seedshift before splitting?", { shares: true });
  if (mode === undefined) return undefined;
  const set = await askShareSet(
    "How many shares, and how many of them restore the seed phrase?",
    STANDARD_SHARES_EXPLANATION,
    false,
  );
  if (set === undefined || set === null) return undefined;
  const shareFormat = await choose(
    "How should each share be written?",
    [
      { label: "Words", note: "Bytewords, such as tuna next keep gyro ...", value: "words" },
      { label: "Short code", note: "ur:sskr/..., the standard short form", value: "ur" },
    ] as const,
    { label: "Shares as" },
  );
  if (shareFormat === undefined) return undefined;
  const shares = await askShares(set, shareFormat);
  if (shares === undefined) return undefined;
  const heirs = await askHeirSheet(mode);
  if (heirs === undefined) return undefined;
  return { run: ["encode", "--sskr", "--ask-secrets", "--mode", mode, ...shares, ...heirs] };
}

/**
 * Whether the phrase of shares was masked before it was split, as the sheet for heirs and the
 * commands of shares ask it; undefined means back. Entries 5 and 6 ask it so.
 */
function askSharesMasked(): Promise<SplitMode | undefined> {
  return choose(SHARE_SEEDSHIFT_QUESTION, SHARE_SEEDSHIFT_CHOICES, {
    label: "Seedshift",
    explanation: SEEDSHIFT_EXPLANATION,
  });
}

/** Entry 5: the seed phrase rebuilt from typed Shamir shares. */
async function restoreAction(): Promise<Action> {
  const mode = await askSharesMasked();
  if (mode === undefined) return undefined;
  return {
    run: ["sskr-combine", "--ask-secrets", ...(mode === "seedshift" ? ["--mode", mode] : [])],
  };
}

/** Entry 6: a forgotten word, a forgotten digit of a date, or an unreadable code of a share. */
async function recoverAction(): Promise<Action> {
  const forgotten = await choose(
    "What is forgotten?",
    [
      { label: "A word of the seed phrase", note: "or several, or a missing one", value: "word" },
      {
        label: "A code of the encoded seed phrase",
        note: "typed with ? for each unread code",
        value: "code",
      },
      {
        label: "A digit of a date",
        note: "for a phrase masked with Seedshift",
        value: "date",
      },
      {
        label: "A code of a Shamir share",
        note: "the share with ? for each unread code",
        value: "share",
      },
    ] as const,
    { label: "Forgotten" },
  );
  if (forgotten === undefined) return undefined;
  if (forgotten === "word") return wordRecoveryAction();
  if (forgotten === "code") return markedCodesAction();
  // The shares come back whole, in their own form, without the seed phrase being shown.
  if (forgotten === "share") return shareRepairAction();
  const source = await askSource();
  if (source === undefined) return undefined;
  // A record file names its mode; otherwise the person says which Seedshift was used.
  const mode =
    source.options[0] === "--input-file"
      ? undefined
      : await choose(WHICH_SEEDSHIFT_QUESTION, SEEDSHIFT_CHOICES, {
          label: "Seedshift",
          explanation: VARIANT_EXPLANATION,
        });
  if (mode === undefined && source.options[0] !== "--input-file") return undefined;
  // Every date gives MnemoCode Seedshift a valid phrase, so only the wallet can tell the right one;
  // the original Seedshift's checksum sorts out most dates by itself. A record file names its own
  // mode, and recover-date asks for the wallet after reading it only when that mode needs one.
  const wallet = await askWallet(mode !== undefined && walletNeeded(mode), walletExplanation(mode));
  if (wallet === undefined) return undefined;
  return {
    run: [
      "recover-date",
      "--ask-secrets",
      ...source.options,
      ...(mode === undefined ? [] : ["--mode", mode]),
      ...wallet,
    ],
  };
}

/** Why the wallet is asked for before shares are repaired. */
const SHARE_WALLET_EXPLANATION: Explanation = {
  lines: ["Shares with many ? may fit in several ways; the wallet tells the right one."],
  more: [readmeLink(REPAIR_ANCHOR)],
};

/**
 * Entry 6, forgotten words: at their places with ?, or one missing word whose place is not known;
 * on request every candidate also goes to a list for the Discovery Scanner.
 */
async function wordRecoveryAction(): Promise<Action> {
  const where = await choose(
    "Do you know where the forgotten words were?",
    [
      { label: "Yes", note: "type ? at each place, or ab* if it began with ab", value: "places" },
      { label: "No", note: "one word is missing; type the words you have", value: "missing" },
    ] as const,
    { label: "Places" },
  );
  if (where === undefined) return undefined;
  const search = [
    "recover-word",
    "--ask-secrets",
    ...(where === "missing" ? ["--missing-word"] : []),
  ];
  const save = await choose(
    "Save the candidates for the Discovery Scanner?",
    [
      { label: "No", value: false },
      { label: "Yes", note: "an encrypted list that the Scanner checks online", value: true },
    ],
    { label: "List", explanation: CANDIDATES_EXPLANATION },
  );
  if (save === undefined) return undefined;
  if (!save) return { run: search };
  const path = await askOutputFile("File name", "candidates.age");
  if (path === undefined) return undefined;
  const protection = await choose(
    "How should the list be encrypted?",
    [
      { label: "The Scanner's key", note: "paste the age1 key the Scanner shows", value: "key" },
      {
        label: "A passphrase",
        note: "asked next; for a list made in advance",
        value: "passphrase",
      },
    ] as const,
    { label: "Protect" },
  );
  if (protection === undefined) return undefined;
  const key =
    protection === "key"
      ? await askLine("Scanner key", "Key", {
          what: "the age1 key that the Scanner shows",
          check: parseRecipient,
        })
      : "";
  if (key === undefined) return undefined;
  return {
    run: [...search, "--candidates-file", path, ...(key === "" ? [] : ["--candidates-key", key])],
  };
}

/** Why candidates are saved, shown with the question. */
const CANDIDATES_EXPLANATION: Explanation = {
  lines: ["Without the wallet's fingerprint, only a search for funds tells them apart."],
  more: [readmeLink("forgotten-word-recovery")],
};

/**
 * Entry 6, a code of a share: the wallet, if it can be told, picks among sets of shares that fit.
 * For a phrase masked before splitting, the wallet is checked after the dates.
 */
async function shareRepairAction(): Promise<Action> {
  const wallet = await askWallet(false, SHARE_WALLET_EXPLANATION);
  if (wallet === undefined) return undefined;
  if (wallet.length === 0) return { run: ["sskr-export", "--ask-secrets"] };
  const mode = await askSharesMasked();
  if (mode === undefined) return undefined;
  return {
    run: [
      "sskr-export",
      "--ask-secrets",
      ...(mode === "direct" ? [] : ["--mode", mode]),
      ...wallet,
    ],
  };
}

/**
 * What tells the right phrase among the candidates: the BIP32 master fingerprint, the same for
 * every coin of the wallet and shown by Encode, or one of the first receiving addresses of the
 * wallet, of Bitcoin or another coin, followed by among how many of them it is (Enter: 20). Each
 * is checked at once, as core/wallet-evidence.ts checks it, and becomes the command's options.
 * Without it (`required` false) every candidate is listed.
 */
async function askWallet(
  required: boolean,
  explanation: Explanation,
): Promise<string[] | undefined> {
  const answer = await askWalletEvidence({ optional: !required, explanation }, MENU_ASKER);
  if (answer.kind === "back") return undefined;
  if (answer.kind === "none") return [];
  return walletEvidenceArguments(answer.evidence);
}

/**
 * The menu's way of asking the values of the wallet question (askWalletEvidence): each on a line
 * of its own, recorded as typed, and going back leaves the entry.
 */
const MENU_ASKER: WalletValueAsker = {
  async ask(value, parse) {
    let parsed: ReturnType<typeof parse> | undefined;
    const answer = await askLine(value.prompt, value.label, {
      what: value.what,
      ...(value.fallback === undefined ? {} : { fallback: value.fallback }),
      check: (text) => {
        parsed = parse(text);
        return text;
      },
    });
    return answer === undefined ? undefined : parsed;
  },
  backLeaves: true,
};

/** Entry 7: card designs drawn with the public test phrase. */
async function previewAction(): Promise<Action> {
  const design = await askDesign(true);
  if (design === undefined) return undefined;
  const path = await askOutputFile("PDF file name", `${SAMPLE_FILE_BASE}.pdf`);
  if (path === undefined) return undefined;
  return {
    run: ["preview", ...(design === "" ? ["--all"] : ["--template", design]), "--pdf", path],
  };
}

/** A lookup of the word table: its question, and its answer checked as the table looks it up. */
interface Lookup {
  readonly question: string;
  /** Its line in the record of answers, which must fit ANSWER_LABEL_WIDTH. */
  readonly label: string;
  readonly what: string;
  readonly check: (answer: string) => string;
  /** The hints below the answer being typed, for a word. */
  readonly hints?: WordHints;
}

const LOOKUPS: Readonly<Record<"word" | "index" | "unicode", Lookup>> = {
  word: {
    question: "Word",
    label: "Word",
    what: "a word of the English BIP39 list",
    // Given as the table writes it, in lower case.
    check: (answer) => wordTableRow("word", answer).english,
    hints: WordList.BIP39,
  },
  index: {
    question: "Word number",
    label: "Number",
    what: `a number from ${WORD_NUMBERS}`,
    // Written as the command line takes it, without leading zeros.
    check: (answer) => String(wordTableRow("index", answer).index),
  },
  unicode: {
    question: "Unicode code",
    label: "Code",
    what: UNICODE_CODE_HINT,
    check: (answer) => wordTableRow("unicode", answer).unicodeHex,
  },
};

/** Entry 8: one row of the word table, or all of it. */
async function tableAction(): Promise<Action> {
  const lookup = await choose(
    "What do you want to look up?",
    [
      { label: "A word", note: "such as abandon", value: "word" },
      {
        label: "A word number",
        note: WORD_NUMBERS,
        value: "index",
      },
      { label: "A Unicode code", note: UNICODE_CODE_HINT, value: "unicode" },
      { label: "The whole table", note: "all 2,048 rows", value: "all" },
    ] as const,
    { label: "Look up" },
  );
  if (lookup === undefined) return undefined;
  if (lookup === "all") return { run: ["table", "--all"] };
  const { question, label, what, check, hints } = LOOKUPS[lookup];
  const answer = await askLine(question, label, {
    what,
    check,
    ...(hints === undefined ? {} : { hints }),
  });
  if (answer === undefined) return undefined;
  return { run: ["table", `--${lookup}`, answer] };
}

interface Entry {
  readonly label: string;
  readonly digit: number | null;
  readonly action: () => Promise<Action>;
  /**
   * The command asks for a seed phrase or a share, which needs a protected, self-tested process.
   */
  readonly asksSecrets?: boolean;
}

export const MENU_ENTRIES: readonly Entry[] = [
  { ...MENU_ENTRY_NAMES.encode, action: askedAfresh(encodeAction), asksSecrets: true },
  { ...MENU_ENTRY_NAMES.reEncode, action: askedAfresh(reEncodeAction), asksSecrets: true },
  { ...MENU_ENTRY_NAMES.decode, action: askedAfresh(decodeAction), asksSecrets: true },
  { ...MENU_ENTRY_NAMES.split, action: askedAfresh(splitAction), asksSecrets: true },
  { ...MENU_ENTRY_NAMES.restore, action: askedAfresh(restoreAction), asksSecrets: true },
  { ...MENU_ENTRY_NAMES.recover, action: askedAfresh(recoverAction), asksSecrets: true },
  { ...MENU_ENTRY_NAMES.preview, action: askedAfresh(previewAction) },
  { ...MENU_ENTRY_NAMES.table, action: tableAction },
  { ...MENU_ENTRY_NAMES.selfTest, action: async () => ({ run: ["self-test"] }) },
  { ...MENU_ENTRY_NAMES.help, action: async () => "help" },
  { ...MENU_ENTRY_NAMES.quit, action: async () => "quit" },
];

const paint = (code: string, text: string): string => terminalPaint("stderr", code, text);

// The command lines as typed are shown by shell-command.ts; here too for the tests that take them
// with the menu.
export { commandDisplay, typedCommand };

/**
 * Why no command may ask for a secret here, or undefined: this process could not switch off core
 * dumps, or the core self-test failed (assertProtected, assertCoreSelfTest). Each command that
 * takes a secret checks both again before it asks anything and would stop at once, so the menu
 * checks them before its first question and does not offer such commands then.
 */
function secretsRefusal(): string | undefined {
  try {
    assertProtected();
    assertCoreSelfTest();
    return undefined;
  } catch (error) {
    return describeError(error);
  }
}

/** Said once when the entries that ask for a secret are no longer offered. */
const SECRET_ENTRIES_LEFT_OUT =
  "The entries that ask for a seed phrase or a share are not offered.";

/** The menu's heading; `refusal` says why no entry that asks for a secret is offered. */
function writeHeading(refusal: string | undefined): void {
  console.error(`\n${headingLine(process.stderr, "Offline seed phrase encoding")}\n`);
  console.error("Encodes a BIP39 seed phrase as numbers, codes or colors, all offline.");
  terminalMore("menu");
  console.error(paint(STYLE.muted, "Work on a trusted computer without a network connection."));
  if (refusal !== undefined) {
    terminalFailure(refusal);
    terminalNotice(SECRET_ENTRIES_LEFT_OUT, "warning");
  }
  // The record of answers starts after a blank line; each question adds its own above it.
  console.error("");
}

export async function runMenu(): Promise<void> {
  // Each command runs in a process of its own, which gives up what it does not need; the menu
  // itself saves nothing.
  dropForMenu();
  let refusal = secretsRefusal();
  writeHeading(refusal);
  // Drawn again, as it is then, where going back draws the whole screen anew.
  startRecord(() => writeHeading(refusal));
  let selected: Entry = defined(MENU_ENTRIES[0]);
  for (;;) {
    const entries =
      refusal === undefined ? MENU_ENTRIES : MENU_ENTRIES.filter((item) => !item.asksSecrets);
    const before = answerMark();
    const entry = await choose(
      "What do you want to do?",
      entries.map((item) => ({ label: item.label, digit: item.digit, value: item })),
      { label: "Task", initial: Math.max(0, entries.indexOf(selected)), quit: "quits" },
    );
    if (entry === undefined) return;
    selected = entry;
    const action = await entry.action();
    if (action === "quit") return;
    if (action === undefined) {
      // Back: the task and the answers given for it leave the record before the list returns.
      eraseAnswersSince(before);
      continue;
    }
    // What follows is written below the record, which starts again under it for the next task.
    startRecord();
    if (action === "help") {
      printUsage();
    } else {
      // Shown before the command asks anything: the same answers typed after mnemocode.
      console.error(`\n${paint(STYLE.muted, "The same as:")}`);
      console.error(paint(STYLE.accent, commandDisplay(action.run)));
      // The command reports its own result, error or cancellation (Ctrl+C), then the menu goes on.
      const code = await runCommand(action.run);
      if (code === undefined || code === CANCELLED_EXIT_CODE) continue;
      // A copy that fails its own check is not trusted with a secret either.
      if (action.run[0] === "self-test" && code !== 0 && refusal === undefined) {
        refusal = "The self-test failed.";
        terminalNotice(`${refusal} ${SECRET_ENTRIES_LEFT_OUT}`, "warning");
      }
      // After the private screen the person has already read the result and pressed Enter.
      if (
        code === 0 &&
        PRIVATE_SCREEN_COMMANDS.has(defined(action.run[0])) &&
        privateScreenAvailable()
      ) {
        console.error(paint(STYLE.muted, "The screen with the result was cleared."));
        continue;
      }
    }
    console.error("");
    // Only Escape quits here, not q or the rest of a paste meant for the command.
    const back = await waitForEnter("Press Enter to return to the menu (Esc quits).", {
      onlyEscapeLeaves: true,
    });
    if (!back) return;
  }
}
