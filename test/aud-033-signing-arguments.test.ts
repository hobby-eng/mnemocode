import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { TEST_TIME_LIMIT_MS } from "./helpers/limits.js";

it("refuses invalid signing arguments without echoing them or performing a release operation", () => {
  const code = String.raw`
import assert from "node:assert/strict";
import { parseReleaseArguments } from "./scripts/sign-release.mjs";
const marker = "PUBLIC SYNTHETIC WRONG-FIELD SENTINEL";
for (const [args, suffix] of [
  [["--" + marker], "unknown-option-see-help"],
  [["v0.1.0", marker], "give-one-release-tag-not-too"],
  [[marker], "not-release-tag-looks-like-v0-1-0"],
]) {
  let caught;
  try { parseReleaseArguments(args); } catch (error) { caught = error; }
  assert.equal(caught?.code, "scripts.sign-release." + suffix);
  assert.equal(caught?.message.includes(marker), false);
  assert.equal(caught?.cause, undefined);
}
assert.deepEqual(parseReleaseArguments(["v0.1.0", "--dry-run", "--publish"]), {
  tag: "v0.1.0", publish: true, dryRun: true, help: false,
});
assert.deepEqual(parseReleaseArguments(["--help"]), {
  tag: undefined, publish: false, dryRun: false, help: true,
});
console.log("Signing parser refusals and compatibility passed; no release operation ran.");
`;
  const output = execFileSync(
    process.execPath,
    [
      "--permission",
      "--allow-fs-read=*",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      code,
    ],
    { encoding: "utf8", timeout: TEST_TIME_LIMIT_MS, env: { ...process.env, NO_COLOR: "1" } },
  );
  expect(output.trim()).toBe(
    "Signing parser refusals and compatibility passed; no release operation ran.",
  );
});
