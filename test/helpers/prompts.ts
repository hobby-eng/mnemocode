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

/** The private prompt for an encoded phrase or a local record. */
export const ENCODED_PROMPT = "Encoded seed phrase, record or text file path:";
/** The offer to check a newly made backup. */
export const BACKUP_CHECK_QUESTION = "Check the backup now?";
/** The question of a stored phrase's masking mode. */
export const SEEDSHIFT_QUESTION = "Was Seedshift used when it was encoded?";
/** The private prompt for an English BIP39 phrase. */
export const SEED_PHRASE_PROMPT = "Seed phrase (English BIP39 words):";
/** The answer that compares candidates with the wallet. */
export const CHECK_WALLET_ANSWER = "Check them against the wallet";
/** The answer that starts a new word entry. */
export const WORDS_AGAIN_ANSWER = "Type the words again";
/** The answer that starts a new encoded-phrase entry. */
export const CODES_AGAIN_ANSWER = "Type the encoded seed phrase again";
/** The answer that asks for the dates again, keeping the codes. */
export const DATES_AGAIN_ANSWER = "Type the dates again";
/** The prompt that replaces the second share. */
export const SECOND_SHARE_PROMPT = "Share 2 again, or its text file path:";
/** The question that confirms the phrase of a backup before re-encoding. */
export const RE_ENCODE_CONFIRMATION = "Is this the seed phrase to re-encode?";
/** The follow-up question when the private screen cannot hold all candidates. */
export const CANDIDATES_TOO_LONG_QUESTION = "Not every candidate fits on the screen. What now?";
