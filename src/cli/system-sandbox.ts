// The protections that the operating system itself enforces for a MnemoCode process, beyond the
// Node.js permission model (protection.ts): on Linux core dumps off, seccomp and Landlock
// (sandbox-linux.ts), on macOS core dumps off, no debugger and its sandbox (sandbox-macos.ts), on
// Windows crash reports without the heap, a job object and process mitigation policies
// (sandbox-windows.ts). Node.js reaches them through node:ffi, which protection.ts gives up once
// they are applied, before any secret is asked.
//
// Each is applied where the system offers it and read back before the summary names it. A system
// without one runs as before, without it (owner, 2026-10-13): nothing is refused for its lack, and
// the self-test says what was not available and why. Core dumps are the one exception: where a
// system can switch them off and that fails, no secret is asked, as before.

import { LinuxSandbox } from "./sandbox-linux.js";
import { MacSandbox } from "./sandbox-macos.js";
import type { CoreDumps, SystemAccess, SystemSandbox } from "./sandbox-record.js";
import { WindowsSandbox } from "./sandbox-windows.js";

export type {
  CoreDumps,
  NodeFfi,
  SandboxNeeds,
  SystemAccess,
  SystemSandbox,
} from "./sandbox-record.js";

/** Where MnemoCode knows no sandbox: nothing is enforced beyond the permission model. */
class NoSandbox implements SystemSandbox {
  readonly #reason: string;

  constructor(reason: string) {
    this.#reason = reason;
  }

  start(): void {}

  restrict(): void {}

  held(): readonly string[] {
    return [];
  }

  missing(): readonly string[] {
    return [this.#reason];
  }

  coreDumps(): CoreDumps {
    return { state: "untouched" };
  }
}

/**
 * The sandbox of the system this process runs on, which calls it through node:ffi, or which says
 * why it cannot (SystemAccess).
 */
export function systemSandbox(access: SystemAccess): SystemSandbox {
  if (process.platform === "linux") return new LinuxSandbox(access);
  if (process.platform === "darwin") return new MacSandbox(access);
  if (process.platform === "win32") return new WindowsSandbox(access);
  return new NoSandbox(`MnemoCode knows no sandbox of ${process.platform}`);
}
