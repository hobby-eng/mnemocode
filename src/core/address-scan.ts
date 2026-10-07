// The scan of a wallet's addresses that every address check shares: the key at a path, derived
// with every node on the way wiped, the keys of a branch derived one step each from the branch's
// key, and how many addresses in a row a person compares when unsure which one they have. Every
// key derived is wiped once compared.
//
// Host-neutral: it imports only @scure/bip32 (test/portable-modules.test.ts).

import { HARDENED_OFFSET, type HDKey } from "@scure/bip32";

/**
 * How many addresses a person compares when unsure which one they have: the first 20, BIP44's gap
 * limit, after which a wallet stops looking for used addresses.
 */
export const DEFAULT_ADDRESS_COUNT = 20;
/**
 * The most addresses one piece of evidence is compared with: every one costs a derivation in each
 * phrase that a search tries, and no wallet hands out more in a row without a used one between.
 */
export const MAX_ADDRESS_COUNT = 1_000;
/** BIP32: the highest index of an address that is not hardened, 2^31 − 1. */
const LAST_ADDRESS_INDEX = 0x7fffffff;

/**
 * The addresses compared from `first` on when the person names no number: the first 20
 * (DEFAULT_ADDRESS_COUNT), or as many as there are up to the last index.
 */
export function defaultAddressCount(first: number): number {
  return Math.max(1, Math.min(DEFAULT_ADDRESS_COUNT, LAST_ADDRESS_INDEX - first + 1));
}

/** What a check derives from a node and its public key when it is the evidence's key. */
export type KeyMatch = (node: HDKey, publicKey: Uint8Array) => string | undefined;

/** A key that matched, as shown, and where it is. */
export interface FoundKey {
  readonly derived: string;
  readonly path: string;
}

/** The addresses of a branch that are compared: `count` of them from index `first` on. */
export interface AddressRange {
  readonly first: number;
  readonly count: number;
}

/**
 * How many addresses are compared from `first` on: `requested`, or one when it is left out;
 * refused unless it is a whole number from 1 through MAX_ADDRESS_COUNT that ends at an index of
 * BIP32 that is not hardened.
 */
export function addressCount(requested: number | undefined, first: number): number {
  if (requested === undefined) return 1;
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > MAX_ADDRESS_COUNT)
    throw new Error(
      `The number of addresses compared must be an integer from 1 through ${MAX_ADDRESS_COUNT}.`,
    );
  if (first + requested - 1 > LAST_ADDRESS_INDEX)
    throw new Error(`The addresses compared would pass index ${LAST_ADDRESS_INDEX}.`);
  return requested;
}

/** The key at `path` compared by `matchOf`; it is wiped once compared. */
export function matchAtPath(root: HDKey, path: string, matchOf: KeyMatch): FoundKey | undefined {
  const node = deriveWiping(root, path);
  try {
    const derived = matchOf(node, publicKeyOf(node));
    return derived === undefined ? undefined : { derived, path };
  } finally {
    node.wipePrivateData();
  }
}

/**
 * The first of the addresses in `range` below the branch at `branchPath` that `matchOf` matches.
 * The branch's key is derived once and each address's key from it in one step; every key is wiped
 * once compared, and the branch's at the end.
 */
export function scanBranch(
  root: HDKey,
  branchPath: string,
  range: AddressRange,
  matchOf: KeyMatch,
): FoundKey | undefined {
  const branch = deriveWiping(root, branchPath);
  try {
    for (let index = range.first; index < range.first + range.count; index += 1) {
      const node = branch.deriveChild(index);
      try {
        const derived = matchOf(node, publicKeyOf(node));
        if (derived !== undefined) return { derived, path: `${branchPath}/${index}` };
      } finally {
        node.wipePrivateData();
      }
    }
    return undefined;
  } finally {
    branch.wipePrivateData();
  }
}

/**
 * The node at `path`, a path such as m/84'/0'/0'/0/0, below `root`. Each node on the way is wiped
 * as soon as its child exists: HDKey.derive keeps them, the account's private key among them,
 * until they are collected. The caller wipes the node returned, and the root.
 */
export function deriveWiping(root: HDKey, path: string): HDKey {
  let node = root;
  try {
    for (const step of path.split("/").slice(1)) {
      // A step such as 84' is hardened: BIP32 adds 2^31 to its index.
      const index = Number.parseInt(step, 10) + (step.endsWith("'") ? HARDENED_OFFSET : 0);
      const child = node.deriveChild(index);
      if (node !== root) node.wipePrivateData();
      node = child;
    }
    return node;
  } catch (error) {
    if (node !== root) node.wipePrivateData();
    throw error;
  }
}

function publicKeyOf(node: HDKey): Uint8Array {
  const publicKey = node.publicKey;
  if (publicKey === null) throw new Error("Unable to derive the public key.");
  return publicKey;
}
