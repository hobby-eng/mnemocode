import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import { PublicCliFiles } from "./helpers/public-cli-files.js";
import { wrongValue } from "./helpers/shares.js";

it("reports a damaged minimum quorum as invalid shares through the real CLI", () => {
  const records = [wrongValue(sskrSetVector.shares[0]!), sskrSetVector.shares[1]!];
  using material = new PublicCliFiles([
    "sskr-combine",
    ...records.flatMap((share) => ["--share", share]),
  ]);
  const result = spawnSync(process.execPath, ["dist/mnemocode.js", ...material.arguments], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 10_000,
    maxBuffer: 256 * 1024,
  });
  if (result.error) throw result.error;
  expect(result.status, result.stderr).toBe(1);
  expect(result.signal).toBeNull();
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("These shares do not restore a secret");
  expect(result.stderr).not.toContain("Not enough SSKR shares to meet the recorded threshold");
  for (const record of records) expect(result.stderr).not.toContain(record);
});
