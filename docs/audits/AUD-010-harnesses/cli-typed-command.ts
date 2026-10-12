// AUD-010 cli reviewer: the command line that the menu shows ("The same as:") must give the same
// arguments when it is typed into a POSIX shell. typedCommand (src/cli/menu.ts) is checked against
// bash and dash as independent parsers: the shown text, with "mnemocode" replaced by printf, prints
// each argument as the shell read it, NUL-terminated, and that list must equal the menu's own.
//
//   node docs/audits/AUD-010-harnesses/run-command.mjs cli-typed-command \
//       node --import tsx docs/audits/AUD-010-harnesses/cli-typed-command.ts
//
// The arguments are synthetic answers a person could type for non-secret menu questions (file
// names and card details). Exit 1 when a shell reads any of them differently.

import { spawnSync } from "node:child_process";
import { typedCommand } from "../../../src/cli/menu.ts";

const ANSWERS = [
  "cards.pdf",
  "my cards.pdf",
  "John O'Brien",
  "it's",
  "$HOME/cards.pdf",
  "`id`.pdf",
  "$(id).pdf",
  "a\\b.pdf",
  "~/cards.pdf",
  "=cards.pdf",
  "@cards.pdf",
  "a*b?.pdf",
  "!cards.pdf",
  "-cards.pdf",
  "x;y&z|w.pdf",
  "(x){a,b}<c>.pdf",
  "#x.pdf",
  "a#b.pdf",
  "é ü 字.pdf",
  "tab\there.pdf",
  "%PATH%.pdf",
  "a\"b\".pdf",
  "trailing\\",
  "Ann-Marie d'Arcy",
  "x=y",
  "100",
  "0x10",
];

let failed = 0;
for (const shell of ["/usr/bin/bash", "/usr/bin/dash"]) {
  for (const answer of ANSWERS) {
    const run = ["encode", "--ask-secrets", "--format", "5", "--card-name", answer];
    const shown = typedCommand(run, "linux");
    const script = `printf '%s\\0'${shown.slice("mnemocode".length)}`;
    const result = spawnSync(shell, ["-c", script], { encoding: "utf8", env: { HOME: "/home/nobody", PATH: process.env.PATH ?? "" } });
    const read = result.stdout.split("\0").slice(0, -1);
    const ok = result.status === 0 && JSON.stringify(read) === JSON.stringify(run);
    if (!ok) failed += 1;
    console.log(`[${ok ? "PASS" : "FAIL"}] ${shell} ${JSON.stringify(answer)}: shown ${JSON.stringify(shown)}; read ${JSON.stringify(read.at(-1))}`);
  }
}
console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
