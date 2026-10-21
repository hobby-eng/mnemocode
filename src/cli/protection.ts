// The protection of a MnemoCode process that handles secrets, as far as the system allows it; the
// counterpart of mhfe's src/bin/mhfe/protect.rs.
//
// - The system's own protections (system-sandbox.ts): no core dumps on Linux and macOS, so that a
//   crash cannot write the memory, the seed phrase included, to the disk, and no secret without
//   that; then, as the system offers them, seccomp and Landlock for every thread on Linux, as mhfe
//   isolates itself, no debugger and the sandbox on macOS, a job object and mitigation policies on
//   Windows. They are applied with the same needs as the permission model, while node:ffi is
//   still granted, and FFI is given up right after them, before anything is read. What a system
//   lacks is left out, without a refusal (owner, 2026-10-13).
// - The Node.js permission model. A start outside it runs again with PROTECTION_FLAGS, which the
//   executable has built in: no network, no worker threads, native addons or WASI. A process
//   that already runs under the model is not started again, so a right that its caller granted
//   on purpose, such as --allow-net, stays. Before a command runs, it gives up writing files when
//   it saves nothing, and running other programs when it draws no images
//   (ProcessProtection.dropUnneeded). Node.js enforces this itself, and documents it as a safety
//   belt for trusted code rather than a trust boundary against malicious code.
// - The library uses none of this: it has the rights of the program that imports it.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { exitCodeOfSignal } from "./exit-codes.js";
import { isSea } from "node:sea";
import { type ParsedArguments } from "./arguments.js";
import { DRAWING_OPTIONS, SAVED_OPTIONS } from "./output-options.js";
import protectionFlags from "./protection-flags.json" with { type: "json" };
import { describeError } from "../core/refusal.js";
import {
  systemSandbox,
  type SandboxNeeds,
  type SystemAccess,
  type SystemSandbox,
} from "./system-sandbox.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.protection", {
  "executable-was-built-without-protection-settings": () =>
    "This executable was built without its protection settings.",
  "mnemo-code-could-not-find-own-program-file": () =>
    "MnemoCode could not find its own program file.",
  "mnemo-code-runs-without-protection-settings-asks-no": () =>
    "MnemoCode runs without its protection settings; it asks for no secret so.",
  "mnemo-code-could-not-switch-off-core-dumps": (value0: string) =>
    `MnemoCode could not switch off core dumps (${value0}); it asks for no secret without that.`,
  "mnemo-code-could-still-call-native-code-asks": () =>
    "MnemoCode could still call native code; it asks for no secret so.",
});

/**
 * The Node.js options that a start outside the permission model runs again with
 * (relaunchProtected), kept in protection-flags.json so that scripts/build-executable.mjs embeds
 * the same ones in the executable. A process that its caller started under the model is not run
 * with them: a right that the caller granted, such as --allow-net, stays, unless a command gives it
 * up as below. The options:
 * - --permission, with every file readable: the program's own files and the inputs named;
 * - file writes, other programs and FFI, granted at start and given up as soon as a command does
 *   not need them, FFI once the system's sandbox is applied (ProcessProtection.dropUnneeded); no
 *   network, worker threads, addons or WASI;
 * - no warnings that node:ffi is experimental in Node.js 26 and that a child process (PERM0002)
 *   and FFI (PERM0003) could bypass the model: both are given up before a secret is asked.
 */
export const PROTECTION_FLAGS: readonly string[] = protectionFlags;

/**
 * Whether this process runs under the permission model: with PROTECTION_FLAGS, or with the options
 * of a caller that started it under the model, such as `node --permission --allow-fs-read=*
 * --allow-net dist/mnemocode.js`. Such a process is not started again with PROTECTION_FLAGS.
 */
export function underProtection(): boolean {
  return process.permission !== undefined;
}

/** The exit code that a child process ended with, as a shell would report it. */
async function exitCodeOf(child: ReturnType<typeof spawn>): Promise<number> {
  // Ctrl+C reaches every process at the terminal; the child decides what it means.
  const ignore = (): void => undefined;
  process.on("SIGINT", ignore);
  try {
    // Node.js sets exitCode and signalCode before it emits "exit"; once rejects on "error".
    await once(child, "exit");
    if (child.exitCode !== null) return child.exitCode;
    return exitCodeOfSignal(child.signalCode);
  } finally {
    process.off("SIGINT", ignore);
  }
}

/**
 * Starts this program again with PROTECTION_FLAGS and the same arguments, and returns its exit
 * code: `node dist/mnemocode.js` and the npm command start without them. The executable has them
 * built in, so for it this is an error.
 */
export async function relaunchProtected(argv: readonly string[]): Promise<number> {
  if (isSea()) throw ERRORS.create("executable-was-built-without-protection-settings", []);
  const script = process.argv[1];
  if (script === undefined) throw ERRORS.create("mnemo-code-could-not-find-own-program-file", []);
  const child = spawn(
    process.execPath,
    [...PROTECTION_FLAGS, ...process.execArgv, script, ...argv],
    {
      stdio: "inherit",
    },
  );
  return exitCodeOf(child);
}

/**
 * Runs one command line in a process of its own, as the start menu does for each entry: what that
 * command gives up (ProcessProtection.dropUnneeded) then binds it alone, not the menu and the
 * commands after it.
 */
export async function runInOwnProcess(run: readonly string[]): Promise<number> {
  const script = process.argv[1];
  // The executable carries its options; a script names them again, with itself.
  const args = isSea() ? [...run] : [...process.execArgv, defined(script), ...run];
  return exitCodeOf(spawn(process.execPath, args, { stdio: "inherit" }));
}

/**
 * What a command line needs beyond reading: writing files, which a command that `alwaysWrites`
 * does whatever its options say (the self-test, to a temporary folder), and running pdftocairo.
 */
export function neededPermissions(alwaysWrites: boolean, args: ParsedArguments): SandboxNeeds {
  return {
    writes: alwaysWrites || SAVED_OPTIONS.some((key) => args[key] !== undefined),
    runsPrograms: DRAWING_OPTIONS.some((key) => args[key] !== undefined),
  };
}

/**
 * The protection of this process for its whole run: the system's sandbox, started with the process
 * (harden) and restricted with the command (dropUnneeded), FFI given up right after it, and the
 * rights of the permission model that the command does not need. One for each process, which its
 * start menu or its command asks. A class, because it owns the sandbox in force and the order of
 * its steps: before harden, core dumps count as not switched off, and no secret is asked for
 * (assert) until FFI is given up.
 */
export class ProcessProtection {
  /** The system's sandbox in force: none started until harden. */
  static #sandbox: SystemSandbox = systemSandbox("the process was not hardened");

  /**
   * Starts the system's sandbox, which switches off core dumps first (system-sandbox.ts); node:ffi
   * stays granted until the command's needs restrict the sandbox (dropUnneeded). Never throws: a
   * failure is kept, and assert refuses a secret afterwards.
   */
  static async harden(): Promise<void> {
    let access: SystemAccess;
    try {
      access = await import("node:ffi");
    } catch (error) {
      access = `node:ffi is not available (${describeError(error)})`;
    }
    ProcessProtection.#sandbox = systemSandbox(access);
    ProcessProtection.#sandbox.start();
  }

  /**
   * Refuses to go on with a secret outside the permission model
   * (cli.protection.mnemo-code-runs-without-protection-settings-asks-no), when core dumps could not
   * be switched off where the system can (cli.protection.mnemo-code-could-not-switch-off-core-dumps),
   * or while native code could still be called (FFI, which dropUnneeded gives up;
   * cli.protection.mnemo-code-could-still-call-native-code-asks).
   */
  static assert(): void {
    if (!underProtection())
      throw ERRORS.create("mnemo-code-runs-without-protection-settings-asks-no", []);
    const dumps = ProcessProtection.#sandbox.coreDumps();
    if (dumps.state === "failed")
      throw ERRORS.create("mnemo-code-could-not-switch-off-core-dumps", [
        `${dumps.reason ?? "unknown reason"}`,
      ]);
    if (defined(process.permission).has("ffi"))
      throw ERRORS.create("mnemo-code-could-still-call-native-code-asks", []);
  }

  /**
   * Gives up what a command does not need (neededPermissions), with the system's sandbox while FFI
   * is still granted, then FFI; none of it can be taken back. A command that `asksOutputs` on its
   * private screen, as re-encode asks its new backup, keeps what any of them may need: the
   * permission model gives up the rest once they are answered (dropUnneededAfterAnswers).
   */
  static dropUnneeded(alwaysWrites: boolean, args: ParsedArguments, asksOutputs = false): void {
    if (!underProtection()) return;
    const needed = asksOutputs
      ? { writes: true, runsPrograms: true }
      : neededPermissions(alwaysWrites, args);
    // The sandbox reaches the system through FFI: FFI goes only once the sandbox is restricted.
    ProcessProtection.#sandbox.restrict(needed);
    defined(process.permission).drop("ffi");
    ProcessProtection.#dropPermissions(needed);
  }

  /**
   * Gives up, with the permission model alone, what the outputs that a command asked for on its
   * private screen do not need (dropUnneeded with `asksOutputs`): the system's sandbox was applied
   * before the secret was read, and cannot be narrowed without FFI.
   */
  static dropUnneededAfterAnswers(args: ParsedArguments): void {
    if (!underProtection()) return;
    ProcessProtection.#dropPermissions(neededPermissions(false, args));
  }

  /**
   * The start menu writes nothing; it keeps only the right to start a command's own process. It
   * handles no secret, and leaves the system's sandbox to each command, which applies its own: a
   * command would inherit a sandbox of the menu, which on macOS it might not be able to tighten.
   */
  static dropForMenu(): void {
    if (!underProtection()) return;
    defined(process.permission).drop("ffi");
    defined(process.permission).drop("fs.write");
  }

  /** What protects this process now, for the private screen: all of it. */
  static summary(): string {
    return [...ProcessProtection.#permissionParts(), ...ProcessProtection.#sandbox.held()].join(
      " · ",
    );
  }

  /** The protection apart from the system's sandbox, for its row of the self-test. */
  static permissionSummary(): string {
    return ProcessProtection.#permissionParts().join(" · ");
  }

  /** What the system's sandbox enforces for this run, and what it could not, for the self-test. */
  static sandboxReport(): string {
    const held = ProcessProtection.#sandbox.held();
    const missing = ProcessProtection.#sandbox.missing();
    const parts = [held.length > 0 ? held.join(" · ") : "nothing beyond the permission model"];
    if (missing.length > 0) parts.push(`not available: ${missing.join("; ")}`);
    return parts.join("; ");
  }

  /** Gives up the rights of the permission model that `needed` does not name. */
  static #dropPermissions(needed: SandboxNeeds): void {
    if (!needed.runsPrograms) defined(process.permission).drop("child");
    if (!needed.writes) defined(process.permission).drop("fs.write");
  }

  /** No core dumps, and what the permission model refuses. */
  static #permissionParts(): string[] {
    const parts: string[] = [];
    if (ProcessProtection.#sandbox.coreDumps().state === "off") parts.push("no core dumps");
    if (underProtection()) {
      const permission = defined(process.permission);
      if (!permission.has("net")) parts.push("no network");
      if (!permission.has("child")) parts.push("no other programs");
      if (!permission.has("fs.write")) parts.push("no file writes");
    }
    return parts;
  }
}
