// Text read within the input limit (bounded-read.ts) and decoded as strict UTF-8 (utf8.ts): a file
// that a command reads, such as a share, a WIF or a passphrase file, and standard input.
import { MAX_TEXT_INPUT_BYTES, readFileOrRefuse } from "./bounded-read.js";
import { strictUtf8Text } from "./utf8.js";

/**
 * The text of `bytes`, read from `what`, as strictUtf8Text decodes it: a byte order mark and line
 * breaks are kept for the caller to treat by its own rule. The bytes may hold a secret, such as a
 * passphrase, and are wiped once decoded, also when they are refused.
 */
export function decodedText(bytes: Buffer, what: string): string {
  try {
    return strictUtf8Text(bytes, what);
  } finally {
    bytes.fill(0);
  }
}

/** The text of the file at `path`, at most MAX_TEXT_INPUT_BYTES of valid UTF-8 (decodedText). */
export function readBoundedTextFile(path: string, inputName = "The text input"): string {
  return decodedText(
    readFileOrRefuse(
      path,
      MAX_TEXT_INPUT_BYTES,
      inputName,
      `${inputName} could not be read. Check that the file exists and is readable.`,
    ),
    inputName,
  );
}
