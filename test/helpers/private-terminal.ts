// The private screen of a command in a test: what is written to the terminal, standard output and
// standard error in their order, with the page of the private screen recording it as on a real
// terminal (private-page.ts). The keys are given to the test's own mock of terminal-input.js.

import { format } from "node:util";
import { vi, type MockInstance } from "vitest";
import { PrivatePage } from "../../src/cli/private-page.js";
import { PrivateSteps } from "../../src/cli/private-steps.js";
import { CLEAR_SCREEN } from "../../src/cli/terminal.js";
import { STYLE_CODES } from "../../src/cli/terminal-style.js";

/** A terminal that standard output and standard error write to, `columns` by `rows`. */
export class PrivateTerminal {
  /** Everything written so far. */
  written = "";
  /** The writer of standard error under the page's record, which a test may make do more. */
  readonly stderr: MockInstance;
  readonly #restore: () => void;

  constructor(columns = 80, rows = 24) {
    const size = { columns: process.stderr.columns, rows: process.stderr.rows };
    const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    process.stderr.columns = columns;
    process.stderr.rows = rows;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => this.write(chunk));
    this.stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => this.write(chunk));
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      process.stdout.write(`${format(...parts)}\n`);
    });
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      process.stderr.write(`${format(...parts)}\n`);
    });
    PrivateSteps.open(
      () => process.stderr.write(`${CLEAR_SCREEN}Private operation\n\n`),
      () => undefined,
    );
    PrivatePage.open();
    this.#restore = () => {
      PrivatePage.close();
      PrivateSteps.close();
      vi.restoreAllMocks();
      process.stderr.columns = size.columns;
      process.stderr.rows = size.rows;
      if (stdoutTty === undefined) Reflect.deleteProperty(process.stdout, "isTTY");
      else Object.defineProperty(process.stdout, "isTTY", stdoutTty);
    };
  }

  /** Adds a chunk that either stream was given. */
  write(chunk: unknown): true {
    this.written += typeof chunk === "string" ? chunk : Buffer.from(String(chunk)).toString();
    return true;
  }

  /** Each frame drawn from a clear of the screen on, without colours: what each page showed. */
  frames(): string[] {
    return this.written.split(CLEAR_SCREEN).map((frame) => frame.replace(STYLE_CODES, ""));
  }

  /** Puts the terminal and the private screen back as they were. */
  close(): void {
    this.#restore();
  }
}
