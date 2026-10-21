// AUD-017: generic wallet result ownership. All values are synthetic/public; no derivation,
// rendering, files, network or full-vector replay is needed.
import { describe, expect, it } from "vitest";
import { WordCandidateSearch } from "../src/core/candidates.js";
import { askWallet } from "../src/core/wallet-check.js";
import { LAST_OF_24_FORGOTTEN, ZERO_ENTROPY_PHRASES } from "./helpers/test-phrase.js";

const DERIVED = "public-address-fixture";

class AddressAnswer {
  readonly #matched: boolean;
  #derived = DERIVED;

  constructor(matched = true) {
    this.#matched = matched;
  }
  get matched(): boolean {
    return this.#matched;
  }
  get path(): string {
    return "m";
  }
  get derived(): string {
    return this.#derived;
  }
  set derived(value: string) {
    this.#derived = value;
  }
  describe(): string {
    return this.#derived;
  }
}

describe("AUD-016-API001 (AUD-017): host result operations retain their original receiver", () => {
  it("keeps a getter and method backed by private fields, including through actual word search", async () => {
    const given = new AddressAnswer();
    const answer = await askWallet(() => given, "public fixture");
    expect(answer).toBeInstanceOf(AddressAnswer);
    expect(answer.derived).toBe(DERIVED);
    expect(answer.describe()).toBe(DERIVED);

    const phrase = ZERO_ENTROPY_PHRASES[24];
    const result = await WordCandidateSearch.parse(LAST_OF_24_FORGOTTEN, "unknown-words").run({
      walletCheck: (candidate) => new AddressAnswer(candidate === phrase),
    });
    const match = result.shown.find((row) => row.match?.matched)?.match;
    expect(match).toBeInstanceOf(AddressAnswer);
    expect(match?.derived).toBe(DERIVED);
    expect(match?.describe()).toBe(DERIVED);
  });

  it("keeps private-field setters attached to the host rather than a brandless object", async () => {
    const given = new AddressAnswer();
    const answer = await askWallet(() => given, "public fixture");
    answer.derived = "public replacement";
    expect(given.derived).toBe("public replacement");
    expect(answer.describe()).toBe("public replacement");
  });

  it("does not evaluate unrelated getters while capturing the checked fields", async () => {
    let reads = 0;
    class LazyAnswer extends AddressAnswer {
      get later(): string {
        reads++;
        throw new Error("public lazy getter");
      }
    }
    const answer = await askWallet(() => new LazyAnswer(), "public fixture");
    expect(reads).toBe(0);
    expect(() => answer.later).toThrow("public lazy getter");
    expect(reads).toBe(1);
    expect(answer.derived).toBe(DERIVED);
  });

  it("keeps the nearest override while binding getters inherited through another class", async () => {
    class Child extends AddressAnswer {
      override get derived(): string {
        return `child ${super.derived}`;
      }
    }
    const answer = await askWallet(() => new Child(), "public fixture");
    expect(answer.derived).toBe(`child ${DERIVED}`);
    expect(answer.describe()).toBe(DERIVED);
  });
});

describe("AUD-016-API001 (AUD-017): host result operations retain their original receiver", () => {
  it("captures common getters once and makes them immutable even if the host later changes", async () => {
    const reads = { matched: 0, path: 0, warning: 0 };
    const given = {
      get matched() {
        return reads.matched++ === 0;
      },
      get path() {
        return reads.path++ === 0 ? "m" : "changed";
      },
      get warning() {
        return reads.warning++ === 0 ? "public warning" : "changed";
      },
    };
    const answer = await askWallet(() => given, "public fixture");
    for (let repeat = 0; repeat < 2; repeat++)
      expect([answer.matched, answer.path, answer.warning]).toEqual([true, "m", "public warning"]);
    expect(reads).toEqual({ matched: 1, path: 1, warning: 1 });
    expect(Reflect.set(answer, "matched", false)).toBe(false);
    expect(answer.matched).toBe(true);
  });

  it("preserves own data and JSON fields without following later changes to the host's data", async () => {
    const given = { matched: true, derived: DERIVED };
    const answer = await askWallet(() => given, "public fixture");
    given.derived = "changed public field";
    expect(Object.hasOwn(answer, "derived")).toBe(true);
    expect(answer.derived).toBe(DERIVED);
    expect(JSON.parse(JSON.stringify(answer))).toEqual({ matched: true, derived: DERIVED });
  });

  it("preserves own symbol and prototype-named fields as data", async () => {
    const symbol = Symbol("public field");
    const given = Object.defineProperty({ matched: true, [symbol]: "public symbol" }, "__proto__", {
      value: "public own field",
      enumerable: true,
    });
    const answer = await askWallet(() => given, "public fixture");
    expect(Object.getPrototypeOf(answer)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(answer, "__proto__")?.value).toBe("public own field");
    expect(answer[symbol]).toBe("public symbol");
  });

  it("accepts a null-prototype result without adding inherited fields", async () => {
    const given = { matched: true, derived: DERIVED };
    Reflect.setPrototypeOf(given, null);
    const answer = await askWallet(() => given, "public fixture");
    expect(Object.getPrototypeOf(answer)).toBeNull();
    expect(answer.derived).toBe(DERIVED);
    expect("toString" in answer).toBe(false);
  });
});
