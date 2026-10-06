// AUD-008: BIP39 passphrase runtime contract; public zero mnemonic only.
import { mnemonicToSeedSync } from "@scure/bip39";
import { masterFingerprint } from "../../../dist/bitcoin-evidence.js";
const mnemonic = "abandon ".repeat(11) + "about";
const failures = [];
for (const passphrase of [null, 123, false, [], {}]) {
  let referenceRejected = false;
  try {
    mnemonicToSeedSync(mnemonic, passphrase);
  } catch {
    referenceRejected = true;
  }
  try {
    const fingerprint = masterFingerprint(mnemonic, passphrase);
    failures.push({
      type: passphrase === null ? "null" : typeof passphrase,
      input: passphrase,
      referenceRejected,
      fingerprint,
      silentlyEqualsStringCoercion: fingerprint === masterFingerprint(mnemonic, String(passphrase)),
    });
  } catch {
    // The production API should reject a non-string passphrase as the documented dependency does.
  }
}
console.log(JSON.stringify({ expected: "reject non-string BIP39 passphrases", failures }, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
