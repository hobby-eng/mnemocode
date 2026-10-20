import { expect, it } from "vitest";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { runBuiltCliSync } from "./helpers/built-cli.js";
import { wrongValue } from "./helpers/shares.js";

it("reports a damaged minimum quorum as invalid shares through the real CLI", () => {
  const records = [wrongValue(SSKR_SET_VECTOR.shares[0]!), SSKR_SET_VECTOR.shares[1]!];
  const result = runBuiltCliSync([
    "sskr-combine",
    ...records.flatMap((share) => ["--share", share]),
  ]);
  expect(result.status, result.stderr).toBe(1);
  expect(result.signal).toBeNull();
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("These shares do not restore a secret");
  expect(result.stderr).not.toContain("Not enough SSKR shares to meet the recorded threshold");
  for (const record of records) expect(result.stderr).not.toContain(record);
});
