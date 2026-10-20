import { describe, expect, it } from "vitest";
import { DatesAnswer } from "../src/core/date-search.js";
import { parseDate } from "../src/core/dates.js";
import { wordTableRow } from "../src/core/words.js";
import { validateProfile } from "../src/export/card-settings.js";
import { resolveCardPresentation } from "../src/export/card-copy.js";
import { ShareUnmasking } from "../src/sskr/share-unmasking.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import type { RepairedSet } from "../src/sskr/joint-results.js";
import { droppedPath } from "../src/cli/text-file.js";
import { typedLine } from "../src/cli/shell-command.js";

const OTHER_PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const publicSet = (): RepairedSet => ({
  mnemonic: sskrSetVector.phrase,
  shares: [],
  unsettled: [],
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("AUD-028 restored phrase ownership", () => {
  it("checks and publishes the same input revision across a wallet await", async () => {
    const entered = deferred();
    const release = deferred();
    const detail = {
      ur: sskrSetVector.shares[0],
      format: "ur" as const,
      repaired: true,
      filled: [{ position: 1, value: "public repair" }],
    };
    const mark = { share: 1, position: 2 };
    const mutable = { ...publicSet(), shares: [detail], unsettled: [mark], unchecked: [1] };
    const sets = [mutable, { ...publicSet() }];
    const checked: string[] = [];
    const pending = new ShareUnmasking({
      mode: "direct",
      walletCheck: async (phrase) => {
        checked.push(phrase);
        entered.resolve();
        await release.promise;
        return { matched: phrase === sskrSetVector.phrase };
      },
    }).unmask(sets);
    await entered.promise;
    mutable.mnemonic = OTHER_PHRASE;
    detail.filled[0]!.value = "changed repair";
    mark.position = 99;
    mutable.unchecked[0] = 99;
    sets[1] = { ...mutable, mnemonic: OTHER_PHRASE };
    release.resolve();
    const result = await pending;
    expect(checked).toEqual([sskrSetVector.phrase, sskrSetVector.phrase]);
    expect(result.kind).toBe("phrases");
    if (result.kind !== "phrases") return;
    expect(result.listed).toEqual(checked);
    expect(result.phrases[0]!.set).toMatchObject({
      shares: [{ filled: [{ position: 1, value: "public repair" }] }],
      unsettled: [{ share: 1, position: 2 }],
      unchecked: [1],
    });
    expect(result.phrases.map(({ set, mnemonic }) => [set.mnemonic, mnemonic])).toEqual(
      checked.map((phrase) => [phrase, phrase]),
    );
  });

  it("reads a changing mnemonic getter once and keeps nonmatching controls empty", async () => {
    let reads = 0;
    const set = {
      ...publicSet(),
      get mnemonic() {
        return reads++ === 0 ? sskrSetVector.phrase : OTHER_PHRASE;
      },
    };
    const result = await new ShareUnmasking({ mode: "direct" }).unmask([set]);
    expect(reads).toBe(1);
    expect(result.kind === "phrases" && result.listed).toEqual([sskrSetVector.phrase]);
    expect(
      await new ShareUnmasking({ mode: "direct", walletCheck: () => ({ matched: false }) }).unmask([
        publicSet(),
      ]),
    ).toMatchObject({ kind: "phrases", listed: [], phrases: [] });
  });

  it("refuses dates in direct mode with the canonical masking rule", () => {
    expect(
      () =>
        new ShareUnmasking({ mode: "direct", dates: DatesAnswer.of([parseDate("23-09-2026")]) }),
    ).toThrow(expect.objectContaining({ code: "core.masking.assert-takes-dates-refused" }));
    expect(() => new ShareUnmasking({ mode: "direct" })).not.toThrow();
    expect(
      () =>
        new ShareUnmasking({ mode: "seedshift", dates: DatesAnswer.of([parseDate("23-09-2026")]) }),
    ).not.toThrow();
  });
});

describe("AUD-028 text admission", () => {
  it.each(["missing", "constructor", "__proto__", null, undefined, 1, {}])(
    "refuses an invalid word-table selector with a stable code (%s)",
    (selector) => {
      expect(() => {
        Reflect.apply(wordTableRow, undefined, [selector, "1"]);
      }).toThrow(expect.objectContaining({ code: "core.words.word-table-lookup" }));
    },
  );

  it.each(["\u2028", "\u2029", "\n", "\r"])(
    "refuses line separators in card profiles and copy (%j)",
    (separator) => {
      expect(() => validateProfile({ company: `Public${separator}Example` })).toThrow(
        expect.objectContaining({ code: "export.card-settings.card-non-empty-text-on-one-line" }),
      );
      expect(() =>
        resolveCardPresentation(() => 0, { slogan: `Public${separator}Example` }),
      ).toThrow(
        expect.objectContaining({ code: "export.card-settings.card-non-empty-text-on-one-line" }),
      );
    },
  );

  it.each(["./it's.txt", "./two words.txt", "./a\\b.txt", "./$`literal`.txt", "./café.txt"])(
    "restores a POSIX-quoted literal filename without shell expansion (%s)",
    (path) => {
      expect(droppedPath(typedLine([path], "linux"), "linux")).toBe(path);
      expect(droppedPath(path, "win32")).toBe(path);
    },
  );
});
