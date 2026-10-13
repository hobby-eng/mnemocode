// The protections that macOS gives a MnemoCode process, beside the core dumps that protection.ts
// switches off:
//
// - no debugger attaches: ptrace(PT_DENY_ATTACH), at start, as other programs of the same user
//   could otherwise read the memory, the seed phrase included. A process that a debugger already
//   traces ends at this call, as macOS documents.
// - its sandbox (Seatbelt, sandbox_init with a profile) refuses the network and, where the command
//   starts no program, starting one. The profile allows everything else, so that Node.js runs as
//   before; the permission model alone refuses file writes, since a profile that refused them
//   could also refuse output to the terminal and to files already open, which was not tested.
//
// The sandbox is read back by probes that try what it forbids: a UDP socket connected to the
// loopback address, which sends nothing, and /usr/bin/true started, which does nothing. A refusal
// of the call to deny attaching is all macOS tells of it: no call reads it back.

import {
  SandboxGaps,
  type NodeFfi,
  type SandboxNeeds,
  type SystemSandbox,
} from "./system-sandbox.js";

const LIBSYSTEM = "/usr/lib/libSystem.B.dylib";

/** ptrace's request that denies every later attach (sys/ptrace.h). */
const PT_DENY_ATTACH = 31;
/** EPERM and EACCES (sys/errno.h): what the sandbox gives a refused call. */
const REFUSALS: ReadonlySet<number> = new Set([1, 13]);

const AF_INET = 2;
const SOCK_DGRAM = 2;
/** struct sockaddr_in of macOS: length, family, port and address in network order, padding. */
const SOCKADDR_IN_BYTES = 16;
/** The discard port on the loopback address; a UDP connect sends nothing to it. */
const DISCARD_PORT = 9;
const LOOPBACK = 0x7f00_0001;
/** A program that does nothing, which every macOS has. */
const NOTHING_PROGRAM = "/usr/bin/true";

const LIBSYSTEM_FUNCTIONS = {
  ptrace: { arguments: ["i32", "i32", "pointer", "i32"], return: "i32" },
  sandbox_init: { arguments: ["string", "u64", "buffer"], return: "i32" },
  sandbox_free_error: { arguments: ["pointer"], return: "void" },
  socket: { arguments: ["i32", "i32", "i32"], return: "i32" },
  connect: { arguments: ["i32", "buffer", "u32"], return: "i32" },
  close: { arguments: ["i32"], return: "i32" },
  posix_spawn: {
    arguments: ["buffer", "string", "pointer", "pointer", "buffer", "buffer"],
    return: "i32",
  },
  waitpid: { arguments: ["i32", "buffer", "i32"], return: "i32" },
  __error: { arguments: [], return: "pointer" },
} as const;

/**
 * The sandbox profile for a command with `needs`, in Seatbelt's language: everything allowed but
 * the network and, for a command that starts no program, starting one.
 */
export function macSandboxProfile(needs: SandboxNeeds): string {
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    ...(needs.runsPrograms ? [] : ["(deny process-exec*)"]),
  ].join("\n");
}

/** What a probe of one boundary found. */
type Found = "holds" | "broken" | "unknown";

/** macOS's protections, as described at the top. */
export class MacSandbox implements SystemSandbox {
  readonly #gaps = new SandboxGaps();
  readonly #ffi: NodeFfi;
  #system: ReturnType<typeof loadSystem> | undefined;
  #attachDenied = false;
  /** The boundaries that the sandbox enforces and a probe confirmed. */
  readonly #sandbox: string[] = [];

  constructor(ffi: NodeFfi) {
    this.#ffi = ffi;
    this.#gaps.attempt("the system library", () => {
      this.#system = loadSystem(ffi);
    });
  }

  start(): void {
    const system = this.#system;
    if (system === undefined) return;
    this.#gaps.attempt("debugger attach", () => {
      if (system.ptrace(PT_DENY_ATTACH, 0, null, 0) !== 0) throw new Error("not refused");
      this.#attachDenied = true;
    });
  }

  restrict(needs: SandboxNeeds): void {
    const system = this.#system;
    if (system === undefined) return;
    this.#gaps.attempt("sandbox", () => {
      const error = Buffer.alloc(8);
      if (system.sandbox_init(macSandboxProfile(needs), 0n, error) !== 0) {
        const message = error.readBigUInt64LE(0);
        const text = message === 0n ? "unknown reason" : this.#ffi.toString(message);
        if (message !== 0n) system.sandbox_free_error(message);
        throw new Error(`refused (${text ?? "unknown reason"})`);
      }
      this.#claim("no network", this.#network(system), "a connection was not refused");
      if (!needs.runsPrograms)
        this.#claim("no other programs", this.#programs(system), "a program started");
    });
    if (!needs.writes) this.#gaps.lack("file writes are refused by the permission model only");
  }

  held(): readonly string[] {
    return [
      ...(this.#attachDenied ? ["no debugger attach"] : []),
      ...(this.#sandbox.length > 0 ? [`sandbox: ${this.#sandbox.join(", ")}`] : []),
    ];
  }

  missing(): readonly string[] {
    return this.#gaps.reasons;
  }

  /** The memory is not locked here: swap may hold some of it. */
  keepsMemoryFromSwap(): boolean {
    return false;
  }

  /** errno of the call just made. */
  #errno(system: ReturnType<typeof loadSystem>): number {
    return this.#ffi.getInt32(system.__error(), 0);
  }

  /** A UDP socket connected to the loopback address, which sends nothing: refused. */
  #network(system: ReturnType<typeof loadSystem>): Found {
    const socket = system.socket(AF_INET, SOCK_DGRAM, 0);
    if (socket < 0) return REFUSALS.has(this.#errno(system)) ? "holds" : "unknown";
    try {
      const address = Buffer.alloc(SOCKADDR_IN_BYTES);
      address.writeUInt8(SOCKADDR_IN_BYTES, 0);
      address.writeUInt8(AF_INET, 1);
      address.writeUInt16BE(DISCARD_PORT, 2);
      address.writeUInt32BE(LOOPBACK, 4);
      if (system.connect(socket, address, SOCKADDR_IN_BYTES) === 0) return "broken";
      return REFUSALS.has(this.#errno(system)) ? "holds" : "unknown";
    } finally {
      system.close(socket);
    }
  }

  /** /usr/bin/true started: refused; a start that the sandbox let through is waited for. */
  #programs(system: ReturnType<typeof loadSystem>): Found {
    const name = Buffer.from(`${NOTHING_PROGRAM}\0`);
    // argv: the program's name, then a NULL pointer; envp: a NULL pointer alone.
    const argv = Buffer.alloc(16);
    argv.writeBigUInt64LE(this.#ffi.getRawPointer(name), 0);
    const envp = Buffer.alloc(8);
    const child = Buffer.alloc(4);
    const result = system.posix_spawn(child, NOTHING_PROGRAM, null, null, argv, envp);
    if (result === 0) {
      system.waitpid(child.readInt32LE(0), Buffer.alloc(4), 0);
      return "broken";
    }
    return REFUSALS.has(result) ? "holds" : "unknown";
  }

  /** Names `boundary` among the sandbox's when `found` says it holds; otherwise says why not. */
  #claim(boundary: string, found: Found, broken: string): void {
    if (found === "holds") this.#sandbox.push(boundary);
    else if (found === "broken") this.#gaps.lack(`${boundary} did not hold: ${broken}`);
    else this.#gaps.lack(`${boundary} could not be checked`);
  }
}

/** The functions of libSystem that the protections and their probes call. */
function loadSystem(ffi: NodeFfi) {
  return ffi.dlopen(LIBSYSTEM, LIBSYSTEM_FUNCTIONS).functions;
}
