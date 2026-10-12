// AUD-010 "shares": output names and file permissions of share exports. In a scratch folder it
// checks that a taken name becomes name-1, name-2 (firstFreeName, settleOutputPaths), including
// names with spaces, without an extension, with dots and hidden names, a dangling link and a folder
// in the way; that nothing is written over a file that appears after the name was chosen (the
// writer's own exclusive creation); and the modes of the files and folders that share exports
// write (exportSskrPdf, exportSskrCards, saveQrBeside, saveQrInside, exportQrPayload). Public data
// only: shares of the "abandon ... about" phrase. Writes only under
// <workspace>/tmp/mnemocode/aud010/shares/names/.
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-output-names.ts

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../src/export/platform-node.ts";
import { firstFreeName, settleOutputPaths } from "../../../src/cli/output-paths.ts";
import { exportQrPayload, saveQrBeside, saveQrInside } from "../../../src/cli/qr-export.ts";
import { publishNewPrivateFile } from "../../../src/export/private-file.ts";
import { writeRenderedDocument } from "../../../src/export/image-export.ts";
import { exportSskrCards, exportSskrPdf } from "../../../src/export/sskr-cards.ts";
import { splitSskrMnemonic } from "../../../src/sskr/shares.ts";

const ROOT = fileURLToPath(
  new URL("../../../../tmp/mnemocode/aud010/shares/names", import.meta.url),
);
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });
let failures = 0;
let checks = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}: ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`,
  );
}
const at = (name: string): string => join(ROOT, name);
const touch = (name: string, text = "existing"): void => writeFileSync(at(name), text);
const mode = (path: string): string => (statSync(path).mode & 0o777).toString(8);
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "no error";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? (error as Error).message;
  }
}

// firstFreeName: the name the command chooses itself (QR images beside a sheet).
check("free name is kept", await firstFreeName(at("cards.pdf")), at("cards.pdf"));
touch("cards.pdf");
check("taken name gets -1", await firstFreeName(at("cards.pdf")), at("cards-1.pdf"));
touch("cards-1.pdf");
check("name and name-1 taken give name-2", await firstFreeName(at("cards.pdf")), at("cards-2.pdf"));
touch("my share cards.pdf");
check(
  "name with spaces",
  await firstFreeName(at("my share cards.pdf")),
  at("my share cards-1.pdf"),
);
touch("shares");
check("name without an extension", await firstFreeName(at("shares")), at("shares-1"));
touch("share.v2.final.pdf");
check("name with dots", await firstFreeName(at("share.v2.final.pdf")), at("share.v2.final-1.pdf"));
touch(".hidden");
check("hidden name", await firstFreeName(at(".hidden")), at(".hidden-1"));
symlinkSync(at("missing-target"), at("dangling.png"));
check(
  "dangling link is a taken name",
  await firstFreeName(at("dangling.png")),
  at("dangling-1.png"),
);
mkdirSync(at("folder.png"));
check(
  "folder in the way is a taken name",
  await firstFreeName(at("folder.png")),
  at("folder-1.png"),
);

// settleOutputPaths: names given with the options.
touch("shares.txt");
touch("shares-1.txt");
mkdirSync(at("my.cards"));
mkdirSync(at("my.cards-1"));
const args: Record<string, unknown> = {
  output: at("shares.txt"),
  pdf: at("my share cards.pdf"),
  "cards-dir": at("my.cards"),
  "images-dir": at("fresh-images"),
};
await settleOutputPaths(args as never);
check("--output with name and name-1 taken", args.output, at("shares-2.txt"));
check("--pdf with spaces", args.pdf, at("my share cards-1.pdf"));
check("--cards-dir with a dot keeps the dot", args["cards-dir"], at("my.cards-2"));
check("--images-dir free name kept", args["images-dir"], at("fresh-images"));

// A file that appears after the name was chosen is never written over.
const chosen = await firstFreeName(at("race.png"));
touch("race.png", "written by someone else");
check(
  "publishNewPrivateFile refuses a file that appeared after the name was chosen",
  await refusal(() => publishNewPrivateFile(chosen, new TextEncoder().encode("secret"))),
  "EEXIST",
);
check(
  "the other file is unchanged",
  readFileSync(at("race.png"), "utf8"),
  "written by someone else",
);
symlinkSync(at("link-target.txt"), at("link.txt"));
check(
  "publishNewPrivateFile does not write through a dangling link",
  await refusal(() => publishNewPrivateFile(at("link.txt"), new TextEncoder().encode("secret"))),
  "EEXIST",
);
check("the link target was not created", existsSync(at("link-target.txt")), false);
touch("page.pdf");
check(
  "writeRenderedDocument refuses an existing PDF",
  await refusal(() => writeRenderedDocument(new Uint8Array([1]), at("page"), "pdf")),
  "EEXIST",
);
check(
  "no staging folder is left behind",
  readdirSync(ROOT).filter((name) => name.startsWith(".mnemocode-")),
  [],
);

// Modes of what share exports write.
const shares = await splitSskrMnemonic(`${"abandon ".repeat(11)}about`, 2, 3);
const options = { style: "it", shareFormat: "indexes", cardQr: true } as const;
await exportSskrPdf(shares, options, at("all-shares.pdf"));
check("share PDF mode", mode(at("all-shares.pdf")), "600");
check(
  "share PDF over an existing file",
  await refusal(() => exportSskrPdf(shares, options, at("all-shares.pdf"))),
  "EEXIST",
);
const beside = await saveQrBeside("1 2 3", at("all-shares.pdf"), "-ABCD-1-1");
check("QR image beside the PDF", beside, at("all-shares-ABCD-1-1-qr.png"));
check("QR image mode", mode(beside), "600");
check(
  "a second QR image of that share gets -1",
  await saveQrBeside("1 2 3", at("all-shares.pdf"), "-ABCD-1-1"),
  at("all-shares-ABCD-1-1-qr-1.png"),
);
const count = await exportSskrCards(shares, {
  ...options,
  pageSize: "business",
  directory: at("separate cards"),
});
check("separate-card folder mode", mode(at("separate cards")), "700");
const folders = readdirSync(at("separate cards")).sort();
check(
  "one folder per share, named collection-<reference>",
  folders.map((folder) => /^collection-[0-9A-F]{4}-1-[1-3]$/u.test(folder)),
  [true, true, true],
);
console.log(`  share folders: ${JSON.stringify(folders)}`);
const cardModes = new Set<string>();
const folderModes = new Set<string>();
let files = 0;
for (const folder of folders) {
  folderModes.add(mode(join(at("separate cards"), folder)));
  for (const file of readdirSync(join(at("separate cards"), folder))) {
    files += 1;
    cardModes.add(mode(join(at("separate cards"), folder, file)));
  }
}
console.log(
  `  separate card files: ${JSON.stringify(readdirSync(join(at("separate cards"), folders[0]!)))}`,
);
check("every separate card written", files, count);
check("share folder modes", [...folderModes], ["700"]);
check("separate card file modes", [...cardModes], ["600"]);
check(
  "separate cards into an existing folder",
  await refusal(() =>
    exportSskrCards(shares, { ...options, pageSize: "business", directory: at("separate cards") }),
  ),
  "The card folder already exists. Choose a new folder to avoid mixing separate card collections.",
);
const inside = await saveQrInside("1 2 3", at("separate cards"), "collection-ABCD-1-1");
check(
  "QR image inside a folder, mode",
  [inside, mode(inside)],
  [join(at("separate cards"), "collection-ABCD-1-1-qr.png"), "600"],
);
await exportQrPayload("1 2 3", at("plain-qr.png"));
check("exportQrPayload mode", mode(at("plain-qr.png")), "600");

console.log(`Output name and permission checks: ${checks - failures} passed, ${failures} failed.`);
process.exitCode = failures === 0 ? 0 : 1;
