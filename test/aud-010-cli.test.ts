// AUD-010 findings of the command line: secrets and on-or-off options, and refusals that name
// what they refuse.

import { describe, expect, it } from "vitest";
import { addressCount, walletEvidence } from "../src/cli/bitcoin-options.js";
import { parseArguments } from "../src/cli/arguments.js";
import { runSskrCombine, runSskrExport } from "../src/cli/sskr-command.js";
import { runTable } from "../src/cli/table-command.js";

const BIP84_ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";

describe("AUD-010-SEC001: dates are never taken from the command line with --ask-secrets", () => {
  it("is refused by sskr-combine and sskr-export before any question", async () => {
    const args = { "ask-secrets": true, mode: "seedshift", date: "23-09-2026" } as const;
    await expect(runSskrCombine({ ...args })).rejects.toThrow(
      "--ask-secrets cannot be combined with command-line dates.",
    );
    await expect(
      runSskrExport({ ...args, "master-fingerprint": "73c5da0a", "cards-dir": "unused" }),
    ).rejects.toThrow("--ask-secrets cannot be combined with command-line dates.");
  });
});

describe("AUD-010-API004: an on-or-off option takes no value", () => {
  it("is refused for every such option, so that none is read as off", () => {
    for (const option of ["missing-word", "plaintext-candidates", "list-candidates", "sskr"])
      expect(() => parseArguments([`--${option}`, "yes"]), option).toThrow(
        "is an on-or-off choice and does not accept a separate value",
      );
    expect(parseArguments(["--missing-word", "--mnemonic", "x"])).toEqual({
      "missing-word": true,
      mnemonic: "x",
    });
  });
});

describe("AUD-010-UI002: the numbers of a wallet's place are named as such", () => {
  it("calls --index the first address index beside a wallet, and a word index in table", () => {
    expect(() => walletEvidence({ "bitcoin-address": BIP84_ADDRESS, index: "-1" })).toThrow(
      "The --index first address index value must be a base-10 integer",
    );
    expect(() => walletEvidence({ "bitcoin-address": BIP84_ADDRESS, account: "x" })).toThrow(
      "The --account address account value",
    );
    expect(() => runTable({ index: "x" })).toThrow("word index");
    expect(() => addressCount({ "scan-gap": "0" })).toThrow(
      "The --scan-gap address count value must be a base-10 integer from 1 through 1000.",
    );
  });
});
