/**
 * How long a step's context stays on the private screen: until the next question ends, answered
 * or left with Escape, or its codes are asked for again; until the page ends (a result clears the
 * screen); or until the command ends.
 */
export type StepContextLifetime = "question" | "page" | "command";

/** Lines that belong to the coming steps, drawn again under the title of each step screen. */
interface StepContext {
  readonly draw: () => void;
  readonly lifetime: StepContextLifetime;
}

/**
 * Owns redraw, warning and step-context state for the lifetime of one private command. A warning
 * given before the command's first step screen or page, such as a safety warning, is drawn on
 * every step screen; a later one is a warning of its step, drawn with the others of that step on
 * the next step screen (CORE-39), and on those after it until a step gives warnings of its own, a
 * typed answer is accepted, the warnings end (endWarnings) or a new page starts.
 */
export class PrivateSteps {
  static #heading: (() => void) | undefined;
  static #warn: (warning: string) => void = () => undefined;
  static readonly #startupWarnings = new Set<string>();
  static readonly #context: StepContext[] = [];
  static #begun = false;
  /** The warnings of the last step that gave any, in the order they were given. */
  static readonly #warnings: string[] = [];
  /** Whether a step screen drew #warnings: the next warning is then one of a new step. */
  static #warningsDrawn = false;
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
   * warnings, those of the last step last, in the order they were given, the latest right above
   * the question it explains. Follow-up questions keep a displayed result intact.
   */
  static begin(): boolean {
    if (!PrivateSteps.active || PrivateSteps.#showingResult) return false;
    PrivateSteps.#begun = true;
    PrivateSteps.#heading?.();
    for (const context of PrivateSteps.#context) PrivateSteps.#drawContext(context.draw);
    const warnings = new Set([...PrivateSteps.#startupWarnings, ...PrivateSteps.#warnings]);
    for (const warning of warnings) PrivateSteps.#warn(warning);
    PrivateSteps.#warningsDrawn = PrivateSteps.#warnings.length > 0;
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

  /** Whether a result is shown, which the questions after it are drawn under. */
  static get showingResult(): boolean {
    return PrivateSteps.#showingResult;
  }

  /** A displayed result must remain readable until its owner explicitly opens another page. */
  static showResult(): void {
    if (!PrivateSteps.active) return;
    PrivateSteps.#begun = true;
    PrivateSteps.#showingResult = true;
  }

  /**
   * The result shown was read, and an answer to a question under it, such as "What now?", leads to
   * another step: that step starts a new page (newPage), so that its prompt or search is not drawn
   * under the old result (CORE-39). Without a result shown nothing changes, and the warnings of the
   * question answered carry over to the next step screen.
   */
  static leaveResult(): void {
    if (PrivateSteps.#showingResult) PrivateSteps.newPage();
  }

  /**
   * A new private page ends the result, the warnings of its steps and the contexts of the page. The
   * steps have begun with it: a warning given on the page, before any question, such as why a save
   * failed, is a warning of its step, never a startup warning drawn on every later step screen.
   */
  static newPage(): void {
    PrivateSteps.#begun = true;
    PrivateSteps.#showingResult = false;
    PrivateSteps.endWarnings();
    PrivateSteps.#keepOnly("command");
  }

  /**
   * Retains the warnings given before the first step screen or page, and every warning of the
   * last step that gave any, without a longer history: a warning given after a step screen drew
   * the warnings before it starts the warnings of a new step. A warning drawn as part of a kept
   * context is the context's, and is not retained apart.
   */
  static remember(warning: string): void {
    if (!PrivateSteps.active || PrivateSteps.#drawingContext) return;
    if (!PrivateSteps.#begun) {
      PrivateSteps.#startupWarnings.add(warning);
      return;
    }
    if (PrivateSteps.#warningsDrawn) PrivateSteps.endWarnings();
    if (!PrivateSteps.#warnings.includes(warning)) PrivateSteps.#warnings.push(warning);
  }

  /**
   * The warnings of the last step no longer hold, such as a failed save that another try mended:
   * no later step screen draws them. The startup warnings remain.
   */
  static endWarnings(): void {
    PrivateSteps.#warnings.length = 0;
    PrivateSteps.#warningsDrawn = false;
  }

  /**
   * An accepted typed answer ends its validation warning and the context kept for it, while
   * startup safety warnings remain.
   */
  static answerAccepted(): void {
    PrivateSteps.endWarnings();
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
    PrivateSteps.endWarnings();
    PrivateSteps.#showingResult = false;
    PrivateSteps.#drawingContext = false;
  }
}
