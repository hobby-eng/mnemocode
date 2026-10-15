import { readFile } from "node:fs/promises";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import * as raw from "../sskr-wasm/generated/recovery_sskr_wasm.js";
import { CheckedSskrBridge, type SskrBridge } from "../src/sskr/bridge.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import { bytesOfHex } from "../src/core/bits.js";

raw.initSync({
  module: await readFile(
    new URL("../sskr-wasm/generated/recovery_sskr_wasm_bg.wasm", import.meta.url),
  ),
});
const checked = new CheckedSskrBridge(raw);
const TOKEN = "private-user-token";
const SAFE_MESSAGE = "The SSKR share could not be decoded.";

function caught(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("The malformed public fixture must be refused.");
}

describe.each([
  ["raw", raw],
  ["checked", checked],
] as const)("SSKR %s decode refusals", (_label, bridge: SskrBridge) => {
  const share = sskrSetVector.shares[0];
  const wrongType = share.replace("ur:sskr/", "ur:" + TOKEN + "/");
  const badChecksum = share.slice(0, -2) + "ae";
  it.each([
    ["wrong type", () => bridge.recover_sskr_shares(wrongType)],
    [
      "formatted wrong type",
      () => bridge.recover_sskr_shares_formatted(wrongType, bridge.ShareEncoding.CompactUr),
    ],
    ["checksum", () => bridge.recover_sskr_shares(badChecksum)],
    [
      "words",
      () =>
        bridge.recover_sskr_shares_formatted(
          TOKEN + " invalid words",
          bridge.ShareEncoding.Bytewords,
        ),
    ],
  ] as const)("keeps the stable safe error for %s", (_kind, action) => {
    const error = caught(action);
    expect(error.message).toBe(SAFE_MESSAGE);
    expect(Reflect.get(error, "code")).toBe("sskr.engine.decode");
    expect(error.cause).toBeUndefined();
    expect(Object.hasOwn(error, "cause")).toBe(false);
    for (const rendered of [
      String(error),
      error.stack ?? "",
      inspect(error),
      JSON.stringify(error),
    ])
      expect(rendered).not.toContain(TOKEN);
  });

  it("still recovers the exact public entropy", () => {
    const actual = bridge.recover_sskr_shares(
      [sskrSetVector.shares[0], sskrSetVector.shares[2]].join("\n"),
    );
    try {
      expect(actual).toEqual(bytesOfHex("000102030405060708090a0b0c0d0e0f"));
    } finally {
      actual.fill(0);
    }
  });
});
