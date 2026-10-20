// AUD-020-SEC001: re-encode dropped the warning that a fingerprint is only a filter, and said that
// its match confirmed the seed phrase. The warning now comes first, and the line says the phrase
// is accepted, not proven; an address keeps its plain confirmation. Public test data only: the
// BIP39 test phrase, its master fingerprint and its first native SegWit address.
import { describe, expect, it } from "vitest";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { ReEncoding } from "../src/core/re-encoding.js";
import { FINGERPRINT_WARNING, fingerprintMatch } from "../src/core/wallet-check.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";
import { runBuiltCli } from "./helpers/built-cli.js";

const ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
/** The test phrase without Seedshift as Unicode codes, from the BIP39 Chinese list. */
const UNICODE = `${"7684".repeat(11)}5728`;
const ACCEPTED = "The fingerprint matches: the seed phrase is accepted, not proven.";

/** re-encode of the test phrase, typed as words without Seedshift, as Unicode codes. */
async function reEncode(...wallet: readonly string[]) {
  return await runBuiltCli([
    "re-encode",
    "--input",
    TEST_PHRASE,
    "--old-mode",
    "direct",
    "--old-format",
    "english",
    "--format",
    "3",
    ...wallet,
  ]);
}

describe("AUD-020-SEC001: a fingerprint's match is accepted with its warning", () => {
  it("shows the warning before the match, and claims no proof", async () => {
    const { stdout, stderr } = await reEncode("--master-fingerprint", TEST_FINGERPRINT);
    // The new backup is made as before.
    expect(stdout).toContain(UNICODE);
    const warning = stderr.indexOf(FINGERPRINT_WARNING);
    expect(warning).toBeGreaterThanOrEqual(0);
    expect(stderr.indexOf(ACCEPTED)).toBeGreaterThan(warning);
    expect(stderr).not.toContain("seed phrase is confirmed");
  });

  it("gives an address's match no fingerprint warning", async () => {
    const { stdout, stderr } = await reEncode("--bitcoin-address", ADDRESS);
    expect(stdout).toContain(UNICODE);
    expect(stderr).toContain("Address found at m/84'/0'/0'/0/0: the wallet matches");
    expect(stderr).not.toContain(FINGERPRINT_WARNING);
  });

  it("still refuses a fingerprint of another wallet", async () => {
    const refused = await reEncode("--master-fingerprint", "00000000").then(
      () => undefined,
      (error: { readonly code: number; readonly stdout: string; readonly stderr: string }) => error,
    );
    expect(refused?.code).not.toBe(0);
    expect(refused?.stderr).toContain("does not match: it is not confirmed");
    expect(refused?.stdout).not.toContain(UNICODE);
  });

  it("keeps the check's warning in the library's record of the confirmation", async () => {
    const backup = EncodedBackup.read(TEST_PHRASE, "english", "direct");
    const byFingerprint = ReEncoding.of(backup, []);
    await byFingerprint.confirmByWallet((mnemonic) =>
      fingerprintMatch(mnemonic === TEST_PHRASE ? TEST_FINGERPRINT : "00000000", TEST_FINGERPRINT),
    );
    expect(byFingerprint.confirmation).toEqual({
      by: "wallet",
      path: "m",
      warning: FINGERPRINT_WARNING,
    });
    // A host cannot change how the phrase was confirmed.
    expect(Object.isFrozen(byFingerprint.confirmation)).toBe(true);
    const byAddress = ReEncoding.of(backup, []);
    await byAddress.confirmByWallet(() => ({ matched: true, path: "m/84'/0'/0'/0/0" }));
    const confirmation = byAddress.confirmation;
    expect(confirmation?.by === "wallet" && confirmation.warning).toBeUndefined();
  });
});
