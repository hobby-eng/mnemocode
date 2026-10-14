// The executable builder's refusal codes, without any build or filesystem operation at import.
import { ErrorCatalog } from "../src/core/error-catalog.ts";

/** Stable codes and the existing messages of the executable builder. */
export const ERRORS = new ErrorCatalog("scripts.build-executable", {
  /**
   * @param {string} expected
   * @param {string} actual
   */
  "build-node-js-from-node-version-not": (expected, actual) =>
    `Build with Node.js ${expected} from .node-version, not ${actual}.`,
  /**
   * @param {string} staging
   */
  "publication-and-rollback-failed": (staging) =>
    `Publication and rollback failed; backups remain in ${staging}.`,
});

/** Keeps all publication and rollback failures, with the module's immutable refusal code. */
export class PublicationRollbackError extends AggregateError {
  /** @readonly */
  code;

  constructor(failures, staging) {
    const refusal = ERRORS.create("publication-and-rollback-failed", [staging]);
    super(failures, refusal.message);
    this.code = refusal.code;
    Object.defineProperty(this, "code", { writable: false, configurable: false });
  }
}
