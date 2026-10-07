// What the searches of the library share in how they run in a host: a turn of the host's event
// loop now and then, so that a page or a terminal can show progress and stop a search of hours
// (AUD-008-API001), and the checks of the counts a host passes to a run. A small service that the
// date search and the word search use by composition; it holds nothing.
//
// Needs from the host: nothing; setTimeout, which every host has, is the default turn.

/**
 * A search expected to take longer than this on the host's computer is asked for first: twelve
 * hours. Up to then it starts at once, with its progress shown and a way to stop it; a longer
 * one is a choice the person makes. The share repair and the date search both ask by it.
 */
export const QUESTION_SECONDS = 12 * 3_600;

/** Milliseconds of search between two turns of the host's event loop. */
export const TURN_MILLISECONDS = 50;

/** Waits for the next task of the event loop, which lets a page or a worker take messages. */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A count that a run keeps, such as the matches it shows: a whole number of 0 or more. */
export function keptCount(count: number | undefined, fallback: number, name: string): number {
  if (count === undefined) return fallback;
  if (!Number.isSafeInteger(count) || count < 0)
    throw new RangeError(`${name} must be a whole number of 0 or more.`);
  return count;
}
