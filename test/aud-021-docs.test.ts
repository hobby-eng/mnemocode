import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { parseDate } from "../src/core/dates.js";
import { Masking } from "../src/core/masking.js";
import { HeirInstructions, type HeirRoute } from "../src/export/heir-sheet-text.js";

const route: HeirRoute = {
  subtitle: "Public audit fixture",
  address: "",
  start: [],
  decode: () => ["Decode the public fixture"],
  restore: () => [],
  dateDigitHelp: undefined,
};
const instructions = new HeirInstructions(route);
const PHRASE = `${"abandon ".repeat(11)}about`;

describe("AUD-021-DOC001: heir advice follows masking semantics", () => {
  it.each(["direct", "seedshift", "seedshift-legacy"] as const)(
    "gives truthful guidance for %s",
    (mode) => {
      const text = instructions.text({
        backup: { kind: "encoded", format: "unicode", words: 12 },
        mode,
        dates: mode === "direct" ? 0 : 1,
      });
      const secretDates = text.basics.find((section) => section.heading === "Secret dates");
      if (mode === "direct") expect(secretDates).toBeUndefined();
      else {
        expect(secretDates!.paragraphs.join(" ")).toContain(Masking.of(mode).wrongDateWarning);
        expect(secretDates!.paragraphs.join(" ")).not.toMatch(
          /empty wallet|only the same dates|a wrong date gives no error/u,
        );
      }
    },
  );

  it("describes the known legacy refusal and checksum-valid modern wrong-date answer", () => {
    // Published direct/legacy fixture from AUD-021, with the adjacent wrong date.
    const legacy = EncodedBackup.read(
      "8F44901950118F44901950118F44901950118F4490194F5C",
      "unicode",
      "seedshift-legacy",
    );
    expect(legacy.decode([parseDate("24-09-2026")]).checksumValid).toBe(false);
    expect(Masking.of("seedshift-legacy").wrongDateWarning).toContain("may fail the checksum");
    const modern = EncodedBackup.read(
      "wool abuse actual wool abuse actual wool abuse actual wool abuse congress",
      "english",
      "seedshift",
    );
    const wrong = modern.decode([parseDate("24-09-2026")]);
    expect(wrong.checksumValid).toBe(true);
    expect(wrong.recoveredMnemonic).not.toBe(PHRASE);
    // A date key is not unique: the published modulo-2048 shift also accepts this later year.
    expect(modern.decode([parseDate("23-09-4074")]).recoveredMnemonic).toBe(PHRASE);
  });

  it("does not guarantee that wrong-date wallets are empty in the public guide", () => {
    const guide = readFileSync("docs/HEIRS.md", "utf8");
    expect(guide).toContain("Original Seedshift");
    expect(guide).toContain("A valid checksum does not confirm");
    expect(guide).not.toContain("wallet of that phrase is empty");
  });
});

describe("AUD-021-DOC002: release dates are written in UTC", () => {
  it("gives the release tag command in docs/RELEASING.md signed and in UTC", () => {
    expect(readFileSync("docs/RELEASING.md", "utf8")).toMatch(/^TZ=UTC git tag -s /mu);
  });
});
