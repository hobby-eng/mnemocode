// The question before a long search, the same in every command that searches: whether to start
// it, after the keys typed ahead are dropped. A module of its own, beside the questions it asks
// with (terminal-choice.ts), so that a test can answer them.

import { choose } from "./terminal-choice.js";
import type { Cancelled } from "./terminal-keys.js";

/** An option that allows a longer search, such as "max-tries", and the count it needs. */
export type SearchAllowance = readonly [option: string, count: number];

/**
 * The refusal of a search that would be asked for where nothing can be asked: what it takes
 * (`extent`, such as SearchPlan.extent), and the options that allow it, each with the count it
 * needs. The date search names one option; the share repair also names the date search after it.
 */
export function allowedBy(extent: string, allowances: readonly SearchAllowance[]): string {
  const options = allowances.map(([option, count]) => `--${option} ${count}`).join(" and ");
  return `${extent} Allow it with ${options}.`;
}

/** What the answer No to a long search does: its note, and what Escape does, said in the hint. */
export interface SearchRefusal {
  readonly note: string;
  readonly quit: string;
}

/**
 * Asks whether a search longer than its limit starts: "yes", which Ctrl+C stops, or "no", which
 * does what `no` says and which Escape also answers; CANCELLED when the command is cancelled. Keys
 * typed before, such as while the search was timed, never answer it. Every search of the command
 * line asks it so.
 */
export async function askToSearch(
  question: string,
  no: SearchRefusal,
): Promise<"yes" | "no" | Cancelled> {
  const start = await choose(
    question,
    [
      { label: "Yes", note: "Ctrl+C stops it", value: "yes" as const },
      { label: "No", note: no.note, value: "no" as const },
    ],
    { label: "Search", quit: no.quit },
  );
  return start ?? "no";
}
