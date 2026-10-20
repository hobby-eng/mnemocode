// CoinAddressCheck (src/core/coin-address-evidence.ts), the entry of a host of one coin, such as
// the Dash edition, through its own interface: an address found at its place and among those that
// follow, with a PBKDF2 that answers at once and one that answers later, and what it refuses
// before the host's PBKDF2 is called. Public test phrase and published vectors only: BIP84's
// receiving addresses 0 and 1 and change address 0, and DIP17's first Dash Platform address.
import { pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CoinAddressCheck, type CoinAddressEvidence } from "../src/core/coin-address-evidence.js";
import { BITCOIN } from "../src/core/coins/bitcoin-like.js";
import { DASH } from "../src/core/coins/dash.js";
import type { Pbkdf2HmacSha512 } from "../src/core/master-fingerprint.js";

/** The public BIP39 test phrase of BIP84 and DIP17. */
const ABANDON = "abandon ".repeat(11) + "about";
/** BIP84's first receiving address, m/84'/0'/0'/0/0. */
const RECEIVING_0 = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
/** BIP84's second receiving address, m/84'/0'/0'/0/1. */
const RECEIVING_1 = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g";
/** BIP84's first change address, m/84'/0'/0'/1/0. */
const CHANGE_0 = "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el";
/** DIP17's first Dash Platform address of key class 0', m/9'/5'/17'/0'/0'/0. */
const PLATFORM_0 = "dash1krma5z3ttj75la4m93xcndna9ullamq9y5e9n5rs";
const FIRST = { account: 0, branch: 0, index: 0 } as const;

const nodePbkdf2 = ((password, salt, rounds, bytes) =>
  Uint8Array.from(pbkdf2Sync(password, salt, rounds, bytes, "sha512"))) satisfies Pbkdf2HmacSha512;
/** The same PBKDF2, answering later, as WebCrypto does in a page. */
const laterPbkdf2: Pbkdf2HmacSha512 = async (...parameters) => nodePbkdf2(...parameters);

/** The comparisons of `evidence` with a PBKDF2 that answers at once and with one that answers later. */
async function bothMatches(evidence: CoinAddressEvidence): Promise<unknown[]> {
  return [
    new CoinAddressCheck(nodePbkdf2).match(ABANDON, evidence),
    await new CoinAddressCheck(laterPbkdf2).matchAsync(ABANDON, evidence),
  ];
}

describe("an address of one coin", () => {
  it("is found at its place, with a PBKDF2 that answers at once or later", async () => {
    for (const [coin, value, path] of [
      [BITCOIN, RECEIVING_0, "m/84'/0'/0'/0/0"],
      [BITCOIN, CHANGE_0, "m/84'/0'/0'/1/0"],
      [DASH, PLATFORM_0, "m/9'/5'/17'/0'/0'/0"],
    ] as const) {
      const location = { ...FIRST, branch: value === CHANGE_0 ? 1 : 0 };
      const found = { matched: true, derived: value, path };
      expect(await bothMatches({ coin, value, location })).toEqual([found, found]);
    }
  });

  it("is not found at another place, and is found among the addresses that follow", async () => {
    const notFound = { matched: false };
    expect(await bothMatches({ coin: BITCOIN, value: RECEIVING_1, location: FIRST })).toEqual([
      notFound,
      notFound,
    ]);
    expect(await bothMatches({ coin: BITCOIN, value: CHANGE_0, location: FIRST })).toEqual([
      notFound,
      notFound,
    ]);
    const second = { matched: true, derived: RECEIVING_1, path: "m/84'/0'/0'/0/1" };
    expect(
      await bothMatches({ coin: BITCOIN, value: RECEIVING_1, location: FIRST, addresses: 2 }),
    ).toEqual([second, second]);
  });

  it("is not compared by match with a PBKDF2 that answers later", () => {
    expect(() =>
      new CoinAddressCheck(laterPbkdf2).match(ABANDON, {
        coin: BITCOIN,
        value: RECEIVING_0,
        location: FIRST,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "core.master-fingerprint.host-s-pbkdf2-answers-later-use-match-async",
      }),
    );
  });

  it("is refused before the host's PBKDF2 is called when no wallet can have it", async () => {
    const calls: unknown[] = [];
    const recording = new CoinAddressCheck((...parameters) => {
      calls.push(parameters);
      return nodePbkdf2(...parameters);
    });
    const refused: readonly (readonly [CoinAddressEvidence, string])[] = [
      [
        { coin: BITCOIN, value: `${RECEIVING_0.slice(0, -1)}v`, location: FIRST },
        "core.coins.coin.address-damaged",
      ],
      [
        { coin: BITCOIN, value: RECEIVING_0, location: { ...FIRST, account: 2 ** 31 } },
        "core.coins.coin.assert-address-location-refused",
      ],
      [
        { coin: BITCOIN, value: RECEIVING_0, location: FIRST, addresses: 0 },
        "core.address-scan.address-count-refused",
      ],
      [
        {
          coin: BITCOIN,
          value: RECEIVING_0,
          location: { ...FIRST, index: 2 ** 31 - 1 },
          addresses: 2,
        },
        "core.address-scan.addresses-compared-would-pass-index",
      ],
    ];
    for (const [evidence, code] of refused) {
      const refusal: unknown = expect.objectContaining({ code });
      expect(() => recording.match(ABANDON, evidence)).toThrow(refusal);
      await expect(recording.matchAsync(ABANDON, evidence)).rejects.toThrow(refusal);
    }
    expect(calls).toEqual([]);
  });

  it("is never compared with a PBKDF2 that is no function", () => {
    for (const notAFunction of [undefined, "pbkdf2", {}]) {
      // Fed on purpose as a JavaScript host could: the constructor must refuse it.
      expect(() => new CoinAddressCheck(notAFunction as unknown as Pbkdf2HmacSha512)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "core.master-fingerprint.wallet-check-host-s-pbkdf2-hmac-sha512-function",
        }),
      );
    }
  });
});
