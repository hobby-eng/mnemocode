// The command-line side of shares typed to restore or export a seed phrase: the questions for the
// shares, a share typed again or left out, the lines of a repair's assessment and report, and the
// question before a long search and its progress. On the private screen (--ask-secrets) a share that cannot be used is typed
// again, or left out, while the others are kept (TypedShares, mendShares); elsewhere the problem
// ends the command. What the shares are, and what is wrong with them, the library decides
// (src/sskr/share-input.ts, share-set.ts, repair-report.ts, joint-repair.ts, share-unmasking.ts).

import {
  JointRepair,
  MAX_SEARCH_BITS,
  type JointPlan,
  type RepairedSet,
} from "../sskr/joint-repair.js";
import {
  REPAIR_NOTES,
  RepairReport,
  type DateWork,
  type ReportLine,
  type ShareRepairs,
} from "../sskr/repair-report.js";
import {
  ShareInput,
  type CompleteOutcome,
  type ShareTrouble,
  type TypedShare,
} from "../sskr/share-input.js";
import { nodeSharePlatform } from "../sskr/share-platform-node.js";
import { integerOption, type ParsedArguments } from "./arguments.js";
import { askAfterFailure, askSecretUntil, askValueUntil, droppedPath } from "./ask.js";
import { MENU_ENTRY_NAMES } from "./menu-entries.js";
import { onPrivateScreen } from "./private-screen.js";
import { decodeQrPngFile } from "./qr-input.js";
import { choose, type Choice } from "./terminal-choice.js";
import { dropTypedAhead, InputCancelled, withCtrlCWatch } from "./terminal-input.js";
import {
  ProgressLine,
  STYLE,
  TEXT_WIDTH,
  terminalColor,
  terminalHint,
  terminalMore,
  terminalNotice,
  terminalPaint,
  terminalStatus,
} from "./terminal.js";

export type { DateWork, ShareTrouble, TypedShare };

/** Seconds between two progress lines of a long search. */
const PROGRESS_SECONDS = 10;

/** The question for every share at once; a line break in a paste separates shares too (ask.ts). */
const SHARES_PROMPT =
  "Shamir shares (separate shares with ;, ? for each unreadable code or digit):";
/** The question for shares added to those typed. */
const MORE_SHARES_PROMPT = "More shares (separate shares with ;):";

/** A share that another command's question took, such as Decode's, and where it came from. */
export interface FirstShare {
  readonly text: string;
  /** Read from a QR code image: the next share is offered from one as well. */
  readonly fromQr: boolean;
}

/** How shares are given on the private screen. */
type ShareSource = "typed" | "qr";

const count = (value: number) => value.toLocaleString("en-US");

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
export class TypedShares {
  /**
   * The shares and their places, and every check of them; a seed phrase typed in place of a share
   * is sent to the menu's entry that decodes it.
   */
  readonly input = new ShareInput({ decodeEntry: MENU_ENTRY_NAMES.decode.label });
  /** Whether the last share came from a QR code image, so that the next is offered from one first. */
  #fromQr = false;

  /** Shares given with the options, in their order; nothing is asked about them. */
  static of(texts: readonly string[]): TypedShares {
    const shares = new TypedShares();
    shares.input.add(texts);
    return shares;
  }

  /**
   * The shares after `first`, one given where another question asked (Decode): it is checked as a
   * typed share is, shown when it came from a QR code image, and the others are asked for when the
   * restore finds it too few.
   */
  static async startingWith(first: FirstShare): Promise<TypedShares> {
    const shares = new TypedShares();
    shares.input.add([first.text]);
    if (first.fromQr) shares.#readFromQr();
    await shares.retypeUnreadable();
    return shares;
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

  /** Asks for every share in one answer, in place of any typed before. */
  async askAll(): Promise<void> {
    const texts = await askSecretUntil(
      SHARES_PROMPT,
      (answer) => this.input.sharesOfAnswer(answer),
      { what: "the shares", pastedLineBreak: ";" },
    );
    this.#fromQr = false;
    this.input.replaceAll(texts);
    await this.retypeUnreadable();
  }

  /**
   * Asks for more shares, which are added after those given. After a share read from a QR code
   * image, such as the one Decode read, the next may be read from one too, or typed.
   */
  async askMore(): Promise<void> {
    const texts = this.#fromQr ? await this.#askNextShare() : await this.#typeMore();
    this.input.add(texts);
    this.#showRead();
    await this.retypeUnreadable();
  }

  /** More shares, typed in one answer. */
  async #typeMore(): Promise<string[]> {
    this.#fromQr = false;
    return askSecretUntil(MORE_SHARES_PROMPT, (answer) => this.input.sharesOfAnswer(answer, true), {
      what: "the shares to add",
      pastedLineBreak: ";",
    });
  }

  /**
   * The next share read from a QR code image, or more shares typed, as the person chooses; Escape
   * at the file name chooses again.
   */
  async #askNextShare(): Promise<string[]> {
    for (;;) {
      if ((await this.#askSource()) === "typed") return this.#typeMore();
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
  async #askSource(): Promise<ShareSource> {
    await dropTypedAhead();
    const source = await choose(
      "The next share?",
      [
        { label: "Read another QR code image", note: "the PNG of one share", value: "qr" },
        {
          label: "Type the shares",
          note: "separated by ;, ? for each unreadable code",
          value: "typed",
        },
      ] as const,
      { label: "Shares", quit: "types them" },
    );
    return source === "qr" ? "qr" : "typed";
  }

  /** Marks the last share as read from a QR code image, and shows it. */
  #readFromQr(): void {
    this.#fromQr = true;
    this.#showRead();
  }

  /** Shows the share just read from a QR code image as text, under its place. */
  #showRead(): void {
    if (!this.#fromQr) return;
    const share = this.list.at(-1)!;
    terminalStatus(`Share ${share.place}, from its QR code:`, share.text);
  }

  /**
   * Asks for the share at `place` again until it can be read. After `warning`, and after an answer
   * that still cannot be read, the share may be left out instead while others remain, so that a
   * part that is no share, such as a heading pasted with the shares, does not have to be replaced.
   */
  async retype(place: number, warning?: string): Promise<void> {
    if (!this.input.has(place)) throw new Error(`No share was typed at place ${place}.`);
    for (let problem = warning; ;) {
      if (problem !== undefined) {
        terminalNotice(problem, "warning");
        if (this.list.length > 1 && (await this.leftOut(place))) return;
      }
      const text = await askSecretUntil(`Share ${place} again:`, (answer) => answer, {
        what: `share ${place}`,
      });
      problem = this.input.readProblem(place, text);
      if (problem === undefined) {
        this.input.replace(place, text);
        return;
      }
    }
  }

  /**
   * Asks whether the share at `place` is left out or typed again, after a warning about it; true
   * when it was left out. Escape types it again, which loses nothing.
   */
  async leftOut(place: number): Promise<boolean> {
    const choice = await askAfterFailure(
      "What now?",
      [
        { label: `Leave share ${place} out`, note: "the others are kept", value: "out" },
        { label: `Type share ${place} again`, value: "again" },
      ] as const,
      { escape: "types it again" },
    );
    if (choice === "out") this.leaveOut(place);
    return choice === "out";
  }

  /** Leaves out the share at `place`; the others keep their places. */
  leaveOut(place: number): void {
    this.input.leaveOut(place);
  }

  /** Asks which share, unless only one was typed; undefined when the person goes back (Escape). */
  private async chosenPlace(): Promise<number | undefined> {
    if (this.list.length === 1) return this.list[0]!.place;
    await dropTypedAhead();
    return choose(
      "Which share?",
      this.list.map((share) => ({
        label: `Share ${share.place}`,
        ...(share.text.includes("?") ? { note: "with ?" } : {}),
        value: share.place,
      })),
      { label: "Share", quit: "goes back" },
    );
  }

  /** Asks which share to type again, then for it; false when the person goes back (Escape). */
  async retypeChosen(): Promise<boolean> {
    const place = await this.chosenPlace();
    if (place === undefined) return false;
    await this.retype(place);
    return true;
  }

  /** Asks which share to leave out, and leaves it out; false when the person goes back (Escape). */
  async leaveOutChosen(): Promise<boolean> {
    const place = await this.chosenPlace();
    if (place === undefined) return false;
    this.leaveOut(place);
    return true;
  }

  /** Each share that cannot be read is typed again, with why, until it can be, or left out. */
  private async retypeUnreadable(): Promise<void> {
    for (const share of [...this.list]) {
      const problem = this.input.readProblem(share.place, share.text);
      if (problem !== undefined) await this.retype(share.place, problem);
    }
  }
}

// What the shares give together.

/** What the shares as typed give: the phrase of complete ones, or the assessment of marked ones. */
export type SharesOutcome =
  CompleteOutcome | { readonly kind: "repair"; readonly repair: ShareRepair };

/**
 * What the shares as typed give, or their first problem. Complete shares are read and checked as a
 * set, copies left out with a note, and restored; shares with ? are assessed together
 * (planShareRepair, during which Ctrl+C is read as a key) and the assessment is shown. No
 * combination is searched yet.
 */
export async function assessShares(
  shares: TypedShares,
  assess: (texts: readonly string[]) => Promise<JointPlan>,
): Promise<SharesOutcome> {
  const { input } = shares;
  if (input.marked) {
    const unreadable = input.firstUnreadable();
    if (unreadable !== undefined) return { kind: "trouble", trouble: unreadable };
    const repair = assessShareRepair(await assess(input.texts()), input.places());
    const trouble = input.assessmentTrouble(repair.plan.assessment);
    return trouble === undefined ? { kind: "repair", repair } : { kind: "trouble", trouble };
  }
  // The SSKR self-test ran before the first question (sskr-command.ts, recoverySettings).
  const { outcome, copies } = await input.restoreComplete(nodeSharePlatform);
  for (const copy of copies) terminalNotice(copy.message);
  return outcome;
}

/** What can be done about shares that restore nothing, or nothing that is wanted. */
type ShareFix = "one" | "out" | "all" | "more" | "stop";

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
 * more shares, or Stop, which cancels (InputCancelled). A refusal may name shares to leave out,
 * possibly more than one; each is left out by a choice of its own. Escape at the list of shares
 * asks again. True once the shares were changed; false when the person went back (`back`).
 */
export async function askShareFix(
  shares: TypedShares,
  how: ShareFixQuestion = {},
): Promise<boolean> {
  const question = how.question ?? "What now?";
  for (;;) {
    const several = shares.list.length > 1;
    const choices: Choice<ShareFix>[] = [
      { label: "Type one share again", note: "the others are kept", value: "one" },
      ...(several
        ? [{ label: "Leave a share out", note: "the others are kept", value: "out" as const }]
        : []),
      { label: "Type every share again", value: "all" },
      { label: "Add more shares", value: "more" },
      { label: "Stop", value: "stop" },
    ];
    const fix =
      how.back === true
        ? await chooseOrBack(question, choices)
        : await askAfterFailure(question, choices);
    if (fix === undefined) return false;
    if (fix === "stop") throw new InputCancelled();
    if (fix === "all") {
      await shares.askAll();
      return true;
    }
    if (fix === "more") {
      await shares.askMore();
      return true;
    }
    // Escape at the list of shares asks this question again.
    const changed = fix === "out" ? await shares.leaveOutChosen() : await shares.retypeChosen();
    if (changed) return true;
  }
}

/**
 * The choice of a question reached from another, whose askAfterFailure has checked that there is a
 * terminal: undefined at Escape, q or the end of the input, which go back. At the end of the
 * input the question gone back to then picks its Stop, so that nothing loops.
 */
async function chooseOrBack<T>(
  question: string,
  choices: readonly Choice<T>[],
): Promise<T | undefined> {
  await dropTypedAhead();
  return choose(question, choices, { label: "Next", quit: "goes back" });
}

/**
 * Mends a problem of the shares on the private screen, as ShareTrouble describes, after one
 * warning line; elsewhere the problem ends the command. "few" asks for more shares.
 */
export async function mendShares(
  shares: TypedShares,
  trouble: ShareTrouble,
  interactive: boolean,
): Promise<void> {
  if (!interactive) throw new Error(trouble.message);
  if (trouble.kind === "unreadable") return shares.retype(trouble.place, trouble.message);
  terminalNotice(trouble.message, "warning");
  if (trouble.kind === "few") return shares.askMore();
  if (trouble.kind === "refused") {
    await askShareFix(shares);
    return;
  }
  if (!(await shares.leftOut(trouble.place))) await shares.retype(trouble.place);
}

// Shares with unreadable elements.

/** A plan, and how fast this machine checks the digest. */
export interface ShareRepair {
  readonly plan: JointPlan;
  readonly triesPerSecond: number;
}

/**
 * Prints the assessment of shares typed with ? marks (planShareRepair), naming each share by its
 * place in `places`. No combination is tried yet; a refusal is the plan's reason.
 */
export function assessShareRepair(plan: JointPlan, places?: readonly number[]): ShareRepair {
  const triesPerSecond = new JointRepair(nodeSharePlatform).triesPerSecond();
  printLines(new RepairReport(plan.assessment, triesPerSecond, places).lines());
  return { plan, triesPerSecond };
}

/**
 * The combinations that --max-tries allows without a question, read before any secret is asked;
 * undefined without it, when a search of up to AUTO_SECONDS (repair-report.ts) goes ahead.
 */
export function searchLimit(args: ParsedArguments): number | undefined {
  if (args["max-tries"] === undefined) return undefined;
  return integerOption(args, "max-tries", { min: 1, max: 2 ** MAX_SEARCH_BITS });
}

/**
 * Runs the search, after asking on the private screen when it is longer than allowed; elsewhere a
 * longer search needs --max-tries. With `dates`, the date search that follows for each phrase found
 * is counted in the time, and named in the question. Resolves with every phrase found, possibly
 * none, or undefined when the person chose not to search.
 */
export async function searchShareRepair(
  repair: ShareRepair,
  limits: { readonly shares: number | undefined; readonly dates?: number | undefined },
  dates?: DateWork,
): Promise<RepairedSet[] | undefined> {
  const report = new RepairReport(repair.plan.assessment, repair.triesPerSecond);
  if (report.needsQuestion(limits.shares, dates, limits.dates)) {
    if (!onPrivateScreen()) {
      const allow = dates === undefined ? "" : ` and --max-candidates ${dates.combinations}`;
      throw new Error(
        `The search takes ${count(report.combinations)} checks, ${report.duration(dates)}. Allow it with --max-tries ${report.combinations}${allow}.`,
      );
    }
    // Keys typed during the assessment, which reads none after its watch, must not answer this.
    await dropTypedAhead();
    const start = await choose(
      report.searchQuestion(dates),
      [
        { label: "Yes", note: "Ctrl+C stops it", value: true },
        { label: "No", note: "change the shares", value: false },
      ],
      { label: "Search", quit: "changes the shares" },
    );
    if (start !== true) return undefined;
  } else if (dates !== undefined) terminalNotice(report.searchNotice(dates));
  let shown = Date.now();
  const progress = new ProgressLine();
  // Watched only now, after the question, which reads its own keys: Ctrl+C stops the search at
  // its next turn, which then rejects with InputCancelled.
  try {
    return await withCtrlCWatch((signal) =>
      repair.plan.search({
        signal,
        onProgress: (done, total, phrases) => {
          if (Date.now() - shown < PROGRESS_SECONDS * 1000 || done === total) return;
          shown = Date.now();
          progress.show(
            `Checked ${Math.floor((100 * done) / total)}%: ${count(done)} of ${count(total)}; ${phrases} found.`,
          );
        },
      }),
    );
  } finally {
    progress.end();
  }
}

/**
 * Says, share by share, what a repair filled in where ? marked an element (RepairReport
 * .repairLines), each share named by its place in `places`, by its index in the set.
 */
export function reportRepairs(
  set: Pick<RepairedSet, "shares" | "unsettled">,
  places?: readonly number[],
): void {
  const repairs = RepairReport.repairs(set, places);
  if (repairs.length === 0 || !terminalColor("stderr")) {
    printLines(RepairReport.repairLines(set, places));
    return;
  }
  // On a terminal as a table, a row for each share, so that each element is found at a glance.
  terminalNotice(REPAIR_NOTES.heading, "warning");
  for (const row of repairRows(repairs)) console.error(row);
  if (set.unsettled.length > 0) terminalNotice(REPAIR_NOTES.guesses, "warning");
  terminalHint(REPAIR_NOTES.correct);
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
