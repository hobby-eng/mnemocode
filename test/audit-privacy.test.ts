import { describe, expect, it } from "vitest";

// scripts/verify-audit-privacy.mjs keeps the machine owner's names and local times out of the
// published audit files (AUD-022-SEC002). Fixtures only: the owner is a made-up name.

const script = new URL("../scripts/verify-audit-privacy.mjs", import.meta.url).href;
const { auditTextProblems, ownerNames } = (await import(script)) as {
  readonly auditTextProblems: (text: string, path: string, owners: readonly string[]) => string[];
  readonly ownerNames: (account?: { readonly username: string; readonly home: string }) => string[];
};

const OWNER = ["janeexample"];
const problems = (text: string, path = "docs/audits/AUD-099-harnesses/x.py") =>
  auditTextProblems(text, path, OWNER);

describe("the audit privacy check", () => {
  it("refuses the owner's name, also inside a home path and in any case", () => {
    expect(problems("/home/janeexample/Documents")).toHaveLength(1);
    expect(problems("by JaneExample")).toHaveLength(1);
  });

  it("takes other home paths, such as synthetic test data or a CI runner's, as no owner's", () => {
    expect(problems('const environment = { OneDrive: "/home/u/Work" };')).toEqual([]);
    expect(problems("/home/runner/work /home/user/Documents")).toEqual([]);
  });

  it("refuses a time that is not UTC, with or without a space before its zone", () => {
    for (const time of [
      "2026-10-13 21:00:00 +0500",
      "2026-10-13T21:00:00+05:00",
      "2026-10-13 21:00 ABC",
      "2026-10-13 21:00:00",
      // git's default, RFC 2822 and date(1).
      "Date:   Tue Oct 13 21:00:00 2026 +0500",
      "Tue, 13 Oct 2026 21:00:00 +0500",
      "Tue Oct 13 21:00:00 MSK 2026",
    ])
      expect(problems(time), time).toHaveLength(1);
  });

  it("takes UTC times in every written form", () => {
    for (const time of [
      "2026-10-13T21:00:00Z",
      "2026-10-13T21:00:00.123+00:00",
      "2026-10-13 21:00:00 +0000",
      "2026-10-13 21:00 UTC",
      "2026-10-13",
      "Date:   Tue Oct 13 21:00:00 2026 +0000",
      "Tue, 13 Oct 2026 21:00:00 GMT",
      "Tue Oct 13 21:00:00 UTC 2026",
      // A Python build string, which is no time of a run (AUD-012's record holds one).
      "3.13.7 (main, Aug 20 2026, 10:41:58) [GCC 15.2.0]",
    ])
      expect(problems(time), time).toEqual([]);
  });

  it("asks a report to say that its times are UTC", () => {
    expect(problems("# Report", "docs/audits/AUD-099-2026-10-13.md")).toHaveLength(1);
    expect(problems("Completed (UTC).", "docs/audits/AUD-099-2026-10-13.md")).toEqual([]);
  });

  it("takes the owner's names from the account, leaving out impersonal and short ones", () => {
    expect(ownerNames({ username: "JaneExample", home: "/home/janeexample" })).toEqual([
      "janeexample",
    ]);
    expect(ownerNames({ username: "jane", home: "/Users/JaneExample" })).toEqual([
      "jane",
      "janeexample",
    ]);
    expect(ownerNames({ username: "runner", home: "/home/runner" })).toEqual([]);
    expect(ownerNames({ username: "root", home: "/root" })).toEqual([]);
    expect(ownerNames({ username: "jd", home: "/home/jd" })).toEqual([]);
  });
});
