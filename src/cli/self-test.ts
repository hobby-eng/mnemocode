// The command line's self-test: the library's checks (core/self-test.ts) with the Node.js host's
// services, the checks of the features the command line builds in (wallet evidence, the coins, the
// sheet for heirs and share cards), and the host's own checks around them: the process protection
// first, then the QR PNG written and read back, the QR image beside a sheet and the card renderers.
// It prints the report in the tools' terminal look.

import { masterFingerprint, nodePbkdf2HmacSha512 } from "../bitcoin-evidence.js";
import { STYLE, terminalLayout, terminalPaint } from "./terminal.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encodeMnemonic, formatEncoded, parseDate } from "../core.js";
import { COIN_ADDRESS_SELF_TEST } from "../core/coins-self-test.js";
import { MnemoCodeSelfTest, type SelfTestCheck, type SelfTestFeature } from "../core/self-test.js";
import { expectRefused, expectRefusedLater, expectSame } from "../core/self-test-check.js";
import { WALLET_EVIDENCE_SELF_TEST } from "../core/wallet-evidence-self-test.js";
import { WORD_HINTS_SELF_TEST } from "../core/word-hints-self-test.js";
import { RE_ENCODING_SELF_TEST } from "../core/re-encoding-self-test.js";
import { PNG_ADMISSION_SELF_TEST } from "../core/png-admission-self-test.js";
import { cardExportCheck } from "../export/cards-self-test.js";
import { cardDrawingCheck } from "../export/card-drawing-self-test.js";
import { cardSetsSelfTest } from "../export/card-sets-self-test.js";
import { heirSheetSelfTest } from "../export/heir-sheet-self-test.js";
import { nodeCardRenderer } from "../export/platform-node.js";
import { shareCardsSelfTest } from "../export/sskr-render-self-test.js";
import { SSKR_VECTOR } from "../sskr/known-answers.js";
import { decodeQrPngFile } from "./qr-input.js";
import { saveQrBeside, saveQrInside } from "./qr-export.js";
import { exportQrPayload } from "../export/qr-image.js";
import { writeNewPrivateFile } from "../export/private-file.js";
import { ProcessProtection } from "./protection.js";
import { nodeSharePlatform } from "../sskr/share-platform-node.js";
import { MNEMOCODE_VERSION } from "../version.js";
import { readBundledFile } from "../bundled-files.js";
import { besideMark, headingLine } from "./terminal-style.js";
import { PUBLIC_VECTORS_FILE } from "../bundled-file-paths.js";
import { afterFailure, describeError } from "../core/refusal.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import { TextFileInput } from "./text-file.js";
import { MASKED_DATE, PUBLIC_MNEMONIC } from "../core/self-test-vectors.js";

const ERRORS = new ErrorCatalog("cli.self-test", {
  "qr-image-not-saved": () => "QR image was not saved.",
  "critical-mnemo-code-core-self-test-failed-no": (value0: string) =>
    `CRITICAL: MnemoCode core self-test failed.\nNo mnemonic data was processed.\n${value0}`,
  "qr-write-read-round-trip-mismatch": () => "QR write/read round trip mismatch.",
});

/** The column of the names of the checks, as wide as the longest name with room to spare. */
const CHECK_NAME_WIDTH = 24;
/** The mark before a check's name on a terminal, and its space. */
const CHECK_MARK = "✓ ";
/** Where a check's detail starts on a terminal: after its mark, its name's column and a space. */
const DETAIL_COLUMN = CHECK_MARK.length + CHECK_NAME_WIDTH + 1;
/** What stands before the summary on a terminal. */
const PASSED = "✓ Passed:";

/** Holds a time and its unit together while a line is broken at spaces (besideMark). */
const NO_BREAK_SPACE = "\u00a0";
/** A time in milliseconds as the report writes it, "74.5 ms": the space before its unit. */
const TIME_UNIT = /(?<=\d) (?=ms\b)/gu;

/**
 * A line of the report on a terminal: `text` beside `mark`, which is `indent` characters wide,
 * wrapped as running text under its own column (besideMark), each line in `style`; a time stays
 * whole on its line.
 */
function reportLine(
  mark: string,
  indent: number,
  text: string,
  style: (line: string) => string = (line) => line,
): string {
  const kept = text.replace(TIME_UNIT, NO_BREAK_SPACE);
  const restored = (line: string): string => style(line.replaceAll(NO_BREAK_SPACE, " "));
  return besideMark(mark, indent, kept, restored).join("\n");
}

/** The features the command line builds in beside the library, with their checks. */
const FEATURES: readonly SelfTestFeature[] = [
  WALLET_EVIDENCE_SELF_TEST,
  COIN_ADDRESS_SELF_TEST,
  heirSheetSelfTest(nodeCardRenderer),
  shareCardsSelfTest(nodeCardRenderer),
  cardSetsSelfTest(nodeCardRenderer),
  WORD_HINTS_SELF_TEST,
  RE_ENCODING_SELF_TEST,
  PNG_ADMISSION_SELF_TEST,
];

/**
 * The quick core checks before a command, with those of the features above; a failure stops it
 * before any secret is read, with a message that never names the secret.
 */
export function assertCoreSelfTest(): void {
  try {
    MnemoCodeSelfTest.core(FEATURES);
    checkTextFileInputStartup();
  } catch (error) {
    const detail = describeError(error);
    throw ERRORS.create("critical-mnemo-code-core-self-test-failed-no", [`${detail}`]);
  }
}

/** What a refusal of the self-test's own text files names them by. */
const TEST_FILE = "The test file";

/** Inline input stays inline and remote file links fail before any user text is read. */
function checkTextFileInputStartup(): void {
  expectSame(
    TextFileInput.read(SSKR_VECTOR.shares[0], TEST_FILE),
    SSKR_VECTOR.shares[0],
    "An inline UR is no file path",
  );
  expectRefused(
    () => TextFileInput.read("file://example.invalid/backup.txt", TEST_FILE),
    /local text file/u,
    "A remote file link",
  );
}

/** The full CLI self-test reads one synthetic share file without changing its lines. */
export const TEXT_FILE_INPUT_CHECK: SelfTestCheck = {
  name: "Text file input",
  detail: "local UTF-8 file, share lines retained, missing file refused",
  run: async () => {
    checkTextFileInputStartup();
    await withTemporaryFolder(async (directory) => {
      const path = join(directory, "public shares.txt");
      const text = `${SSKR_VECTOR.shares[0]}\n${SSKR_VECTOR.shares[2]}\n`;
      await writeNewPrivateFile(path, Buffer.from(text, "utf8"));
      expectSame(TextFileInput.read(`"${path}"`, TEST_FILE), text, "All share file lines");
      expectRefused(
        () => TextFileInput.read(join(directory, "missing.txt"), TEST_FILE),
        /could not be read/u,
        "A missing text file",
      );
    });
  },
};

/**
 * Runs `check` in a new temporary folder, which is removed afterwards whatever happens. A removal
 * that fails after the check failed is kept beside the check's failure (afterFailure), which the
 * report names first.
 */
async function withTemporaryFolder(check: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "mnemocode-self-test-"));
  const remove = (): Promise<void> => rm(directory, { recursive: true, force: true });
  try {
    await check(directory);
  } catch (error) {
    throw await afterFailure(error, remove);
  }
  await remove();
}

async function checkQrRoundTrip(): Promise<void> {
  const payload = formatEncoded(
    encodeMnemonic(PUBLIC_MNEMONIC, [parseDate(MASKED_DATE)]),
    "unicode",
  );
  await withTemporaryFolder(async (directory) => {
    const path = join(directory, "vector.png");
    await exportQrPayload(payload, path);
    if ((await decodeQrPngFile(path)) !== payload)
      throw ERRORS.create("qr-write-read-round-trip-mismatch", []);
  });
}

const QR_CHECK: SelfTestCheck = {
  name: "QR adapter",
  detail: "PNG write and local read",
  run: checkQrRoundTrip,
};

/**
 * The QR image that a sheet's QR code is also saved as: beside the PDF and named after it, under
 * the next free name when that is taken, inside a folder of cards by a share's reference, and read
 * back as the first share of the official SSKR vector; an empty one refused.
 */
async function checkQrBesideSheets(): Promise<void> {
  const payload = SSKR_VECTOR.firstShareColors.join(" ");
  await withTemporaryFolder(async (directory) => {
    const sheet = join(directory, "cards.pdf");
    const beside = await saveQrBeside(payload, sheet);
    expectSame(beside, join(directory, "cards-qr.png"), "QR image beside a PDF");
    if (typeof beside !== "string") throw ERRORS.create("qr-image-not-saved", []);
    expectSame(
      await saveQrBeside(payload, sheet),
      join(directory, "cards-qr-1.png"),
      "QR image beside a PDF under a taken name",
    );
    expectSame(
      await saveQrInside(payload, directory, "4BBF-1-1"),
      join(directory, "4BBF-1-1-qr.png"),
      "QR image inside a folder of cards",
    );
    expectSame(await decodeQrPngFile(beside), payload, "QR image beside a PDF read back");
    await expectRefusedLater(
      () => exportQrPayload("", join(directory, "empty.png")),
      /must not be empty/u,
      "An empty QR image",
    );
  });
}

/** The check of the QR images beside sheets, exported for its test. */
export const QR_BESIDE_CHECK: SelfTestCheck = {
  name: "QR beside sheets",
  detail: "PNG named after its PDF, free names, read back",
  run: checkQrBesideSheets,
};

export async function runSelfTest(): Promise<void> {
  // Unknown until the self-test checks its shape (publicVectorsOf in core/self-test.ts).
  const publicVectors: unknown = JSON.parse(
    new TextDecoder().decode(await readBundledFile(PUBLIC_VECTORS_FILE)),
  );
  // The library's SSKR check goes through nodeSharePlatform, whose engine is checked against
  // sskr-wasm/integrity.json as it loads (runtime.ts): hence "pinned WASM" in its line.
  const report = await new MnemoCodeSelfTest({
    fingerprint: (mnemonic) => masterFingerprint(mnemonic),
    pbkdf2: nodePbkdf2HmacSha512,
    publicVectors,
    sharePlatform: nodeSharePlatform,
    shareLibrary: "pinned WASM",
    features: FEATURES,
    // Built here, not at load: the protection is in place only once the command has started.
    before: [
      {
        name: "Process protection",
        detail: ProcessProtection.permissionSummary(),
        run: () => ProcessProtection.assert(),
      },
      // A report of what the system enforces, which never fails: a system without a protection
      // runs without it (system-sandbox.ts).
      { name: "System sandbox", detail: ProcessProtection.sandboxReport(), run: () => undefined },
    ],
    after: [
      TEXT_FILE_INPUT_CHECK,
      QR_CHECK,
      QR_BESIDE_CHECK,
      cardExportCheck(nodeCardRenderer),
      cardDrawingCheck(nodeCardRenderer),
    ],
  }).run();
  const rows = report.rows.map(
    (row) => [row.name, `${row.detail} (${row.milliseconds.toFixed(1)} ms)`] as const,
  );
  const summary = `${report.publicVectors} public vectors; ${report.roundTrips} representation round trips; ${report.milliseconds.toFixed(1)} ms total.`;
  if (terminalLayout("stdout")) {
    // The terminal look of the bip_tools tools: a title line, a ✓ per check, grey details.
    const paint = (code: string, text: string): string => terminalPaint("stdout", code, text);
    console.log(`\n${headingLine(process.stdout, `Self-test ${MNEMOCODE_VERSION}`)}`);
    for (const [name, detail] of rows) {
      const mark = `${paint(STYLE.good, CHECK_MARK)}${name.padEnd(CHECK_NAME_WIDTH)} `;
      console.log(reportLine(mark, DETAIL_COLUMN, detail, (line) => paint(STYLE.muted, line)));
    }
    console.log(reportLine(`${paint(STYLE.good, PASSED)} `, PASSED.length + 1, summary));
    return;
  }
  console.log(`MnemoCode ${MNEMOCODE_VERSION} self-test`);
  console.log("────────────────────────────────────────────────────────────────────────");
  for (const [name, detail] of rows) console.log(`✓ ${name.padEnd(CHECK_NAME_WIDTH)} ${detail}`);
  console.log("────────────────────────────────────────────────────────────────────────");
  console.log(`PASS  ${summary}`);
}
