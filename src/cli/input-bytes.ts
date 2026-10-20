import { ErrorCatalog } from "../core/error-catalog.js";
import { Redacted } from "../core/redacted.js";
import { defined } from "../core/defined.js";
import { BYTE_MAX } from "../core/bits.js";

const ERRORS = new ErrorCatalog("cli.input-bytes", {
  byte: { kind: "type", text: () => `Terminal input needs whole bytes from 0 to ${BYTE_MAX}.` },
});
// Fixed blocks avoid copying pending secret bytes when a long paste grows or a prefix retires.
const SEGMENT_BYTES = 4096;

interface Segment {
  readonly bytes: Uint8Array;
  start: number;
  end: number;
  next: Segment | undefined;
}

function segment(at: number, next: Segment | undefined): Segment {
  return { bytes: new Uint8Array(SEGMENT_BYTES), start: at, end: at, next };
}

function assertByte(byte: number): void {
  if (!Number.isInteger(byte) || byte < 0 || byte > BYTE_MAX) throw ERRORS.create("byte", []);
}

/**
 * Owned terminal bytes in arrival order, including bytes replayed after an unrecognised escape.
 * Storage is segmented Uint8Array data; consumption clears each byte, retirement clears a block,
 * and wipe/dispose empties the queue. A later question may reuse the empty owner with new bytes.
 * Inputs are borrowed and unchanged. Invalid octets fail with cli.input-bytes.byte.
 */
export class InputBytes extends Redacted implements Disposable {
  #head: Segment | undefined;
  #tail: Segment | undefined;
  #length = 0;

  constructor() {
    super("InputBytes");
  }

  /** The number of pending bytes, without exposing their storage. */
  get length(): number {
    return this.#length;
  }

  /** Copies one octet to the end, without reallocating existing secret data. */
  push(byte: number): void {
    assertByte(byte);
    if (this.#tail === undefined || this.#tail.end === SEGMENT_BYTES) {
      const added = segment(0, undefined);
      if (this.#tail === undefined) this.#head = added;
      else this.#tail.next = added;
      this.#tail = added;
    }
    this.#tail.bytes[this.#tail.end++] = byte;
    this.#length += 1;
  }

  /** Copies a replay prefix in its original order; an invalid prefix leaves the queue unchanged. */
  prepend(bytes: readonly number[]): void {
    const copy = new Uint8Array(bytes.length);
    try {
      // Read a borrowed accessor only once: admission and insertion must use the same octet.
      for (let index = 0; index < copy.length; index += 1) {
        const byte = defined(bytes[index]);
        assertByte(byte);
        copy[index] = byte;
      }
      for (let index = copy.length - 1; index >= 0; index -= 1) {
        if (this.#head === undefined || this.#head.start === 0) {
          this.#head = segment(SEGMENT_BYTES, this.#head);
          this.#tail ??= this.#head;
        }
        this.#head.bytes[--this.#head.start] = defined(copy[index]);
        this.#length += 1;
      }
    } finally {
      copy.fill(0);
    }
  }

  /** Takes and clears the oldest byte; undefined when none remains. */
  shift(): number | undefined {
    const head = this.#head;
    if (head === undefined) return undefined;
    const byte = defined(head.bytes[head.start]);
    head.bytes[head.start++] = 0;
    this.#length -= 1;
    if (head.start === head.end) {
      this.#head = head.next;
      head.next = undefined;
      head.bytes.fill(0);
      if (this.#head === undefined) this.#tail = undefined;
    }
    return byte;
  }

  /** Whether an octet, such as Ctrl+C, is still pending. */
  includes(byte: number): boolean {
    for (let part = this.#head; part !== undefined; part = part.next)
      if (part.bytes.subarray(part.start, part.end).includes(byte)) return true;
    return false;
  }

  /** Overwrites and drops all blocks as far as the runtime permits; safe to call repeatedly. */
  wipe(): void {
    while (this.#head !== undefined) {
      const part = this.#head;
      this.#head = part.next;
      part.next = undefined;
      part.bytes.fill(0);
    }
    this.#tail = undefined;
    this.#length = 0;
  }

  /** Empties the queue when its scope ends, including after a failed terminal operation. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}
