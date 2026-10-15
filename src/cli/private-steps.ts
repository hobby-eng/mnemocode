/** Owns redraw and warning state for the lifetime of one private command. */
export class PrivateSteps {
  static #redraw: ((warnings: readonly string[]) => void) | undefined;
  static readonly #startupWarnings = new Set<string>();
  static #begun = false;
  static #warning: string | undefined;
  static #showingResult = false;

  /** Whether a private command owns the current terminal screen. */
  static get active(): boolean {
    return PrivateSteps.#redraw !== undefined;
  }

  /** Starts one command's step screens; the host draws its title and retained warning. */
  static open(redraw: (warnings: readonly string[]) => void): void {
    PrivateSteps.#redraw = redraw;
    PrivateSteps.#startupWarnings.clear();
    PrivateSteps.#begun = false;
    PrivateSteps.#warning = undefined;
    PrivateSteps.#showingResult = false;
  }

  /** Whether a new input page was drawn; follow-up questions keep a displayed result intact. */
  static begin(): boolean {
    if (!PrivateSteps.active || PrivateSteps.#showingResult) return false;
    PrivateSteps.#begun = true;
    const warnings = new Set(PrivateSteps.#startupWarnings);
    if (PrivateSteps.#warning !== undefined) warnings.add(PrivateSteps.#warning);
    PrivateSteps.#redraw?.(Object.freeze([...warnings]));
    return true;
  }

  /** A displayed result must remain readable until its owner explicitly opens another page. */
  static showResult(): void {
    if (!PrivateSteps.active) return;
    PrivateSteps.#begun = true;
    PrivateSteps.#showingResult = true;
  }

  /** A new private page ends the result and its transient warning, keeping startup warnings. */
  static newPage(): void {
    PrivateSteps.#showingResult = false;
    PrivateSteps.#warning = undefined;
  }

  /** Retains initial safety warnings and only the latest later warning, without a step history. */
  static remember(warning: string): void {
    if (!PrivateSteps.active) return;
    if (PrivateSteps.#begun) PrivateSteps.#warning = warning;
    else PrivateSteps.#startupWarnings.add(warning);
  }

  /** An accepted typed answer ends its validation warning, while startup safety warnings remain. */
  static answerAccepted(): void {
    PrivateSteps.#warning = undefined;
  }

  /** Releases the command's redraw and warning state. */
  static close(): void {
    PrivateSteps.#redraw = undefined;
    PrivateSteps.#startupWarnings.clear();
    PrivateSteps.#begun = false;
    PrivateSteps.#warning = undefined;
    PrivateSteps.#showingResult = false;
  }
}
