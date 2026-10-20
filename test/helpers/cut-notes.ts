import { notesRoom, type Choice } from "../../src/cli/terminal-choice.js";

/** The notes and examples of the lists asked so far that a list would cut to fit (notesRoom). */
const cut: string[] = [];

/** Records the notes and examples of `choices` that are longer than their list's room. */
export function recordCutNotes(question: string, choices: readonly Choice<unknown>[]): void {
  const room = notesRoom(choices);
  for (const choice of choices)
    for (const text of [choice.note, choice.example])
      if (text !== undefined && Array.from(text).length > room)
        cut.push(`${question} ${choice.label}: ${text}`);
}

/** The notes recorded since the last call, which a test expects to be none. */
export function takeCutNotes(): string[] {
  return cut.splice(0);
}
