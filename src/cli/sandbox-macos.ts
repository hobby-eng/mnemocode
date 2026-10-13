// The protections that macOS gives a MnemoCode process:
//
// - no core dumps, at start: setrlimit(RLIMIT_CORE, 0), so that a crash cannot write the memory,
//   the seed phrase included, to the disk;
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
  noLimit,
  RLIMIT_CORE,
  SandboxRecord,
  switchOffCoreDumps,
  type CoreDumps,
  type Found,
  type NodeFfi,
  type SandboxNeeds,
  type SystemAccess,
  type SystemSandbox,
} from "./sandbox-record.js";

/** The system library, which holds every call below. */
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
  setrlimit: { arguments: ["i32", "buffer"], return: "i32" },
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

/** macOS's protections, as described at the top. */
export class MacSandbox implements SystemSandbox {
  /** The boundaries that the sandbox enforces and a probe confirmed, and what it did not. */
  readonly #record = new SandboxRecord();
  /** The system library with node:ffi, which reads what it returns; undefined without either. */
  readonly #reach: Reach | undefined;
  #coreDumps: CoreDumps;
  #attachDenied = false;

  constructor(access: SystemAccess) {
    this.#reach = this.#record.reach("the system library", access, (ffi) => ({
      ffi,
      system: loadSystem(ffi),
    }));
    this.#coreDumps = this.#record.coreDumpsNotOff();
  }

  start(): void {
    const system = this.#reach?.system;
    if (system === undefined) return;
    this.#coreDumps = switchOffCoreDumps(() => {
      if (system.setrlimit(RLIMIT_CORE, noLimit()) !== 0)
        throw new Error("setrlimit refused RLIMIT_CORE 0");
    });
    this.#record.attempt("debugger attach", () => {
      if (system.ptrace(PT_DENY_ATTACH, 0, null, 0) !== 0) throw new Error("not refused");
      this.#attachDenied = true;
    });
  }

  restrict(needs: SandboxNeeds): void {
    const reach = this.#reach;
    if (reach === undefined) return;
    const { ffi, system } = reach;
    this.#record.attempt("sandbox", () => {
      const error = Buffer.alloc(8);
      if (system.sandbox_init(macSandboxProfile(needs), 0n, error) !== 0) {
        const message = error.readBigUInt64LE(0);
        const text = message === 0n ? "unknown reason" : ffi.toString(message);
        if (message !== 0n) system.sandbox_free_error(message);
        throw new Error(`refused (${text ?? "unknown reason"})`);
      }
      this.#record.claim("no network", network(reach), "a connection was not refused");
      if (!needs.runsPrograms)
        this.#record.claim("no other programs", programs(reach), "a program started");
    });
    if (!needs.writes) this.#record.lack("file writes are refused by the permission model only");
  }

  held(): readonly string[] {
    const sandbox = this.#record.held;
    return [
      ...(this.#attachDenied ? ["no debugger attach"] : []),
      ...(sandbox.length > 0 ? [`sandbox: ${sandbox.join(", ")}`] : []),
    ];
  }

  missing(): readonly string[] {
    return this.#record.reasons;
  }

  coreDumps(): CoreDumps {
    return this.#coreDumps;
  }

  /** The memory is not locked here: swap may hold some of it. */
  keepsMemoryFromSwap(): boolean {
    return false;
  }
}

/** errno of the call just made. */
function errno({ ffi, system }: Reach): number {
  return ffi.getInt32(system.__error(), 0);
}

/** A UDP socket connected to the loopback address, which sends nothing: refused. */
function network(reach: Reach): Found {
  const { system } = reach;
  const socket = system.socket(AF_INET, SOCK_DGRAM, 0);
  if (socket < 0) return REFUSALS.has(errno(reach)) ? "holds" : "unknown";
  try {
    const address = Buffer.alloc(SOCKADDR_IN_BYTES);
    address.writeUInt8(SOCKADDR_IN_BYTES, 0);
    address.writeUInt8(AF_INET, 1);
    address.writeUInt16BE(DISCARD_PORT, 2);
    address.writeUInt32BE(LOOPBACK, 4);
    if (system.connect(socket, address, SOCKADDR_IN_BYTES) === 0) return "broken";
    return REFUSALS.has(errno(reach)) ? "holds" : "unknown";
  } finally {
    system.close(socket);
  }
}

/** /usr/bin/true started: refused; a start that the sandbox let through is waited for. */
function programs(reach: Reach): Found {
  const { ffi, system } = reach;
  const name = Buffer.from(`${NOTHING_PROGRAM}\0`);
  // argv: the program's name, then a NULL pointer; envp: a NULL pointer alone.
  const argv = Buffer.alloc(16);
  argv.writeBigUInt64LE(ffi.getRawPointer(name), 0);
  const envp = Buffer.alloc(8);
  const child = Buffer.alloc(4);
  const result = system.posix_spawn(child, NOTHING_PROGRAM, null, null, argv, envp);
  if (result === 0) {
    system.waitpid(child.readInt32LE(0), Buffer.alloc(4), 0);
    return "broken";
  }
  return REFUSALS.has(result) ? "holds" : "unknown";
}

/** The functions of libSystem that the protections and their probes call. */
function loadSystem(ffi: NodeFfi) {
  return ffi.dlopen(LIBSYSTEM, LIBSYSTEM_FUNCTIONS).functions;
}

/** The system library with node:ffi, which reads the memory that it returns. */
interface Reach {
  readonly ffi: NodeFfi;
  readonly system: ReturnType<typeof loadSystem>;
}
