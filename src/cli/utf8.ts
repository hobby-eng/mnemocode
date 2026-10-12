// The rules of UTF-8 (RFC 3629) that reading text needs: how many bytes a character has, which
// bytes continue one, a reader that passes on valid characters only, and the strict decoding of a
// file or of standard input. One owner for the terminal modules (terminal-input.ts,
// terminal-geometry.ts, terminal-choice.ts, ask.ts) and for the readers of text input (input.ts).

/** The two top bits of a byte, and the value they have in a byte that continues a character. */
const CONTINUATION_MASK = 0b1100_0000;
const CONTINUATION = 0b1000_0000;

/** Whether `byte` continues a character rather than starting one. */
export function isContinuation(byte: number): boolean {
  return (byte & CONTINUATION_MASK) === CONTINUATION;
}

/**
 * The bytes of the UTF-8 character that `first` starts, or 0 for a byte that starts none (RFC 3629,
 * section 4): a continuation byte; C0 and C1, which only overlong forms use; F5 to FF, which would
 * lie beyond U+10FFFF.
 */
export function characterLength(first: number): number {
  if (first < 0x80) return 1;
  if (first >= 0xc2 && first <= 0xdf) return 2;
  if (first >= 0xe0 && first <= 0xef) return 3;
  if (first >= 0xf0 && first <= 0xf4) return 4;
  return 0;
}

/** Decodes UTF-8 as an answer is decoded: anything else, such as a surrogate, throws. */
export const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Decodes as STRICT_UTF8 does, but keeps a leading byte order mark, which TextDecoder would drop by
 * default: each reader of a file decides about it (parseListPassphrase and the WIF file drop it).
 */
const STRICT_UTF8_WITH_BOM = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Why text that holds bytes of no UTF-8 character is refused, for `what` it was read from. */
export function notUtf8Text(what: string): string {
  return `${what} is not valid UTF-8 text.`;
}

/**
 * The text of a file or of standard input, `bytes`, refused as a whole when it is not valid UTF-8
 * (notUtf8Text): a byte replaced by U+FFFD would turn a passphrase into another one without a word
 * (AUD-014-API002). A U+FFFD written as valid UTF-8 is kept, as is a leading byte order mark and
 * every line break; the caller owns `bytes` and wipes them.
 */
export function strictUtf8Text(bytes: Uint8Array, what: string): string {
  try {
    return STRICT_UTF8_WITH_BOM.decode(bytes);
  } catch (error) {
    // TextDecoder refuses with a TypeError, whose message names no byte of the text.
    if (error instanceof TypeError) throw new Error(notUtf8Text(what));
    throw error;
  }
}

/** Whether `bytes`, one character's, are valid UTF-8. */
function isValidCharacter(bytes: readonly number[]): boolean {
  try {
    STRICT_UTF8.decode(Uint8Array.from(bytes));
    return true;
  } catch {
    return false;
  }
}

/** The next byte typed, or undefined at the end of the input (terminal-input.ts NextByte). */
type ByteSource = () => Promise<number | undefined>;

/** A reader that passes on only valid UTF-8 (validCharacters). */
export interface CharacterReader {
  readonly next: ByteSource;
  /** Whether a byte was left out. */
  readonly leftOut: () => boolean;
}

/**
 * Reads `next` and passes on the control bytes and whole characters of valid UTF-8 only, each
 * character once all of its bytes have come; any other byte, such as é from a terminal set to
 * Latin-1, is left out and noted. The line reader would show such a byte, which each terminal
 * draws in its own way, and refuse the answer only at its end, when the rows that it took could
 * no longer be counted. Left out, the answer read is the answer shown, and the question refuses it
 * at Enter (NOT_UTF8).
 */
export function validCharacters(next: ByteSource): CharacterReader {
  let leftOut = false;
  // The rest of a character whose first byte was passed on.
  const rest: number[] = [];
  const read: ByteSource = async () => {
    if (rest.length > 0) return rest.shift();
    let byte = await next();
    for (;;) {
      if (byte === undefined) return undefined;
      const length = characterLength(byte);
      if (length === 1) return byte;
      const character = [byte];
      while (character.length < length) {
        byte = await next();
        if (byte === undefined || !isContinuation(byte)) break;
        character.push(byte);
      }
      const whole = length > 0 && character.length === length;
      if (whole && isValidCharacter(character)) {
        rest.push(...character.slice(1));
        return character[0];
      }
      leftOut = true;
      // A byte that cut a character short starts what comes next; after the rest, read on.
      if (length === 0 || whole) byte = await next();
    }
  };
  return { next: read, leftOut: () => leftOut };
}
