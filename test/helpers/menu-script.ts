// The questions of the start menu answered by a script instead of a person. They run as they do at
// a terminal; only the program's edges are replaced: the terminal's input (raw-mode-keys.ts), which
// types the script's answer to what each question drew on standard error (drawn-question.ts), and
// pdftocairo, which images of cards need. `answers` holds the place of the answer to each list
// question in turn, typed as its digit or as arrows and Enter, and `asked` records each list
// question as it showed. A typed question takes the answers of `typed` for it in turn, then its
// usual one; as at the terminal, an answer that its check refuses is asked again, with the reason
// as its warning, and Enter alone takes the fallback or leaves an optional answer out. A test file
// loads this module in vi.hoisted, and its vi.mock factories replace each module with what is here;
// so this module imports no module that a test replaces, and loads cut-notes.ts, which measures
// with the questions' own module, only once they run.

import { KEY } from "../../src/cli/terminal-keys.js";
import { keysOfAnswer, type DrawnList } from "./drawn-list.js";
import { drawnQuestion, recordLabel, type DrawnQuestion } from "./drawn-question.js";
import { keyedTerminalKeys } from "./raw-mode-keys.js";

type ImageExport = typeof import("../../src/export/image-export.js");
type TerminalInput = typeof import("../../src/cli/terminal-input.js");

/** The key that ends a typed answer. */
const ENTER = String.fromCharCode(KEY.CARRIAGE_RETURN);

/** What the script answers, and what the questions asked. */
interface MenuScript {
  /** The place of the answer to each list question in turn; the first entry where none is left. */
  answers: number[];
  /** The list questions, each asking as it showed. */
  asked: DrawnQuestion[];
  /** Every distinct line that a list question drew, without colours. */
  drawnLines: Set<string>;
  /** The labels of the lines that the questions wrote in the record of answers, each once. */
  labels: string[];
  /** The answers typed at each typed question in turn, by the question. */
  typed: Record<string, string[]>;
  /** The answer typed at a question once its `typed` ones are used up, by the question. */
  usual: Record<string, string>;
  /** Each asking of a typed question, with the warning above it. */
  lines: { question: string; warning: string | undefined }[];
  /** Whether pdftocairo, which images need, is missing. */
  noImages: boolean;
}

/** What the script answers, and what the questions asked. */
export const script: MenuScript = {
  answers: [],
  asked: [],
  drawnLines: new Set(),
  labels: [],
  typed: {},
  usual: {},
  lines: [],
  noImages: false,
};

/** The keys of the script's answer to the list question `question`, which shows `list`. */
async function listAnswer(question: DrawnQuestion, list: DrawnList): Promise<string> {
  const { recordDrawnCuts } = await import("./cut-notes.js");
  recordDrawnCuts(list);
  const place = script.answers[script.asked.length] ?? 0;
  script.asked.push(question);
  for (const line of question.lines) script.drawnLines.add(line);
  const entry = list.entries[place];
  if (entry === undefined) throw new Error(`"${list.question}" has no entry at ${place}`);
  return keysOfAnswer(list, entry.label);
}

/**
 * The keys of the script's answer to the typed question `question`. Asked again with the reason
 * of a refusal and nothing more to type, it fails: the script would answer the same for ever.
 */
function lineAnswer({ question, warning }: DrawnQuestion): string {
  const askedAgain = warning !== undefined && script.lines.at(-1)?.question === question;
  script.lines.push({ question, warning });
  const queued = script.typed[question];
  if (askedAgain && (queued === undefined || queued.length === 0))
    throw new Error(`"${question}" refused its last answer: ${warning}`);
  return `${queued?.shift() ?? script.usual[question] ?? ""}${ENTER}`;
}

/**
 * The terminal's input, which types the script's answer to each question; each list question is
 * recorded in `script.asked`, and the label of each answer's line in the record of answers, which
 * shows in colour, in `script.labels`.
 */
export function replacedTerminalInput(actual: TerminalInput): TerminalInput {
  const TerminalKeys = keyedTerminalKeys(actual, {
    keysFor: (drawn) => {
      const question = drawnQuestion(drawn);
      if (question === undefined) throw new Error(`no question of the menu drew this: ${drawn}`);
      return question.list === undefined
        ? lineAnswer(question)
        : listAnswer(question, question.list);
    },
    ended: (written) => {
      const label = recordLabel(written);
      if (label !== undefined && !script.labels.includes(label)) script.labels.push(label);
    },
  });
  return { ...actual, TerminalKeys };
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
