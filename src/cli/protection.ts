// The protection of a MnemoCode process that handles secrets, as far as Node.js allows it; the
// counterpart of mhfe's src/bin/mhfe/protect.rs.
//
// - No core dumps. A crash must not write the memory, the seed phrase included, to the disk, as
//   systemd-coredump or apport would. Linux: setrlimit(RLIMIT_CORE, 0) and prctl(PR_SET_DUMPABLE,
//   0); the latter also keeps other programs of the same user from attaching a debugger or
//   reading /proc/PID/mem. macOS: setrlimit. Node.js 26 calls them through its node:ffi module.
//   Windows writes no crash dump unless an administrator set one up; MnemoCode changes nothing
//   there.
// - The Node.js permission model. A start outside it runs again with PROTECTION_FLAGS, which the
//   executable has built in: no network, no worker threads, native addons or WASI. A process
//   that already runs under the model is not started again, so a right that its caller granted
//   on purpose, such as --allow-net, stays. Before a command runs, it gives up writing files when
//   it saves nothing, and running other programs when it draws no images (dropUnneeded). Node.js
//   enforces this, not the kernel, and documents it as a safety belt for trusted code rather than
//   a boundary against malicious code.
// - The system's own sandbox (system-sandbox.ts): on Linux seccomp and Landlock for every thread,
//   as mhfe isolates itself, on macOS its sandbox, on Windows a job object and mitigation policies.
//   It is applied with the same needs as the permission model, while node:ffi is still granted,
//   and FFI is given up right after it, before anything is read. What a system lacks is left out,
//   without a refusal (owner, 2026-10-13).
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
  noSandbox,
  systemSandbox,
  type NodeFfi,
  type SandboxNeeds,
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

/** RLIMIT_CORE is 4 on Linux and macOS (sys/resource.h); PR_SET_DUMPABLE is 4 (linux/prctl.h). */
const RLIMIT_CORE = 4;
const PR_GET_DUMPABLE = 3;
const PR_SET_DUMPABLE = 4;
/** struct rlimit: the soft and the hard limit, two 64-bit values, both 0 here. */
const RLIMIT_BYTES = 16;

/** The C library that holds setrlimit and prctl. */
const C_LIBRARY: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  linux: "libc.so.6",
  darwin: "/usr/lib/libSystem.B.dylib",
};

let coreDumpsOff = false;
let hardeningFailure: string | undefined;
/** The system's sandbox: started with the process, restricted with the command (dropUnneeded). */
let sandbox: SystemSandbox = noSandbox("the process was not hardened");

/**
 * Switches off core dumps as described at the top and starts the system's sandbox; node:ffi stays
 * granted until the command's needs restrict the sandbox (dropUnneeded, dropForMenu). Never
 * throws: a failure is kept, and assertProtected refuses a secret afterwards.
 */
export async function hardenProcess(): Promise<void> {
  let ffi: NodeFfi;
  try {
    ffi = await import("node:ffi");
  } catch (error) {
    hardeningFailure = describeError(error);
    sandbox = noSandbox(`node:ffi is not available (${hardeningFailure})`);
    return;
  }
  const library = C_LIBRARY[process.platform];
  try {
    if (library !== undefined) {
      switchOffCoreDumps(ffi, library);
      coreDumpsOff = true;
    }
  } catch (error) {
    hardeningFailure = describeError(error);
  }
  sandbox = systemSandbox(ffi);
  sandbox.start();
}

/** setrlimit(RLIMIT_CORE, 0) and, on Linux, prctl(PR_SET_DUMPABLE, 0), each read back. */
function switchOffCoreDumps(ffi: NodeFfi, library: string): void {
  const limits = ffi.dlopen(library, {
    setrlimit: { arguments: ["i32", "buffer"], return: "i32" },
  } as const);
  try {
    if (limits.functions.setrlimit(RLIMIT_CORE, Buffer.alloc(RLIMIT_BYTES)) !== 0)
      throw new Error("setrlimit refused RLIMIT_CORE 0");
  } finally {
    limits.lib.close();
  }
  if (process.platform !== "linux") return;
  // prctl exists on Linux only, so it is looked up apart from setrlimit.
  const control = ffi.dlopen(library, {
    prctl: { arguments: ["i32", "u64", "u64", "u64", "u64"], return: "i32" },
  } as const);
  try {
    const { prctl } = control.functions;
    if (prctl(PR_SET_DUMPABLE, 0n, 0n, 0n, 0n) !== 0) throw new Error("prctl refused");
    if (prctl(PR_GET_DUMPABLE, 0n, 0n, 0n, 0n) !== 0)
      throw new Error("the process is still dumpable");
  } finally {
    control.lib.close();
  }
}

/**
 * Refuses to go on with a secret when core dumps could not be switched off where they exist, or
 * while native code could still be called (FFI, which dropUnneeded gives up).
 */
export function assertProtected(): void {
  if (!underProtection())
    throw new Error("MnemoCode runs without its protection settings; it asks for no secret so.");
  if (C_LIBRARY[process.platform] !== undefined && !coreDumpsOff)
    throw new Error(
      `MnemoCode could not switch off core dumps (${hardeningFailure ?? "unknown reason"}); it asks for no secret without that.`,
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
 * The start menu writes nothing; it keeps only the right to start a command's own process. Its
 * sandbox keeps what a command may need, since each command inherits it and restricts itself.
 */
export function dropForMenu(): void {
  if (!underProtection()) return;
  restrictThenDropFfi({ writes: true, runsPrograms: true });
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
  if (coreDumpsOff) parts.push("no core dumps");
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
