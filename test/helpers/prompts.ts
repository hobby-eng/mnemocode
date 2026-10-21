// The questions and prompts of the command line that several tests look for on the screen, each
// written once, as a person reads it. They are written out rather than taken from src/cli, so that
// a test sees a changed text.

import { TEST_FINGERPRINT } from "./test-phrase.js";

/** The prompt for the wallet's original fingerprint, with the test phrase's as its example. */
export const FINGERPRINT_PROMPT = `Original fingerprint of the wallet, such as ${TEST_FINGERPRINT} (not the encoded one; They do not reveal the phrase.)`;

/** The prompt for the dates that encode and re-encode mask with. */
export const DATES_PROMPT = "Dates (up to 4, DD-MM-YYYY, separated by spaces):";

/** The prompt for the dates that decode and restore unmask with, where a part may be forgotten. */
export const DECODE_DATES_PROMPT =
  "Dates (up to 4, DD-MM-YYYY, ? for what is forgotten, separated by spaces):";

/** The list question for how the wallet is recognised, as askWalletEvidence asks it. */
export const WALLET_QUESTION = "How can MnemoCode recognise the wallet?";
