// The public BIP39 test phrase of the tests, and what follows from it. Public test data only.

/** The BIP39 test phrase "abandon … about": twelve words of zero entropy. */
export const TEST_PHRASE = `${"abandon ".repeat(11)}about`;

/** The BIP32 master fingerprint of TEST_PHRASE with an empty passphrase. */
export const TEST_FINGERPRINT = "73c5da0a";
