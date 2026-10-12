// AUD-010 "shares": the names of separate share cards in --cards-dir, through the command line
// (`encode --sskr --page-size business --cards-dir`, src/mnemocode.ts). The help of --cards-dir
// (src/cli/help-pages.ts) says "Files are named 01-ABCDEF.pdf, 02-123456.pdf and so on", and
// src/cli/output-paths.ts keeps numbered names free of spaces "so that a numbered name ... can be
// typed in a command without quotes". Since ab57e8d a card of a share in word numbers, Unicode
// codes or Bytewords (the default ur form) is named after its three codes (ShareCardSet
// #documentName). The probe lists the files for each share form. Expected, per the help: names of
// the shape NN-XXXXXX.pdf, without spaces. Public data only: a 2-of-2 split of "abandon ... about".
// Writes only under <workspace>/tmp/mnemocode/aud010/shares/card-file-names/.
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-card-file-names.ts

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(
  new URL("../../../../tmp/mnemocode/aud010/shares/card-file-names", import.meta.url),
);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PHRASE = `${"abandon ".repeat(11)}about`;
const HELP_SHAPE = /^\d{2}-[0-9A-F]{6}\.pdf$/u;

let failures = 0;
for (const format of ["colors", "ur", "words", "indexes", "unicode"]) {
  const folder = join(OUT, format);
  const run = spawnSync(
    "node",
    [
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
      "2",
      "--share-format",
      format,
      "--page-size",
      "business",
      "--cards-dir",
      folder,
    ],
    { env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (run.status !== 0) {
    failures += 1;
    console.log(
      `FAIL: --share-format ${format}: exit ${run.status}\n  ${run.stderr.toString().trim()}`,
    );
    continue;
  }
  const share = readdirSync(folder).sort()[0]!;
  const names = readdirSync(join(folder, share)).sort();
  const off = names.filter((name) => !HELP_SHAPE.test(name));
  const ok = off.length === 0;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}: --share-format ${format}: card file names of ${share}\n` +
      `  actual:   ${JSON.stringify(names.slice(0, 3))} ... (${names.length} files)\n` +
      `  names not of the help's shape NN-XXXXXX.pdf: ${off.length}; with a space: ${names.filter((name) => name.includes(" ")).length}`,
  );
}
console.log(`Card file name checks: ${failures === 0 ? "all passed" : `${failures} failed`}.`);
process.exitCode = failures === 0 ? 0 : 1;
