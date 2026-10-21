// Regressions of the AUD-022 findings. Public test data only: the BIP39 test phrase, the published
// vectors and synthetic bytes.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderCards, separateCardJob, type CardJob } from "../src/export/render.js";
import { selectTemplate } from "../src/export/templates.js";
import { indexesToColors } from "../src/core/colors.js";
import { CardPreview } from "../src/export/card-preview.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { PngAdmission } from "../src/core/png-admission.js";
import { PNG_ADMISSION_SELF_TEST } from "../src/core/png-admission-self-test.js";
import {
  PNG_SIGNATURE,
  pngChunk,
  pngHeader,
  pngImage,
  pngUint32,
} from "../src/core/synthetic-png.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { LAST_WORD_NOT_TAKEN, RE_ENCODING_WORDS, ReEncoding } from "../src/core/re-encoding.js";
import { FINGERPRINT_WARNING, fingerprintMatch } from "../src/core/wallet-check.js";
import { parseDate } from "../src/core/dates.js";
import { planJointRepair } from "../src/sskr/joint-repair.js";
import { repairCandidates } from "../src/sskr/repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { writeShare, type ShareFormat } from "../src/sskr/transport.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";
import { runBuiltCli } from "./helpers/built-cli.js";
import { LONG_TEST_TIME_LIMIT_MS } from "./helpers/limits.js";
import { sskrVectors } from "./helpers/vectors.js";

const SHARE_SETS = sskrVectors().deterministic;

/** The elements of `ur` as `format` writes them: Color Unicode as its four-digit codes. */
function shareElements(ur: string, format: ShareFormat): string[] {
  const text = writeShare(ur, format).trim();
  return format === "colors-unicode" ? text.match(/.{4}/gu)! : text.split(/\s+/u);
}

/** `elements` written as `format` writes them, apart or, for Color Unicode, run together. */
function shareText(elements: readonly string[], format: ShareFormat, apart = false): string {
  return elements.join(format === "colors-unicode" && !apart ? "" : " ");
}

/** The verdict of a joint repair of `texts`. */
async function jointVerdict(...texts: string[]): Promise<string> {
  const plan = await planJointRepair(texts, { platform: nodeSharePlatform });
  try {
    return plan.assessment.verdict;
  } finally {
    plan.wipe();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("AUD-022-ARC002: PNG admission has quick known answers that can fail", () => {
  it("passes with the real admission", () => {
    expect(() => PNG_ADMISSION_SELF_TEST.startup()).not.toThrow();
  });

  it("fails on a wrong budget", () => {
    const read = PngAdmission.read.bind(PngAdmission);
    // Fault: the PNG reader counts one filtered byte more than an image has, which the self-test's
    // known budget must refuse.
    vi.spyOn(PngAdmission, "read").mockImplementation((bytes) => {
      const admitted = read(bytes);
      // An object made on the admitted result, which it differs from in one field: no
      // PngAdmission, fed on purpose so that the self-test refuses its budget.
      return Object.create(admitted, {
        filteredBytes: { value: admitted.filteredBytes + 1 },
      }) as typeof admitted;
    });
    expect(() => PNG_ADMISSION_SELF_TEST.startup()).toThrow("PNG budget");
  });

  it("fails on a reader that takes a second IHDR", () => {
    const read = PngAdmission.read.bind(PngAdmission);
    // A valid 1x1 image, which a lenient reader returns for every image it should refuse.
    const valid = read(pngImage(pngHeader(1, 1, 8, 0), pngChunk("IDAT", [0])));
    // Fault: the PNG reader refuses nothing, so it takes an image with a second IHDR, which the
    // self-test must refuse.
    vi.spyOn(PngAdmission, "read").mockImplementation((bytes) => {
      try {
        return read(bytes);
      } catch {
        return valid;
      }
    });
    expect(() => PNG_ADMISSION_SELF_TEST.startup()).toThrow("PNG second IHDR");
  });

  it("fails on a reader that takes a whole chunk after IEND", () => {
    const read = PngAdmission.read.bind(PngAdmission);
    const iend = pngChunk("IEND", []);
    // Fault: the PNG reader lacks its end check and takes a whole chunk after IEND; it still
    // refuses bytes there too short for a chunk (an empty chunk is as long as IEND).
    vi.spyOn(PngAdmission, "read").mockImplementation((bytes) => {
      const end = Buffer.from(bytes).indexOf(iend) + iend.length;
      return bytes.length - end >= iend.length ? read(bytes.subarray(0, end)) : read(bytes);
    });
    expect(() => PNG_ADMISSION_SELF_TEST.startup()).toThrow("PNG data after IEND");
  });

  it("fails on a reader that takes 16-bit samples", () => {
    const read = PngAdmission.read.bind(PngAdmission);
    const valid = read(pngImage(pngHeader(1, 1, 8, 0), pngChunk("IDAT", [0])));
    // Fault: the PNG reader takes 16-bit samples, which the self-test must refuse.
    vi.spyOn(PngAdmission, "read").mockImplementation((bytes) => {
      try {
        return read(bytes);
      } catch (error) {
        if (String(error).includes("bits per sample")) return valid;
        throw error;
      }
    });
    expect(() => PNG_ADMISSION_SELF_TEST.startup()).toThrow("PNG 16-bit samples");
  });
});

describe("AUD-022-API001: a damaged PNG start is refused with its own reason", () => {
  it("names a first chunk of another type, whatever its length, before the IHDR length", () => {
    // A first chunk header of `length` and `type`, then 17 zero bytes: as many as an IHDR's data
    // and its CRC.
    const start = (length: number, type: string) =>
      Uint8Array.from([
        ...PNG_SIGNATURE,
        ...pngUint32(length),
        ...Array.from(type, (letter) => letter.charCodeAt(0)),
        ...Array.from({ length: 17 }, () => 0),
      ]);
    expect(() => PngAdmission.read(start(1, "IDAT"))).toThrow("does not begin with an IHDR chunk");
    expect(() => PngAdmission.read(start(13, "IDAT"))).toThrow("does not begin with an IHDR chunk");
    expect(() => PngAdmission.read(start(12, "IHDR"))).toThrow("invalid IHDR chunk length");
  });
});

describe("AUD-022-API002: a last word is refused where the backup gives one phrase", () => {
  it("refuses it for a backup without Seedshift and one of MnemoCode Seedshift", () => {
    const direct = EncodedBackup.read(TEST_PHRASE, "english", "direct");
    expect(() => ReEncoding.of(direct, [], "zoo")).toThrow(LAST_WORD_NOT_TAKEN);
    const masked = EncodedBackup.encode(
      TEST_PHRASE,
      [parseDate("23-09-2026")],
      "indexes",
      "seedshift",
    );
    expect(() => ReEncoding.of(masked.backup, [parseDate("23-09-2026")], "about")).toThrow(
      LAST_WORD_NOT_TAKEN,
    );
    expect(ReEncoding.of(direct, []).phrase).toBe(TEST_PHRASE);
  });
});

describe("AUD-022-ARC001: the library words how a phrase was confirmed", () => {
  const backup = () => EncodedBackup.read(TEST_PHRASE, "english", "direct");

  it("says accepted, not proven, for any match that came with a warning", async () => {
    const reEncoding = ReEncoding.of(backup(), []);
    await reEncoding.confirmByWallet(() => fingerprintMatch(TEST_FINGERPRINT, TEST_FINGERPRINT));
    expect(reEncoding.confirmation).toMatchObject({ warning: FINGERPRINT_WARNING });
    expect(reEncoding.confirmationLine("fingerprint")).toBe(
      "The fingerprint matches: the seed phrase is accepted, not proven.",
    );
    // Not the kind of evidence, the warning decides it.
    const warned = ReEncoding.of(backup(), []);
    await warned.confirmByWallet(() => ({
      matched: true,
      path: "m/84'/0'/0'/0/0",
      warning: "A filter.",
    }));
    expect(warned.confirmationLine("address")).toBe(
      "The address matches: the seed phrase is accepted, not proven.",
    );
  });

  it("says where an address matched, and the person's recognition", async () => {
    const byAddress = ReEncoding.of(backup(), []);
    await byAddress.confirmByWallet(() => ({ matched: true, path: "m/84'/0'/0'/0/0" }));
    expect(byAddress.confirmationLine("address")).toBe(
      "Address found at m/84'/0'/0'/0/0: the wallet matches, the seed phrase is confirmed.",
    );
    const byPerson = ReEncoding.of(backup(), []);
    expect(() => byPerson.confirmationLine("address")).toThrow("not confirmed");
    byPerson.confirmByPerson();
    expect(byPerson.confirmationLine("address")).toBe(RE_ENCODING_WORDS.recognised);
  });
});

describe("AUD-022-FUN002: separate cards keep their own page", () => {
  it("drops a sheet plan's orientation and keeps the person's", () => {
    const colors = indexesToColors([...Array.from({ length: 11 }, () => 0), 3]);
    const job: CardJob = {
      template: selectTemplate("business-it"),
      content: { kind: "colors", colors, payload: colors.join(" "), orientation: "portrait" },
    };
    expect(separateCardJob(job, undefined).content).not.toHaveProperty("orientation");
    expect(separateCardJob(job, "landscape").content).toMatchObject({ orientation: "landscape" });
  });

  it(
    "saves 90 x 50 mm cards with encode --cards-dir for a 24-word phrase",
    async () => {
      const folder = mkdtempSync(join(tmpdir(), "mnemocode-aud022-"));
      try {
        const phrase = `${"abandon ".repeat(23)}art`;
        await runBuiltCli([
          "encode",
          "--mnemonic",
          phrase,
          "--mode",
          "direct",
          "--format",
          "5",
          "--template",
          "business-it",
          "--cards-dir",
          join(folder, "cards"),
        ]);
        const files = readdirSync(join(folder, "cards"));
        expect(files.length).toBeGreaterThan(16);
        const document = await PDFDocument.load(readFileSync(join(folder, "cards", files[0]!)));
        const { width, height } = document.getPage(0).getSize();
        // 90 x 50 mm in points.
        expect(Math.round(width)).toBe(255);
        expect(Math.round(height)).toBe(142);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    },
    LONG_TEST_TIME_LIMIT_MS,
  );
});

describe("AUD-022-FUN004: card refusals come before any secret is asked", () => {
  const company = "Northern Atlantic Consolidated Engineering and Logistics Holdings";
  const prepared = async (argv: readonly string[]) => {
    const { prepareEncode } = await import("../src/cli/encode-command.js");
    const { parseArguments } = await import("../src/cli/arguments.js");
    return prepareEncode(parseArguments([...argv]));
  };
  const split = [
    "--sskr",
    "--ask-secrets",
    "--mode",
    "direct",
    "--threshold",
    "2",
    "--shares",
    "2",
  ];

  it("refuses a detail too long for share cards", async () => {
    await expect(
      prepared([
        ...split,
        "--share-format",
        "unicode",
        "--template",
        "business-it",
        "--card-company",
        company,
        "--pdf",
        "never.pdf",
      ]),
    ).rejects.toThrow("too long to fit");
  });

  it("refuses a material with too few samples for the longest share", async () => {
    await expect(
      prepared([
        ...split,
        "--share-format",
        "unicode",
        "--template",
        "material-tile",
        "--pdf",
        "never.pdf",
      ]),
    ).rejects.toThrow("distinct samples");
  });

  it("refuses a material design at the business size, which makes separate cards", async () => {
    await expect(
      prepared([
        "--ask-secrets",
        "--mode",
        "direct",
        "--format",
        "5",
        "--template",
        "material-tile",
        "--page-size",
        "business",
        "--pdf",
        "never.pdf",
      ]),
    ).rejects.toThrow("sheets only");
  });

  it("is the library's own check, which a page asks as the command line does", async () => {
    // business-it, as --template takes it; a detail that fits passes.
    const style = "it" as const;
    await expect(
      ShareCardSet.assertPrintable(nodeCardRenderer, {
        style,
        shareFormat: "unicode",
        profile: { company },
      }),
    ).rejects.toThrow("cannot be printed for every seed phrase");
    await expect(
      ShareCardSet.assertPrintable(nodeCardRenderer, { style, shareFormat: "colors" }),
    ).resolves.toBeUndefined();
  });

  it("prepares share cards that fit", async () => {
    await expect(
      prepared([
        ...split,
        "--share-format",
        "colors",
        "--template",
        "material-switch",
        "--pdf",
        "never.pdf",
      ]),
    ).resolves.toBeTypeOf("function");
  });
});

describe("AUD-022-FUN001: one share below its threshold with its first elements marked", () => {
  const FORMATS = ["unicode", "indexes", "colors", "colors-unicode"] as const;
  /** The reader's separators other than a space (core/code-text.ts, ELEMENT_SEPARATORS). */
  const OTHER_SEPARATORS = [",", ";", "#"] as const;

  /** `elements` written apart by `separator`, the # before a color serving as a # separator. */
  const apartBy = (elements: readonly string[], separator: string) =>
    elements.join(separator).replace(/#{2,}/gu, "#");

  it(
    "asks for more shares, and its repairs hold the share, in every form, length and separator",
    async () => {
      for (const set of SHARE_SETS)
        for (const ur of set.shares)
          for (const format of FORMATS)
            for (const marks of [1, 2, 3]) {
              const elements = shareElements(ur, format).map((unit, at) =>
                at < marks ? "?" : unit,
              );
              const text = shareText(elements, format);
              const label = `${set.name} ${format} ${marks}`;
              // One reading that does not fit, such as a decoy prefix, no longer blames the set.
              expect(await jointVerdict(text), label).toBe("not-enough");
              // Three marked colors of 128 bits are refused: the checksum cannot tell them.
              if (format === "colors" && marks === 3 && set.name.includes("-128-")) continue;
              const found = repairCandidates(text).map((share) => share.ur);
              expect(found, label).toContain(ur);
              // Up to two marks, and three in Unicode codes and word numbers from 160 bits on, leave
              // one share; three marks in colors hold the checksum and the header, and some bits
              // stay open. Unicode codes of 128 bits also read as 15 colors run together.
              const open =
                marks === 3 &&
                (format === "colors" ||
                  format === "colors-unicode" ||
                  (format === "unicode" && set.name.includes("-128-")));
              if (!open) expect(found, label).toEqual([ur]);
              // Commas, semicolons and # write the elements apart as spaces do, so they read the
              // same; Color Unicode codes run together have no separator.
              if (format === "colors-unicode") continue;
              for (const separator of OTHER_SEPARATORS) {
                const apart = apartBy(elements, separator);
                const name = `${label} "${separator}"`;
                expect(
                  repairCandidates(apart).map((share) => share.ur),
                  name,
                ).toEqual(found);
                expect(await jointVerdict(apart), name).toBe("not-enough");
              }
            }
    },
    LONG_TEST_TIME_LIMIT_MS,
  );
});

describe("AUD-022-FUN003: a decoy card marked with ? after a share whose header is read", () => {
  const share = SHARE_SETS.find((set) => set.name === "bip39-128-2-of-3")!.shares;
  const decoySource = SHARE_SETS.find((set) => set.name === "bip39-256-2-of-3")!.shares[1]!;

  /** The share's elements, `marked` at its place 9, then six elements of another set's share. */
  const withDecoys = (format: ShareFormat, decoys: (all: string[]) => string[], marked = false) => {
    const units = shareElements(share[0]!, format).map((unit, at) =>
      marked && at === 9 ? "?" : unit,
    );
    return [...units, ...decoys(shareElements(decoySource, format).slice(6, 12))];
  };
  const cases: Record<string, (format: ShareFormat) => string[]> = {
    "a marked decoy": (format) => withDecoys(format, (decoys) => ["?", ...decoys.slice(1)]),
    "a share mark and a marked decoy": (format) =>
      withDecoys(format, (decoys) => ["?", ...decoys.slice(1)], true),
  };

  it.each(["colors", "unicode", "indexes"] as const)("repairs the share in %s", async (format) => {
    for (const [label, elements] of Object.entries(cases)) {
      const text = shareText(elements(format), format);
      expect(
        repairCandidates(text).map((found) => found.ur),
        label,
      ).toEqual([share[0]]);
      expect(await jointVerdict(text, share[1]!), label).toBe("determined");
    }
  });

  it("repairs the share in Color Unicode, joined and apart, also with marks across its end", async () => {
    const format = "colors-unicode";
    const own = shareElements(share[0]!, format);
    const colorCases: Record<string, string[]> = {
      ...Object.fromEntries(Object.entries(cases).map(([label, make]) => [label, make(format)])),
      "a marked decoy color": withDecoys(format, (decoys) => ["?", ...decoys.slice(2)]),
      "its last code and a decoy code marked": [
        ...own.slice(0, -1),
        "?",
        "?",
        ...shareElements(decoySource, format).slice(7, 12),
      ],
    };
    for (const apart of [false, true])
      for (const [label, elements] of Object.entries(colorCases)) {
        const text = shareText(elements, format, apart);
        const name = `${label}${apart ? ", apart" : ""}`;
        expect(
          repairCandidates(text).map((found) => found.ur),
          name,
        ).toEqual([share[0]]);
        expect(await jointVerdict(text, share[1]!), name).toBe("determined");
      }
  });
});

describe("AUD-022 observation: every design is checked before any of them is drawn", () => {
  it("refuses a design printed on sheets only at the business size, by its name, at once", async () => {
    const preview = new CardPreview(nodeCardRenderer, { settings: { pageSize: "business" } });
    const drawn = vi.fn();
    // Each design that draws separate cards would note it here: none may, before the refusal.
    const jobs = preview.jobs({ every: true }).map((job) => ({
      ...job,
      template: {
        ...job.template,
        ...(job.template.renderIndividual === undefined ? {} : { renderIndividual: drawn }),
      },
    }));
    const sheetsOnly = jobs.find((job) => job.template.renderIndividual === undefined)!.template;
    await expect(renderCards(nodeCardRenderer, jobs)).rejects.toThrow(
      `The design "${sheetsOnly.name}" is printed on sheets only`,
    );
    expect(drawn).not.toHaveBeenCalled();
  });
});
