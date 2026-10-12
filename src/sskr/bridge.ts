// The SSKR bridge's entries as hosts call them, each argument that the generated glue narrows
// checked first. The glue (sskr-wasm/generated) passes a number to the WASM as a u8, so 256 and
// NaN arrive as 0 and 257 as 1: a supported encoding or threshold that was never asked for
// (AUD-014-API008). The bridge refuses an unsupported code itself and wipes the secret it was
// given (AUD-012-SEC001), but only a code that survives the narrowing. The checks here run before
// the glue copies the secret, the seed or the shares into the WASM's memory.
//
// Needs from the host: the bridge, loaded (runtime.ts in Node.js); a page passes its own.
// Does not: load or verify the WASM (runtime.ts), or change what the bridge returns.

import type * as Engine from "../../sskr-wasm/generated/recovery_sskr_wasm.js";

/** The generated bridge, as its glue exports it. */
type Bridge = typeof Engine;

/** The entries of the bridge that a host calls, with the codes of its encodings. */
export type SskrBridge = Pick<
  Bridge,
  | "ShareEncoding"
  | "create_sskr_shares"
  | "create_sskr_shares_formatted"
  | "recover_sskr_shares"
  | "recover_sskr_shares_formatted"
>;

/**
 * The bridge's own refusal of an unsupported encoding (UNSUPPORTED_ENCODING in
 * sskr-wasm/rust/src/lib.rs): a deliberate copy across the languages, so that a code refused here
 * reads as one refused there. test/aud-014-shares.test.ts keeps the two in step.
 */
export const UNSUPPORTED_ENCODING = "Unsupported SSKR share encoding.";
/** Why a group threshold is refused before the glue narrows it to a byte. */
export const UNSUPPORTED_GROUP_THRESHOLD =
  "The SSKR group threshold must be a whole number from 0 to 255.";
/** The largest value of the u8 that the glue passes a group threshold as. */
const U8_MAX = 0xff;

/**
 * The bridge with each narrowed argument checked before it is called. A class, so that a host
 * holds one object that keeps the bridge it wraps private and that every caller takes in its
 * place (SskrBridge): an unchecked entry is not reachable through it.
 */
export class CheckedSskrBridge implements SskrBridge {
  readonly #bridge: SskrBridge;
  /** The codes of the bridge's encodings: the numbers of its enum, which also maps them back. */
  readonly #encodings: readonly number[];

  constructor(bridge: SskrBridge) {
    this.#bridge = bridge;
    this.#encodings = Object.freeze(
      Object.values(bridge.ShareEncoding).filter((code) => typeof code === "number"),
    );
  }

  get ShareEncoding(): SskrBridge["ShareEncoding"] {
    return this.#bridge.ShareEncoding;
  }

  create_sskr_shares(
    secret: Uint8Array,
    group_threshold: number,
    group_specs: Uint8Array,
    random_seed: Uint8Array,
  ): string {
    CheckedSskrBridge.#assertGroupThreshold(group_threshold);
    return this.#bridge.create_sskr_shares(secret, group_threshold, group_specs, random_seed);
  }

  create_sskr_shares_formatted(
    secret: Uint8Array,
    group_threshold: number,
    group_specs: Uint8Array,
    random_seed: Uint8Array,
    encoding: number,
  ): string {
    CheckedSskrBridge.#assertGroupThreshold(group_threshold);
    this.#assertEncoding(encoding);
    return this.#bridge.create_sskr_shares_formatted(
      secret,
      group_threshold,
      group_specs,
      random_seed,
      encoding,
    );
  }

  recover_sskr_shares(records: string): Uint8Array {
    return this.#bridge.recover_sskr_shares(records);
  }

  recover_sskr_shares_formatted(records: string, encoding: number): Uint8Array {
    this.#assertEncoding(encoding);
    return this.#bridge.recover_sskr_shares_formatted(records, encoding);
  }

  /** Refuses anything but the code of one of the bridge's encodings, a whole number as it is. */
  #assertEncoding(encoding: unknown): void {
    if (typeof encoding !== "number" || !this.#encodings.includes(encoding))
      throw new Error(UNSUPPORTED_ENCODING);
  }

  /** Refuses a group threshold that the glue's u8 would not hold as it is. */
  static #assertGroupThreshold(threshold: unknown): void {
    if (!Number.isInteger(threshold) || (threshold as number) < 0 || (threshold as number) > U8_MAX)
      throw new Error(UNSUPPORTED_GROUP_THRESHOLD);
  }
}
