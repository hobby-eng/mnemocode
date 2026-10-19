/**
 * How long a step's context stays on the private screen: until the next question ends, answered
 * or left with Escape; until the page ends (a result clears the screen); or until the command
 * ends.
 */
export type StepContextLifetime = "question" | "page" | "command";

/** Lines that belong to the coming steps, drawn again under the title of each step screen. */
interface StepContext {
  readonly draw: () => void;
  readonly lifetime: StepContextLifetime;
}

/** Owns redraw, warning and step-context state for the lifetime of one private command. */
export class PrivateSteps {
  static #heading: (() => void) | undefined;
  static #warn: (warning: string) => void = () => undefined;
  static readonly #startupWarnings = new Set<string>();
  static readonly #context: StepContext[] = [];
  static #begun = false;
  static #warning: string | undefined;
  static #showingResult = false;
  static #drawingContext = false;

  /** Whether a private command owns the current terminal screen. */
  static get active(): boolean {
    return PrivateSteps.#heading !== undefined;
  }

  /**
   * Starts one command's step screens: `heading` clears the screen and draws its title, `warn`
   * draws one retained warning.
   */
  static open(heading: () => void, warn: (warning: string) => void): void {
    PrivateSteps.#heading = heading;
    PrivateSteps.#warn = warn;
    PrivateSteps.#reset();
  }

  /**
   * Whether a new input page was drawn: the title, the kept context of the step, then the retained
   * warnings, the latest last, right above the question it explains. Follow-up questions keep a
   * displayed result intact.
   */
  static begin(): boolean {
    if (!PrivateSteps.active || PrivateSteps.#showingResult) return false;
    PrivateSteps.#begun = true;
    PrivateSteps.#heading?.();
    for (const context of PrivateSteps.#context) PrivateSteps.#drawContext(context.draw);
    const warnings = new Set(PrivateSteps.#startupWarnings);
    if (PrivateSteps.#warning !== undefined) warnings.add(PrivateSteps.#warning);
    for (const warning of warnings) PrivateSteps.#warn(warning);
    return true;
  }

  /**
   * Draws what the coming question needs beside it, such as the encoded fingerprint to compare
   * before the dates are typed, or why the question is asked; on the private screen the lines are
   * drawn again on every step screen until `lifetime` ends (CORE-39: a step's screen shows its
   * context, not only its question). Elsewhere they are drawn once, in order. A warning drawn as
   * part of them is theirs: it is not retained apart (remember).
   */
  static keep(draw: () => void, lifetime: StepContextLifetime = "question"): void {
    PrivateSteps.#drawContext(draw);
    if (PrivateSteps.active) PrivateSteps.#context.push({ draw, lifetime });
  }

  /** A displayed result must remain readable until its owner explicitly opens another page. */
  static showResult(): void {
    if (!PrivateSteps.active) return;
    PrivateSteps.#begun = true;
    PrivateSteps.#showingResult = true;
  }

  /** A new private page ends the result, its transient warning and the contexts of the page. */
  static newPage(): void {
    PrivateSteps.#showingResult = false;
    PrivateSteps.#warning = undefined;
    PrivateSteps.#keepOnly("command");
  }

  /** Retains initial safety warnings and only the latest later warning, without a step history. */
  static remember(warning: string): void {
    if (!PrivateSteps.active || PrivateSteps.#drawingContext) return;
    if (PrivateSteps.#begun) PrivateSteps.#warning = warning;
    else PrivateSteps.#startupWarnings.add(warning);
  }

  /**
   * An accepted typed answer ends its validation warning and the context kept for it, while
   * startup safety warnings remain.
   */
  static answerAccepted(): void {
    PrivateSteps.#warning = undefined;
    PrivateSteps.questionEnded();
  }

  /**
   * A question ended, answered or left with Escape, or its codes are asked for again: the context
   * kept for it ends.
   */
  static questionEnded(): void {
    PrivateSteps.#keepOnly("page", "command");
  }

  /** Releases the command's redraw, warning and context state. */
  static close(): void {
    PrivateSteps.#heading = undefined;
    PrivateSteps.#warn = () => undefined;
    PrivateSteps.#reset();
  }

  static #drawContext(draw: () => void): void {
    PrivateSteps.#drawingContext = true;
    try {
      draw();
    } finally {
      PrivateSteps.#drawingContext = false;
    }
  }

  static #keepOnly(...lifetimes: readonly StepContextLifetime[]): void {
    const kept = PrivateSteps.#context.filter((context) => lifetimes.includes(context.lifetime));
    PrivateSteps.#context.splice(0, PrivateSteps.#context.length, ...kept);
  }

  static #reset(): void {
    PrivateSteps.#startupWarnings.clear();
    PrivateSteps.#context.length = 0;
    PrivateSteps.#begun = false;
    PrivateSteps.#warning = undefined;
    PrivateSteps.#showingResult = false;
    PrivateSteps.#drawingContext = false;
  }
}
