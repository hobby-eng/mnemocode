// The protection of a MnemoCode process that handles secrets, as far as Node.js allows it; the
// counterpart of mhfe's src/bin/mhfe/protect.rs.
//
// - No core dumps. A crash must not write the memory, the seed phrase included, to the disk, as
//   systemd-coredump or apport would. Linux: setrlimit(RLIMIT_CORE, 0) and prctl(PR_SET_DUMPABLE,
//   0); the latter also keeps other programs of the same user from attaching a debugger or
//   reading /proc/PID/mem. macOS: setrlimit. Node.js 26 calls them through its node:ffi module.
//   Windows writes no crash dump unless an administrator set one up; MnemoCode changes nothing
//   there.
// - The Node.js permission model. MnemoCode always runs with PROTECTION_FLAGS: no network, no
//   worker threads, native addons or WASI. Before a command runs, it gives up writing files when
//   it saves nothing, and running other programs when it draws no images (dropUnneeded). Node.js
//   enforces this, not the kernel, and documents it as a safety belt for trusted code rather than
//   a boundary against malicious code; mhfe's kernel isolation (seccomp, Landlock) cannot be
//   applied here, because Node.js has started its own threads before any script runs.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:os";
import { isSea } from "node:sea";
import { type ParsedArguments } from "./arguments.js";
import protectionFlags from "./protection-flags.json" with { type: "json" };

/**
 * The Node.js options MnemoCode always runs with, kept in protection-flags.json so that
 * scripts/build-executable.mjs embeds the same ones in the executable:
 * - --permission, with every file readable: the program's own files and the inputs named;
 * - file writes, other programs and FFI, granted at start and given up as soon as a command does
 *   not need them (hardenProcess, dropUnneeded); no network, worker threads, addons or WASI;
 * - no warnings that node:ffi is experimental in Node.js 26 and that a child process (PERM0002)
 *   and FFI (PERM0003) could bypass the model: both are given up before a secret is asked.
 */
export const PROTECTION_FLAGS: readonly string[] = protectionFlags;

/** Whether this process runs under the permission model, that is with PROTECTION_FLAGS. */
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
    return 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0));
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

/**
 * Switches off core dumps as described at the top, then gives up FFI. Never throws: a failure is
 * kept, and assertProtected refuses a secret afterwards.
 */
export async function hardenProcess(): Promise<void> {
  const library = C_LIBRARY[process.platform];
  try {
    if (library === undefined) return;
    const { dlopen } = await import("node:ffi");
    const limits = dlopen(library, {
      setrlimit: { arguments: ["i32", "buffer"], return: "i32" },
    } as const);
    try {
      if (limits.functions.setrlimit(RLIMIT_CORE, Buffer.alloc(RLIMIT_BYTES)) !== 0)
        throw new Error("setrlimit refused RLIMIT_CORE 0");
    } finally {
      limits.lib.close();
    }
    if (process.platform === "linux") {
      // prctl exists on Linux only, so it is looked up apart from setrlimit.
      const control = dlopen(library, {
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
    coreDumpsOff = true;
  } catch (error) {
    hardeningFailure = error instanceof Error ? error.message : String(error);
  } finally {
    if (underProtection()) process.permission!.drop("ffi");
  }
}

/** Refuses to go on with a secret when core dumps could not be switched off where they exist. */
export function assertProtected(): void {
  if (!underProtection())
    throw new Error("MnemoCode runs without its protection settings; it asks for no secret so.");
  if (C_LIBRARY[process.platform] !== undefined && !coreDumpsOff)
    throw new Error(
      `MnemoCode could not switch off core dumps (${hardeningFailure ?? "unknown reason"}); it asks for no secret without that.`,
    );
}

/** Options that save a file or a folder, and those that draw images with pdftocairo. */
const WRITING_OPTIONS = ["output", "qr", "pdf", "heir-sheet", "cards-dir", "images-dir"] as const;
const DRAWING_OPTIONS = ["images-dir", "image-format"] as const;

/** What a command line needs beyond reading: writing files, and running pdftocairo. */
export function neededPermissions(
  command: string,
  args: ParsedArguments,
): { readonly writes: boolean; readonly runsPrograms: boolean } {
  return {
    // The self-test writes its cards to a temporary folder.
    writes: command === "self-test" || WRITING_OPTIONS.some((key) => args[key] !== undefined),
    runsPrograms: DRAWING_OPTIONS.some((key) => args[key] !== undefined),
  };
}

/** Gives up what `command` does not need (neededPermissions); it cannot be taken back. */
export function dropUnneeded(command: string, args: ParsedArguments): void {
  if (!underProtection()) return;
  const needed = neededPermissions(command, args);
  if (!needed.runsPrograms) process.permission!.drop("child");
  if (!needed.writes) process.permission!.drop("fs.write");
}

/** The start menu writes nothing; it keeps only the right to start a command's own process. */
export function dropForMenu(): void {
  if (underProtection()) process.permission!.drop("fs.write");
}

/** What protects this process now, for the private screen and the self-test. */
export function protectionSummary(): string {
  const parts: string[] = [];
  if (coreDumpsOff) parts.push("no core dumps");
  if (underProtection()) {
    const permission = process.permission!;
    if (!permission.has("net")) parts.push("no network");
    if (!permission.has("child")) parts.push("no other programs");
    if (!permission.has("fs.write")) parts.push("no file writes");
  }
  return parts.join(" · ");
}
