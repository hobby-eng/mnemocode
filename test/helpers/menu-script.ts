// The questions of the start menu answered by a script instead of a terminal: `answers` holds the
// place of the answer to each list question in turn, and `asked` records how many choices each
// question offered. A typed question takes the answers of `typed` for it in turn, then its usual
// one; as at the terminal, an answer that its check refuses is asked again, with the reason as its
// warning, and Enter alone takes the fallback or leaves an optional answer out. A test file loads
// this module in vi.hoisted, and its vi.mock factories replace each module with what is here; so
// this module imports no module that a test replaces.

import type { Choice, ChooseOptions, LineQuestion } from "../../src/cli/terminal-choice.js";

type CardsFit = typeof import("../../src/cli/cards-fit.js");
type ImageExport = typeof import("../../src/export/image-export.js");
type TerminalChoice = typeof import("../../src/cli/terminal-choice.js");
type TerminalInput = typeof import("../../src/cli/terminal-input.js");

/** What the script answers, and what the questions asked. */
interface MenuScript {
  /** The place of the answer to each list question in turn; the first entry where none is left. */
  answers: number[];
  asked: { question: string; count: number; labels: string[]; warning?: string | undefined }[];
  lists: string[][];
  explanations: string[][];
  labels: string[];
  /** The answers typed at each typed question in turn, by the question. */
  typed: Record<string, string[]>;
  /** The answer typed at a question once its `typed` ones are used up, by the question. */
  usual: Record<string, string>;
  lines: { question: string; warning?: string | undefined }[];
  /** Notes and examples longer than their list's room, which the list would cut. */
  cutNotes: string[];
  /** Whether pdftocairo, which images need, is missing. */
  noImages: boolean;
  /**
   * Whether typed card details are checked by drawing the cards (cards-fit.ts). A render takes
   * seconds, and the walk through every path types details on many, so only a test of the check
   * turns it on.
   */
  fitCards: boolean;
  /** The value and the key of each answer, by the question last asked with them. */
  digits: Record<string, { value: unknown; digit?: number | null | undefined }[]>;
}

/** What the script answers, and what the questions asked. */
export const script: MenuScript = {
  answers: [],
  asked: [],
  lists: [],
  explanations: [],
  labels: [],
  typed: {},
  usual: {},
  lines: [],
  cutNotes: [],
  noImages: false,
  fitCards: false,
  digits: {},
};

/** Width checks need each distinct screen once; the exhaustive walk otherwise retains gigabytes. */
function keepScreen(screens: string[][], lines: string[]): void {
  if (
    !screens.some(
      (seen) => seen.length === lines.length && seen.every((line, at) => line === lines[at]),
    )
  )
    screens.push(lines);
}

/** The list and typed questions, answered by the script. */
export function replacedTerminalChoice(actual: TerminalChoice): TerminalChoice {
  return {
    ...actual,
    choose: async <T>(question: string, choices: readonly Choice<T>[], options: ChooseOptions) => {
      if (!script.labels.includes(options.label)) script.labels.push(options.label);
      keepScreen(script.explanations, actual.explanationLines(options.explanation));
      const place = script.answers[script.asked.length] ?? 0;
      const labels = choices.map((choice) => choice.label);
      script.asked.push({ question, count: choices.length, labels, warning: options.warning });
      keepScreen(script.lists, actual.listLines(choices, place));
      script.digits[question] = choices.map(({ value, digit }) => ({ value, digit }));
      const room = actual.notesRoom(choices);
      for (const choice of choices)
        for (const text of [choice.note, choice.example])
          if (text !== undefined && Array.from(text).length > room)
            script.cutNotes.push(`${question} ${choice.label}: ${text}`);
      return choices[place]!.value;
    },
    askLine: async (question: string, label: string, given?: LineQuestion) => {
      const options = given ?? {};
      if (!script.labels.includes(label)) script.labels.push(label);
      for (let warning = options.warning; ;) {
        script.lines.push({ question, warning });
        const queued = script.typed[question];
        const typed = (queued?.shift() ?? script.usual[question] ?? "").trim();
        if (typed === "" && options.optional !== undefined) return "";
        const answer = typed === "" ? options.fallback : typed;
        try {
          if (answer === undefined) throw new Error(`Type ${options.what ?? "an answer"}.`);
          return options.check === undefined ? answer : await options.check(answer);
        } catch (error) {
          warning = error instanceof Error ? error.message : String(error);
          // Without a further answer the walk would ask for ever.
          if (queued === undefined || queued.length === 0)
            throw new Error(`"${question}" refused "${answer}": ${warning}`);
        }
      }
    },
  };
}

/** The checks of typed card details, which draw the cards only where `script.fitCards` says so. */
export function replacedCardsFit(actual: CardsFit): CardsFit {
  return {
    ...actual,
    assertColorCardsFit: async (options, form) => {
      if (script.fitCards) await actual.assertColorCardsFit(options, form);
    },
    assertShareCardsFit: async (options, shareFormat) => {
      if (script.fitCards) await actual.assertShareCardsFit(options, shareFormat);
    },
  };
}

/** The terminal's input, which has nothing typed ahead to drop. */
export function replacedTerminalInput(actual: TerminalInput): TerminalInput {
  class ScriptKeys extends actual.TerminalKeys {
    static override async dropTypedAhead(): Promise<undefined> {
      return undefined;
    }
  }
  return { ...actual, TerminalKeys: ScriptKeys };
}

/** The images of cards, whose renderer is missing when `script.noImages` says so. */
export function replacedImageExport(actual: ImageExport): ImageExport {
  return {
    ...actual,
    assertImageRenderer: async () => {
      if (script.noImages) throw new Error("pdftocairo is missing");
    },
  };
}
