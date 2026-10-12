// AUD-010 "shares": the sheet for heirs beside printed share sheets, through the command line
// (`encode --sskr --pdf --heir-sheet`, src/mnemocode.ts). The sheet says how the shares look
// ("What you need", src/export/heir-sheet-text.ts SHARE_LOOKS). Since ab57e8d a share written as
// ur:sskr, the default --share-format, is printed on its cards as Bytewords (sskr-render.ts,
// LABELLED_FORMS; docs/SSKR.md: "A share written as ur:sskr prints its Bytewords"). Expected: the
// sheet made in the same command describes what the cards print, as it does for --share-format
// words ("words such as tuna next keep gyro"). The page texts are read with Poppler's pdftotext.
// Public data only: a 2-of-3 split of "abandon ... about". Writes only under
// <workspace>/tmp/mnemocode/aud010/shares/heir-sheet-form/.
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-heir-sheet-form.ts

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(
  new URL("../../../../tmp/mnemocode/aud010/shares/heir-sheet-form", import.meta.url),
);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PHRASE = `${"abandon ".repeat(11)}about`;

let failures = 0;
for (const format of ["ur", "words"]) {
  const cards = join(OUT, `cards-${format}.pdf`);
  const heir = join(OUT, `heir-${format}.pdf`);
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
      "3",
      "--share-format",
      format,
      "--pdf",
      cards,
      "--heir-sheet",
      heir,
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
  const flat = (pdf: string) =>
    execFileSync("pdftotext", ["-layout", pdf, "-"]).toString().replace(/\s+/gu, " ");
  const cardText = flat(cards);
  const heirText = flat(heir);
  const firstCard = /01 (\S+ \S+ \S+)/u.exec(cardText)?.[1];
  const said = /written as ([^.]+)\./u.exec(heirText)?.[1];
  const cardsPrintWords =
    firstCard !== undefined && /^[a-z]{4} [a-z]{4} [a-z]{4}$/u.test(firstCard);
  const sheetSaysWords = said !== undefined && said.startsWith("words");
  const ok = cardsPrintWords === sheetSaysWords;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}: --share-format ${format}: the heir sheet describes what the cards print\n` +
      `  cards, first card:   ${JSON.stringify(firstCard)} (Bytewords: ${cardsPrintWords})\n` +
      `  heir sheet says:     ${JSON.stringify(`written as ${said}`)} (words: ${sheetSaysWords})`,
  );
}
console.log(`Heir sheet form checks: ${failures === 0 ? "all passed" : `${failures} failed`}.`);
process.exitCode = failures === 0 ? 0 : 1;
