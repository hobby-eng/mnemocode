import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scriptExports } from "./helpers/script-exports.js";

// scripts/verify-markdown.mjs refuses a key document that shows another fingerprint than the
// release key. It finds them with shownFingerprints (scripts/release-key.mjs), which must find a
// fingerprint in every form a person may paste, or a wrong key would pass unreported.

/** The part of scripts/release-key.mjs that this test uses; the script has no types. */
interface ReleaseKey {
  readonly KEY_DOCUMENTS: readonly string[];
  readonly SIGNING_KEY: string;
  readonly shownFingerprints: (text: string) => string[];
}

const { KEY_DOCUMENTS, SIGNING_KEY, shownFingerprints } = await scriptExports<ReleaseKey>(
  "scripts/release-key.mjs",
  { KEY_DOCUMENTS: "object", SIGNING_KEY: "string", shownFingerprints: "function" },
);

/** The frozen records of their releases and audits, which no check of the key reads. */
const FROZEN_RECORDS = /^(?:CHANGELOG\.md$|docs\/releases\/|docs\/audits\/)/u;

/** `fingerprint` as `gpg --fingerprint` prints it: groups of four, two spaces in the middle. */
function gnupgForm(fingerprint: string): string {
  const groups = fingerprint.match(/.{4}/gu) ?? [];
  return `${groups.slice(0, 5).join(" ")}  ${groups.slice(5).join(" ")}`;
}

/** Another key's fingerprint, made up for the test. */
const OTHER_KEY = "0123456789ABCDEF0123456789ABCDEF01234567";

describe("the fingerprints that a key document shows", () => {
  it("finds the release key in its compact form", () => {
    expect(shownFingerprints(`Key: ${SIGNING_KEY}.`)).toEqual([SIGNING_KEY]);
  });

  it("finds a key in GnuPG's form, in lower case and across a line break", () => {
    expect(gnupgForm(SIGNING_KEY)).toContain("  ");
    expect(shownFingerprints(gnupgForm(SIGNING_KEY))).toEqual([SIGNING_KEY]);
    expect(shownFingerprints(OTHER_KEY.toLowerCase())).toEqual([OTHER_KEY]);
    const wrapped = `${OTHER_KEY.slice(0, 20)}\n${OTHER_KEY.slice(20)}`;
    expect(shownFingerprints(wrapped)).toEqual([OTHER_KEY]);
  });

  it("reports another key shown beside the release key", () => {
    const text = `Release key ${SIGNING_KEY}; old key ${gnupgForm(OTHER_KEY).toLowerCase()}.`;
    const other = shownFingerprints(text).filter((shown) => shown !== SIGNING_KEY);
    expect(other).toEqual([OTHER_KEY]);
  });

  it("takes no longer or shorter run of digits for a fingerprint", () => {
    // A SHA-256 checksum has 64 digits, and 39 digits are too few.
    expect(shownFingerprints(`${SIGNING_KEY}${SIGNING_KEY.slice(0, 24)}`)).toEqual([]);
    expect(shownFingerprints(SIGNING_KEY.slice(1))).toEqual([]);
  });

  it("is checked in every document that shows it, but the frozen records", () => {
    const listing = execFileSync("git", ["ls-files", "-z", "--", "*.md"], { encoding: "utf8" });
    const documents = listing
      .split("\0")
      .filter((path) => path !== "" && !FROZEN_RECORDS.test(path));
    const showing = documents.filter((path) =>
      shownFingerprints(readFileSync(path, "utf8")).includes(SIGNING_KEY),
    );
    expect(showing.sort()).toEqual([...KEY_DOCUMENTS].sort());
  });
});
