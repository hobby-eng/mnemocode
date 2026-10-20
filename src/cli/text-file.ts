// Text read within the input limit (bounded-read.ts) and decoded as strict UTF-8 (utf8.ts): a file
// that a command reads, such as a share, a WIF or a passphrase file, and standard input.
import { MAX_TEXT_INPUT_BYTES, readBoundedDescriptor, readFileOrRefuse } from "./bounded-read.js";
import { strictUtf8Text } from "./utf8.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.text-file", {
  "local-file-required": () => "Use a local text file path or type the text itself.",
});

/** Quotes that a terminal puts around a path dragged into it: GNOME's ', Windows Terminal's ". */
const DROPPED_QUOTES = /^(['"])(.*)\1$/su;
/** A URI is inline text unless it names a local file; in particular, ur:sskr/ is a share. */
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
/** A Windows drive prefix is a path, not a URI scheme. */
const DRIVE_PATH = /^[a-z]:[/\\]/iu;

/**
 * A file dragged into a terminal as its path: unquote or unescape it, and expand a leading ~.
 * Backslashes on Windows separate folders and stay as typed. No shell is started.
 */
export function droppedPath(answer: string, platform: NodeJS.Platform = process.platform): string {
  const text = answer.trim();
  const quoted = DROPPED_QUOTES.exec(text);
  const path =
    quoted !== null
      ? platform !== "win32" && quoted[1] === "'"
        ? defined(quoted[2]).replaceAll("'\\''", "'")
        : defined(quoted[2])
      : platform === "win32"
        ? text
        : text.replace(/\\(.)/gsu, "$1");
  if (path === "~") return homedir();
  return path.startsWith("~/") || (platform === "win32" && path.startsWith("~\\"))
    ? join(homedir(), path.slice(2))
    : path;
}

/**
 * The text of one private answer: inline text, or one local regular UTF-8 file within the common
 * input bound. Paths use a separator, an extension or enclosing quotes; ./ names a bare filename.
 * File contents are never interpreted as another path, and never printed here.
 */
export class TextFileInput {
  /** Reads a path once, or keeps inline text exactly as typed. Refusals contain no input value. */
  static read(answer: string, inputName: string): string {
    const path = TextFileInput.#path(answer);
    return path === undefined ? answer : readBoundedTextFile(path, inputName, true);
  }

  static #path(answer: string): string | undefined {
    if (/[\r\n]/u.test(answer)) return undefined;
    const path = droppedPath(answer);
    if (/^file:/iu.test(path)) {
      try {
        const url = new URL(path);
        if (url.hostname !== "" && url.hostname !== "localhost")
          throw ERRORS.create("local-file-required", []);
        return fileURLToPath(url);
      } catch (error) {
        throw ERRORS.create("local-file-required", [], { cause: error });
      }
    }
    if (URI_SCHEME.test(path) && !DRIVE_PATH.test(path)) return undefined;
    if (path.startsWith("//") || path.startsWith("\\\\"))
      throw ERRORS.create("local-file-required", []);
    return /[/\\]|\.[^.\s]+$/u.test(path) || DROPPED_QUOTES.test(answer.trim()) ? path : undefined;
  }
}

/**
 * The text of `bytes`, read from `what`, as strictUtf8Text decodes it: a byte order mark and line
 * breaks are kept for the caller to treat by its own rule. The bytes may hold a secret, such as a
 * passphrase, and are wiped once decoded, also when they are refused.
 */
function decodedText(bytes: Buffer, what: string): string {
  try {
    return strictUtf8Text(bytes, what);
  } finally {
    bytes.fill(0);
  }
}

/** Standard input's descriptor; shared by every explicitly stdin-capable material file option. */
const STANDARD_INPUT_DESCRIPTOR = 0;
const STANDARD_INPUT_NAME = "Text input";

/**
 * A bounded strict UTF-8 file, or "-" for standard input. Decoding retires its owned bytes;
 * the caller handles the returned immutable text under the material's own parsing rule.
 */
export function readInputTextFile(path: string, inputName = "The text input"): string {
  if (path !== "-") return readBoundedTextFile(path, inputName);
  return decodedText(
    readBoundedDescriptor(STANDARD_INPUT_DESCRIPTOR, MAX_TEXT_INPUT_BYTES, STANDARD_INPUT_NAME),
    STANDARD_INPUT_NAME,
  );
}

/**
 * The file at `path`, at most MAX_TEXT_INPUT_BYTES of valid UTF-8 (decodedText). regularOnly
 * refuses a non-regular file; the default also permits explicitly requested pipes and devices.
 */
export function readBoundedTextFile(
  path: string,
  inputName = "The text input",
  regularOnly = false,
): string {
  return decodedText(
    readFileOrRefuse(path, MAX_TEXT_INPUT_BYTES, inputName, regularOnly),
    inputName,
  );
}
