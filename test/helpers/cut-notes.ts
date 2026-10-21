import { notesRoom } from "../../src/cli/terminal-choice.js";
import type { DrawnList } from "./drawn-list.js";

/** The notes and examples of the lists asked so far that their list cut to fit (notesRoom). */
const cut: string[] = [];

/** The mark at the end of a note or an example that a list cut to fit its room (shortened). */
const CUT_MARK = "…";
/**
 * How a text ends by its own words, as the menu's samples of codes do (sampleOf): a space, then
 * CUT_MARK. A list's cut keeps its text's characters up to the mark, so it ends so only where its
 * text had a space just there, which a drawn list cannot tell apart from a sample.
 */
const OWN_END = ` ${CUT_MARK}`;

/**
 * Records the notes and examples of `list`, as choose drew it, that it cut to fit: a text cut
 * fills its list's room and ends with CUT_MARK. A text that ends with OWN_END is not taken for a
 * cut one: a sample of the menu fills its room by design and ends so.
 */
export function recordDrawnCuts(list: DrawnList): void {
  const room = notesRoom(list.entries.map(({ label }) => ({ label, value: label })));
  for (const entry of list.entries)
    for (const text of [entry.note, entry.example])
      if (
        text !== undefined &&
        text.endsWith(CUT_MARK) &&
        !text.endsWith(OWN_END) &&
        Array.from(text).length === room
      )
        cut.push(`${list.question} ${entry.label}: ${text}`);
}

/** The notes recorded since the last call, which a test expects to be none. */
export function takeCutNotes(): string[] {
  return cut.splice(0);
}
