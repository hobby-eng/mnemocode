// Leaf result shapes shared by repair owners and retained share values, without an owner import.
import type { ShareFormat } from "./share-units.js";

/** An element filled in by a repair: its place, counted from 1, and its secret text value. */
export interface FilledElement {
  readonly position: number;
  readonly value: string;
}

/** A caller-owned repair result snapshot; its strings cannot be recalled by an owner wipe. */
export interface ReadRepairableShare {
  readonly ur: string;
  readonly format: ShareFormat;
  readonly repaired: boolean;
  /** The marked elements as the repair filled them in, in order. */
  readonly filled: readonly FilledElement[];
}
