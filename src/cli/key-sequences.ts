// The escape sequences that keys send (ECMA-48 CSI and SS3), read to their end so that no byte of
// one is taken for a key of its own, also when a slow link splits a sequence from its Escape; and
// the editing keys that a visible answer takes from them (terminal-input.ts).

import { ESCAPE_DELAY_MS, type MoreWithin, type NextByte, PASTE_GAP_MS } from "./terminal-keys.js";
import { InputBytes } from "./input-bytes.js";
import { defined } from "../core/defined.js";

/** The bytes after ESC that start a control sequence (CSI, "[") or a single shift (SS3, "O"). */
const CSI_INTRODUCER = 0x5b;

const SS3_INTRODUCER = 0x4f;

/** ECMA-48's parameter bytes (0 to 9, ; and the like) between the introducer and the final byte. */
const PARAMETER_FIRST = 0x30;

const PARAMETER_LAST = 0x3f;

/** ECMA-48's final bytes, @ to ~, one of which ends a sequence. */
const FINAL_FIRST = 0x40;

const FINAL_LAST = 0x7e;

/** The printable ASCII characters, space to ~; ESC before one of them is Alt with that key. */
const PRINTABLE_FIRST = 0x20;

const PRINTABLE_LAST = 0x7e;

/** Longer than any key's sequence, such as ESC [ 2 4 ; 5 ~ (Ctrl+F12). */
const MAX_KEY_SEQUENCE_BYTES = 8;

/** A transient replay view transferred to the caller, which clears it after replay admission. */
function replayOf(bytes: InputBytes): number[] {
  const replay: number[] = [];
  while (bytes.length > 0) replay.push(defined(bytes.shift()));
  return replay;
}

function parametersOf(bytes: InputBytes): string {
  const replay = replayOf(bytes);
  try {
    // The final byte is already held by the caller as the key discriminator.
    replay.pop();
    return String.fromCharCode(...replay);
  } finally {
    replay.fill(0);
  }
}

/** What followed an ESC that more bytes followed at once. */
type EscapeSequence =
  /** A whole sequence: its introducer, its parameter bytes as text and its final byte. */
  | {
      readonly kind: "sequence";
      readonly introducer: number;
      readonly parameters: string;
      readonly final: number;
    }
  /** A printable character, as Alt with that key sends it: no key of MnemoCode's. */
  | { readonly kind: "alt" }
  /** No key's sequence: the bytes to read again as typed, in order. */
  | { readonly kind: "none"; readonly readAgain: number[] };

/**
 * Reads what follows an ESC that more bytes followed at once: a key's sequence as ECMA-48 shapes
 * it, [ or O, parameter bytes and one final byte. A terminal sends a key's whole sequence at once,
 * so one that stops short is no key: at a byte that cannot stand in it, such as a space, Enter,
 * Backspace or Ctrl+C, after MAX_KEY_SEQUENCE_BYTES, at the end of the input or, with
 * `moreWithin`, after a pause of ESCAPE_DELAY_MS. The bytes read after the [ or O are then given
 * back (readAgain), the one that ended it included, so that each keeps its meaning: Alt+[, or
 * Escape and [ pressed quickly, loses no digit typed after it, and Enter still ends the answer and
 * Ctrl+C still cancels. A control key or a non-ASCII character right after ESC, such as Alt+Enter
 * or a second Escape, is given back the same way.
 */
export async function readEscapeSequence(
  next: NextByte,
  moreWithin: MoreWithin | undefined,
): Promise<EscapeSequence> {
  const introducer = await next();
  if (introducer === undefined) return { kind: "none", readAgain: [] };
  if (introducer !== CSI_INTRODUCER && introducer !== SS3_INTRODUCER) {
    const printable = introducer >= PRINTABLE_FIRST && introducer <= PRINTABLE_LAST;
    return printable ? { kind: "alt" } : { kind: "none", readAgain: [introducer] };
  }
  using read = new InputBytes();
  while (read.length < MAX_KEY_SEQUENCE_BYTES) {
    if (moreWithin !== undefined && !(await moreWithin(ESCAPE_DELAY_MS))) break;
    const byte = await next();
    if (byte === undefined) break;
    read.push(byte);
    if (byte >= FINAL_FIRST && byte <= FINAL_LAST) {
      const parameters = parametersOf(read);
      return { kind: "sequence", introducer, parameters, final: byte };
    }
    if (byte < PARAMETER_FIRST || byte > PARAMETER_LAST) break;
  }
  return { kind: "none", readAgain: replayOf(read) };
}

/**
 * How long after an Escape alone, which a question for a secret ignores, the rest of a key's
 * sequence is still read as that key: a slow remote link may deliver ESC and "[B" of an arrow key
 * apart, and "[B" must not become part of the answer.
 */
const LATE_SEQUENCE_MS = 1000;

/** Whether `byte` may start the rest of the sequence of an Escape ignored at `ignoredAt`. */
export function mayBeLateSequence(byte: number, ignoredAt: number | undefined): boolean {
  return (
    (byte === CSI_INTRODUCER || byte === SS3_INTRODUCER) &&
    ignoredAt !== undefined &&
    Date.now() - ignoredAt <= LATE_SEQUENCE_MS
  );
}

/**
 * The final bytes of the sequences that keys send (xterm's ctlseqs, "PC-Style Function Keys"):
 * the arrows A to D, E (keypad 5), F and H (End, Home), G (keypad 5 on some terminals), P to S
 * (F1 to F4), Z (Shift+Tab) and ~ (Insert, Delete, Page Up and Down, F5 and up). After SS3 only
 * those without parameters; MnemoCode never switches the keypad to its application mode, whose
 * SS3 sequences end in letters that text also has.
 */
const CSI_KEY_FINALS = new Set(Array.from("ABCDEFGHPQRSZ~", (final) => final.charCodeAt(0)));

const SS3_KEY_FINALS = new Set(Array.from("ABCDFHPQRS", (final) => final.charCodeAt(0)));

/**
 * Reads the bytes after `introducer`, a [ or O typed soon after an ignored Escape, and tells
 * whether they are the rest of that Escape's key: a terminal sends a key's whole sequence at once,
 * and nothing follows it at once unless it is a paste. Typed text comes key by key, and pasted
 * text goes on after the final byte. A key's sequence gives the key; anything else gives back the
 * bytes read after the introducer, which are then read as typed (the introducer is text).
 */
export async function readLateSequence(
  introducer: number,
  next: NextByte,
  moreWithin: MoreWithin,
): Promise<{ readonly key: EditKey } | { readonly readAgain: number[] }> {
  using rest = new InputBytes();
  const finals = introducer === CSI_INTRODUCER ? CSI_KEY_FINALS : SS3_KEY_FINALS;
  while (rest.length < MAX_KEY_SEQUENCE_BYTES && (await moreWithin(PASTE_GAP_MS))) {
    const byte = await next();
    if (byte === undefined) break;
    rest.push(byte);
    if (finals.has(byte)) {
      if (await moreWithin(PASTE_GAP_MS)) break;
      const parameters = parametersOf(rest);
      return { key: editKeyOf(introducer, parameters, byte) };
    }
    const parameter = byte >= PARAMETER_FIRST && byte <= PARAMETER_LAST;
    if (introducer !== CSI_INTRODUCER || !parameter) break;
  }
  return { readAgain: replayOf(rest) };
}

/** The keys of a visible answer that move the cursor or delete, read from their escape sequence. */
export type EditKey =
  "left" | "right" | "word-left" | "word-right" | "home" | "end" | "delete" | "other";

/** The xterm modifier numbers of Alt and Ctrl, as in ESC [ 1 ; 5 D for Ctrl+Left. */
const WORD_MODIFIERS = new Set(["3", "5"]);

/**
 * Which editing key sent the whole sequence of `introducer`, `parameters` and `final`, as
 * readEscapeSequence and readLateSequence read it.
 */
export function editKeyOf(introducer: number, parameters: string, final: number): EditKey {
  if (introducer === SS3_INTRODUCER) {
    if (final === 0x43) return "right";
    if (final === 0x44) return "left";
    if (final === 0x48) return "home";
    if (final === 0x46) return "end";
    return "other";
  }
  const [code, modifier] = parameters.split(";");
  const word = modifier !== undefined && WORD_MODIFIERS.has(modifier);
  if (final === 0x43) return word ? "word-right" : "right";
  if (final === 0x44) return word ? "word-left" : "left";
  if (final === 0x48) return "home";
  if (final === 0x46) return "end";
  if (final === 0x7e) {
    if (code === "1" || code === "7") return "home";
    if (code === "4" || code === "8") return "end";
    if (code === "3") return "delete";
  }
  return "other";
}
