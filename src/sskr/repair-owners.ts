// Owners of one marked reading and its affine solution space. Retained values live in mutable
// byte storage; decoded views and BigInts are temporary copies that JavaScript cannot recall.
import { fitsPattern, wholeMark } from "../core/code-text.js";
import { xorInto } from "../core/bits.js";
import { defined } from "../core/defined.js";
import { Redacted } from "../core/redacted.js";
import { SecretValue } from "../core/secret-value.js";
import { BitFields, linearize, solve, unitVectors } from "./gf2.js";
import { unitModels } from "./repair-models.js";
import {
  CODE_POINT_TEXT,
  type ReadBits,
  type ReadingCodeConstraints,
  type ReadingUnits,
  type ShareStructure,
} from "./repair-units.js";
import { SHARE_METADATA_BYTES } from "./share-layout.js";
import { SHARE_UNITS } from "./share-units.js";
import { readShare, type ShareFormat } from "./transport.js";
import type { ReadRepairableShare } from "./repair-types.js";

/**
 * Every way to pick one item of each list, first list varying slowest; undefined above `limit`.
 * The returned arrays belong to the caller; this helper does not consume the borrowed items.
 */
export function everyPick<T>(
  lists: readonly (readonly T[])[],
  limit = Infinity,
): T[][] | undefined {
  let all: T[][] = [[]];
  for (const list of lists) {
    if (list.length > 0 && all.length > Math.floor(limit / list.length)) return undefined;
    all = all.flatMap((prefix) => list.map((item) => [...prefix, item]));
  }
  return all;
}

/**
 * An independently owned reading of a marked share. Values, partial bits, candidate lists and
 * symbolic code constraints are byte snapshots. Returned views are caller copies. wipe/dispose
 * refuse later secret operations with core.secret-value.wiped; layout metadata stays readable.
 */
export class MarkedReading extends Redacted implements Disposable {
  readonly #values: SecretValue<readonly number[]>;
  readonly #readBits: SecretValue<readonly (readonly number[])[]>;
  readonly #candidates: SecretValue<readonly (readonly number[])[]>;
  readonly #codes: SecretValue<readonly string[]>;
  readonly #hasReadBits: boolean;
  readonly #hasCandidates: boolean;
  readonly #codeLengths: readonly number[];
  readonly #codePrefix: boolean | undefined;
  readonly #format: ShareFormat;
  readonly #decoys: boolean;
  readonly #structure: ShareStructure;
  readonly #holes: readonly number[];

  private constructor(units: ReadingUnits, structure: ShareStructure) {
    super("MarkedReading");
    const owned: Disposable[] = [];
    try {
      this.#values = SecretValue.numbers(units.values.map((value) => value ?? 0));
      owned.push(this.#values);
      this.#readBits = SecretValue.numberLists(
        (units.readBits ?? []).map((bits) => (bits === undefined ? [] : [bits.value, bits.mask])),
      );
      owned.push(this.#readBits);
      this.#candidates = SecretValue.numberLists(
        (units.candidates ?? []).map((values) => (values === undefined ? [0] : [1, ...values])),
      );
      owned.push(this.#candidates);
      const pairs = units.codeConstraints?.pairs ?? [];
      this.#codes = SecretValue.utf16Texts(pairs.flat());
      owned.push(this.#codes);
      this.#hasReadBits = units.readBits !== undefined;
      this.#hasCandidates = units.candidates !== undefined;
      this.#codeLengths = Object.freeze(pairs.map((pair) => pair.length));
      this.#codePrefix = units.codeConstraints?.prefix;
      this.#format = units.format;
      this.#decoys = units.decoys === true;
      this.#structure = structure;
      this.#holes = Object.freeze(
        units.values.flatMap((value, index) => (value === undefined ? [index] : [])),
      );
    } catch (error) {
      for (const owner of owned) owner[Symbol.dispose]();
      throw error;
    }
  }

  /** Every supported reading; each result is independently owned and must be disposed. */
  static of(text: string): MarkedReading[] {
    const readings: MarkedReading[] = [];
    try {
      for (const { structures, ...units } of unitModels(text))
        for (const structure of structures) readings.push(new MarkedReading(units, structure));
      return readings;
    } catch (error) {
      for (const reading of readings) reading.wipe();
      throw error;
    }
  }

  /** A separate snapshot of this live reading, including all symbolic constraints. */
  copy(): MarkedReading {
    return new MarkedReading(this.#snapshot(), this.#structure);
  }

  /** Refuses work after disposal; metadata and earlier caller views are not recalled. */
  assertLive(): void {
    this.#values.assertLive();
  }

  /** The form of this reading; layout metadata remains available after disposal. */
  get format(): ShareFormat {
    return this.#format;
  }

  /** Whether complete decoy cards follow a supported prefix. */
  get withDecoys(): boolean {
    return this.#decoys;
  }

  /** The number of bits per unit of this form. */
  get unitBits(): number {
    return SHARE_UNITS[this.#format].unitBits;
  }

  /** A fresh unit-value snapshot, undefined at marks; refused after disposal. */
  get values(): readonly (number | undefined)[] {
    return Object.freeze(
      this.#values.value.map((value, index) => (this.#holes.includes(index) ? undefined : value)),
    );
  }

  /** The borrowed public byte layout; its evaluator receives all secret values as parameters. */
  get structure(): ShareStructure {
    return this.#structure;
  }

  /** A fresh snapshot of partial unit bits, if present; refused after disposal. */
  get readBits(): readonly (ReadBits | undefined)[] | undefined {
    this.assertLive();
    if (!this.#hasReadBits) return undefined;
    return Object.freeze(
      this.#readBits.value.map((bits) =>
        bits.length === 0
          ? undefined
          : Object.freeze({ value: defined(bits[0]), mask: defined(bits[1]) }),
      ),
    );
  }

  /** Fresh candidate lists for partial units, if present; refused after disposal. */
  get candidates(): readonly (readonly number[] | undefined)[] | undefined {
    this.assertLive();
    if (!this.#hasCandidates) return undefined;
    // A separate presence flag preserves an admitted empty list as distinct from no constraint.
    return Object.freeze(
      this.#candidates.value.map((values) =>
        values[0] === 0 ? undefined : Object.freeze(values.slice(1)),
      ),
    );
  }

  /** Marked unit places, counted from 0, in their bit order; layout metadata. */
  get holes(): readonly number[] {
    return this.#holes;
  }

  /** The number of unknown bits, marked unit count times unit width. */
  get unknownBits(): number {
    return this.#holes.length * this.unitBits;
  }

  #shift(order: number): bigint {
    return BigInt(order * this.unitBits);
  }

  /** The bit mask of marked unit `order`, counted from 0 among holes. */
  unitMask(order: number): bigint {
    return ((1n << BigInt(this.unitBits)) - 1n) << this.#shift(order);
  }

  /** Caller-owned unit values with `bits` at the marks; refused after disposal. */
  valuesAt(bits: bigint): number[] {
    const values = this.zeroFilled();
    this.#holes.forEach((hole, order) => {
      // The mask admits one unit only, at most 24 bits, so this conversion is exact.
      values[hole] = Number((bits & this.unitMask(order)) >> this.#shift(order));
    });
    return values;
  }

  /** Caller-owned values with every marked unit set to zero; refused after disposal. */
  zeroFilled(): number[] {
    return [...this.#values.value];
  }

  /** Independent reading with chosen unit values added as full-width equations. */
  withValues(chosen: ReadonlyMap<number, number>): MarkedReading {
    const units = this.#snapshot();
    const mask = 2 ** this.unitBits - 1;
    const readBits = units.values.map((_, place) => {
      const value = chosen.get(place);
      return value === undefined ? units.readBits?.[place] : { value, mask };
    });
    return new MarkedReading({ ...units, readBits }, this.#structure);
  }

  /** Whether changing unit `place`, counted from 0, reaches the share's metadata bytes. */
  reachesMetadata(place: number): boolean {
    const values = this.zeroFilled();
    let before: Uint8Array | undefined;
    try {
      before = this.#structure.evaluate(values).payload;
      for (let bit = 0; bit < this.unitBits; bit += 1) {
        const flipped = [...values];
        let after: Uint8Array | undefined;
        try {
          flipped[place] = defined(values[place]) ^ (1 << bit);
          after = this.#structure.evaluate(flipped).payload;
          for (let byte = 0; byte < SHARE_METADATA_BYTES; byte += 1)
            if (after[byte] !== before[byte]) return true;
        } finally {
          after?.fill(0);
          flipped.fill(0);
        }
      }
      return false;
    } finally {
      before?.fill(0);
      values.fill(0);
    }
  }

  /** Independent readings for all candidate choices; even an empty choice returns an owned copy. */
  choicesAt(places: readonly number[]): MarkedReading[] {
    const { candidates } = this;
    const tried = places.filter((place) => candidates?.[place] !== undefined);
    if (tried.length === 0) return [this.copy()];
    const picks = defined(everyPick(tried.map((place) => defined(defined(candidates)[place]))));
    const readings: MarkedReading[] = [];
    try {
      for (const values of picks)
        readings.push(
          this.withValues(new Map(tried.map((place, index) => [place, defined(values[index])]))),
        );
      return readings;
    } catch (error) {
      for (const reading of readings) reading.wipe();
      throw error;
    } finally {
      for (const values of picks) values.fill(0);
    }
  }

  /** Candidate unit places, counted from 0, and the number of values of each. */
  candidateCounts(): { readonly place: number; readonly count: number }[] {
    return (this.candidates ?? []).flatMap((values, place) =>
      values === undefined ? [] : [{ place, count: values.length }],
    );
  }

  /** A caller-owned share snapshot if values fit the reading and ordinary reader, else undefined. */
  solvedShare(values: readonly number[]): ReadRepairableShare | undefined {
    this.assertLive();
    if (!this.#fits(values)) return undefined;
    const units = SHARE_UNITS[this.#format];
    let read;
    try {
      read = readShare(units.text(values));
    } catch {
      return undefined;
    }
    if (read.format !== this.#format) return undefined;
    const filled = this.#holes.map((index) => ({
      position: index + 1,
      value: units.unitText(defined(values[index])),
    }));
    return { ur: read.ur, format: read.format, repaired: filled.length > 0, filled };
  }

  #constraints(): ReadingCodeConstraints | undefined {
    this.assertLive();
    if (this.#codePrefix === undefined) return undefined;
    const codes = this.#codes.value;
    let start = 0;
    const pairs = this.#codeLengths.map((length) => {
      const pair = codes.slice(start, start + length);
      start += length;
      return pair;
    });
    return { pairs, prefix: this.#codePrefix };
  }

  #snapshot(): ReadingUnits {
    const values = this.values;
    const readBits = this.readBits;
    const candidates = this.candidates;
    const codeConstraints = this.#constraints();
    return {
      format: this.#format,
      values,
      decoys: this.#decoys,
      ...(readBits === undefined ? {} : { readBits }),
      ...(candidates === undefined ? {} : { candidates }),
      ...(codeConstraints === undefined ? {} : { codeConstraints }),
    };
  }

  #fits(values: readonly number[]): boolean {
    const candidates = this.candidates;
    if (
      candidates !== undefined &&
      !candidates
        .slice(0, values.length)
        .every((allowed, place) => allowed?.includes(defined(values[place])) ?? true)
    )
      return false;
    const constraints = this.#constraints();
    if (constraints === undefined) return true;
    const pairs = constraints.prefix
      ? constraints.pairs.slice(0, values.length)
      : constraints.pairs;
    return pairs.every((pair, index) => {
      const written = defined(
        SHARE_UNITS[this.#format].unitText(defined(values[index])).match(CODE_POINT_TEXT),
      );
      return pair.every((code, half) =>
        constraints.prefix
          ? wholeMark(code) || fitsPattern(code, defined(written[half]))
          : code === "?" || code === written[half],
      );
    });
  }

  /** An independently owned solution space; the caller disposes it. */
  space(): ReadingSpace | undefined {
    return ReadingSpace.solve(this);
  }

  /** Uses a temporary space synchronously and disposes it on success or failure. */
  withSpace<T>(use: (space: ReadingSpace | undefined) => T): T {
    return ReadingSpace.use(this, use);
  }

  /** Overwrites owned buffers as far as the runtime allows, without affecting derived owners. */
  wipe(): void {
    this.#values.wipe();
    this.#readBits.wipe();
    this.#candidates.wipe();
    this.#codes.wipe();
  }

  /** Ends this reading's lifetime; idempotent. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}

/**
 * An owned affine space of a share's marked bits, including an independent reading copy, exact
 * BigInt coordinates, payload and deltas. Branch/Joint borrow this owner; their containing plan
 * disposes each unique space. The input reading to solve is borrowed and remains independently live.
 */
export class ReadingSpace extends Redacted implements Disposable {
  readonly #reading: MarkedReading;
  readonly #rank: number;
  readonly #coordinates: SecretValue<readonly bigint[]>;
  readonly #payload: Uint8Array;
  readonly #payloadDeltas: readonly Uint8Array[];

  private constructor(
    reading: MarkedReading,
    solved: {
      readonly rank: number;
      readonly particular: bigint;
      readonly free: readonly bigint[];
    },
    payload: Uint8Array,
    payloadDeltas: readonly Uint8Array[],
  ) {
    super("ReadingSpace");
    const deltas = Object.freeze([...payloadDeltas]);
    this.#coordinates = SecretValue.bigints([solved.particular, ...solved.free]);
    this.#reading = reading;
    this.#rank = solved.rank;
    this.#payload = payload;
    this.#payloadDeltas = deltas;
  }

  /** Solves a borrowed reading into an independent owner; undefined when no values fit. */
  static solve(input: MarkedReading): ReadingSpace | undefined {
    const reading = input.copy();
    const arrays: Uint8Array[] = [];
    let transferred = false;
    try {
      const { holes, unitBits, unknownBits, readBits } = reading;
      const at = (bits: bigint) => {
        const values = reading.valuesAt(bits);
        let evaluated: ReturnType<ShareStructure["evaluate"]> | undefined;
        try {
          evaluated = reading.structure.evaluate(values);
          if (readBits === undefined) return evaluated;
          const read = BitFields.of(
            holes.map((hole) => {
              const bitsRead = readBits[hole];
              const change =
                bitsRead === undefined
                  ? 0
                  : (defined(values[hole]) ^ bitsRead.value) & bitsRead.mask;
              return [change, unitBits] as const;
            }),
          );
          return { ...evaluated, residual: (evaluated.residual << BigInt(unknownBits)) | read };
        } catch (error) {
          evaluated?.payload.fill(0);
          throw error;
        } finally {
          values.fill(0);
        }
      };
      const residualAt = (bits: bigint): bigint => {
        const { residual, payload } = at(bits);
        payload.fill(0);
        return residual;
      };
      const { value: baseline, columns } = linearize(residualAt, 0n, unitVectors(unknownBits));
      let solved: ReturnType<typeof solve>;
      try {
        solved = solve(columns, baseline);
      } finally {
        columns.fill(0n);
      }
      if (solved === undefined) return undefined;
      const payload = at(solved.particular).payload;
      arrays.push(payload);
      const payloadDeltas: Uint8Array[] = [];
      for (const direction of solved.free) {
        const delta = at(solved.particular ^ direction).payload;
        arrays.push(delta);
        xorInto(delta, payload);
        payloadDeltas.push(delta);
      }
      const space = new ReadingSpace(reading, solved, payload, payloadDeltas);
      transferred = true;
      return space;
    } finally {
      if (!transferred) {
        reading.wipe();
        for (const array of arrays) array.fill(0);
      }
    }
  }

  /** Uses the space synchronously; its complete owner is disposed even when use throws. */
  static use<T>(reading: MarkedReading, use: (space: ReadingSpace | undefined) => T): T {
    using space = ReadingSpace.solve(reading);
    return use(space);
  }

  /** Refuses secret reads after this space is disposed. */
  assertLive(): void {
    this.#coordinates.assertLive();
  }

  /** Borrowed child reading, valid until this space ends; copy it for an independent lifetime. */
  get reading(): MarkedReading {
    this.assertLive();
    return this.#reading;
  }

  /** The number of marked bits; layout metadata remains readable after disposal. */
  get unknownBits(): number {
    return this.#reading.unknownBits;
  }

  /** The rank of the equations; layout metadata remains readable after disposal. */
  get rank(): number {
    return this.#rank;
  }

  /** One exact affine solution; refused after disposal. */
  get particular(): bigint {
    return defined(this.#coordinates.value[0]);
  }

  /** A fresh exact basis snapshot; refused after disposal. */
  get basis(): readonly bigint[] {
    return Object.freeze(this.#coordinates.value.slice(1));
  }

  /** Marked unit places, counted from 0; layout metadata. */
  get holes(): readonly number[] {
    return this.#reading.holes;
  }

  /** The mask of marked unit `order`, counted from 0; layout metadata. */
  unitMask(order: number): bigint {
    return this.#reading.unitMask(order);
  }

  /** Caller-owned unit values for exact marked bits; refused after disposal. */
  valuesAt(bits: bigint): number[] {
    this.assertLive();
    return this.#reading.valuesAt(bits);
  }

  /** Marked unit places that `change` touches, counted from 0. */
  holesChangedBy(change: bigint): number[] {
    return this.holes.filter((_, order) => (change & this.unitMask(order)) !== 0n);
  }

  /** New caller-owned payload bytes for basis choice `own`; wipe them after use. */
  payloadAt(own: bigint): Uint8Array {
    this.assertLive();
    const payload = Uint8Array.from(this.#payload);
    this.#payloadDeltas.forEach((delta, j) => {
      if ((own >> BigInt(j)) & 1n) xorInto(payload, delta);
    });
    return payload;
  }

  /** A fixed payload byte, or undefined if a solution changes it; refused after disposal. */
  fixedPayloadByte(index: number): number | undefined {
    this.assertLive();
    return this.#payloadDeltas.every((delta) => delta[index] === 0)
      ? this.#payload[index]
      : undefined;
  }

  /**
   * Borrowed payload/delta buffers for legacy cleanup observations, still available after wipe.
   * Wiping these arrays alone does not end the reading/coordinate lifetime: dispose this owner.
   */
  secretArrays(): Uint8Array[] {
    return [this.#payload, ...this.#payloadDeltas];
  }

  /** Overwrites owned buffers and ends the child reading; leaves the caller's input live. */
  wipe(): void {
    this.#coordinates.wipe();
    this.#reading.wipe();
    this.#payload.fill(0);
    for (const array of this.#payloadDeltas) array.fill(0);
  }

  /** Ends this space's lifetime; shared spaces belong to the containing plan, not each branch. */
  [Symbol.dispose](): void {
    this.wipe();
  }
}
