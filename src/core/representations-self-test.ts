// Fast representation known answers at the two BIP39 length boundaries. The 12-word values are
// vectors/mnemocode-v1.json's direct-12. The 24-word zero-entropy phrase is a published BIP39
// vector; its colors were computed with independent decimal packing, first reproducing direct-12.
// Unicode values use the published Traditional Chinese word list. No host service is needed.
import { Masking } from "./masking.js";
import { parseDate } from "./dates.js";
import { formatEncoded, parseInput } from "./representations.js";
import { decodeInputDirect, representMnemonic } from "./seedshift.js";
import { expectRefused, expectSame } from "./self-test-check.js";
import { ENCODED_FORMATS, type EncodedFormat } from "./types.js";

export interface Answer {
  readonly words: number;
  readonly forms: Readonly<Record<EncodedFormat, string>>;
}

// Fixed answers stay independent of the encoders; constructing them by encoding would hide a
// defect shared by the writer and reader. Repeated literals here are intentional test oracles.
// The 12-word answers are a deliberate copy of vectors/mnemocode-v1.json's direct-12, since a
// startup reads no file; test/startup-edges.test.ts keeps the two in step.
export const REPRESENTATION_ANSWERS: readonly Answer[] = [
  {
    words: 12,
    forms: {
      english: `${"abandon ".repeat(11)}about`,
      indexes: "1 1 1 1 1 1 1 1 1 1 1 4",
      unicode: "768476847684768476847684768476847684768476845728",
      colors: "#000064 #1EAB91 #3D0964 #5BB491 #7A1264 #98BD91 #B71B64 #D5C694",
      "colors-unicode": "E000E064E13AE191E271E064E3ABE191E4E2E064E61CE191E753E064E88DE194",
    },
  },
  {
    words: 24,
    forms: {
      english: `${"abandon ".repeat(23)}art`,
      indexes: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 103",
      unicode: `${"7684".repeat(23)}6027`,
      colors:
        "#000064 #0F6951 #1E84E4 #2DEDD1 #3D0964 #4C7251 #5B8DE4 #6AF6D1 #7A1264 #897B51 #9896E4 #A7FFD1 #B71B64 #C68451 #D59FE4 #E50937",
      "colors-unicode":
        "E000E064E09DF451E138ECE4E1D6E7D1E271E064E30EF451E3A9ECE4E447E7D1E4E2E064E57FF451E61AECE4E6B8E7D1E753E064E7F0F451E88BECE4E929E837",
    },
  },
];

/** Exact forward/reverse answers and refusals, without PBKDF2, files, renderers or a share engine. */
export function checkRepresentationStartup(): void {
  for (const { words, forms } of REPRESENTATION_ANSWERS) {
    const represented = representMnemonic(forms.english);
    for (const format of ENCODED_FORMATS) {
      const name = `Direct ${words}-word ${format}`;
      expectSame(formatEncoded(represented, format), forms[format], `${name} encoding`);
      const decoded = decodeInputDirect(forms[format], format);
      expectSame(decoded.recoveredMnemonic, forms.english, `${name} decoding`);
      expectSame(decoded.checksumValid, true, `${name} checksum`);
    }
  }
  for (const bad of [0, 2049])
    expectRefused(
      () => decodeInputDirect(`${bad} ${"1 ".repeat(10)}4`, "indexes"),
      /numbering from 1 through 2048/u,
      `Direct word number ${bad}`,
    );
  expectRefused(
    () => decodeInputDirect(`${"1 ".repeat(12)}4`, "indexes"),
    /12.*24/u,
    "Direct 13-word input",
  );
  const invalid = parseInput("1 ".repeat(12), "indexes");
  // Direct decoding reports checksumValid=false. A checksum-valid Seedshift container must
  // refuse these same bad indexes; direct input and a masked container have different contracts.
  expectSame(
    decodeInputDirect("1 ".repeat(12), "indexes").checksumValid,
    false,
    "Bad direct checksum",
  );
  expectRefused(
    () => Masking.of("seedshift").undo(invalid, [parseDate("23-09-2026")]),
    /checksum/u,
    "Bad Seedshift container",
  );
  expectRefused(
    () =>
      parseInput(
        `F8FFF8FF${REPRESENTATION_ANSWERS[0]!.forms["colors-unicode"].slice(8)}`,
        "colors-unicode",
      ),
    /outside the #RRGGBB range/u,
    "Color Unicode beyond RGB",
  );
  expectRefused(
    () => parseInput(REPRESENTATION_ANSWERS[0]!.forms.english, "unknown" as EncodedFormat),
    /Unsupported encoded format/u,
    "Unknown representation",
  );
}
