// What every self-test check is made of: its row in the report, the checks of one feature (quick
// known answers for every start, and its row in the full self-test), and the comparisons they make.
// Each feature keeps its checks in a module beside it, so that a build without the feature carries
// none of them; core/self-test.ts composes those of the library, and a host adds those of the
// features it builds in.
//
// Host-neutral: it imports nothing.

/** One check of a self-test: its name and what it covers, as the report shows them. */
export interface SelfTestCheck {
  readonly name: string;
  readonly detail: string;
  run(): void | Promise<void>;
}

/**
 * The checks of one feature that a host builds in: known answers quick enough for every start,
 * and the feature's row in the full self-test, which runs them too, with the slower checks.
 */
export interface SelfTestFeature {
  /** Synchronous known answers that need nothing from the host: milliseconds. */
  readonly startup: () => void;
  readonly check: SelfTestCheck;
}

/** Throws, naming what was compared, unless `actual` is exactly `expected`. */
export function expectSame(actual: unknown, expected: unknown, name: string): void {
  if (actual !== expected) throw new Error(`${name} mismatch.`);
}

/** The message of what `run` throws, or undefined when it throws nothing. */
function refusalOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

/**
 * Throws, naming the case, unless `run` refuses it with a message that `because` matches: a case
 * the feature must refuse, for the reason it must refuse it.
 */
export function expectRefused(run: () => unknown, because: RegExp, name: string): void {
  const message = refusalOf(run);
  if (message === undefined) throw new Error(`${name} was accepted.`);
  if (!because.test(message)) throw new Error(`${name} was refused for another reason.`);
}

/** The same as expectRefused, for an operation that answers later. */
export async function expectRefusedLater(
  run: () => Promise<unknown>,
  because: RegExp,
  name: string,
): Promise<void> {
  let message: string | undefined;
  try {
    await run();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (message === undefined) throw new Error(`${name} was accepted.`);
  if (!because.test(message)) throw new Error(`${name} was refused for another reason.`);
}

/** The bytes of hexadecimal text, as known answers write them. */
export function bytesOfHex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

/** Bytes as lowercase hexadecimal text. */
export function hexOfBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
