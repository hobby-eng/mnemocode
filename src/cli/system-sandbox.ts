// The protections that the operating system itself enforces for a MnemoCode process, beyond the
// Node.js permission model (protection.ts): on Linux seccomp, Landlock and locked memory
// (sandbox-linux.ts), on macOS its sandbox (sandbox-macos.ts), on Windows a job object and process
// mitigation policies (sandbox-windows.ts). Node.js reaches them through node:ffi, which
// protection.ts gives up once they are applied, before any secret is asked.
//
// Each is applied where the system offers it and read back before the summary names it. A system
// without one runs as before, without it (owner, 2026-10-13): nothing is refused for its lack, and
// the self-test says what was not available and why.

import { describeError } from "../core/refusal.js";
import { LinuxSandbox } from "./sandbox-linux.js";
import { MacSandbox } from "./sandbox-macos.js";
import { WindowsSandbox } from "./sandbox-windows.js";

/** The node:ffi module, which every sandbox calls the system through. */
export type NodeFfi = typeof import("node:ffi");

/** What a command needs that a sandbox would forbid (protection.ts, neededPermissions). */
export interface SandboxNeeds {
  readonly writes: boolean;
  readonly runsPrograms: boolean;
}

/** The protections of one operating system. */
export interface SystemSandbox {
  /** Applies what does not depend on the command, at start. */
  start(): void;
  /** Applies for good what a command does not need, once its needs are known. */
  restrict(needs: SandboxNeeds): void;
  /** What holds, read back, as the summary of the protection names it. */
  held(): readonly string[];
  /** What this system did not enforce for this run, and why, as the self-test names it. */
  missing(): readonly string[];
  /** Whether all the memory of the process is locked, so that swap holds none of it. */
  keepsMemoryFromSwap(): boolean;
}

/**
 * What a sandbox did not enforce, and why, kept as each platform's sandbox reports it: a boundary
 * that the system did not give, or a step that threw, such as a call to a function that an older
 * system lacks.
 */
export class SandboxGaps {
  readonly #reasons: string[] = [];

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

  get reasons(): readonly string[] {
    return [...this.#reasons];
  }
}

/** Where neither the system nor this program offers anything beyond the permission model. */
class NoSandbox implements SystemSandbox {
  constructor(private readonly reason: string) {}

  start(): void {}

  restrict(): void {}

  held(): readonly string[] {
    return [];
  }

  missing(): readonly string[] {
    return [this.reason];
  }

  keepsMemoryFromSwap(): boolean {
    return false;
  }
}

/** The sandbox of the system this process runs on, which calls it through `ffi`. */
export function systemSandbox(ffi: NodeFfi): SystemSandbox {
  if (process.platform === "linux") return new LinuxSandbox(ffi);
  if (process.platform === "darwin") return new MacSandbox(ffi);
  if (process.platform === "win32") return new WindowsSandbox(ffi);
  return new NoSandbox(`MnemoCode knows no sandbox of ${process.platform}`);
}

/** The sandbox where node:ffi could not be had: nothing is enforced, for `reason`. */
export function noSandbox(reason: string): SystemSandbox {
  return new NoSandbox(reason);
}
