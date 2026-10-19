// The command-line side of shares typed to restore or export a seed phrase: the questions for the
// shares, a share typed again or left out, the lines of a repair's assessment and report, and the
// question before a long search and its progress. On the private screen (--ask-secrets) a share
// that cannot be used is typed again, or left out, while the others are kept (TypedShares,
// mendShares); elsewhere the problem ends the command. What the shares are, and what is wrong with
// them, the library decides (src/sskr/share-input.ts, share-set.ts, repair-report.ts,
// joint-repair.ts, share-unmasking.ts).

import { MAX_REPAIR_COMBINATIONS } from "../sskr/joint-repair.js";
import { type RepairedSet, type RepairedShares } from "../sskr/joint-results.js";
import {
  REPAIR_NOTES,
  RepairReport,
  type DateWork,
  type ReportLine,
  type ShareRepairs,
} from "../sskr/repair-report.js";
import {
  ShareInput,
  type ShareTrouble,
  type TypedShare,
  SHARE_SEPARATOR,
  SHARE_WORD_HINTS,
} from "../sskr/share-input.js";
import { nodeSharePlatform } from "../sskr/share-platform-node.js";
import {
  releaseRead,
  searchDecision,
  ShareRestore,
  type MarkedShares,
  type SearchLimits,
  type SharesRead,
} from "../sskr/share-restore.js";
import { assertAskedNotGiven, integerOption, values, type ParsedArguments } from "./arguments.js";
import { textInput } from "./input.js";
import { readBoundedTextFile } from "./text-file.js";
import { SHARE_SOURCE_OPTIONS } from "./share-options.js";
import {
  askAfterFailure,
  askSecretUntil,
  askValueUntil,
  droppedPath,
  WHAT_NOW,
  askOrCancel,
} from "./ask.js";
import { MENU_ENTRY_NAMES } from "./menu-entries.js";
import { onPrivateScreen } from "./private-screen.js";
import { decodeQrPngFile } from "./qr-input.js";
import { choose, type Choice } from "./terminal-choice.js";
import { allowedBy, askToSearch, type SearchAllowance } from "./search-consent.js";
import { withCtrlCWatch, nodeTurn } from "./terminal-input.js";
import {
  printableText,
  ProgressLine,
  SEARCH_PROGRESS_SECONDS,
  STYLE,
  TEXT_WIDTH,
  terminalColor,
  terminalHint,
  terminalMore,
  terminalNotice,
  terminalPaint,
  terminalStatus,
} from "./terminal.js";
import { counting } from "../core/search-plan.js";
import { isMarked } from "../sskr/repair-units.js";
import { defined } from "../core/defined.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { ErrorCatalog, suppliedMessage } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.share-repair", {
  "no-share-was-typed-at-place": (value0: string) => `No share was typed at place ${value0}.`,
  "mend-shares-refused": suppliedMessage,
  "search-share-repair-refused": suppliedMessage,
  "one-share-at-a-time": () => "Give one share here, or a text file containing just that share.",
});

// Keep the established source-reader refusal codes when their lifetime moves into TypedShares.
const SOURCE_ERRORS = new ErrorCatalog("cli.sskr-restore-command", {
  "standard-input-can-only-read-once": () => "Standard input can only be read once.",
  "provide-at-least-one-complete-share-as-text": () =>
    "Provide at least one complete share in a text file, in a QR image, or through --ask-secrets. Additional share sources may be repeated.",
});

/** The restore of shares with Node's SSKR library: it keeps nothing of a restore. */
const SHARE_RESTORE = new ShareRestore(nodeSharePlatform);

export type { DateWork, ShareTrouble, TypedShare };

/** How shares are typed in one answer, which every question for shares says. */
const SHARE_SEPARATOR_HINT = `separate shares with ${SHARE_SEPARATOR}`;
/** How shares are typed in one answer, with the marks of what cannot be read. */
export const SHARE_ANSWER_HINT = `${SHARE_SEPARATOR_HINT}, ? for each unreadable code or digit`;
/** The question for every share at once; a line break in a paste separates shares too (ask.ts). */
const SHARES_PROMPT = `Shamir shares or text file path (${SHARE_ANSWER_HINT}):`;
/** The question for shares added to those typed. */
const MORE_SHARES_PROMPT = `More shares or text file path (${SHARE_SEPARATOR_HINT}):`;

/** A share that another command's question took, such as Decode's, and where it came from. */
export interface FirstShare {
  readonly text: string;
  /** Read from a QR code image: the next share is offered from one as well. */
  readonly fromQr: boolean;
}

/** How shares are given on the private screen. */
type ShareSource = "typed" | "qr";

/** Prints the lines of a report, each in the style of its kind. */
function printLines(lines: readonly ReportLine[]): void {
  for (const line of lines) {
    if (line.kind === "status") terminalStatus(line.label, line.value, line.good);
    else if (line.kind === "more") terminalMore(line.anchor);
    else if (line.kind === "hint") terminalHint(line.text);
    else terminalNotice(line.text, line.kind === "warning" ? "warning" : "info");
  }
}

// The shares as typed.

/**
 * The shares typed, kept in memory while one of them is typed again, left out or joined by more,
 * each with the place it was typed at (ShareInput). A share that cannot be read is typed again at
 * once, alone, or left out.
 */
export class TypedShares implements Disposable {
  /**
   * The shares and their places, and every check of them; a seed phrase typed in place of a share
   * is sent to the menu's entry that decodes it. The one handle of the typed shares that callers
   * get, to ask it and to hand it to the library; only this class adds or replaces shares.
   */
  readonly input = new ShareInput({ decodeEntry: MENU_ENTRY_NAMES.decode.label });
  /**
   * Whether the last share came from a QR code image, so that the next is offered from one first.
   */
  #fromQr = false;

  /**
   * The shares after `first`, one given where another question asked (Decode): it is checked as a
   * typed share is, shown when it came from a QR code image, and the others are asked for when the
   * restore finds it too few.
   */
  static async startingWith(first: FirstShare): Promise<TypedShares | Cancelled> {
    const shares = new TypedShares();
    try {
      shares.input.add(shares.input.sharesOfAnswer(first.text));
      if (first.fromQr) shares.#readFromQr();
      if ((await shares.#retypeUnreadable()) !== CANCELLED) return shares;
      shares.wipe();
      return CANCELLED;
    } catch (error) {
      shares.wipe();
      throw error;
    }
  }

  /** Owns shares from options/files/QR until the completed input is transferred to its caller. */
  static async given(args: ParsedArguments): Promise<TypedShares> {
    if (values(args, "share-file").filter((path) => path === "-").length > 1)
      throw SOURCE_ERRORS.create("standard-input-can-only-read-once", []);
    const shares = new TypedShares();
    try {
      const { input } = shares;
      input.add(values(args, "share"));
      for (const path of values(args, "share-file")) {
        const text =
          path === "-"
            ? textInput({ "input-file": "-" }, "input")
            : readBoundedTextFile(path, "The share file");
        input.add(input.sharesOfText(text, "The file holds"));
      }
      for (const path of values(args, "share-qr")) input.add([await decodeQrPngFile(path)]);
      if (input.list.length === 0)
        throw SOURCE_ERRORS.create("provide-at-least-one-complete-share-as-text", []);
      return shares;
    } catch (error) {
      shares.wipe();
      throw error;
    }
  }

  /** Asks on the private screen or reads options; the returned input is caller-owned. */
  static async read(args: ParsedArguments): Promise<TypedShares | Cancelled> {
    if (args["ask-secrets"] !== true) return TypedShares.given(args);
    assertAskedNotGiven(args, SHARE_SOURCE_OPTIONS);
    const shares = new TypedShares();
    try {
      if ((await shares.askAll()) !== CANCELLED) return shares;
      shares.wipe();
      return CANCELLED;
    } catch (error) {
      shares.wipe();
      throw error;
    }
  }

  /** Ends the typed input after the command's awaited restores, display and saves settle. */
  wipe(): void {
    this.input.wipe();
  }

  /** Ends this input's owning command scope. */
  [Symbol.dispose](): void {
    this.wipe();
  }

  get list(): readonly TypedShare[] {
    return this.input.list;
  }

  /** The texts, in the order typed, as the share functions take them. */
  texts(): string[] {
    return this.input.texts();
  }

  /** The place of each share, by its index in texts(). */
  places(): number[] {
    return this.input.places();
  }

  /** Whether an element of a share is marked with ? as unreadable. */
  get marked(): boolean {
    return this.input.marked;
  }

  /**
   * Asks for every share in one answer, in place of any typed before; CANCELLED, as every question
   * of the shares gives it, when the command is cancelled.
   */
  async askAll(): Promise<Cancelled | undefined> {
    const texts = await askSecretUntil(
      SHARES_PROMPT,
      (answer) => this.input.sharesOfAnswer(answer),
      {
        what: "the shares or their text file path",
        textFile: "The share file",
        pastedLineBreak: SHARE_SEPARATOR,
        hints: SHARE_WORD_HINTS,
      },
    );
    if (texts === CANCELLED) return CANCELLED;
    this.#fromQr = false;
    this.input.replaceAll(texts);
    return this.#retypeUnreadable();
  }

  /**
   * Asks for more shares, which are added after those given. After a share read from a QR code
   * image, such as the one Decode read, the next may be read from one too, or typed.
   */
  async askMore(): Promise<Cancelled | undefined> {
    const texts = this.#fromQr ? await this.#askNextShare() : await this.#typeMore();
    if (texts === CANCELLED) return CANCELLED;
    this.input.add(texts);
    this.#showRead();
    return this.#retypeUnreadable();
  }

  /** More shares, typed in one answer. */
  async #typeMore(): Promise<string[] | Cancelled> {
    this.#fromQr = false;
    return askSecretUntil(MORE_SHARES_PROMPT, (answer) => this.input.sharesOfAnswer(answer, true), {
      what: "the shares to add",
      textFile: "The share file",
      hints: SHARE_WORD_HINTS,
      pastedLineBreak: SHARE_SEPARATOR,
    });
  }

  /**
   * The next share read from a QR code image, or more shares typed, as the person chooses; Escape
   * at the file name chooses again.
   */
  async #askNextShare(): Promise<string[] | Cancelled> {
    for (;;) {
      const source = await this.#askSource();
      if (source === CANCELLED) return CANCELLED;
      if (source === "typed") return this.#typeMore();
      const texts = await askValueUntil(
        "QR code file name:",
        async (answer) =>
          this.input.sharesOfAnswer(await decodeQrPngFile(droppedPath(answer)), true),
        { what: "the name of the QR code image of a share" },
      );
      if (texts !== undefined) return texts;
    }
  }

  /** How the next share is given: from another QR code image, or typed. Escape types it. */
  async #askSource(): Promise<ShareSource | Cancelled> {
    const source = await choose(
      "The next share?",
      [
        { label: "Read another QR code image", note: "the PNG of one share", value: "qr" },
        {
          label: "Type the shares",
          // Shorter than SHARE_ANSWER_HINT, so that the note fits its list.
          note: `separated by ${SHARE_SEPARATOR}, ? for each unreadable code`,
          value: "typed",
        },
      ] as const,
      { label: "Shares", quit: "types them" },
    );
    return source ?? "typed";
  }

  /** Marks the last share as read from a QR code image, and shows it. */
  #readFromQr(): void {
    this.#fromQr = true;
    this.#showRead();
  }

  /** Shows the share just read from a QR code image as text, under its place. */
  #showRead(): void {
    if (!this.#fromQr) return;
    const share = defined(this.list.at(-1));
    // An image may hold any text: it is shown without its control characters.
    terminalStatus(`Share ${share.place}, from its QR code:`, printableText(share.text));
  }

  /**
   * Asks for the share at `place` again until it can be read. After `warning`, and after an answer
   * that still cannot be read, the share may be left out instead while others remain, so that a
   * part that is no share, such as a heading pasted with the shares, does not have to be replaced.
   */
  async retype(place: number, warning?: string): Promise<Cancelled | undefined> {
    if (!this.input.has(place)) throw ERRORS.create("no-share-was-typed-at-place", [`${place}`]);
    for (let problem = warning; ;) {
      if (problem !== undefined) {
        terminalNotice(problem, "warning");
        const kept = this.list.length > 1 ? await this.askLeaveOut(place) : "again";
        if (kept !== "again") return kept === "out" ? undefined : kept;
      }
      const text = await askSecretUntil(
        `Share ${place} again, or its text file path:`,
        (answer) => {
          const parts = this.input.sharesOfAnswer(answer);
          if (parts.length !== 1) throw ERRORS.create("one-share-at-a-time", []);
          return defined(parts[0]);
        },
        {
          what: `share ${place} or its text file path`,
          textFile: "The share file",
          hints: SHARE_WORD_HINTS,
        },
      );
      if (text === CANCELLED) return CANCELLED;
      problem = this.input.readProblem(place, text);
      if (problem === undefined) {
        this.input.replace(place, text);
        return undefined;
      }
    }
  }

  /**
   * Asks whether the share at `place` is left out or typed again, after a warning about it, and
   * leaves it out at "out". Escape types it again ("again"), which loses nothing.
   */
  async askLeaveOut(place: number): Promise<"out" | "again" | Cancelled> {
    const choice = await askAfterFailure(
      WHAT_NOW,
      [
        { label: `Leave share ${place} out`, note: "the others are kept", value: "out" },
        { label: `Type share ${place} again`, value: "again" },
      ] as const,
      { escape: "types it again" },
    );
    if (choice === "out") this.leaveOut(place);
    return choice;
  }

  /** Leaves out the share at `place`; the others keep their places. */
  leaveOut(place: number): void {
    this.input.leaveOut(place);
  }

  /** Asks which share, unless only one was typed; undefined when the person goes back (Escape). */
  async #chosenPlace(): Promise<number | undefined | Cancelled> {
    if (this.list.length === 1) return defined(this.list[0]).place;
    return choose(
      "Which share?",
      this.list.map((share) => ({
        label: `Share ${share.place}`,
        ...(isMarked(share.text) ? { note: "with ?" } : {}),
        value: share.place,
      })),
      { label: "Share", quit: "goes back" },
    );
  }

  /** Asks which share to type again, then for it; "back" when the person goes back (Escape). */
  async retypeChosen(): Promise<SharesChange> {
    const place = await this.#chosenPlace();
    if (place === undefined) return "back";
    if (place === CANCELLED) return CANCELLED;
    return (await this.retype(place)) ?? "changed";
  }

  /** Asks which share to leave out, and leaves it out; "back" when the person goes back (Escape). */
  async leaveOutChosen(): Promise<SharesChange> {
    const place = await this.#chosenPlace();
    if (place === undefined) return "back";
    if (place === CANCELLED) return CANCELLED;
    this.leaveOut(place);
    return "changed";
  }

  /**
   * Each share that cannot be read is typed again, with why, until it can be, or left out; over
   * the list as it was, which `list` gives as a copy.
   */
  async #retypeUnreadable(): Promise<Cancelled | undefined> {
    for (const share of this.list) {
      const problem = this.input.readProblem(share.place, share.text);
      if (problem !== undefined && (await this.retype(share.place, problem)) === CANCELLED)
        return CANCELLED;
    }
    return undefined;
  }
}

/** What a question that changes the shares did: changed them, or went back with Escape. */
export type SharesChange = "changed" | "back" | Cancelled;

// What the shares give together.

/**
 * What the shares as typed give, or their first problem (ShareRestore.read): complete shares are
 * read and checked as a set, copies left out with a note, and restored; shares with ? are assessed
 * together, during which Ctrl+C is read as a key, and the assessment is shown; an assessment that
 * Ctrl+C stopped cancels the command (CANCELLED). No combination is searched yet.
 */
export async function assessShares(
  shares: TypedShares,
): Promise<Exclude<SharesRead, { kind: "stopped" }> | Cancelled> {
  const { input } = shares;
  const read = await SHARE_RESTORE.read(input, withCtrlCWatch, nodeTurn);
  try {
    printLines(read.lines);
    // The person stopped the assessment with Ctrl+C.
    if (read.kind === "stopped") return CANCELLED;
    return read;
  } catch (error) {
    releaseRead(read);
    throw error;
  }
}

/** What can be done about shares that restore nothing, or nothing that is wanted. */
type ShareFix = "one" | "out" | "all" | "more";

/** The answer that asks for more shares after those typed (TypedShares.askMore), with `value`. */
export function addMoreShares<T>(value: T): Choice<T> {
  return { label: "Add more shares", value };
}

/** How askShareFix asks. */
export interface ShareFixQuestion {
  /** "What now?" by default. */
  readonly question?: string;
  /**
   * Whether Escape goes back, for a question reached from another, such as "Change a share" at the
   * "What now?" after a wallet that nothing matched; otherwise Escape is Stop (askAfterFailure).
   */
  readonly back?: boolean;
}

/**
 * Asks which share to change after a refusal that names none or several, or a search without a
 * result: one share typed again, one left out (while others remain), every share typed again,
 * more shares, or Stop, which cancels (CANCELLED). A refusal may name shares to leave out,
 * possibly more than one; each is left out by a choice of its own. Escape at the list of shares
 * asks again. "changed" once the shares were changed; "back" when the person went back (`back`).
 */
export async function askShareFix(
  shares: TypedShares,
  how: ShareFixQuestion = {},
): Promise<SharesChange> {
  const question = how.question ?? WHAT_NOW;
  for (;;) {
    const several = shares.list.length > 1;
    const choices: Choice<ShareFix>[] = [
      { label: "Type one share again", note: "the others are kept", value: "one" },
      ...(several
        ? [{ label: "Leave a share out", note: "the others are kept", value: "out" as const }]
        : []),
      { label: "Type every share again", value: "all" },
      addMoreShares("more"),
    ];
    const fix = await askOrCancel(question, choices, { back: how.back === true });
    if (fix === undefined) return "back";
    if (fix === CANCELLED) return CANCELLED;
    if (fix === "all") return (await shares.askAll()) ?? "changed";
    if (fix === "more") return (await shares.askMore()) ?? "changed";
    // Escape at the list of shares asks this question again.
    const changed = fix === "out" ? await shares.leaveOutChosen() : await shares.retypeChosen();
    if (changed !== "back") return changed;
  }
}

/**
 * Mends a problem of the shares on the private screen, as ShareTrouble describes, after one
 * warning line; elsewhere the problem ends the command. "few" asks for more shares. CANCELLED
 * when the command is cancelled.
 */
export async function mendShares(
  shares: TypedShares,
  trouble: ShareTrouble,
  interactive: boolean,
): Promise<Cancelled | undefined> {
  if (!interactive) throw ERRORS.create("mend-shares-refused", [trouble.message]);
  if (trouble.kind === "unreadable") return shares.retype(trouble.place, trouble.message);
  terminalNotice(trouble.message, "warning");
  if (trouble.kind === "few") return shares.askMore();
  if (trouble.kind === "refused")
    return (await askShareFix(shares)) === CANCELLED ? CANCELLED : undefined;
  const kept = await shares.askLeaveOut(trouble.place);
  if (kept === "again") return shares.retype(trouble.place);
  return kept === CANCELLED ? CANCELLED : undefined;
}

// Shares with unreadable elements.

/**
 * The combinations that --max-tries allows without a question, read before any secret is asked;
 * undefined without it, when a search of up to QUESTION_SECONDS (search-turns.ts) goes ahead.
 */
export function searchLimit(args: ParsedArguments): number | undefined {
  if (args["max-tries"] === undefined) return undefined;
  return integerOption(args, "max-tries", { min: 1, max: MAX_REPAIR_COMBINATIONS });
}

/**
 * Runs the search of marked shares, after asking on the private screen when it is longer than
 * `limits` allow (searchDecision); elsewhere a longer search needs --max-tries. With `dates`, the
 * date search that follows for each phrase found is counted in the time, and named in the
 * question. Resolves with every phrase found, possibly none, undefined when the person chose not
 * to search, or CANCELLED when Ctrl+C stopped the search; the caller then releases the read
 * (releaseRead).
 */
export async function searchShareRepair(
  marked: MarkedShares,
  limits: SearchLimits,
  dates?: DateWork,
): Promise<RepairedSet[] | undefined | Cancelled> {
  const { report } = marked;
  const decision = searchDecision(marked, dates, limits);
  if (decision.question !== undefined) {
    if (!onPrivateScreen()) {
      const allowances: SearchAllowance[] = [["max-tries", report.combinations]];
      if (dates !== undefined) allowances.push(["max-candidates", dates.combinations]);
      throw ERRORS.create("search-share-repair-refused", [
        allowedBy(report.searchExtent(dates), allowances),
      ]);
    }
    // Keys typed during the assessment, which reads none after its watch, do not answer this.
    const start = await askToSearch(decision.question, {
      note: "change the shares",
      quit: "changes the shares",
    });
    if (start !== "yes") return start === "no" ? undefined : start;
  } else if (decision.notice !== undefined) terminalNotice(decision.notice);
  const progress = new ProgressLine(SEARCH_PROGRESS_SECONDS);
  // Watched only now, after the question, which reads its own keys: Ctrl+C stops the search at
  // its next turn, which then ends as stopped.
  try {
    const found = await withCtrlCWatch((signal) =>
      SHARE_RESTORE.search(marked, {
        signal,
        turn: nodeTurn,
        onProgress: ({ checked, total, found: phrases }) => {
          // The end is said by the result, not by a last line of progress.
          if (checked === total) return;
          progress.showEvery(
            () =>
              `Checked ${Math.floor((100 * checked) / total)}%: ${counting(checked)} of ${counting(total)}; ${phrases} found.`,
          );
        },
      }),
    );
    // The person stopped the search with Ctrl+C.
    if (found.kind === "stopped") return CANCELLED;
    return found.kind === "sets" ? found.sets : [];
  } finally {
    progress.end();
  }
}

/**
 * Says, share by share, what a repair filled in where ? marked an element (RepairReport
 * .repairLines), each share named by its place in `places`, by its index in the set.
 */
export function reportRepairs(set: RepairedShares, places?: readonly number[]): void {
  const repairs = RepairReport.repairs(set, places);
  if (repairs.length === 0 || !terminalColor("stderr")) {
    printLines(RepairReport.repairLines(set, places));
    return;
  }
  // On a terminal as a table, a row for each share, so that each element is found at a glance.
  terminalNotice(REPAIR_NOTES.heading, "warning");
  for (const row of repairRows(repairs)) console.error(row);
  // The notes after the repairs, as the library tells them for every host.
  printLines(RepairReport.notes(set));
}

/** Indent of the rows of repaired elements, under the text after the "!" of their heading. */
const REPAIR_INDENT = "    ";
/** Spaces between the share and its elements, and between two elements. */
const REPAIR_GAP = "   ";

/**
 * The rows of the repairs: the share in grey, then each element's position in grey and what was
 * filled in bold, a guess with a yellow "?", the elements of one share wrapped under each other
 * within the width of running text.
 */
function repairRows(repairs: readonly ShareRepairs[]): string[] {
  const paint = (code: string, text: string): string => terminalPaint("stderr", code, text);
  const label = (share: number): string => `Share ${share}`;
  const elements = repairs.flatMap((repair) => repair.elements);
  const labelWidth = Math.max(...repairs.map((repair) => label(repair.share).length));
  const positionWidth = Math.max(...elements.map((e) => String(e.position).length));
  const valueWidth = Math.max(...elements.map((e) => e.value.length));
  // A position, a space, the value and the room for the "?" of a guess.
  const cellWidth = positionWidth + 1 + valueWidth + 1;
  const room = TEXT_WIDTH - REPAIR_INDENT.length - labelWidth;
  const perRow = Math.max(1, Math.floor(room / (REPAIR_GAP.length + cellWidth)));
  const rows: string[] = [];
  for (const repair of repairs) {
    const cells = repair.elements.map((e) => {
      const position = paint(STYLE.muted, String(e.position).padStart(positionWidth));
      const mark = e.guess ? paint(STYLE.warning, "?") : " ";
      return `${position} ${paint(STYLE.strong, e.value)}${mark}${" ".repeat(valueWidth - e.value.length)}`;
    });
    for (let start = 0; start < cells.length; start += perRow) {
      const name = start === 0 ? label(repair.share) : "";
      const row = cells.slice(start, start + perRow).join(REPAIR_GAP);
      rows.push(
        `${REPAIR_INDENT}${paint(STYLE.muted, name.padEnd(labelWidth))}${REPAIR_GAP}${row}`.trimEnd(),
      );
    }
  }
  return rows;
}
