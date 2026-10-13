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
//   it saves nothing, and running other programs when it draws no images (dropUnneeded). Node.js
//   enforces this itself, and documents it as a safety belt for trusted code rather than a boundary
//   against malicious code.
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

/**
 * The Node.js options that a start outside the permission model runs again with
 * (relaunchProtected), kept in protection-flags.json so that scripts/build-executable.mjs embeds
 * the same ones in the executable. A process that its caller started under the model is not run
 * with them: a right that the caller granted, such as --allow-net, stays, unless a command gives it
 * up as below. The options:
 * - --permission, with every file readable: the program's own files and the inputs named;
 * - file writes, other programs and FFI, granted at start and given up as soon as a command does
 *   not need them, FFI once the system's sandbox is applied (dropUnneeded); no network, worker
 *   threads, addons or WASI;
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
    const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
    if (code !== null) return code;
    return exitCodeOfSignal(signal);
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
  if (isSea()) throw new Error("This executable was built without its protection settings.");
  const script = process.argv[1];
  if (script === undefined) throw new Error("MnemoCode could not find its own program file.");
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
 * command gives up (dropUnneeded) then binds it alone, not the menu and the commands after it.
 */
export async function runInOwnProcess(run: readonly string[]): Promise<number> {
  const script = process.argv[1];
  // The executable carries its options; a script names them again, with itself.
  const args = isSea() ? [...run] : [...process.execArgv, script!, ...run];
  return exitCodeOf(spawn(process.execPath, args, { stdio: "inherit" }));
}

/**
 * The system's sandbox: started with the process (hardenProcess), restricted with the command
 * (dropUnneeded). Before it starts, core dumps count as not switched off.
 */
let sandbox: SystemSandbox = systemSandbox("the process was not hardened");

/**
 * Starts the system's sandbox, which switches off core dumps first (system-sandbox.ts); node:ffi
 * stays granted until the command's needs restrict the sandbox (dropUnneeded). Never throws: a
 * failure is kept, and assertProtected refuses a secret afterwards.
 */
export async function hardenProcess(): Promise<void> {
  let access: SystemAccess;
  try {
    access = await import("node:ffi");
  } catch (error) {
    access = `node:ffi is not available (${describeError(error)})`;
  }
  sandbox = systemSandbox(access);
  sandbox.start();
}

/**
 * Refuses to go on with a secret when core dumps could not be switched off where the system can,
 * or while native code could still be called (FFI, which dropUnneeded gives up).
 */
export function assertProtected(): void {
  if (!underProtection())
    throw new Error("MnemoCode runs without its protection settings; it asks for no secret so.");
  const dumps = sandbox.coreDumps();
  if (dumps.state === "failed")
    throw new Error(
      `MnemoCode could not switch off core dumps (${dumps.reason ?? "unknown reason"}); it asks for no secret without that.`,
    );
  if (process.permission!.has("ffi"))
    throw new Error("MnemoCode could still call native code; it asks for no secret so.");
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
 * Gives up what a command does not need (neededPermissions), with the system's sandbox while FFI
 * is still granted, then FFI; none of it can be taken back.
 */
export function dropUnneeded(alwaysWrites: boolean, args: ParsedArguments): void {
  if (!underProtection()) return;
  const needed = neededPermissions(alwaysWrites, args);
  restrictThenDropFfi(needed);
  if (!needed.runsPrograms) process.permission!.drop("child");
  if (!needed.writes) process.permission!.drop("fs.write");
}

/**
 * The start menu writes nothing; it keeps only the right to start a command's own process. It
 * handles no secret, and leaves the system's sandbox to each command, which applies its own: a
 * command would inherit a sandbox of the menu, which on macOS it might not be able to tighten.
 */
export function dropForMenu(): void {
  if (!underProtection()) return;
  process.permission!.drop("ffi");
  process.permission!.drop("fs.write");
}

function restrictThenDropFfi(needs: SandboxNeeds): void {
  sandbox.restrict(needs);
  process.permission!.drop("ffi");
}

/** What protects this process now, for the private screen: all of it. */
export function protectionSummary(): string {
  return [...permissionParts(), ...sandbox.held()].join(" · ");
}

/** The protection apart from the system's sandbox, for its row of the self-test. */
export function permissionSummary(): string {
  return permissionParts().join(" · ");
}

/** No core dumps, and what the permission model refuses. */
function permissionParts(): string[] {
  const parts: string[] = [];
  if (sandbox.coreDumps().state === "off") parts.push("no core dumps");
  if (underProtection()) {
    const permission = process.permission!;
    if (!permission.has("net")) parts.push("no network");
    if (!permission.has("child")) parts.push("no other programs");
    if (!permission.has("fs.write")) parts.push("no file writes");
  }
  return parts;
}

/** What the system's sandbox enforces for this run, and what it could not, for the self-test. */
export function sandboxReport(): string {
  const held = sandbox.held();
  const missing = sandbox.missing();
  const parts = [held.length > 0 ? held.join(" · ") : "nothing beyond the permission model"];
  if (missing.length > 0) parts.push(`not available: ${missing.join("; ")}`);
  return parts.join("; ");
}

/** Whether the memory of this process is locked, so that swap cannot hold any of it. */
export function memoryKeptFromSwap(): boolean {
  return sandbox.keepsMemoryFromSwap();
}
