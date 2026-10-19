/**
 * How long a step's context stays on the private screen: until the next question is answered, or
 * until the page ends (a result clears the screen, or the command ends).
 */
export type StepContextLifetime = "answered" | "page";

/** Lines that belong to the coming steps, drawn again under the title of each step screen. */
interface StepContext {
  readonly draw: () => void;
  readonly lifetime: StepContextLifetime;
}

/** Owns redraw, warning and step-context state for the lifetime of one private command. */
export class PrivateSteps {
  static #redraw: ((warnings: readonly string[]) => void) | undefined;
  static readonly #startupWarnings = new Set<string>();
  static readonly #context: StepContext[] = [];
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
    PrivateSteps.#reset();
  }

  /**
   * Whether a new input page was drawn: the title, the retained warnings and the kept context of
   * the step. Follow-up questions keep a displayed result intact.
   */
  static begin(): boolean {
    if (!PrivateSteps.active || PrivateSteps.#showingResult) return false;
    PrivateSteps.#begun = true;
    const warnings = new Set(PrivateSteps.#startupWarnings);
    if (PrivateSteps.#warning !== undefined) warnings.add(PrivateSteps.#warning);
    PrivateSteps.#redraw?.(Object.freeze([...warnings]));
    for (const context of PrivateSteps.#context) context.draw();
    return true;
  }

  /**
   * Draws what the coming question needs beside it, such as the encoded fingerprint to compare
   * before the dates are typed, or why the question is asked; on the private screen the lines are
   * drawn again on every step screen until `lifetime` ends (CORE-39: a step's screen shows its
   * context, not only its question). Elsewhere they are drawn once, in order.
   */
  static keep(draw: () => void, lifetime: StepContextLifetime = "answered"): void {
    draw();
    if (PrivateSteps.active) PrivateSteps.#context.push({ draw, lifetime });
  }

  /** A displayed result must remain readable until its owner explicitly opens another page. */
  static showResult(): void {
    if (!PrivateSteps.active) return;
    PrivateSteps.#begun = true;
    PrivateSteps.#showingResult = true;
  }

  /** A new private page ends the result, its transient warning and every kept context. */
  static newPage(): void {
    PrivateSteps.#showingResult = false;
    PrivateSteps.#warning = undefined;
    PrivateSteps.#context.length = 0;
  }

  /** Retains initial safety warnings and only the latest later warning, without a step history. */
  static remember(warning: string): void {
    if (!PrivateSteps.active) return;
    if (PrivateSteps.#begun) PrivateSteps.#warning = warning;
    else PrivateSteps.#startupWarnings.add(warning);
  }

  /**
   * An accepted typed answer ends its validation warning and the context kept for it, while
   * startup safety warnings remain.
   */
  static answerAccepted(): void {
    PrivateSteps.#warning = undefined;
    PrivateSteps.answered();
  }

  /** An answered question, typed or chosen from a list, ends the context kept for it. */
  static answered(): void {
    const kept = PrivateSteps.#context.filter((context) => context.lifetime !== "answered");
    PrivateSteps.#context.splice(0, PrivateSteps.#context.length, ...kept);
  }

  /** Releases the command's redraw, warning and context state. */
  static close(): void {
    PrivateSteps.#redraw = undefined;
    PrivateSteps.#reset();
  }

  static #reset(): void {
    PrivateSteps.#startupWarnings.clear();
    PrivateSteps.#context.length = 0;
    PrivateSteps.#begun = false;
    PrivateSteps.#warning = undefined;
    PrivateSteps.#showingResult = false;
  }
}
