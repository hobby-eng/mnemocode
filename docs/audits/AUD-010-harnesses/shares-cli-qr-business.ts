// AUD-010 "shares": the QR card of each share in the business size, through the command line
// (`encode --sskr`, src/mnemocode.ts). The help of --card-layout says "qr: one document with a QR
// code per share, in any page size", and docs/SSKR.md gives "any | qr | One document with a QR
// code". Since ab57e8d a share written as ur:sskr, the default --share-format, is printed as its
// Bytewords. The probe splits the public 24-word phrase "abandon ... art" 2 of 3 and asks for a QR
// card per share at the business size, in the default form and, as a control, in colors and at A6.
// Expected: every run saves its PDF (exit 0). Writes only under
// <workspace>/tmp/mnemocode/aud010/shares/cli-qr-business/.
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-cli-qr-business.ts

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(
  new URL("../../../../tmp/mnemocode/aud010/shares/cli-qr-business", import.meta.url),
);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PHRASE = `${"abandon ".repeat(23)}art`;

let failures = 0;
const cases = [
  {
    name: "default share format (ur, printed as Bytewords), business",
    extra: ["--page-size", "business"],
  },
  {
    name: "share format words, business",
    extra: ["--share-format", "words", "--page-size", "business"],
  },
  {
    name: "control: share format colors, business",
    extra: ["--share-format", "colors", "--page-size", "business"],
  },
  { name: "control: default share format, a6", extra: ["--page-size", "a6"] },
];
for (const [index, item] of cases.entries()) {
  const pdf = join(OUT, `case-${index + 1}.pdf`);
  const args = [
    "--import",
    "tsx",
    "src/mnemocode.ts",
    "encode",
    "--sskr",
    "--mnemonic",
    PHRASE,
    "--threshold",
    "2",
    "--shares",
    "3",
    "--card-layout",
    "qr",
    "--template",
    "business-it",
    "--pdf",
    pdf,
    ...item.extra,
  ];
  const run = spawnSync("node", args, {
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const actual = { exit: run.status, saved: existsSync(pdf) };
  const ok = actual.exit === 0 && actual.saved;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}: ${item.name}\n  command:  mnemocode ${args.slice(3).join(" ").replace(PHRASE, '"abandon ... art"')}\n` +
      `  actual:   ${JSON.stringify(actual)}\n  expected: {"exit":0,"saved":true}\n` +
      `  stderr (last line): ${JSON.stringify(run.stderr.toString().trim().split("\n").at(-1))}`,
  );
}
console.log(`Business QR card checks: ${failures === 0 ? "all passed" : `${failures} failed`}.`);
process.exitCode = failures === 0 ? 0 : 1;
