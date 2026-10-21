// The SSKR engine leaves no copy of a secret, a seed or a share in its WebAssembly memory once a
// call returns, whatever its dependencies copy while they work (AUD-037-SEC005, AUD-037-SEC006).
// Each case runs in an engine of its own, so that no earlier call has written over what it left,
// and the whole memory is then searched for the secret, the seed and each share: as bytes, as the
// text of the share, and as a table of references to the engine's words, which spells the bytes
// as well. The search is first given a memory laid out to hold each of them, which it must name.
// Public test data only: a secret and a seed whose bytes rise by a fixed step.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as recordMaker from "../sskr-wasm/generated/recovery_sskr_wasm.js";
import {
  BYTEWORD_LETTERS,
  BYTEWORD_VALUES,
  BYTEWORDS,
  MINIMAL_BYTEWORD_LETTERS,
  MINIMAL_BYTEWORD_VALUES,
  MINIMAL_BYTEWORDS,
} from "../src/sskr/bytewords-list.js";
import { crc32 } from "../src/sskr/checksum.js";
import {
  bytewordsToUr,
  CHECKSUM_BYTES,
  transportToUr,
  urToBytewords,
  urToTransport,
} from "../src/sskr/transport.js";

type Glue = typeof recordMaker;
type EncodingName = keyof typeof recordMaker.ShareEncoding;

const MODULE = new WebAssembly.Module(
  readFileSync("sskr-wasm/generated/recovery_sskr_wasm_bg.wasm"),
);
/** The engine that makes the shares a restore is given; its memory is never searched. */
recordMaker.initSync({ module: MODULE });

/** A seed whose bytes occur nowhere else: 0x31, 0x36, 0x3B, … */
const SEED = Uint8Array.from({ length: 32 }, (_, index) => 0x31 + index * 5);
/** A secret of `length` bytes that occur nowhere else: 0xA0, 0xA3, 0xA6, … */
const secretOf = (length: number) => Uint8Array.from({ length }, (_, index) => 0xa0 + index * 3);

/**
 * The fewest bytes of a secret, a seed or a share searched for together: a freed block keeps all
 * but its first bytes, which the allocator overwrites with its own pointers, so a part is looked
 * for too. No 8 bytes of the secret or the seed rise by one, as the engine's tables of words do.
 */
const WINDOW_BYTES = 8;
/** The fewest letters of a share's text searched for together: 8 bytes of a compact UR. */
const WINDOW_LETTERS = 16;
/** The bytes of a reference to a word: its address and its length, 4 bytes each. */
const REFERENCE_BYTES = 8;
/** What a place that holds no reference to a word spells. */
const NO_WORD = 256;

interface Layout {
  readonly name: string;
  readonly groupThreshold: number;
  /** The threshold and the count of each group. */
  readonly groups: readonly number[];
  /** The places of shares that restore the secret. */
  readonly quorum: readonly number[];
}

const LAYOUTS: readonly Layout[] = [
  { name: "1 of 1", groupThreshold: 1, groups: [1, 1], quorum: [0] },
  { name: "1 of 3", groupThreshold: 1, groups: [1, 3], quorum: [2] },
  { name: "2 of 3", groupThreshold: 1, groups: [2, 3], quorum: [0, 2] },
  { name: "3 of 5", groupThreshold: 1, groups: [3, 5], quorum: [1, 2, 4] },
  {
    name: "2 of 3 and 1 of 2, both groups",
    groupThreshold: 2,
    groups: [2, 3, 1, 2],
    quorum: [0, 1, 4],
  },
];
const ENCODINGS: readonly EncodingName[] = ["CompactUr", "Bytewords"];
const CASES = LAYOUTS.flatMap((layout) =>
  [16, 32].flatMap((secretBytes) =>
    ENCODINGS.map((encoding) => ({ layout, secretBytes, encoding })),
  ),
).map((sample) => ({
  ...sample,
  name: `${sample.layout.name}, ${sample.secretBytes} bytes, ${sample.encoding}`,
}));

const GLUE = new URL("../sskr-wasm/generated/recovery_sskr_wasm.js", import.meta.url).href;
let engines = 0;

/** Whether `loaded` exports each name of the glue, as a value of the same kind. */
function isGlue(loaded: unknown): loaded is Glue {
  return (
    typeof loaded === "object" &&
    loaded !== null &&
    Object.entries(recordMaker).every(
      ([name, value]) => typeof Reflect.get(loaded, name) === typeof value,
    )
  );
}

/** A new instance of the engine, whose memory no other case has touched. */
async function freshEngine(): Promise<{ glue: Glue; memory: () => Uint8Array }> {
  engines += 1;
  // A module of its own for each engine: the glue keeps the instance it made.
  const glue: unknown = await import(/* @vite-ignore */ `${GLUE}?engine=${engines}`);
  if (!isGlue(glue)) throw new Error("A fresh import of the glue lacks what the glue exports.");
  const { memory } = glue.initSync({ module: MODULE });
  // The memory may grow during a call, which replaces its buffer.
  return { glue, memory: () => new Uint8Array(memory.buffer) };
}

/** The shares of `secret` in `encoding` that `layout` makes from SEED. */
function split(glue: Glue, layout: Layout, secret: Uint8Array, encoding: EncodingName): string[] {
  return glue
    .create_sskr_shares_formatted(
      secret.slice(),
      layout.groupThreshold,
      Uint8Array.from(layout.groups),
      SEED.slice(),
      glue.ShareEncoding[encoding],
    )
    .split("\n");
}

/** The CBOR and checksum of the share `record`, written in `encoding`. */
function transportOf(record: string, encoding: EncodingName): Uint8Array {
  return urToTransport(encoding === "CompactUr" ? record : bytewordsToUr(record));
}

/** The value of a share, the part of it that a quorum turns into the secret. */
function valueOf(record: string, encoding: EncodingName, secretBytes: number): Uint8Array {
  return transportOf(record, encoding).slice(-CHECKSUM_BYTES - secretBytes, -CHECKSUM_BYTES);
}

/**
 * The share `record` of `member` with 0xFF + member added to each byte of its value (GF(256)) and
 * its checksum written anew. Done to members 0 and 1, it adds to the polynomial the line through
 * them, which is 0 at 255, where the secret is, and 1 at 254, where its digest is: the quorum
 * restores the secret unchanged, and its digest fails (the construction of AUD-035).
 */
function withFailingDigest(
  record: string,
  member: number,
  encoding: EncodingName,
  secretBytes: number,
): string {
  const transport = transportOf(record, encoding);
  for (
    let at = transport.length - CHECKSUM_BYTES - secretBytes;
    at < transport.length - CHECKSUM_BYTES;
    at += 1
  )
    transport[at]! ^= 0xff ^ member;
  new DataView(transport.buffer, transport.byteOffset, transport.byteLength).setUint32(
    transport.length - CHECKSUM_BYTES,
    crc32(transport.slice(0, -CHECKSUM_BYTES)),
  );
  const ur = transportToUr(transport);
  return encoding === "CompactUr" ? ur : urToBytewords(ur);
}

/** Where any `window` items of `needle` in a row occur in `haystack`. */
function windowsOf(
  haystack: Uint8Array | Uint16Array,
  needle: Uint8Array,
  window: number,
): number[] {
  const found = new Set<number>();
  for (let start = 0; start + window <= needle.length; start += 1) {
    const part = needle.subarray(start, start + window);
    for (let at = haystack.indexOf(part[0]!); at !== -1; at = haystack.indexOf(part[0]!, at + 1))
      if (part.every((item, offset) => haystack[at + offset] === item)) found.add(at - start);
  }
  return [...found].sort((left, right) => left - right);
}

/**
 * What the references to words in `memory` spell, for each place where a reference may start: a
 * reference is the address and the length of a Byteword or a minimal pair in the engine's tables,
 * the form in which bc-ur's encoder left a share in freed memory (AUD-037-SEC006).
 */
function spelledByReferences(memory: Uint8Array): { start: number; bytes: Uint16Array }[] {
  const view = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
  return [0, REFERENCE_BYTES / 2].map((start) => {
    const bytes = new Uint16Array(Math.floor((memory.length - start) / REFERENCE_BYTES));
    for (const [entry] of bytes.entries()) {
      const at = start + entry * REFERENCE_BYTES;
      const address = view.getUint32(at, true);
      const length = view.getUint32(at + REFERENCE_BYTES / 2, true);
      const values =
        length === 4 ? BYTEWORD_VALUES : length === 2 ? MINIMAL_BYTEWORD_VALUES : undefined;
      const word =
        values && address + length <= memory.length
          ? String.fromCharCode(...memory.subarray(address, address + length))
          : "";
      bytes[entry] = values?.get(word) ?? NO_WORD;
    }
    return { start, bytes };
  });
}

/** Each part of `kept` that `memory` holds, named with where and in which form. */
function leftovers(
  memory: Uint8Array,
  kept: { bytes: Record<string, Uint8Array>; texts: Record<string, string> },
): string[] {
  const references = spelledByReferences(memory);
  const found: string[] = [];
  for (const [name, bytes] of Object.entries(kept.bytes)) {
    for (const at of windowsOf(memory, bytes, WINDOW_BYTES))
      found.push(`${name} as bytes at ${at}`);
    for (const { start, bytes: spelled } of references)
      for (const entry of windowsOf(spelled, bytes, WINDOW_BYTES))
        found.push(`${name} as word references at ${start + entry * REFERENCE_BYTES}`);
  }
  for (const [name, text] of Object.entries(kept.texts))
    for (const at of windowsOf(memory, new TextEncoder().encode(text), WINDOW_LETTERS))
      found.push(`${name} as text at ${at}`);
  return found;
}

/** The value and the text of each of `records`, named by their places. */
function sharesOf(records: readonly string[], encoding: EncodingName, secretBytes: number) {
  const names = records.map((_, place) => `share ${place + 1}`);
  return {
    bytes: Object.fromEntries(
      records.map((record, place) => [names[place], valueOf(record, encoding, secretBytes)]),
    ),
    texts: Object.fromEntries(records.map((record, place) => [names[place], record])),
  };
}

/**
 * Writes into `memory`, from `at`, a reference to a word for each of `bytes`: the address of the
 * word for that byte in the table of `letters`-letter words at `table`, then `letters`.
 */
function writeReferences(
  memory: Uint8Array,
  at: number,
  bytes: Uint8Array,
  table: number,
  letters: number,
): void {
  const view = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
  for (const [entry, byte] of bytes.entries()) {
    view.setUint32(at + entry * REFERENCE_BYTES, table + byte * letters, true);
    view.setUint32(at + entry * REFERENCE_BYTES + REFERENCE_BYTES / 2, letters, true);
  }
}

describe("the search of a memory for what a call left", () => {
  it("names a secret, a seed and a share that a memory holds, in each form and in part", () => {
    // A memory laid out by hand: the two tables of words that the engine holds, a secret whole and
    // the end of one, as a freed block keeps it, a share's text, and the references to words that
    // spell a share's value in Bytewords, from place 0, and the seed in minimal pairs, from place 4.
    const memory = new Uint8Array(8192);
    const [words, pairs] = [1024, 2048];
    for (const [value, word] of BYTEWORDS.entries())
      memory.set(new TextEncoder().encode(word), words + value * BYTEWORD_LETTERS);
    for (const [value, pair] of MINIMAL_BYTEWORDS.entries())
      memory.set(new TextEncoder().encode(pair), pairs + value * MINIMAL_BYTEWORD_LETTERS);
    const secret = secretOf(16);
    memory.set(secret, 64);
    memory.set(secret.subarray(6), 160);
    const [record] = split(recordMaker, LAYOUTS[2]!, secret, "CompactUr");
    memory.set(new TextEncoder().encode(record), 256);
    writeReferences(memory, 4096, valueOf(record!, "CompactUr", 16), words, BYTEWORD_LETTERS);
    writeReferences(memory, 6148, SEED, pairs, MINIMAL_BYTEWORD_LETTERS);
    const shares = sharesOf([record!], "CompactUr", 16);
    expect(
      leftovers(memory, { bytes: { secret, seed: SEED, ...shares.bytes }, texts: shares.texts }),
    ).toEqual([
      "secret as bytes at 64",
      // The end of the secret, at 160, is where the whole would have started 6 bytes before.
      "secret as bytes at 154",
      "seed as word references at 6148",
      "share 1 as word references at 4096",
      "share 1 as text at 256",
    ]);
  });
});

describe("the memory of the SSKR engine after a call", () => {
  it.each(CASES)("holds no secret, seed or share after a split: $name", async (sample) => {
    const engine = await freshEngine();
    const secret = secretOf(sample.secretBytes);
    const records = split(engine.glue, sample.layout, secret, sample.encoding);
    const shares = sharesOf(records, sample.encoding, sample.secretBytes);
    expect(
      leftovers(engine.memory(), {
        bytes: { secret, seed: SEED, ...shares.bytes },
        texts: shares.texts,
      }),
    ).toEqual([]);
  });

  it.each(CASES)("holds no secret or share after a restore: $name", async (sample) => {
    const secret = secretOf(sample.secretBytes);
    const records = split(recordMaker, sample.layout, secret, sample.encoding);
    const given = sample.layout.quorum.map((place) => records[place]!);
    const engine = await freshEngine();
    const restored = engine.glue.recover_sskr_shares_formatted(
      given.join("\n"),
      engine.glue.ShareEncoding[sample.encoding],
    );
    expect(Array.from(restored)).toEqual(Array.from(secret));
    const shares = sharesOf(given, sample.encoding, sample.secretBytes);
    expect(
      leftovers(engine.memory(), { bytes: { secret, ...shares.bytes }, texts: shares.texts }),
    ).toEqual([]);
  });

  it.each(ENCODINGS)(
    "holds no secret or share after a restore whose digest fails: %s",
    async (encoding) => {
      const secret = secretOf(16);
      const records = split(recordMaker, LAYOUTS[2]!, secret, encoding);
      const given = [0, 1].map((member) =>
        withFailingDigest(records[member]!, member, encoding, secret.length),
      );
      const engine = await freshEngine();
      expect(() =>
        engine.glue.recover_sskr_shares_formatted(
          given.join("\n"),
          engine.glue.ShareEncoding[encoding],
        ),
      ).toThrow(expect.objectContaining({ code: "sskr.engine.combine" }));
      const shares = sharesOf(given, encoding, secret.length);
      expect(
        leftovers(engine.memory(), { bytes: { secret, ...shares.bytes }, texts: shares.texts }),
      ).toEqual([]);
    },
  );
});
