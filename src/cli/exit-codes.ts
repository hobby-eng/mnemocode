// How a tool ends when the person or a signal stops it: the shell's rule for the exit code of a
// process that a signal stopped, the code and the one line of Ctrl+C. A leaf that imports only
// node:os and is written in TypeScript that Node runs by stripping its types, so that a maintainer
// script ends as the command line does (scripts/sign-release.mjs).

import { constants } from "node:os";

/** What a shell reports for a process that a signal stopped: 128 plus the signal's number. */
const SIGNAL_EXIT_BASE = 128;

/** The exit code of a tool stopped by Ctrl+C: that of a process stopped by SIGINT, 130. */
export const CANCELLED_EXIT_CODE = SIGNAL_EXIT_BASE + constants.signals.SIGINT;

/** What a tool stopped by the person says. */
export const CANCELLED_MESSAGE = "Cancelled.";

/** The exit code that a shell reports for a process that `signal` stopped. */
export function exitCodeOfSignal(signal: NodeJS.Signals | null): number {
  return SIGNAL_EXIT_BASE + (signal === null ? 0 : (constants.signals[signal] ?? 0));
}

/** Whether `code` is what a shell reports for a process that a signal stopped. */
export function stoppedBySignal(code: number): boolean {
  return code > SIGNAL_EXIT_BASE;
}

/** The name of the signal that ended a process with `code` (exitCodeOfSignal). */
export function signalNameOf(code: number): string {
  const number = code - SIGNAL_EXIT_BASE;
  const name = Object.entries(constants.signals).find(([, value]) => value === number)?.[0];
  return name ?? `signal ${number}`;
}
