// Why a candidate file was refused, shared by the plain format and its encryption without either
// importing the other.

import { ErrorCatalog } from "./error-catalog.js";
import { inWholeRange, wholeNumbersFrom } from "./typed-number.js";

/**
 * Why a candidate file was refused, by the step it failed at: its size or header is not that of a
 * list (`unsupported`), the key given does not open it (`key`), or its contents were changed or cut
 * (`damaged`).
 */
export type CandidateFileProblem = "unsupported" | "key" | "damaged";

/** The words of the three refusals of a header whose recipients the reader does not take. */
function exactlyOneRecipient(types: string): string {
  return `The candidate file must have exactly one ${types} recipient.`;
}

/**
 * The conditions under which a candidate file is refused, one code each (AUD-037-API009), and
 * their English messages, from which every refusal's text is built (CORE-23). `detail` is the
 * description of age's own error.
 */
const REFUSALS = new ErrorCatalog("core.candidate-file-refusal", {
  "size-not-whole": () => "The candidate file size must be a non-negative safe integer.",
  "plaintext-list-too-large": (maximum: number) =>
    `The plaintext candidate list exceeds the supported limit of ${maximum} bytes.`,
  "encrypted-file-too-large": (maximum: number) =>
    `The encrypted candidate file exceeds the supported limit of ${maximum} bytes.`,
  "form-unsupported": () => "The candidate file form is not supported.",
  "not-age-file": () => "This is not a binary age file.",
  "header-without-end": () => "The age header has no end.",
  "recipient-unsupported": exactlyOneRecipient,
  "several-recipients": exactlyOneRecipient,
  "recipient-of-another-key": exactlyOneRecipient,
  "scrypt-work-factor-unsupported": (logN: number) =>
    `The candidate file must use the scrypt work factor ${logN}.`,
  "header-malformed": () => "The age header is malformed.",
  "header-read-short": () => "The candidate file changed or ended while its header was being read.",
  "file-changed-while-read": () => "The candidate file changed or ended while it was being read.",
  "contents-damaged": (detail: string) => `The candidate file is damaged (${detail}).`,
  "identity-invalid": () => "This Scanner key is not a valid age identity.",
  "scanner-key-does-not-open": (detail: string) =>
    `This Scanner key does not open the candidate file, or its header is damaged (${detail}).`,
  "passphrase-does-not-open": (detail: string) =>
    `This passphrase does not open the candidate file, or its header is damaged (${detail}).`,
});

/** One condition under which a candidate file is refused (CandidateFileRefusedError.create). */
export type CandidateFileRefusal = Parameters<typeof REFUSALS.create>[0];

/** The step each condition fails at, which CandidateFileRefusedError.problem names. */
const PROBLEMS = Object.freeze({
  "size-not-whole": "unsupported",
  "plaintext-list-too-large": "unsupported",
  "encrypted-file-too-large": "unsupported",
  "form-unsupported": "unsupported",
  "not-age-file": "unsupported",
  "header-without-end": "unsupported",
  "recipient-unsupported": "unsupported",
  "several-recipients": "unsupported",
  "recipient-of-another-key": "unsupported",
  "scrypt-work-factor-unsupported": "unsupported",
  "header-malformed": "unsupported",
  "header-read-short": "damaged",
  "file-changed-while-read": "damaged",
  "contents-damaged": "damaged",
  "identity-invalid": "key",
  "scanner-key-does-not-open": "key",
  "passphrase-does-not-open": "key",
} as const satisfies Record<CandidateFileRefusal, CandidateFileProblem>);

/**
 * Thrown when a candidate file cannot be opened: `code` names the condition, one of
 * core.candidate-file-refusal.*, and `problem` the step it failed at, so that a host can add its
 * own words where it knows more, such as which page a key belongs to. age's own error, where it
 * failed, is the `cause`.
 */
export class CandidateFileRefusedError extends Error {
  /** The stable code of the condition, such as core.candidate-file-refusal.not-age-file. */
  readonly code: `core.candidate-file-refusal.${CandidateFileRefusal}`;
  /** The step it failed at: admission (unsupported), the key (key) or the contents (damaged). */
  readonly problem: CandidateFileProblem;

  /** Built only by create, so that the message is always that of the code. */
  private constructor(
    code: CandidateFileRefusal,
    failure: { readonly code: CandidateFileRefusedError["code"]; readonly message: string },
    options: ErrorOptions | undefined,
  ) {
    super(failure.message, options);
    this.name = "CandidateFileRefusedError";
    this.code = failure.code;
    this.problem = PROBLEMS[code];
  }

  /**
   * The refusal of `code` with the parameters of its message; `cause` is age's own error, if any.
   * A host that reads a file itself refuses with these codes too, such as
   * file-changed-while-read for a file that changed between its checks and its read.
   */
  static create<Code extends CandidateFileRefusal>(
    code: Code,
    parameters: Parameters<typeof REFUSALS.create<Code>>[1],
    cause?: unknown,
  ): CandidateFileRefusedError {
    const options = cause === undefined ? undefined : { cause };
    return new CandidateFileRefusedError(code, REFUSALS.create(code, parameters), options);
  }

  /** Whether `error` is the refusal of a candidate file under one of the conditions `codes`. */
  static isRefusal(
    error: unknown,
    codes: readonly CandidateFileRefusal[],
  ): error is CandidateFileRefusedError {
    return error instanceof CandidateFileRefusedError && REFUSALS.matches(error, codes);
  }
}

/**
 * A byte count checked before reading, allocating, or copying a candidate file: refused unless
 * `size` is a whole number from 0 (size-not-whole) through `maximum` bytes (`tooLarge`, the code
 * of the file's form).
 */
export function assertCandidateFileSize(
  size: number,
  maximum: number,
  tooLarge: "plaintext-list-too-large" | "encrypted-file-too-large",
): void {
  if (!inWholeRange(size, wholeNumbersFrom(0)))
    throw CandidateFileRefusedError.create("size-not-whole", []);
  if (size > maximum) throw CandidateFileRefusedError.create(tooLarge, [maximum]);
}
