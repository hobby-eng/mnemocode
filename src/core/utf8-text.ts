import { ErrorCatalog, suppliedMessage } from "./error-catalog.js";

// Preserve the established refusal code for callers of the CLI's original text reader.
const ERRORS = new ErrorCatalog("cli.utf8", {
  "strict-utf8text-refused": suppliedMessage,
});

/** Keeps a leading byte order mark; each input format decides whether it belongs to its text. */
const STRICT_UTF8_WITH_BOM = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Why text that holds bytes of no UTF-8 character is refused, for `what` it was read from. */
export function notUtf8Text(what: string): string {
  return `${what} is not valid UTF-8 text.`;
}

/**
 * Decodes the complete borrowed input as UTF-8, keeping a leading BOM and all line breaks.
 * Refuses invalid bytes with cli.utf8.strict-utf8text-refused instead of replacing them with
 * U+FFFD; a valid U+FFFD is kept. The caller owns and wipes `bytes`.
 */
export function strictUtf8Text(bytes: Uint8Array, what: string): string {
  try {
    return STRICT_UTF8_WITH_BOM.decode(bytes);
  } catch (error) {
    if (error instanceof TypeError)
      throw ERRORS.create("strict-utf8text-refused", [notUtf8Text(what)]);
    throw error;
  }
}
