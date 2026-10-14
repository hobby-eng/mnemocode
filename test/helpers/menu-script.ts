// The questions of the start menu answered by a script instead of a terminal: `answers` holds the
// place of the answer to each list question in turn, and `asked` records how many choices each
// question offered. A typed question takes the answers of `typed` for it in turn, then its usual
// one; as at the terminal, an answer that its check refuses is asked again, with the reason as its
// warning, and Enter alone takes the fallback or leaves an optional answer out. A test file loads
// this module in vi.hoisted, and its vi.mock factories replace each module with what is here; so
// this module imports no module that a test replaces.

import type { LineQuestion } from "../../src/cli/terminal-choice.js";

type ImageExport = typeof import("../../src/export/image-export.js");
type TerminalChoice = typeof import("../../src/cli/terminal-choice.js");
type TerminalInput = typeof import("../../src/cli/terminal-input.js");

/** What the script answers, and what the questions asked. */
export const script = {
  answers: [] as number[],
  asked: [] as {
    question: string;
    count: number;
    labels: string[];
    warning?: string | undefined;
  }[],
  lists: [] as string[][],
  explanations: [] as string[][],
  labels: [] as string[],
  typed: {} as Record<string, string[]>,
  usual: {} as Record<string, string>,
  lines: [] as { question: string; warning?: string | undefined }[],
  /** Notes and examples longer than their list's room, which the list would cut. */
  cutNotes: [] as string[],
  /** Whether pdftocairo, which images need, is missing. */
  noImages: false,
  /** The value and the key of each answer, by the question last asked with them. */
  digits: {} as Record<string, { value: unknown; digit?: number | undefined }[]>,
};

/** The list and typed questions, answered by the script. */
export function replacedTerminalChoice(actual: TerminalChoice): TerminalChoice {
  return {
    ...actual,
    choose: (async (
      question: string,
      choices: readonly { label: string; value: unknown }[],
      options: { readonly label: string; readonly explanation?: never; readonly warning?: string },
    ) => {
      script.labels.push(options.label);
      script.explanations.push(actual.explanationLines(options.explanation));
      const place = script.answers[script.asked.length] ?? 0;
      const labels = choices.map((choice) => choice.label);
      script.asked.push({ question, count: choices.length, labels, warning: options.warning });
      script.lists.push(actual.listLines(choices as never, place));
      script.digits[question] = (choices as readonly { value: unknown; digit?: number }[]).map(
        ({ value, digit }) => ({ value, digit }),
      );
      const room = actual.notesRoom(choices as never);
      for (const choice of choices as readonly { label: string; note?: string; example?: string }[])
        for (const text of [choice.note, choice.example])
          if (text !== undefined && Array.from(text).length > room)
            script.cutNotes.push(`${question} ${choice.label}: ${text}`);
      return choices[place]!.value;
    }) as TerminalChoice["choose"],
    askLine: (async (question: string, label: string, given?: LineQuestion) => {
      const options = given ?? {};
      script.labels.push(label);
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
          warning = (error as Error).message;
          // Without a further answer the walk would ask for ever.
          if (queued === undefined || queued.length === 0)
            throw new Error(`"${question}" refused "${answer}": ${warning}`);
        }
      }
    }) as TerminalChoice["askLine"],
  };
}

/** The terminal's input, which has nothing typed ahead to drop. */
export function replacedTerminalInput(actual: TerminalInput): TerminalInput {
  return { ...actual, dropTypedAhead: async () => undefined };
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
