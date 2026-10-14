// Every published audit file (audit-files.mjs) is in the npm package, so that a new kind of
// harness file or a new folder cannot drop out of package.json "files" unnoticed (AUD-022
// observation). npm lists what it would pack without packing it or reaching the network. Run by
// pnpm check.
import { execFileSync } from "node:child_process";
import { publishedAuditFiles } from "./audit-files.mjs";

const [listing] = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
const packed = new Set(listing.files.map((file) => file.path));
const audits = publishedAuditFiles();
const missing = audits.filter((path) => !packed.has(path));
if (missing.length > 0)
  throw new Error(`Audit files left out of the npm package ("files"):\n${missing.join("\n")}`);
console.log(`Audit package: all ${audits.length} published audit files are packed.`);
