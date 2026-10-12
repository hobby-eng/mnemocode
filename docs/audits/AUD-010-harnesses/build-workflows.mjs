// AUD-010 build reviewer: static review of .github/workflows (CHECK-BLD-005). Nothing is
// dispatched; the files are only read.
//
// Checks, each printed with what was found:
// 1. every "uses:" names a full 40-hex commit SHA, with a version comment;
// 2. no pull_request_target and no workflow_run trigger;
// 3. each workflow sets "permissions: contents: read" at the top; only the release job asks for
//    more (contents: write, id-token: write, attestations: write);
// 4. each workflow has a concurrency group whose cancel-in-progress is on for branches and off for
//    tags (release publishing is never cut off);
// 5. no ${{ ... }} expression inside a run: block reads untrusted input (github.event.*,
//    github.head_ref, inputs.*); every expression found in run: blocks is listed;
// 6. the release job runs only for v* tags, needs verify, sskr and build, and creates the release
//    with --draft and never publishes (no --draft=false, no "gh release edit");
// 7. the tag build refuses a tag that is not v<package.json version> or lacks docs/releases/<tag>.md.
// Listed for review, not failing: checkout steps without persist-credentials: false.
// Exits 1 when a check fails.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`FAIL ${message}`);
};
const directory = ".github/workflows";
const workflows = Object.fromEntries(
  readdirSync(directory)
    .filter((name) => /\.ya?ml$/u.test(name))
    .map((name) => [name, readFileSync(join(directory, name), "utf8")]),
);
console.log(`Workflows: ${Object.keys(workflows).join(", ")}`);

for (const [name, text] of Object.entries(workflows)) {
  const lines = text.split("\n");
  // 1. Action pins.
  for (const [number, line] of lines.entries()) {
    const use = /^\s*-?\s*uses:\s*(\S+)(.*)$/u.exec(line);
    if (!use) continue;
    const [, target, comment] = use;
    const local = target.startsWith("./");
    const pinned = /@[0-9a-f]{40}$/u.test(target) && /#\s*v\d/u.test(comment);
    console.log(`${name}:${number + 1} uses ${target}${comment} -> ${local ? "local workflow" : pinned ? "pinned" : "NOT PINNED"}`);
    if (!local && !pinned) fail(`${name}:${number + 1} action not pinned to a commit`);
  }
  // 2. Risky triggers.
  if (/pull_request_target|workflow_run/u.test(text)) fail(`${name}: pull_request_target or workflow_run`);
  // 3. Permissions at the top.
  const topPermissions = /^permissions:\n\s+contents: read\n/mu.test(text);
  console.log(`${name}: top-level permissions contents: read -> ${topPermissions}`);
  if (!topPermissions) fail(`${name}: no top-level contents: read`);
  const writes = [...text.matchAll(/^\s+(\S+): write$/gmu)].map((m) => m[1]);
  console.log(`${name}: write scopes requested: [${writes.join(", ")}]`);
  if (name !== "executable.yml" && writes.length > 0) fail(`${name}: write scopes outside the release job`);
  // 4. Concurrency.
  const concurrency = /^concurrency:\n\s+group: (.+)\n(?:\s+#.*\n)*\s+cancel-in-progress: (.+)$/mu.exec(text);
  console.log(`${name}: concurrency group ${concurrency?.[1]}; cancel-in-progress ${concurrency?.[2]}`);
  if (concurrency === null || concurrency[2].trim() !== "${{ !startsWith(github.ref, 'refs/tags/') }}")
    fail(`${name}: concurrency is not cancel-in-progress for branches and off for tags`);
  // 5. Expressions inside run: blocks.
  let inRun = false;
  let runIndent = 0;
  for (const [number, line] of lines.entries()) {
    const run = /^(\s*)(?:- )?run:\s*(\|)?(.*)$/u.exec(line);
    if (run) {
      inRun = run[2] === "|";
      runIndent = run[1].length;
      for (const expression of run[3].matchAll(/\$\{\{([^}]*)\}\}/gu)) {
        console.log(`${name}:${number + 1} expression in run: ${expression[0]}`);
        if (/github\.event|head_ref|inputs\./u.test(expression[1])) fail(`${name}:${number + 1} untrusted expression in run`);
      }
      continue;
    }
    if (inRun && line.trim() !== "" && line.search(/\S/u) <= runIndent) inRun = false;
    if (!inRun) continue;
    for (const expression of line.matchAll(/\$\{\{([^}]*)\}\}/gu)) {
      console.log(`${name}:${number + 1} expression in run: ${expression[0]}`);
      if (/github\.event|head_ref|inputs\./u.test(expression[1])) fail(`${name}:${number + 1} untrusted expression in run`);
    }
  }
  // Review list: checkout without persist-credentials: false.
  for (const [number, line] of lines.entries())
    if (/uses: actions\/checkout@/u.test(line)) {
      const next = lines.slice(number + 1, number + 3).join("\n");
      if (!/persist-credentials: false/u.test(next))
        console.log(`review: ${name}:${number + 1} checkout keeps the token in .git/config (no persist-credentials: false)`);
    }
}

// 6 and 7: the release path.
const executable = workflows["executable.yml"];
const releaseJob = executable.slice(executable.indexOf("\n  release:"));
const checks = [
  ["release job only for v* tags", /^\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)$/mu.test(releaseJob.split("\n").slice(0, 3).join("\n"))],
  ["release needs verify, sskr and build", /needs: \[verify, sskr, build\]/u.test(releaseJob)],
  ["release created as a draft", /gh release create "\$GITHUB_REF_NAME" [^\n]*--draft/u.test(releaseJob)],
  ["release never published by the workflow", !/--draft=false|gh release edit|gh release upload/u.test(executable)],
  ["verify job is the complete CI", /verify:\n\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)\n\s+uses: \.\/\.github\/workflows\/ci\.yml/u.test(executable)],
  ["tag must equal v<package.json version>", /test "\$GITHUB_REF_NAME" = "v\$\(node -p "require\('\.\/package\.json'\)\.version"\)"/u.test(executable)],
  ["tag needs docs/releases/<tag>.md", /test -s "docs\/releases\/\$GITHUB_REF_NAME\.md"/u.test(executable)],
  ["a second draft for one tag refused", /has a release or draft already/u.test(executable)],
  ["build provenance attested", /uses: actions\/attest@[0-9a-f]{40}/u.test(executable)],
];
for (const [name, ok] of checks) {
  console.log(`release path: ${name} -> ${ok}`);
  if (!ok) fail(`release path: ${name}`);
}
console.log(failures === 0 ? "PASS build-workflows" : `FAIL build-workflows: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
