// AUD-028: public text validators only; no renderer, secret, image or PDF is used.
import { validateProfile } from "../../../dist/export/card-settings.js";
import { resolveCardPresentation } from "../../../dist/export/card-copy.js";
import { wordTableRow } from "../../../dist/core/words.js";

const observations = [];
function refusal(name, action) {
  try {
    action();
    observations.push({ name, refused: false, coded: false });
  } catch (error) {
    observations.push({
      name,
      refused: true,
      coded: typeof error?.code === "string",
      errorClass: error?.constructor?.name,
      code: error?.code ?? null,
    });
  }
}

refusal("LF profile control", () => validateProfile({ company: "Public\nExample" }));
for (const [name, separator] of [["line", "\u2028"], ["paragraph", "\u2029"]]) {
  refusal(`${name} separator in profile`, () =>
    validateProfile({ company: `Public${separator}Example` }),
  );
  refusal(`${name} separator in copy`, () =>
    resolveCardPresentation(() => 0, { slogan: `Public${separator}Example` }),
  );
}
for (const selector of ["missing", "constructor", "__proto__"])
  refusal(`word-table selector ${selector}`, () => wordTableRow(selector, "1"));

console.log(JSON.stringify({ observations }, null, 2));
// A refusal must be a deliberate coded input error. An accepted multiline value or an
// incidental TypeError is the discrepancy this probe is intended to demonstrate.
process.exitCode = observations.every((row) => row.refused && row.coded) ? 0 : 1;
