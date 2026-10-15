// Finite private terminals need a revisitable result, including lines wider than the viewport.
// Redirected output keeps its complete original representation and never receives navigation.
import { PrivateSteps } from "./private-steps.js";
import { terminalColumns, terminalRows, displayWidth, rowsOfText } from "./terminal-geometry.js";
import { withRawTerminal, dropTypedAhead, readKey } from "./terminal-input.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { CLEAR_SCREEN } from "./terminal.js";
import { SecretValue } from "../core/secret-value.js";
import { Redacted } from "../core/redacted.js";

const NAVIGATION = ["↑/PgUp previous · ↓/PgDn next", "Home/End · Enter done · Esc cancel"];

/** A multiline result that remains navigable until the person finishes copying it. */
export class PrivateResult extends Redacted {
  readonly #lines: SecretValue<readonly string[]>;

  /** Owns a UTF-8 snapshot of this result's lines; no file or persistent history is involved. */
  constructor(lines: readonly string[]) {
    super("PrivateResult");
    this.#lines = SecretValue.texts(lines);
  }

  /** Shows long private results by pages; other output uses its original complete writer. */
  async show(plain: () => void): Promise<Cancelled | undefined> {
    this.#lines.assertLive();
    if (
      !PrivateSteps.active ||
      process.stdout.isTTY !== true ||
      this.#wrapped().length + this.#reserved() <= terminalRows()
    ) {
      plain();
      return undefined;
    }
    return withRawTerminal(async (next, moreWithin) => {
      if ((await dropTypedAhead()) === CANCELLED) return CANCELLED;
      let start = 0;
      let capacity = 1;
      let length = 1;
      const draw = (): void => {
        const lines = this.#wrapped();
        length = lines.length;
        capacity = Math.max(1, terminalRows() - this.#reserved());
        start = Math.min(start, Math.max(0, length - 1));
        PrivateSteps.showResult();
        process.stderr.write(CLEAR_SCREEN);
        const page = Math.floor(start / capacity) + 1;
        const pages = Math.ceil(length / capacity);
        console.error(
          [...lines.slice(start, start + capacity), `Page ${page}/${pages}`, ...NAVIGATION].join(
            "\n",
          ),
        );
      };
      process.on("SIGWINCH", draw);
      try {
        draw();
        for (;;) {
          const key = await readKey(next, moreWithin);
          if (key.kind === "cancel" || key.kind === "back") return CANCELLED;
          if (key.kind === "enter") return undefined;
          if (key.kind === "up" || key.kind === "page-up") start = Math.max(0, start - capacity);
          else if (key.kind === "down" || key.kind === "page-down")
            start = Math.min(Math.floor((length - 1) / capacity) * capacity, start + capacity);
          else if (key.kind === "home") start = 0;
          else if (key.kind === "end") start = Math.floor((length - 1) / capacity) * capacity;
          else continue;
          draw();
        }
      } finally {
        process.off("SIGWINCH", draw);
      }
    });
  }

  /** Ends this display's lifetime after the asynchronous viewer has settled. */
  wipe(): void {
    this.#lines.wipe();
  }

  /** Releases the display snapshot when its owning scope exits. */
  [Symbol.dispose](): void {
    this.wipe();
  }

  #reserved(): number {
    // Page count plus the cursor's final row; navigation wraps too on a narrow terminal.
    return 2 + NAVIGATION.reduce((rows, line) => rows + rowsOfText(line), 0);
  }

  #wrapped(): string[] {
    const columns = terminalColumns();
    return this.#lines.value.flatMap((text) =>
      text.split("\n").flatMap((line) => {
        const result: string[] = [];
        let shown = "";
        let width = 0;
        for (const point of line) {
          const cells = displayWidth(point);
          if (shown !== "" && width + cells > columns) {
            result.push(shown);
            shown = "";
            width = 0;
          }
          shown += point;
          width += cells;
        }
        result.push(shown);
        return result;
      }),
    );
  }
}
