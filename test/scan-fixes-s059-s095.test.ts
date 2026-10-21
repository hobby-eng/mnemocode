// The findings S059 to S095 of the DRY/OOP scan of 2026-10-09 (test/scan-fixes.test.ts), each with
// a case that would fail without its fix. Public test data only: the BIP39 test phrase and the
// public SSKR vectors.

import {
  headingLine,
  factLine,
  markedLines as styledMarkedLinesForTest,
  noticeLines as styledNoticeLines,
} from "../src/cli/terminal-style.js";
import { CANCELLED_EXIT_CODE, CANCELLED_MESSAGE } from "../src/cli/exit-codes.js";
import {
  CardPreview as CardPreviewClass,
  LONGEST_SAMPLE_WORDS,
  SAMPLE_WORD_COUNTS,
} from "../src/export/card-preview.js";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArguments, assertAskedNotGiven, flagOf } from "../src/cli/arguments.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { Masking, SPLIT_MODES_ONLY, PHRASE_WORDS } from "../src/core/masking.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ShareSetChoice } from "../src/core/backup-options.js";
import { MAX_SHOWN_MATCHES } from "../src/core/date-search.js";
import { ShareInput, SHARE_SEPARATOR } from "../src/sskr/share-input.js";
import { parseDate } from "../src/core.js";
import { DEFAULT_DOCUMENT_FORMAT } from "../src/export/image-export.js";
import { assertSheetQr } from "../src/export/content-kinds.js";
import { MatchTally } from "../src/core/candidates.js";
import { coinById } from "../src/core/coins.js";
import { bech32m } from "@scure/base";
import {
  FIRST_RECEIVING_LOCATION,
  BITCOIN_PROFILES,
  type WalletEvidence,
} from "../src/core/wallet-evidence.js";
import {
  walletEvidence,
  walletEvidenceArguments,
  givenWallet,
  WALLET_EVIDENCE_OPTIONS,
} from "../src/cli/bitcoin-options.js";
import { Bech32Prefixes } from "../src/core/coins/bech32.js";
import { maxResultsOf } from "../src/cli/date-search.js";
import { WHAT_NOW } from "../src/cli/ask.js";
import { changeWalletAnswer, checkWalletAnswer } from "../src/cli/wallet-question.js";
import { FILE_INPUTS, FILE_OUTPUTS, FOLDER_OUTPUTS } from "../src/cli/output-options.js";
import {
  COMMAND_OPTIONS,
  COMMAND_FACTS,
  PRIVATE_SCREEN_COMMANDS,
} from "../src/cli/command-options.js";
import { optionLabel } from "../src/cli/option-copy.js";
import { TypedShares } from "../src/cli/share-repair.js";
import { SHARE_ANSWER_HINT, addMoreShares } from "../src/cli/share-repair.js";
import { heirSheetText } from "../src/cli/heir-sheet.js";
import { ShareSplit } from "../src/sskr/split.js";
import { nodeSharePlatform, nodeFillRandom } from "../src/sskr/share-platform-node.js";
import { combineSskrShares } from "../src/sskr/shares.js";
import { runSskrSplit } from "../src/cli/sskr-split-command.js";
import {
  TEMPLATE_CATALOG,
  resolveTemplateId,
  findTemplate,
  DEFAULT_TEMPLATE_ID,
  BUSINESS_STYLES,
  designOfStyle,
} from "../src/export/template-catalog.js";
import { CARD_TEMPLATES, selectTemplate } from "../src/export/templates.js";
import { sectorForStyle } from "../src/export/card-identities.js";
import { PHYSICAL_BUSINESS_STYLES } from "../src/export/business-designs.js";
import { designTexts } from "../src/export/card-copy.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { assertCardIndex } from "../src/export/card-codes.js";
import { validateCardOptions, cardOutputs } from "../src/cli/card-options.js";
import { exportOptions } from "../src/cli/sskr-output.js";
import { cardFileFormat } from "../src/cli/image-options.js";
import {
  ENCODE_SHARED_OPTIONS,
  ENCODE_PLAIN_ONLY_OPTIONS,
  ENCODE_SSKR_ONLY_OPTIONS,
} from "../src/cli/encode-option-groups.js";
import { plainFingerprintLine, FINGERPRINT_HINT } from "../src/cli/fingerprint-report.js";
import { listQuestionRows, rowsOf, enteredAnswer, typeHint } from "../src/cli/terminal-choice.js";
import { closingRows } from "../src/cli/private-screen.js";
import {
  resultHeaderLines,
  noticeLines,
  markedLines,
  cursorUp,
  cursorRight,
} from "../src/cli/terminal.js";
import { NOT_UTF8 } from "../src/cli/typed-answer.js";
import {
  isUnusableOutputPath,
  validateOutputPaths,
  preflightFileDestination,
  preflightFolderDestination,
} from "../src/cli/output-paths.js";
import { entryAt, absentPath } from "../src/export/private-file.js";
import { ValidCharacters, characterLength, isContinuation } from "../src/cli/utf8.js";
import { characterSize } from "../src/cli/terminal-geometry.js";
import { assertColorCards } from "../src/export/card-content.js";
import { firstReceivingOf } from "./helpers/coin-addresses.js";
import {
  DATE,
  ENCODED_FINGERPRINT,
  TEST_ADDRESS,
  TEST_FINGERPRINT,
  TEST_PHRASE,
  TEST_WORDS,
} from "./helpers/test-phrase.js";
import { sskrVectors } from "./helpers/vectors.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";
import { WORDS_AGAIN_ANSWER } from "./helpers/prompts.js";

describe("S059: the menu's wallet answer is the command line that gives the same evidence", () => {
  it("reads back every way of the wallet question, and a place that is not the first", () => {
    const first = { ...FIRST_RECEIVING_LOCATION };
    const cases: WalletEvidence[] = [
      { kind: "master-fingerprint", value: TEST_FINGERPRINT, network: "mainnet" },
      {
        kind: "address",
        value: TEST_ADDRESS,
        profiles: BITCOIN_PROFILES,
        location: first,
        addresses: 20,
      },
      {
        kind: "address",
        value: TEST_ADDRESS,
        profiles: ["native-segwit"],
        location: { ...first, account: 1, index: 3 },
        addresses: 2,
      },
      {
        kind: "coin-address",
        coin: "ethereum",
        value: firstReceivingOf("ethereum"),
        location: { account: 0, branch: 0, index: 0 },
        addresses: 5,
      },
    ];
    for (const evidence of cases)
      expect(walletEvidence(parseArguments(walletEvidenceArguments(evidence)))).toEqual(evidence);
  });
});

describe("S065: Dash Platform's account and branch paths follow one DIP17 rule", () => {
  it("builds the branch from the account path, with DIP9's purpose", () => {
    const dash = coinById("dash");
    expect(dash.purposeOf("dash-platform")).toBe(9);
    expect(dash.accountPathOf("dash-platform", 5, 2)).toBe("m/9'/5'/17'/2'");
    expect(dash.branchPathOf("dash-platform", 5, { account: 2, branch: 0, index: 7 })).toBe(
      "m/9'/5'/17'/2'/0'",
    );
    expect(dash.accountPathOf("p2pkh", 5, 0)).toBe("m/44'/5'/0'");
  });
});

describe("S064: one value type of Bech32 prefixes", () => {
  it("tells a coin's strings and their network, and refuses a foreign prefix with the separator", () => {
    const prefixes = new Bech32Prefixes("bc", "tb");
    expect(prefixes.starts).toEqual(["bc1", "tb1"]);
    expect([prefixes.testnetOf("bc"), prefixes.testnetOf("tb"), prefixes.testnetOf("ltc")]).toEqual(
      [false, true, undefined],
    );
    // A Bech32m string of another prefix that begins as Dash Platform's does.
    const foreign = bech32m.encode("dash1x", bech32m.toWords(new Uint8Array(21)));
    expect(() => coinById("dash").parse(foreign)).toThrow("it is not an address of Dash");
  });
});

describe("S070: one refusal of secrets given beside --ask-secrets", () => {
  it("names the options given, by their flags", () => {
    expect(() =>
      assertAskedNotGiven({ "ask-secrets": true, mnemonic: "x", date: ["01-01-2000"] }, [
        "mnemonic",
        "mnemonic-file",
        "date",
      ]),
    ).toThrow("--ask-secrets cannot be combined with --mnemonic or --dates.");
    expect(() => assertAskedNotGiven({ mnemonic: "x" }, ["mnemonic"])).not.toThrow();
    expect(flagOf("date")).toBe("--dates");
  });
});

describe("S069: one reader of the wallet options", () => {
  it("refuses a place without a wallet, and reads the wallet, its place and passphrase together", () => {
    expect(() => givenWallet({ network: "testnet" })).toThrow(
      "--network applies to a wallet given as an option",
    );
    const wallet = givenWallet({ "master-fingerprint": TEST_FINGERPRINT });
    expect(wallet.evidence).toEqual({
      kind: "master-fingerprint",
      value: TEST_FINGERPRINT,
      network: "mainnet",
    });
    expect(wallet.place.location).toEqual(FIRST_RECEIVING_LOCATION);
    expect(wallet.passphrase).toBe("");
    expect(wallet.withPassphrase).toBe(false);
    expect(maxResultsOf({})).toBe(MAX_SHOWN_MATCHES);
  });

  it("says whether a BIP39 passphrase was given, so that a question needs no copy of it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-passphrase-"));
    try {
      // TREZOR: the public passphrase of the BIP39 test vectors.
      const path = join(directory, "passphrase.txt");
      await writeFile(path, "TREZOR\n");
      const wallet = givenWallet({
        "master-fingerprint": TEST_FINGERPRINT,
        "bip39-passphrase-file": path,
      });
      expect(wallet.passphrase).toBe("TREZOR");
      expect(wallet.withPassphrase).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("S068: one question after a date search, one wording of each wallet answer", () => {
  it("types the wallet answers only where they are built", () => {
    const typedIn = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => {
        const source = readFileSync(join("src", file), "utf8");
        return /"(?:Change the wallet|Check them against the wallet)"/u.test(source);
      });
    expect(typedIn).toEqual([join("cli", "wallet-question.ts")]);
    expect(changeWalletAnswer("wallet")).toEqual({
      label: "Change the wallet",
      note: "the fingerprint or the address",
      value: "wallet",
    });
    expect(checkWalletAnswer(1, "without a list").note).toBe("without a list");
  });
});

describe("S071: every option list is typed once", () => {
  it("lists every option that names a file or a folder as exactly one input or output", () => {
    const options = new Set(Object.values(COMMAND_OPTIONS).flat());
    const lists: readonly (readonly string[])[] = [FILE_INPUTS, FILE_OUTPUTS, FOLDER_OUTPUTS];
    for (const key of options) {
      const named = /\b(?:file|folder)\b/u.test(optionLabel(key));
      const listed = lists.filter((list) => list.includes(key)).length;
      expect([key, listed]).toEqual([key, named ? 1 : 0]);
    }
    for (const key of lists.flat()) expect(options.has(key)).toBe(true);
  });

  it("builds the wallet options from the evidence options and the place", () => {
    expect([...WALLET_EVIDENCE_OPTIONS].sort()).toEqual(
      [
        "bitcoin-address",
        "coin-address",
        "coin",
        "master-xpub",
        "account-xpub",
        "compressed-public-key",
        "master-fingerprint",
        "wif-file",
        "network",
        "bitcoin-profile",
        "account",
        "branch",
        "index",
        "scan-gap",
        "bip39-passphrase-file",
      ].sort(),
    );
    expect(() =>
      givenWallet({ "master-fingerprint": TEST_FINGERPRINT, "bitcoin-profile": "bip84" }),
    ).toThrow("--bitcoin-profile places an address, a key or a WIF; a master key has no place.");
    expect(() =>
      givenWallet({ coin: "litecoin", "coin-address": "x", "bitcoin-profile": "bip84" }),
    ).toThrow("--bitcoin-profile is for Bitcoin evidence");
  });
});

describe("S072: a share file reads as a typed answer does", () => {
  const { shares } = sskrVectors().deterministic[0]!;
  const [first, second, third] = [shares[0]!, shares[1]!, shares[2]!];

  it("splits at ;, joins a wrapped share and refuses a seed phrase one word per line", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-share-file-"));
    try {
      const joined = join(directory, "joined.txt");
      await writeFile(joined, `${first};${second}\n`);
      const wrapped = join(directory, "wrapped.txt");
      const cut = Math.floor(third.length / 2);
      await writeFile(wrapped, `${third.slice(0, cut)}\n${third.slice(cut)}\n`);
      const read = await TypedShares.given({ "share-file": [joined, wrapped] });
      expect(read.list.map((share) => share.text)).toEqual([first, second, third]);
      const phrase = join(directory, "phrase.txt");
      await writeFile(phrase, `${TEST_WORDS.join("\n")}\n`);
      await expect(TypedShares.given({ "share-file": phrase })).rejects.toThrow(
        "The file holds a seed phrase in words, not a Shamir share",
      );
      const blank = join(directory, "blank.txt");
      await writeFile(blank, " \n;\n");
      await expect(TypedShares.given({ "share-file": blank })).rejects.toThrow(
        "Provide at least one complete share",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("S073: the share separator is one constant", () => {
  it("names the separator in the hint of the share prompts and on the heir sheet, and splits shares at it", () => {
    expect(SHARE_ANSWER_HINT).toBe(
      `separate shares with ${SHARE_SEPARATOR}, ? for each unreadable code or digit`,
    );
    const sheet = heirSheetText({
      backup: { kind: "shares", format: "words", threshold: 2, count: 3 },
      mode: "direct",
      dates: 0,
    });
    expect(sheet.steps).toContain(
      `Type any 2 shares, separated by "${SHARE_SEPARATOR}". MnemoCode shows the seed phrase.`,
    );
    const input = new ShareInput({ decodeEntry: "Decode" });
    expect(input.sharesOfText(`a${SHARE_SEPARATOR}b\nc`)).toEqual(["a", "b", "c"]);
  });
});

describe("S075: one library split of a backup", () => {
  const phrase = TEST_PHRASE;
  const dated = [parseDate(DATE)];

  it("splits the phrase that the mode holds, and refuses a mode without shares", async () => {
    const split = new ShareSplit(nodeSharePlatform, nodeFillRandom);
    const masked = await split.splitBackup({
      mnemonic: `  ${phrase.toUpperCase()} `,
      mode: "seedshift",
      dates: dated,
      threshold: 2,
      count: 3,
    });
    expect(masked.original).toBe(phrase);
    expect(masked.held).toBe(Masking.of("seedshift").held(phrase, dated));
    expect(masked.held).not.toBe(phrase);
    expect(await combineSskrShares(masked.records.slice(1))).toBe(masked.held);
    const direct = await split.splitBackup({
      mnemonic: phrase,
      mode: "direct",
      dates: [],
      threshold: 2,
      count: 2,
    });
    expect(direct.held).toBe(phrase);
    await expect(
      split.splitBackup({
        mnemonic: phrase,
        // A mode that splitBackup does not take, given on purpose as a JavaScript host could.
        mode: "seedshift-legacy" as never,
        dates: dated,
        threshold: 2,
        count: 3,
      }),
    ).rejects.toThrow(SPLIT_MODES_ONLY);
  });
});

describe("S076: Encode keeps the library's encoding", () => {
  it("says whether the last word was replaced", () => {
    const phrase = TEST_PHRASE;
    const dated = [parseDate(DATE)];
    const kept = EncodedBackup.encode(phrase, dated, "indexes", "seedshift-legacy");
    const asked = EncodedBackup.encode(phrase, dated, "indexes", "seedshift-legacy", {
      validLastWord: true,
    });
    expect(kept.replaced).toBe(false);
    expect(asked.replaced).toBe(asked.lastWordChanged);
    expect(asked.backup.mode).toBe(asked.replaced ? "seedshift-legacy-valid" : "seedshift-legacy");
  });
});

describe("S074: the share numbers are read within SSKR's bounds", () => {
  it("refuses a threshold or a count outside them before anything is asked", async () => {
    const { MIN_SHARES, MAX_SHARES } = ShareSetChoice;
    await expect(
      runSskrSplit({ threshold: String(MIN_SHARES - 1), shares: "3", mnemonic: "x" }),
    ).rejects.toThrow(String(MAX_SHARES));
    await expect(
      runSskrSplit({ threshold: "2", shares: String(MAX_SHARES + 1), mnemonic: "x" }),
    ).rejects.toThrow(String(MAX_SHARES));
    await expect(runSskrSplit({ threshold: "3", shares: "2", mnemonic: "x" })).rejects.toThrow(
      "A split needs a threshold",
    );
  });
});

describe("S078: the rules of printable cards have one owner", () => {
  it("refuses a QR code on separate colour cards without drawing", () => {
    expect(() => assertSheetQr({ kind: "colors", pageSize: "business", cardQr: true })).toThrow(
      "A QR code is printed on a sheet only.",
    );
    expect(() => assertSheetQr({ kind: "colors", pageSize: "a6", cardQr: true })).not.toThrow();
    expect(() => assertSheetQr({ kind: "sskr", pageSize: "business", cardQr: true })).not.toThrow();
  });

  it("takes BIP39's longest phrase as the longest sample, and builds sample cards in the form of the codes but never in word numbers", () => {
    expect(LONGEST_SAMPLE_WORDS).toBe(Math.max(...SAMPLE_WORD_COUNTS));
    expect(() => new CardPreviewClass(nodeCardRenderer, { colorForm: "indexes" })).toThrow(
      "Colour cards are not written as indexes.",
    );
    // Unicode codes have cards, which print them.
    const unicode = new CardPreviewClass(nodeCardRenderer, { colorForm: "unicode" });
    expect(unicode.content(CardPreviewClass.templates[0]!).labels).toBeDefined();
    const preview = new CardPreviewClass(nodeCardRenderer, { colorForm: "colors-unicode" });
    const colors = CardPreviewClass.templates.find((template) => template.kind === "colors")!;
    const content = preview.content(colors);
    expect(content.kind === "colors" && content.payload.startsWith("#")).toBe(false);
  });
});

describe("S079: one catalog of designs and one reader of their numbers", () => {
  it("keeps the ids, numbers them alike for every caller and lists every design once", () => {
    // Recorded commands name these ids: they never change.
    expect(TEMPLATE_CATALOG.map((entry) => entry.id)).toEqual([
      "business-architect",
      "business-it",
      "business-estate",
      "business-diagonal",
      "business-contact",
      "business-curves",
      "business-facets",
      "business-mixed",
      "material-vehicle",
      "material-enclosure",
      "material-tile",
      "material-switch",
      "material-kitchen",
    ]);
    expect(CARD_TEMPLATES.map((template) => template.id)).toEqual(
      TEMPLATE_CATALOG.map((entry) => entry.id),
    );
    TEMPLATE_CATALOG.forEach((entry, index) => {
      const number = String(index + 1);
      expect(resolveTemplateId(number, "colors")).toBe(entry);
      expect(selectTemplate(number, "colors").id).toBe(entry.id);
      expect(selectTemplate(entry.id).style).toBe(entry.style);
    });
    expect(findTemplate("0")).toBeUndefined();
    expect(findTemplate("01")).toBeUndefined();
    expect(() => resolveTemplateId("business-nowhere")).toThrow("is unknown or incompatible");
    expect(DEFAULT_TEMPLATE_ID).toBe(selectTemplate().id);
  });

  it("gives the employer's sector by the style of a design, not by its place", () => {
    expect(sectorForStyle(selectTemplate("business-it").style)).toBe("it");
    expect(sectorForStyle(selectTemplate("business-architect").style)).toBe("architecture");
    expect(sectorForStyle(selectTemplate("business-estate").style)).toBe("property");
    for (const entry of TEMPLATE_CATALOG.slice(3))
      expect(sectorForStyle(entry.style)).toBeUndefined();
    expect(sectorForStyle("1")).toBeUndefined();
    expect(sectorForStyle(undefined)).toBeUndefined();
  });
});

describe("S080: one list of the styles of the designs", () => {
  it("derives the business styles, the texts of a design and the share card styles from it", async () => {
    expect(PHYSICAL_BUSINESS_STYLES).toEqual(BUSINESS_STYLES.filter((style) => style !== "mixed"));
    expect(designTexts(false)).toEqual(["referenceLabel"]);
    expect(designTexts(true)).toEqual(["studioName", "slogan", "subtitle", "footer"]);
    for (const entry of TEMPLATE_CATALOG) expect(designOfStyle(entry.style)).toBe(entry);
    expect(designOfStyle("business-it")).toBeUndefined();
    // A style that no design has, given on purpose as a JavaScript host could.
    await expect(
      ShareCardSet.create(nodeCardRenderer, [], { style: "nowhere" as never }),
    ).rejects.toThrow("Unsupported SSKR card style.");
  });
});

describe("S082: one rule for card settings without a card output", () => {
  const NEED_OUTPUT =
    "Card settings require a PDF file, an image output folder or an individual-card output folder.";

  it("refuses them alike in Encode and in the commands of shares", () => {
    expect(() => validateCardOptions({ title: "Cards" }, "colors")).toThrow(NEED_OUTPUT);
    expect(() => exportOptions({ template: "business-it" }, "colors")).toThrow(NEED_OUTPUT);
    expect(exportOptions({}, "colors")).toBeUndefined();
    expect(cardOutputs({ pdf: "a.pdf" })).toEqual({ sheets: true, cards: false });
  });

  it("writes card files as PDF unless an image format is given", () => {
    expect(cardFileFormat({})).toBe(DEFAULT_DOCUMENT_FORMAT);
    expect(cardFileFormat({ "image-format": "jpeg" })).toBe("jpg");
  });
});

describe("S083: each option of Encode belongs to one of its modes", () => {
  it("splits Encode's options into three groups that cover them once", () => {
    const groups = [ENCODE_SHARED_OPTIONS, ENCODE_PLAIN_ONLY_OPTIONS, ENCODE_SSKR_ONLY_OPTIONS];
    const listed: string[] = groups.flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed, "sskr"].sort()).toEqual([...COMMAND_OPTIONS.encode].sort());
    // sskr-split names the form of the shares --format; every other option of it is SSKR's too.
    const sskr = new Set<string>([...ENCODE_SHARED_OPTIONS, ...ENCODE_SSKR_ONLY_OPTIONS]);
    for (const key of COMMAND_OPTIONS["sskr-split"])
      expect([key, sskr.has(key)]).toEqual([key, true]);
  });
});

describe("S084: one source of the fingerprint lines", () => {
  it("builds the plain lines and notes from FINGERPRINT_NOTE and PHRASE_WORDS", () => {
    expect(plainFingerprintLine("original", TEST_FINGERPRINT)).toBe(
      `Original BIP32 master fingerprint (empty BIP39 passphrase): ${TEST_FINGERPRINT}`,
    );
    expect(plainFingerprintLine("encoded", ENCODED_FINGERPRINT, true)).toBe(
      `Encoded BIP32 master fingerprint of the masked phrase (empty BIP39 passphrase): ${ENCODED_FINGERPRINT}`,
    );
    expect(FINGERPRINT_HINT).toBe("Fingerprint uses an empty BIP39 passphrase.");
    expect(PHRASE_WORDS.encodedFingerprint).toBe("Encoded fingerprint (of the masked phrase)");
    expect(Masking.of("direct").encodedFingerprintLabel).toBe("Encoded fingerprint");
  });
});

describe("S085: one Stop that cancels, one question and one answer for more shares", () => {
  it('has no module that cancels at a "stop" answer of its own, and words the question as What now? and the answer as Add more shares', () => {
    const stops = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .filter((file) =>
        /=== "stop"\) return CANCELLED/u.test(readFileSync(join("src", file), "utf8")),
      );
    expect(stops).toEqual([]);
    expect(WHAT_NOW).toBe("What now?");
    expect(addMoreShares(1)).toEqual({ label: "Add more shares", value: 1 });
  });
});

describe("S087: the rows around a result are measured as they are printed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("counts a question, the closing lines and a coloured heading by their lines", () => {
    const three = [
      { label: WORDS_AGAIN_ANSWER, value: 1 },
      { label: "Change the wallet", note: "the fingerprint or the address", value: 2 },
      { label: "Done", value: 3 },
    ];
    // A blank line, the question, three choices, a blank line, the key hint, the cursor's row.
    expect(listQuestionRows(WHAT_NOW, three, "stops")).toBe(8);
    expect(closingRows()).toBe(2);
    vi.stubEnv("CLICOLOR_FORCE", "1");
    streamsAsTerminal();
    vi.stubEnv("NO_COLOR", "");
    // A blank line, the title and three facts: the hand count left out one of them.
    expect(
      rowsOf(
        resultHeaderLines("Date recovery", [
          ["A", "1"],
          ["B", "2"],
          ["C", "3"],
        ]),
      ),
    ).toBe(5);
    const message = "word ".repeat(40).trim();
    expect(rowsOf(noticeLines(message, "warning"))).toBe(markedLines(message, "warning").length);
    expect(markedLines(message, "warning").length).toBeGreaterThan(1);
  });
});

describe("S088: one rule for an empty typed answer", () => {
  it("gives the text, the fallback, a left-out answer or one hint", () => {
    expect(enteredAnswer("x", { leave: "back" })).toEqual({ kind: "text", text: "x" });
    expect(enteredAnswer("", { fallback: "20", leave: "back" })).toEqual({
      kind: "text",
      text: "20",
    });
    expect(enteredAnswer("", { optional: "random", leave: "back" })).toEqual({ kind: "left-out" });
    expect(enteredAnswer("", { what: "it", leave: "back" })).toEqual({
      kind: "refused",
      reason: "Type it, or press Esc to go back.",
    });
    expect(typeHint(undefined, "stop")).toBe("Type an answer, or press Ctrl+C to stop.");
    expect(NOT_UTF8).toBe("The answer is not valid UTF-8 text.");
  });
});

describe("S089: one tally of the wallet's matches", () => {
  it("counts the matches and keeps the first warning", () => {
    const tally = new MatchTally();
    tally.add(undefined);
    tally.add({ matched: false });
    tally.add({ matched: true, warning: "first" });
    tally.add({ matched: true, warning: "second" });
    expect([tally.matched, tally.warning]).toEqual([2, "first"]);
  });
});

describe("S090: one owner of the rules of output paths", () => {
  it("refuses an absent image path and unusable folder destinations", async () => {
    expect(isUnusableOutputPath(" ")).toBe(true);
    expect(isUnusableOutputPath("-")).toBe(true);
    expect(isUnusableOutputPath("./-")).toBe(false);
    await expect(validateOutputPaths({ "images-dir": "-" })).rejects.toThrow(
      "The image output folder needs a path",
    );
    const root = await mkdtemp(join(tmpdir(), "mnemocode-s090-"));
    try {
      const file = join(root, "file.txt");
      await writeFile(file, "");
      await expect(preflightFolderDestination(join(file, "cards"))).rejects.toThrow(
        "A file stands where a folder of this name should be",
      );
      await expect(
        preflightFolderDestination(join(root, "a", "b", "cards")),
      ).resolves.toBeUndefined();
      // A folder named like a file that an export writes is refused, whatever its case.
      for (const name of ["cards.pdf", "pages.PNG", "pages.jpg", "pages.jpeg/"])
        await expect(preflightFolderDestination(join(root, name)), name).rejects.toThrow(
          "A new folder needs a name without .",
        );
      await expect(preflightFolderDestination(join(root, "cards.v2"))).resolves.toBeUndefined();
      // A file named like a folder that stands in its way: the message says so.
      await mkdir(join(root, "taken.pdf"));
      await expect(preflightFileDestination(join(root, "taken.pdf"), true)).rejects.toThrow(
        "A folder has this name; give the file another name, or a name inside that folder.",
      );
      expect(await entryAt(file)).toBe("other");
      await expect(absentPath(" ", "taken")).rejects.toThrow("A new folder needs a path");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("S091: the facts of each command in one table", () => {
  it("derives the private-screen commands and the listed ones from it", () => {
    expect([...PRIVATE_SCREEN_COMMANDS].sort()).toEqual(
      [
        "decode",
        "encode",
        "re-encode",
        "recover-date",
        "recover-word",
        "sskr-combine",
        "sskr-export",
        "sskr-split",
      ].sort(),
    );
    const unlisted = Object.entries(COMMAND_FACTS).filter(([, facts]) => !facts.listed);
    expect(unlisted.map(([name]) => name)).toEqual(["sskr-split"]);
    expect(Object.keys(COMMAND_FACTS).sort()).toEqual(Object.keys(COMMAND_OPTIONS).sort());
  });
});

describe("S092: the shapes of terminal lines in the style leaf", () => {
  it("builds the heading, a fact, a marked warning and the cancel line once", () => {
    const plain = { isTTY: false };
    expect(headingLine(plain, "Self-test")).toBe("MnemoCode · Self-test");
    expect(factLine(plain, "Protection", "no network", 11)).toBe("  Protection  no network");
    expect(styledMarkedLinesForTest(plain, "Careful.", "warning")).toEqual(["! Careful."]);
    expect(styledNoticeLines(plain, "Careful.", "warning")).toEqual(["Careful."]);
    expect(CANCELLED_MESSAGE).toBe("Cancelled.");
    expect(CANCELLED_EXIT_CODE).toBe(130);
  });
});

describe("S093: one owner of the UTF-8 rules", () => {
  it("passes on whole valid characters only and steps over any byte", async () => {
    const bytes = [0xc0, 0x41, 0xff, 0x80, 0x42, 0xe2, 0x82, 0xac];
    const source = async (): Promise<number | undefined> => bytes.shift();
    const reader = new ValidCharacters(source);
    const read: number[] = [];
    for (let byte = await reader.next(); byte !== undefined; byte = await reader.next())
      read.push(byte);
    expect(read).toEqual([0x41, 0x42, 0xe2, 0x82, 0xac]);
    expect(reader.leftOut()).toBe(true);
    expect([characterLength(0xc0), characterLength(0xe2), characterSize(0xff)]).toEqual([0, 3, 1]);
    expect(isContinuation(0x80)).toBe(true);
    expect(cursorUp(0) + cursorRight(-1)).toBe("");
  });
});

describe("S095: one gate of colour cards and one check of a card's number", () => {
  it("refuses non-colour content and an index outside the cards through the shared checks", () => {
    expect(() =>
      // Content of another kind, given on purpose as a JavaScript host could.
      assertColorCards({ kind: "unicode", payload: "" } as never),
    ).toThrow("These cards draw color references");
    expect(() => assertCardIndex(3, 3)).toThrow("There is no card 4: the cards are 1 to 3.");
    expect(() => assertCardIndex(1.5, 3)).toThrow("There is no card");
    expect(() => assertCardIndex(2, 3)).not.toThrow();
  });
});
