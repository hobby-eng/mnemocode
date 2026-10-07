// The command line's self-test: the library's checks (core/self-test.ts) with the Node.js host's
// services, the checks of the features the command line builds in (wallet evidence, the coins, the
// sheet for heirs and share cards), and the host's own checks around them: the process protection
// first, then the QR PNG written and read back, the QR image beside a sheet and the card renderers.
// It prints the report in the tools' terminal look.

import { masterFingerprint, nodePbkdf2HmacSha512 } from "../bitcoin-evidence.js";
import { STYLE, terminalColor, terminalPaint } from "./terminal.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encodeMnemonic, formatEncoded, parseDate } from "../core.js";
import { COIN_ADDRESS_SELF_TEST } from "../core/coins-self-test.js";
import { MnemoCodeSelfTest, type SelfTestCheck, type SelfTestFeature } from "../core/self-test.js";
import { expectRefusedLater, expectSame } from "../core/self-test-check.js";
import { WALLET_EVIDENCE_SELF_TEST } from "../core/wallet-evidence-self-test.js";
import { CARD_EXPORT_CHECK } from "../export/cards-self-test.js";
import { HEIR_SHEET_SELF_TEST } from "../export/heir-sheet-self-test.js";
import { SHARE_CARDS_SELF_TEST } from "../export/sskr-render-self-test.js";
import { sskrVector } from "../sskr/known-answers.js";
import { decodeQrPngFile } from "./qr-input.js";
import { exportQrPayload, saveQrBeside, saveQrInside } from "./qr-export.js";
import { assertProtected, protectionSummary } from "./protection.js";
import { nodeSharePlatform } from "../sskr/share-platform-node.js";
import { MNEMOCODE_VERSION } from "../version.js";
import { readBundledFile } from "../bundled-files.js";

const PUBLIC_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/** The features the command line builds in beside the library, with their checks. */
const FEATURES: readonly SelfTestFeature[] = [
  WALLET_EVIDENCE_SELF_TEST,
  COIN_ADDRESS_SELF_TEST,
  HEIR_SHEET_SELF_TEST,
  SHARE_CARDS_SELF_TEST,
];

/**
 * The quick core checks before a command, with those of the features above; a failure stops it
 * before any secret is read, with a message that never names the secret.
 */
export function assertCoreSelfTest(): void {
  try {
    MnemoCodeSelfTest.core(FEATURES);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `CRITICAL: MnemoCode core self-test failed.\nNo mnemonic data was processed.\n${detail}`,
    );
  }
}

async function checkQrRoundTrip(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "mnemocode-self-test-"));
  const path = join(directory, "vector.png");
  const payload = formatEncoded(
    encodeMnemonic(PUBLIC_MNEMONIC, [parseDate("23-09-2026")]),
    "unicode",
  );
  try {
    await exportQrPayload(payload, path);
    if ((await decodeQrPngFile(path)) !== payload)
      throw new Error("QR write/read round trip mismatch.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
  const directory = await mkdtemp(join(tmpdir(), "mnemocode-self-test-"));
  const sheet = join(directory, "cards.pdf");
  const payload = sskrVector.firstShareColors.join(" ");
  try {
    const beside = await saveQrBeside(payload, sheet);
    expectSame(beside, join(directory, "cards-qr.png"), "QR image beside a PDF");
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** The check of the QR images beside sheets, exported for its test. */
export const QR_BESIDE_CHECK: SelfTestCheck = {
  name: "QR beside sheets",
  detail: "PNG named after its PDF, free names, read back",
  run: checkQrBesideSheets,
};

export async function runSelfTest(): Promise<void> {
  // The library's SSKR check goes through nodeSharePlatform, whose engine is checked against
  // sskr-wasm/integrity.json as it loads (runtime.ts): hence "pinned WASM" in its line.
  const report = await new MnemoCodeSelfTest({
    fingerprint: (mnemonic) => masterFingerprint(mnemonic),
    pbkdf2: nodePbkdf2HmacSha512,
    publicVectors: JSON.parse(
      new TextDecoder().decode(await readBundledFile("vectors/mnemocode-v1.json")),
    ) as unknown,
    sharePlatform: nodeSharePlatform,
    shareLibrary: "pinned WASM",
    features: FEATURES,
    // Built here, not at load: the protection is in place only once the command has started.
    before: [{ name: "Process protection", detail: protectionSummary(), run: assertProtected }],
    after: [QR_CHECK, QR_BESIDE_CHECK, CARD_EXPORT_CHECK],
  }).run();
  const rows = report.rows.map(
    (row) => [row.name, `${row.detail} (${row.milliseconds.toFixed(1)} ms)`] as const,
  );
  const summary = `${report.publicVectors} public vectors; ${report.roundTrips} representation round trips; ${report.milliseconds.toFixed(1)} ms total.`;
  if (terminalColor("stdout")) {
    // The terminal look of the bip_tools tools: a title line, a ✓ per check, grey details.
    const paint = (code: string, text: string): string => terminalPaint("stdout", code, text);
    console.log(
      `\n${paint(STYLE.heading, "MnemoCode")} ${paint(STYLE.muted, "·")} ${paint(STYLE.strong, `Self-test ${MNEMOCODE_VERSION}`)}`,
    );
    for (const [name, detail] of rows)
      console.log(`${paint(STYLE.good, "✓")} ${name.padEnd(24)} ${paint(STYLE.muted, detail)}`);
    console.log(`${paint(STYLE.good, "✓ Passed:")} ${summary}`);
    return;
  }
  console.log(`MnemoCode ${MNEMOCODE_VERSION} self-test`);
  console.log("────────────────────────────────────────────────────────────────────────");
  for (const [name, detail] of rows) console.log(`✓ ${name.padEnd(24)} ${detail}`);
  console.log("────────────────────────────────────────────────────────────────────────");
  console.log(`PASS  ${summary}`);
}
