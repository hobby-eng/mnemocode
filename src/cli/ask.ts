// Questions that are asked again until their answer can be used, on the private screen of a command
// (private-screen.ts). Nowhere may a command end abruptly and lose what the person typed: a wrong
// or unusable answer is explained in one warning line, which never repeats what was typed (a
// position such as "date 2" or "place 11" is fine), and the same question is asked again, while the
// caller keeps every earlier answer. Only the person leaves: Ctrl+C (CANCELLED, returned up to the
// command, which ends with CANCELLED_EXIT_CODE), Escape in a secret question, or the last choice
// of askAfterFailure. A cancelled command returns to the menu that started it. Each question drops
// what was typed
// before it showed (TerminalKeys.dropTypedAhead), so that only keys pressed for it answer it.
//
// The API for the commands:
// - askSecretUntil(prompt, parse, { what, pastedLineBreak, hints, textFile }): a secret, asked until
//   `parse` returns. An Error from `parse` is its one warning line; `hints` shows the words of a
//   list below the words being typed. An empty answer or Ctrl+D asks again
//   with "Type <what>, or press Ctrl+C to stop."; a real end of the input cancels.
//   With textFile, a local text file path is read once before parse; its contents are not echoed.
// - askValueUntil(prompt, parse, { what, fallback }): the same for a visible value that is no
//   secret, such as a fingerprint or a file name; Escape goes back (undefined), and Enter alone
//   takes the `fallback` where there is one.
// - askAfterFailure(question, choices, { label, escape }): "What now?" after a failure that is no
//   answer error, such as no result or a file that could not be saved; Escape picks the last
//   choice, which must be the one that stops or changes nothing.
// - droppedPath(answer): a typed file name as the file system knows it, when the file was dragged
//   into the terminal, which adds quotes or backslashes, or starts with ~.

import { TextFileInput } from "./text-file.js";
import { onPrivateScreen } from "./private-screen.js";
import { PrivatePage } from "./private-page.js";
import { PrivateSteps } from "./private-steps.js";
import { noticeLines, terminalNotice } from "./terminal.js";
import {
  choose,
  rowsOf,
  writePrompt,
  type Choice,
  type Explanation,
  enteredAnswer,
  typeHint,
} from "./terminal-choice.js";
import {
  readLine,
  terminalAvailable,
  TerminalKeys,
  refusal,
  type PastedLineBreak,
  terminalTooDumb,
  dumbTerminalReason,
  SECRET_SOURCE_ADVICE,
} from "./terminal-input.js";
import { CANCELLED, type Cancelled, type NextByte } from "./terminal-keys.js";
import { NOT_UTF8 } from "./typed-answer.js";
import { displayWidth } from "./terminal-geometry.js";
import { trimWhiteSpace } from "../core/white-space.js";
import { ValidCharacters } from "./utf8.js";
import type { WordHints } from "../core/word-hints.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.ask", {
  "run-command-another-terminal-set-term-such-as": (value0: string, value1: string) =>
    `${value0} Run the command in another terminal, set TERM (such as TERM=xterm-256color), or ${value1}.`,
  "ask-secrets-terminal-on-standard-input-standard-error": (value0: string) =>
    `--ask-secrets needs a terminal on standard input and standard error. Run the command in a terminal, or ${value0}.`,
  "question-after-failure-choice": () => "A question after a failure needs a choice.",
  "answer-question-stop-value": (value0: string) =>
    `An answer of a question with Stop has the value "${value0}".`,
});

/** How a question is asked again. */
export interface AskOptions {
  /** What to type, for the line after an empty answer: "Type <what>, or press Ctrl+C to stop." */
  readonly what?: string;
}

/** How a question for a visible value is asked again, and what Enter alone gives. */
export interface ValueAskOptions extends AskOptions {
  /** The answer that Enter alone gives, which the prompt names, such as "(Enter: 20)". */
  readonly fallback?: string;
}

/** How a secret question is asked again. */
export interface SecretAskOptions extends AskOptions {
  /** Accept a local text file path too; this name, never the path, appears in file refusals. */
  readonly textFile?: string;
  /**
   * The hints below the words being typed on the private screen, and Tab's completion
   * (core/word-hints.ts): where the answer is words of a list, such as a seed phrase.
   */
  readonly hints?: WordHints;
  /**
   * What a line break inside a paste of several lines becomes (readLine): a space by default, so
   * that words, codes or dates pasted one per line are one answer; ";" between shares.
   */
  readonly pastedLineBreak?: PastedLineBreak;
}

/** Checks an answer: returns what it means, or throws an Error whose message is the warning. */
export type AnswerParser<T> = (answer: string) => T | Promise<T>;

/** What one reading of a question gave. */
type Reading =
  | { readonly kind: "answer"; readonly text: string }
  /** Nothing typed but Enter, or Ctrl+D on an empty line. */
  | { readonly kind: "empty" }
  /** Escape: goes back from a visible value, or cancels a secret question. */
  | { readonly kind: "back" }
  /** An answer longer than any valid one, or not UTF-8: the reason, without the answer. */
  | { readonly kind: "unusable"; readonly reason: string }
  /** The input ended (standard input closed): nothing more can be asked. */
  | { readonly kind: "ended" }
  /** Ctrl+C: the command is cancelled. */
  | { readonly kind: "cancelled" };

/** Refuses a question without a terminal, before the terminal is touched. */
function assertTerminal(): void {
  if (terminalAvailable()) return;
  // A terminal of the type "dumb", as in some editors, cannot draw the private screen.
  if (terminalTooDumb())
    throw ERRORS.create("run-command-another-terminal-set-term-such-as", [
      `${dumbTerminalReason("--ask-secrets")}`,
      `${SECRET_SOURCE_ADVICE}`,
    ]);
  throw ERRORS.create("ask-secrets-terminal-on-standard-input-standard-error", [
    `${SECRET_SOURCE_ADVICE}`,
  ]);
}

/**
 * Asks `prompt` once and reads the answer with readLine, after dropping what was typed ahead. On
 * the private screen, which is cleared afterwards, the answer shows as it is typed (`echo`).
 */
async function readAnswer(
  prompt: string,
  how: {
    readonly echo: boolean;
    readonly pastedLineBreak?: PastedLineBreak;
    readonly hints?: WordHints | undefined;
  },
): Promise<Reading> {
  return TerminalKeys.withRawMode(async (next, moreWithin) => {
    if ((await TerminalKeys.dropTypedAhead()) === CANCELLED) return { kind: "cancelled" };
    // The end of the input is told from Ctrl+D by the reader: readLine returns nothing for both.
    let ended = false;
    let wentBack = false;
    // Only valid UTF-8 is shown and read, as in the menu's questions (ValidCharacters).
    const valid = new ValidCharacters(next);
    const reader: NextByte = async () => {
      const byte = await valid.next();
      if (byte === undefined) ended = true;
      return byte;
    };
    writePrompt(`${prompt} `);
    try {
      const text = await readLine(reader, {
        echo: how.echo,
        moreWithin,
        promptWidth: displayWidth(`${prompt} `),
        escapeGoesBack: true,
        onBack: () => {
          wentBack = true;
        },
        ...(how.pastedLineBreak === undefined ? {} : { pastedLineBreak: how.pastedLineBreak }),
        ...(how.hints === undefined ? {} : { hints: how.hints }),
      });
      if (text === CANCELLED) return { kind: "cancelled" };
      // An answer given with Enter that held a byte of no character is refused; Escape still goes
      // back.
      if (text !== undefined && valid.leftOut()) return { kind: "unusable", reason: NOT_UTF8 };
      const trimmed = trimWhiteSpace(text ?? "");
      if (trimmed !== "") return { kind: "answer", text: trimmed };
      if (ended) return { kind: "ended" };
      return { kind: wentBack ? "back" : "empty" };
    } catch (error) {
      const reason = await TerminalKeys.refusedLine(error, next, moreWithin);
      return reason === CANCELLED ? { kind: "cancelled" } : { kind: "unusable", reason };
    } finally {
      // The terminal did not show the Enter key either.
      process.stderr.write("\n");
    }
  });
}

/**
 * Asks for a secret until `parse` accepts the answer, as described at the top, and returns what
 * `parse` made of it, or CANCELLED at Escape, Ctrl+C or the end of the input. Typed text is trimmed; file
 * contents reach parse unchanged. Only the typed answer is echoed on the private screen.
 */
export async function askSecretUntil<T>(
  prompt: string,
  parse: AnswerParser<T>,
  options: SecretAskOptions = {},
): Promise<T | Cancelled> {
  const read = (text: string): T | Promise<T> =>
    parse(options.textFile === undefined ? text : TextFileInput.read(text, options.textFile));
  const shown = `${prompt} (Esc cancels)`;
  return askUntil(shown, read, async () => {
    const reading = await readAnswer(shown, {
      echo: onPrivateScreen(),
      pastedLineBreak: options.pastedLineBreak ?? " ",
      hints: options.hints,
    });
    return turnOfReading(reading, { ...options, leave: "stop" });
  });
}

/** One answer typed to a question that asks until it can be used: its text, or a warning. */
type Answered = { readonly text: string } | { readonly warning: string };

/**
 * A visible value's question left with Escape (askValueUntil); a value of its own, never one that
 * a parser of answers gives.
 */
const WENT_BACK: unique symbol = Symbol("went back");

/** How a typed question treats an answer not given, and how it is left (enteredAnswer). */
type TurnRules = Parameters<typeof enteredAnswer>[1];

/** The turn of a typed answer, trimmed, by the rule of every typed question (enteredAnswer). */
function turnOf(typed: string, rules: TurnRules): Answered {
  const entered = enteredAnswer(typed, rules);
  // No question of ask.ts may be left out: its answer is always a text or the hint.
  return entered.kind === "text"
    ? { text: entered.text }
    : { warning: entered.kind === "refused" ? entered.reason : typeHint(rules.what, rules.leave) };
}

/**
 * The turn of one reading of a question, for a secret and a visible value alike: the end of the
 * input stops, an unusable answer is its warning, and an answer not given is empty. Escape, where
 * it leaves the question, is taken before (askValueUntil).
 */
function turnOfReading(reading: Reading, rules: TurnRules): Answered | Cancelled {
  // Nothing can answer once the input has ended: the command is cancelled.
  if (reading.kind === "ended" || reading.kind === "cancelled" || reading.kind === "back")
    return CANCELLED;
  if (reading.kind === "unusable") return { warning: reading.reason };
  return turnOf(reading.kind === "answer" ? reading.text : "", rules);
}

/**
 * Asks, by `turn`, the question of `prompt` until `parse` accepts an answer, each warning shown
 * before the question comes again: why the answer was refused, or why it was empty. WENT_BACK
 * when the person went back, where `turn` can give it; CANCELLED when they cancelled. The
 * questions for a secret and for a visible value ask through it.
 */
async function askUntil<T, Leaving extends typeof WENT_BACK | Cancelled>(
  prompt: string,
  parse: AnswerParser<T>,
  turn: () => Promise<Answered | Leaving>,
): Promise<T | Leaving | Cancelled> {
  assertTerminal();
  for (let warning: string | undefined; ;) {
    const above = warning === undefined ? [] : noticeLines(warning, "warning");
    if ((await PrivatePage.beforeQuestion(rowsOf(["", ...above, prompt]))) === CANCELLED)
      return CANCELLED;
    if (warning !== undefined && PrivateSteps.active) PrivateSteps.remember(warning);
    const redrawn = PrivateSteps.begin();
    if (warning !== undefined && !redrawn) terminalNotice(warning, "warning");
    const answer = await turn();
    if (typeof answer !== "object") {
      if (answer === WENT_BACK) PrivateSteps.questionEnded();
      return answer;
    }
    if ("warning" in answer) warning = answer.warning;
    else
      try {
        const accepted = await parse(answer.text);
        PrivateSteps.answerAccepted();
        return accepted;
      } catch (error) {
        warning = refusal(error);
      }
  }
}

/**
 * Asks for a visible value that is no secret, such as a fingerprint or a file name, until `parse`
 * accepts it; undefined when the person goes back with Escape, CANCELLED at Ctrl+C. Enter alone
 * answers the `fallback` where there is one, which the prompt names.
 */
export async function askValueUntil<T>(
  prompt: string,
  parse: AnswerParser<T>,
  options: ValueAskOptions = {},
): Promise<T | undefined | Cancelled> {
  const answer = await askUntil(prompt, parse, async () => {
    const reading = await readAnswer(prompt, { echo: true });
    if (reading.kind === "back") return WENT_BACK;
    return turnOfReading(reading, { ...options, leave: "back" });
  });
  return answer === WENT_BACK ? undefined : answer;
}

/**
 * Asks what to do after a failure that no answer caused and that no new answer to the same
 * question mends: no result, a wallet that matched nothing, a file that could not be saved. The
 * choices are listed with the arrow keys and digits (choose); Escape, q and the end of the input
 * pick the last one, which must therefore stop or change nothing ("Stop", "Done", "Skip"). Ctrl+C
 * gives CANCELLED. `escape` says what Escape does in the key hint ("stops" by default).
 */
export async function askAfterFailure<T>(
  question: string,
  choices: readonly Choice<T>[],
  options: AfterFailureOptions & { readonly escape?: string } = {},
): Promise<T | Cancelled> {
  const last = choices.at(-1);
  if (last === undefined) throw ERRORS.create("question-after-failure-choice", []);
  assertTerminal();
  const chosen = await choose(question, choices, {
    label: options.label ?? "Next",
    quit: options.escape ?? "stops",
    ...(options.explanation === undefined ? {} : { explanation: options.explanation }),
  });
  return chosen === undefined ? last.value : chosen;
}

/** What a question after a failure may show besides its choices. */
export interface AfterFailureOptions {
  /** Its line in the record of answers; "Next" by default. */
  readonly label?: string;
  /** Text shown with the question, such as why the question is asked. */
  readonly explanation?: Explanation;
}

/** The question after a failure, where nothing more particular is asked; others end with it. */
export const WHAT_NOW = "What now?";

/** The value of the Stop that askOrCancel adds, which no other answer of its question may have. */
const STOPPED = "stop";

/**
 * Asks what to do after a failure (askAfterFailure), with a Stop of its own as the last choice,
 * which cancels the command (CANCELLED): so Escape, q and the end of the input stop. With `back`,
 * for a question reached from another, Escape goes back instead and gives undefined.
 */
export async function askOrCancel<T>(
  question: string,
  choices: readonly Choice<T>[],
  options?: AfterFailureOptions & { readonly back?: false },
): Promise<T | Cancelled>;
export async function askOrCancel<T>(
  question: string,
  choices: readonly Choice<T>[],
  options: { readonly label?: string; readonly back: boolean },
): Promise<T | undefined | Cancelled>;
export async function askOrCancel<T>(
  question: string,
  choices: readonly Choice<T>[],
  options: AfterFailureOptions & { readonly back?: boolean } = {},
): Promise<T | undefined | Cancelled> {
  if (choices.some((choice) => choice.value === STOPPED))
    throw ERRORS.create("answer-question-stop-value", [`${STOPPED}`]);
  const all: Choice<T | typeof STOPPED>[] = [...choices, { label: "Stop", value: STOPPED }];
  const chosen =
    options.back === true
      ? await chooseOrBack(question, all, options.label)
      : await askAfterFailure(question, all, {
          ...(options.label === undefined ? {} : { label: options.label }),
          ...(options.explanation === undefined ? {} : { explanation: options.explanation }),
        });
  if (chosen === STOPPED) return CANCELLED;
  return chosen;
}

/**
 * The choice of a question reached from another: undefined at Escape, q or the end of the input,
 * which go back. At the end of the input the question gone back to then picks its Stop, so that
 * nothing loops.
 */
async function chooseOrBack<T>(
  question: string,
  choices: readonly Choice<T>[],
  label = "Next",
): Promise<T | undefined | Cancelled> {
  assertTerminal();
  return choose(question, choices, { label, quit: "goes back" });
}

// Keep the existing prompt helpers' import path while file admission owns path normalization.
export { droppedPath } from "./text-file.js";
