// Seedshift masking and its variants: the one place that tells the four transformation modes
// apart. Each mode is one Masking value with everything that differs between them: its name, whether
// it masks with dates, whether its codes keep the BIP39 checksum, whether complete dates still
// leave several phrases, what a backup made with it allows, how it writes a seed phrase and undoes
// its codes, and the wallet checks that one date combination of a search costs. Every other module
// asks the Masking of a mode instead of switching over the mode names, so that a new variant is one
// more value here and nothing else.
//
// Needs from the host: nothing.
// Does not: read or write codes in their forms (core/encoded-backup.ts), search dates
// (core/date-search.ts) or check a wallet. Its messages never repeat a word or a code.
//
// Host-neutral: it reaches only @scure/bip39 and its word lists, through the core modules.

import {
  decodeIndexes,
  decodeIndexesDirect,
  decodeIndexesLegacy,
  decodeIndexesLegacyValid,
  encodeMnemonic,
  encodeMnemonicLegacy,
  legacyChecksumValidResult,
  representMnemonic,
} from "./seedshift.js";
import type { DateShiftDate, DecodedResult, EncodedResult } from "./types.js";
import { assertWordCount, BIP39_INDEX_BITS } from "./words.js";

/** How a seed phrase was written: not masked, or one of the Seedshift variants (record.ts). */
export type MaskingMode = "direct" | "seedshift" | "seedshift-legacy" | "seedshift-legacy-valid";

/** What a backup made with a mode allows besides the backup itself. */
export interface MaskingCapabilities {
  /** Whether the seed phrase can be split into Shamir shares in this mode. */
  readonly split: boolean;
  /** Whether what was written down can be checked against the result (core/backup-check.ts). */
  readonly backupCheck: boolean;
  /** Whether a sheet for heirs can be made: it leads through the restore of the host. */
  readonly heirSheet: boolean;
}

/** BIP39 adds one checksum bit for every three words. */
const WORDS_PER_CHECKSUM_BIT = 3;

/** What one variant is, as the class below hands it out. */
interface Variant {
  readonly name: string;
  readonly masked: boolean;
  readonly keepsChecksum: boolean;
  readonly givesSeveral: boolean;
  readonly capabilities: MaskingCapabilities;
  readonly encode: (mnemonic: string, dates: readonly DateShiftDate[]) => EncodedResult;
  readonly undo: (indexes: readonly number[], dates: readonly DateShiftDate[]) => DecodedResult[];
  /** The checksum-valid phrases, so wallet checks, that one date combination gives on average. */
  readonly checks: (checksumBits: number) => number;
}

const VARIANTS: Readonly<Record<MaskingMode, Variant>> = Object.freeze({
  direct: {
    name: "no Seedshift",
    masked: false,
    keepsChecksum: false,
    givesSeveral: false,
    capabilities: Object.freeze({ split: true, backupCheck: true, heirSheet: true }),
    encode: (mnemonic) => representMnemonic(mnemonic),
    undo: (indexes) => [decodeIndexesDirect(indexes)],
    // Without dates there is nothing to search.
    checks: () => 0,
  },
  // Writes the checksum again after the shift, so that every date gives a valid phrase.
  seedshift: {
    name: "MnemoCode Seedshift",
    masked: true,
    keepsChecksum: true,
    givesSeveral: false,
    capabilities: Object.freeze({ split: true, backupCheck: true, heirSheet: true }),
    encode: encodeMnemonic,
    undo: (indexes, dates) => [decodeIndexes(indexes, dates)],
    checks: () => 1,
  },
  "seedshift-legacy": {
    name: "the Original Seedshift",
    masked: true,
    keepsChecksum: false,
    givesSeveral: false,
    // SSKR splits the entropy of a valid BIP39 phrase, and the Original Seedshift's result usually
    // fails the checksum.
    capabilities: Object.freeze({ split: false, backupCheck: true, heirSheet: true }),
    encode: encodeMnemonicLegacy,
    undo: (indexes, dates) => [decodeIndexesLegacy(indexes, dates)],
    // A wrong date gives a valid phrase only by chance, once in 2^bits.
    checks: (checksumBits) => 2 ** -checksumBits,
  },
  // The last word replaced by one whose checksum fits: every phrase that it may have hidden is
  // tried, 2^(11 - bits) of them, and only a search finds the seed phrase again, so that no check
  // of what was written down and no sheet for heirs can undo it.
  "seedshift-legacy-valid": {
    name: "the Original Seedshift with a valid last word",
    masked: true,
    keepsChecksum: true,
    givesSeveral: true,
    capabilities: Object.freeze({ split: false, backupCheck: false, heirSheet: false }),
    encode: (mnemonic, dates) => legacyChecksumValidResult(encodeMnemonicLegacy(mnemonic, dates)),
    undo: decodeIndexesLegacyValid,
    checks: (checksumBits) => 2 ** (BIP39_INDEX_BITS - checksumBits),
  },
});

/**
 * The words that every result uses for the two phrases, so that the command line and a page say
 * the same and no one takes the masked phrase for the wallet's: the original seed phrase is the
 * wallet's; Seedshift turns it into the masked phrase, a valid decoy that codes and shares of a
 * masked backup hold, and the dates turn it back. Hosts show these texts as they are.
 */
export const PHRASE_WORDS = Object.freeze({
  original: "the original seed phrase, the wallet's",
  originalItself: "the original seed phrase itself",
  masked: "the masked phrase (decoy)",
  originalFingerprint: "Original fingerprint",
  encodedFingerprint: "Encoded fingerprint (of the masked phrase)",
  /** Under both fingerprints of a masked backup. */
  fingerprintRoles: "Original is the wallet itself; encoded is the masked phrase (decoy).",
  /** Above shares that a repair with the dates gives back. */
  repairedMasked:
    "The repaired shares are the shares as written: they hold the masked phrase (decoy). The dates only checked them against the wallet; a restore with the same dates gives the original seed phrase.",
  /** Above shares that a repair without the mode gives back. */
  repairedUnknown:
    "The repaired shares are the shares as written: they hold the phrase they were split from, the masked phrase (decoy) if Seedshift was used.",
});

/** The modes, in the order the menu and the help name them. */
const MODES = Object.freeze(Object.keys(VARIANTS) as MaskingMode[]);

/**
 * One transformation mode. A class, so that every rule that tells the modes apart is the
 * operation of one value, chosen once with `of`, and no caller switches over the mode names; the
 * values are fixed and shared.
 */
export class Masking {
  readonly #mode: MaskingMode;
  readonly #variant: Variant;

  private constructor(mode: MaskingMode) {
    this.#mode = mode;
    this.#variant = VARIANTS[mode];
  }

  /** Every mode, in the order the menu and the help name them. */
  static readonly MODES: readonly MaskingMode[] = MODES;

  /** The one value of each mode. */
  static readonly #values: Readonly<Record<MaskingMode, Masking>> = Object.freeze(
    Object.fromEntries(MODES.map((mode) => [mode, new Masking(mode)])) as Record<
      MaskingMode,
      Masking
    >,
  );

  /** Whether `value` names a mode; a JavaScript host or a parsed file may pass anything. */
  static isMode(value: unknown): value is MaskingMode {
    return typeof value === "string" && Object.hasOwn(VARIANTS, value);
  }

  /** The masking of `mode`; refuses a value that names none. */
  static of(mode: MaskingMode): Masking {
    if (!Masking.isMode(mode)) throw new Error("Unsupported Seedshift mode.");
    return Masking.#values[mode];
  }

  get mode(): MaskingMode {
    return this.#mode;
  }

  /** The mode by the name that the menu and the help use in a sentence: "MnemoCode Seedshift". */
  get name(): string {
    return this.#variant.name;
  }

  /** Whether the mode masks with dates, which are then needed to undo it. */
  get masked(): boolean {
    return this.#variant.masked;
  }

  /**
   * What the codes or the shares of this mode hold, as a result says it, so that no one takes the
   * masked phrase for the wallet's (PHRASE_WORDS).
   */
  get holds(): string {
    return this.#variant.masked ? PHRASE_WORDS.masked : PHRASE_WORDS.originalItself;
  }

  /** The label of the fingerprint of the codes: that of the masked phrase where the mode masks. */
  get encodedFingerprintLabel(): string {
    return this.#variant.masked ? PHRASE_WORDS.encodedFingerprint : "Encoded fingerprint";
  }

  /**
   * Whether the codes are a valid BIP39 phrase themselves. Such a mode gives a valid phrase for
   * every date too, so that only the wallet tells the right dates.
   */
  get keepsChecksum(): boolean {
    return this.#variant.keepsChecksum;
  }

  /** Whether complete dates still leave several phrases: the Original Seedshift's valid last word. */
  get givesSeveral(): boolean {
    return this.#variant.givesSeveral;
  }

  get capabilities(): MaskingCapabilities {
    return this.#variant.capabilities;
  }

  /** The codes of `mnemonic` masked with `dates` in this mode; no dates without Seedshift. */
  encode(mnemonic: string, dates: readonly DateShiftDate[]): EncodedResult {
    return this.#variant.encode(mnemonic, dates);
  }

  /**
   * Every phrase that `indexes`, BIP39 indexes from 0 to 2047, and the complete `dates` give: one,
   * unless givesSeveral. Throws when the codes cannot be undone in this mode.
   */
  undo(indexes: readonly number[], dates: readonly DateShiftDate[]): DecodedResult[] {
    return this.#variant.undo(indexes, dates);
  }

  /**
   * The checksum-valid phrases, so the wallet checks, that one date combination of a search gives
   * on average for a phrase of `wordCount` words, from the checksum bits of the phrase.
   */
  checksPerCombination(wordCount: number): number {
    assertWordCount(wordCount);
    return this.#variant.checks(wordCount / WORDS_PER_CHECKSUM_BIT);
  }

  toString(): string {
    return this.#mode;
  }
}
