// AUD-016 remediation: the public reproductions of its findings, each with its controls. Public
// test data only: the all-zero-entropy phrase, a published BIP39 phrase, a synthetic date and the
// published SSKR vector.

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { describe, expect, it } from "vitest";
import { allWiped, madeArrays } from "./helpers/made-arrays.js";
import { parseDate } from "../src/core.js";
import { WordCandidateSearch } from "../src/core/candidates.js";
import { DatesAnswer, DateSearch, type WalletCheck } from "../src/core/date-search.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import { MissingCodesSearch } from "../src/core/missing-codes-search.js";
import { MALFORMED_WALLET_ANSWER, type WalletMatch } from "../src/core/wallet-check.js";
import { nodeFillRandom, nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { ShareSplit } from "../src/sskr/split.js";
import { bytewordsToUr, urToBytewords, urToTransport } from "../src/sskr/transport.js";
import {
  DATE,
  LAST_OF_24_FORGOTTEN,
  LAST_WORD_FORGOTTEN,
  MASKED_INDEXES,
  OTHER_PHRASE,
  TEST_PHRASE,
} from "./helpers/test-phrase.js";
import { publicShare } from "./helpers/vectors.js";

const SHARE = publicShare();

/** The date search of TEST_PHRASE masked with DATE, asking `walletCheck`. */
function dateSearch(walletCheck: WalletCheck): DateSearch {
  return new DateSearch({
    indexes: MASKED_INDEXES,
    dates: DatesAnswer.of([parseDate(DATE)]),
    mode: "seedshift",
    keep: 1,
    walletCheck,
  });
}

describe("AUD-016-API001: a wallet answer is read field by field, whatever its kind of object", () => {
  it("takes an answer of a class, its fields getters of the class", async () => {
    class Answer {
      get matched(): boolean {
        return true;
      }
      get path(): string {
        return "m/84'/0'/0'/0/0";
      }
    }
    const result = await dateSearch(() => new Answer()).run();
    expect(result.matchCount).toBe(1);
    expect(result.shown[0]?.evidence).toBe("m/84'/0'/0'/0/0");
  });

  it("keeps a path that is no enumerable field of the answer", async () => {
    const answer = Object.defineProperty({ matched: true }, "path", {
      value: "m",
      enumerable: false,
    });
    const result = await dateSearch(() => answer).run();
    expect(result.shown[0]?.evidence).toBe("m");
  });

  it("keeps the host's own fields of its answer, such as a derived address", async () => {
    class AddressAnswer {
      readonly derived = "bc1qpublicfixture";
      get matched(): boolean {
        return true;
      }
    }
    const search = WordCandidateSearch.parse(LAST_WORD_FORGOTTEN, "unknown-words");
    const byPhrase = (mnemonic: string) =>
      mnemonic === TEST_PHRASE ? new AddressAnswer() : { matched: false };
    const result = await search.run({ walletCheck: byPhrase });
    const shown = result.shown.find((entry) => entry.match?.matched === true);
    expect(shown?.match).toMatchObject({ derived: "bc1qpublicfixture" });
  });

  it("still refuses an answer whose matched is no boolean, and reads it once", async () => {
    class Wrong {
      get matched(): unknown {
        return "true";
      }
    }
    // An answer that no type allows, fed on purpose as a JavaScript host could.
    await expect(dateSearch(() => new Wrong() as WalletMatch).run()).rejects.toThrow(
      MALFORMED_WALLET_ANSWER,
    );
    let reads = 0;
    const changing = {
      get matched() {
        return reads++ === 0 ? false : true;
      },
    };
    expect((await dateSearch(() => changing).run()).matchCount).toBe(0);
  });
});

describe("AUD-015-API001 (AUD-016): a list of codes is not handed out after a stop", () => {
  /** The codes of a 24-word phrase without its last word: a few candidates, which a list holds. */
  const codes = () => MissingCodes.read(LAST_OF_24_FORGOTTEN, "english", "direct");

  it("ends as stopped, listing nothing, when the host stops while it fingerprints", async () => {
    const controller = new AbortController();
    let calls = 0;
    const search = new MissingCodesSearch(codes(), async () => {
      calls++;
      controller.abort(new Error("stopped while fingerprinting"));
      return "00000000";
    });
    expect(await search.listed([]).run({ signal: controller.signal })).toEqual({ kind: "stopped" });
    expect(calls).toBe(1);
  });

  it("lists every candidate when nothing stops it", async () => {
    // The last word holds the last three bits of the entropy, the other bits are zero: 8 phrases.
    const phrases = Array.from({ length: 8 }, (_, last) =>
      entropyToMnemonic(
        Uint8Array.from({ length: 32 }, (_, index) => (index === 31 ? last : 0)),
        wordlist,
      ),
    );
    const search = new MissingCodesSearch(codes(), async () => "00000000");
    expect(await search.listed([]).run({ signal: new AbortController().signal })).toEqual({
      kind: "list",
      rows: phrases.map((phrase) => ({ codes: phrase, phrase, fingerprint: "00000000" })),
    });
  });
});

describe("AUD-015-SEC001 (AUD-016): a share refused at its last element leaves no bytes", () => {
  it.each([
    ["the first", (body: string) => `zz${body.slice(2)}`],
    ["a middle", (body: string) => `${body.slice(0, 20)}zz${body.slice(22)}`],
    ["the last", (body: string) => `${body.slice(0, -2)}zz`],
  ])("wipes a UR whose pair at %s place is none", (_, broken) => {
    const body = SHARE.slice("ur:sskr/".length);
    const { arrays, refusal } = madeArrays(() => urToTransport(`ur:sskr/${broken(body)}`));
    expect(refusal).toBe("Unknown Bytewords pair in SSKR record.");
    expect(arrays.length).toBeGreaterThan(0);
    expect(allWiped(arrays)).toBe(true);
  });

  it("wipes Bytewords whose last word is none", () => {
    const words = urToBytewords(SHARE).split(" ");
    words[words.length - 1] = "zzzz";
    const { arrays, refusal } = madeArrays(() => bytewordsToUr(words.join(" ")));
    expect(refusal).toBe("Unknown SSKR Byteword.");
    expect(arrays.length).toBeGreaterThan(0);
    expect(allWiped(arrays)).toBe(true);
  });

  it("still hands the caller its transport, and reads the published share", () => {
    expect(urToTransport(SHARE).some((byte) => byte !== 0)).toBe(true);
    expect(bytewordsToUr(urToBytewords(SHARE))).toBe(SHARE);
  });
});

describe("AUD-016 observation: a split reads each field of its request once", () => {
  it("splits the phrase it read, even if a getter answers another later", async () => {
    let reads = 0;
    const request = {
      get mnemonic() {
        return reads++ === 0 ? TEST_PHRASE : OTHER_PHRASE;
      },
      mode: "direct" as const,
      dates: [],
      threshold: 2,
      count: 3,
    };
    const split = await new ShareSplit(nodeSharePlatform, nodeFillRandom).splitBackup(request);
    expect(reads).toBe(1);
    expect(split.original).toBe(TEST_PHRASE);
    expect(split.held).toBe(TEST_PHRASE);
  });
});
