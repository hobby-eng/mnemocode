// Leaf result shapes shared by repair owners and retained share values, without an owner import.
import type { ShareFormat } from "./share-units.js";

/** An element filled in by a repair: its place, counted from 1, and its secret text value. */
export interface FilledElement {
  /** The element's place among all the elements of its share, counted from 1. */
  readonly position: number;
  /** The element as filled in, written in the share's form: part of the secret. */
  readonly value: string;
}

/** A caller-owned repair result snapshot; its strings cannot be recalled by an owner wipe. */
export interface ReadRepairableShare {
  /** The share as a UR, ur:sskr/ and its bytewords, with every marked element filled in. */
  readonly ur: string;
  /** The form the share was typed in, which the repair keeps. */
  readonly format: ShareFormat;
  /** Whether the repair filled in any element: false for a share typed without a ?. */
  readonly repaired: boolean;
  /** The marked elements as the repair filled them in, in order. */
  readonly filled: readonly FilledElement[];
}
