// What every system's sandbox is made of (system-sandbox.ts): the interface that protection.ts
// calls, what a command needs, and the record of what a sandbox enforced and why it did not,
// which each platform's module keeps through it. No module of a platform is imported here, so that
// each imports this alone.

import { describeError } from "../core/refusal.js";

/** The node:ffi module, which every sandbox calls the system through. */
export type NodeFfi = typeof import("node:ffi");

/**
 * How a sandbox reaches the system: node:ffi, or why it cannot, such as a caller's permission
 * model without --allow-ffi. A sandbox without it enforces nothing and says why.
 */
export type SystemAccess = NodeFfi | string;

/** What a command needs that a sandbox would forbid (protection.ts, neededPermissions). */
export interface SandboxNeeds {
  readonly writes: boolean;
  readonly runsPrograms: boolean;
}

/**
 * What a sandbox did with core dumps: switched them off and read them back, failed to, or left
 * them, as on Windows, which writes none unless an administrator set it up.
 */
export interface CoreDumps {
  readonly state: "off" | "failed" | "untouched";
  /** Why they are not off, where they failed. */
  readonly reason?: string;
}

/** The protections of one operating system. */
export interface SystemSandbox {
  /** Applies what does not depend on the command, at start: core dumps off first. */
  start(): void;
  /** Applies for good what a command does not need, once its needs are known. */
  restrict(needs: SandboxNeeds): void;
  /** What holds, read back, as the summary of the protection names it. */
  held(): readonly string[];
  /** What this system did not enforce for this run, and why, as the self-test names it. */
  missing(): readonly string[];
  /**
   * Core dumps, where the system can switch them off: no secret is asked while they failed
   * (protection.ts, assertProtected).
   */
  coreDumps(): CoreDumps;
}

/** What a probe of one boundary found: it holds, a probe got through, or it could not tell. */
export type Found = "holds" | "broken" | "unknown";

/**
 * What a sandbox enforced, read back, and what it did not, and why: a boundary that the system
 * did not give, one that a probe got through, or a step that threw, such as a call to a function
 * that an older system lacks.
 */
export class SandboxRecord {
  readonly #held: string[] = [];
  readonly #reasons: string[] = [];

  /** Records `boundary` as holding. */
  hold(boundary: string): void {
    this.#held.push(boundary);
  }

  /** Records why a boundary is not enforced. */
  lack(reason: string): void {
    this.#reasons.push(reason);
  }

  /** Runs `step`; what it throws is recorded as why `what` is not enforced. */
  attempt(what: string, step: () => void): void {
    try {
      step();
    } catch (error) {
      this.lack(`${what}: ${describeError(error)}`);
    }
  }

  /**
   * What `open` gives through `access`, such as a library's functions; undefined, with the reason
   * recorded under `what`, where node:ffi or the library cannot be had.
   */
  reach<T>(what: string, access: SystemAccess, open: (ffi: NodeFfi) => T): T | undefined {
    if (typeof access === "string") {
      this.lack(`${what}: ${access}`);
      return undefined;
    }
    let reached: T | undefined;
    this.attempt(what, () => {
      reached = open(access);
    });
    return reached;
  }

  /** Core dumps before a start switches them off: failed, for the first reason recorded. */
  coreDumpsNotOff(): CoreDumps {
    return Object.freeze({ state: "failed", reason: this.#reasons[0] ?? "not switched off yet" });
  }

  /**
   * Records `boundary` as holding when its probe `found` so; otherwise why not: what got through
   * (`broken`), or that no probe could tell.
   */
  claim(boundary: string, found: Found, broken: string): void {
    if (found === "holds") this.hold(boundary);
    else if (found === "broken") this.lack(`${boundary} did not hold: ${broken}`);
    else this.lack(`${boundary} could not be checked`);
  }

  get held(): readonly string[] {
    return [...this.#held];
  }

  get reasons(): readonly string[] {
    return [...this.#reasons];
  }
}

/** RLIMIT_CORE, 4 on Linux and macOS (sys/resource.h), which both switch off with setrlimit. */
export const RLIMIT_CORE = 4;
/** A struct rlimit with both limits 0: the soft and the hard limit, two 64-bit values. */
export function noLimit(): Buffer {
  return Buffer.alloc(16);
}

/** Core dumps switched off by `step`, which throws why it cannot; their state for coreDumps(). */
export function switchOffCoreDumps(step: () => void): CoreDumps {
  try {
    step();
    return Object.freeze({ state: "off" });
  } catch (error) {
    return Object.freeze({ state: "failed", reason: describeError(error) });
  }
}
