// AUD-022: one share of a public set below its threshold, its first elements marked with ?, read
// through the real CLI (sskr-export) and the single-share repair. Run from the MnemoCode root.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const root = process.cwd();
const { writeShare } = await import(join(root, "dist/sskr/transport.js"));
const { repairCandidates } = await import(join(root, "dist/sskr/repair.js"));
const sets = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic;
let bad = 0;
for (const set of sets)
  for (const [index, ur] of set.shares.entries())
    for (const format of ["unicode", "indexes", "colors"]) {
      const units = writeShare(ur, format).trim().split(/\s+/u);
      const marked = units.map((unit, i) => (i < 3 ? "?" : unit)).join(" ");
      let single;
      try {
        const found = repairCandidates(marked);
        single = `${found.length} candidate(s)${found.some((s) => s.ur === ur) ? ", the right one among them" : ", NOT the right one"}`;
      } catch (error) {
        single = `refused: ${error.message.slice(0, 70)}`;
      }
      let cli;
      try {
        execFileSync(process.execPath, ["dist/mnemocode.js", "sskr-export", "--share", marked], { env: { ...process.env, NO_COLOR: "1" }, stdio: "pipe", timeout: 60000 });
        cli = "exit 0";
      } catch (error) {
        cli = `exit ${error.status}: ${String(error.stderr).trim().split("\n").at(-1).slice(0, 90)}`;
      }
      const unique = single.startsWith("1 candidate(s), the right");
      if (!unique || cli.includes("do not fit")) bad += 1;
      console.log(`${set.name} share ${index + 1} ${format.padEnd(8)} single: ${single.padEnd(48)} cli: ${cli}`);
    }
console.log(`${bad} case(s) without a unique repair or with "do not fit"`);
