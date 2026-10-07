import { notesRoom } from "../../src/cli/terminal-choice.js";

/** The notes and examples of the lists asked so far that a list would cut to fit (notesRoom). */
const cut: string[] = [];

/** Records the notes and examples of `choices` that are longer than their list's room. */
export function recordCutNotes(
  question: string,
  choices: readonly { readonly label: string; readonly note?: string; readonly example?: string }[],
): void {
  const room = notesRoom(choices as never);
  for (const choice of choices)
    for (const text of [choice.note, choice.example])
      if (text !== undefined && [...text].length > room)
        cut.push(`${question} ${choice.label}: ${text}`);
}

/** The notes recorded since the last call, which a test expects to be none. */
export function takeCutNotes(): string[] {
  return cut.splice(0);
}
