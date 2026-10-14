// The Linux kernel's own boundaries for a MnemoCode process, as mhfe sets them
// (src/bin/mhfe/protect.rs and its core dump check), with one difference that Node.js imposes: it
// has started its threads, the pool of libuv that runs file operations among them, before any
// script runs. Each boundary is therefore applied to every thread at once
// (SECCOMP_FILTER_FLAG_TSYNC, LANDLOCK_RESTRICT_SELF_TSYNC), and a kernel that cannot do so gets
// none of it, rather than one that holds for one thread only.
//
// - No core dumps, at start: setrlimit(RLIMIT_CORE, 0) and prctl(PR_SET_DUMPABLE, 0), read back.
//   A crash cannot write the memory, the seed phrase included, to the disk, as systemd-coredump or
//   apport would; and other programs of the same user cannot attach a debugger or read
//   /proc/PID/mem.
// - no_new_privs, which seccomp and Landlock need: no program started afterwards gains privileges.
// - seccomp refuses new sockets, new io_uring instances and, where the command starts no program,
//   execve. socketpair stays allowed: libuv makes the pipes of a child's standard streams with it
//   (stty around a command of the menu, pdftocairo), and such a pair reaches nothing outside. The
//   io_uring instances that libuv opens at start stay usable, since refusing io_uring_enter would
//   stop its event loop; only native code could submit a socket through one, and node:ffi is given
//   up once this is applied (protection.ts).
// - Landlock refuses every change to the file system where the command saves nothing, and TCP
//   bind and connect where the kernel knows them (Landlock ABI 4).
// - The memory is not locked out of swap, unlike mhfe's: V8 returns freed pages to the system with
//   madvise(MADV_DONTNEED), which Linux refuses on locked pages (EINVAL), and V8 then stops the
//   process at once. mlockall would crash every run that the system lets lock memory, such as one
//   as root; the warning about unencrypted swap covers swap instead (swap-check.ts).
//
// Every boundary is read back by a probe that tries what it forbids, as mhfe's are: a socket, an
// io_uring, /dev/null opened for writing, a program started at a path where none can be.

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

/** The C library, which holds every call below. */
const LIBC = "libc.so.6";

/** The error number that the filter and Landlock give a refused call: EACCES (errno-base.h). */
const REFUSED = 13;
/** ENOTDIR: what starting a program under /dev/null gives where nothing refuses it. */
const NOT_A_DIRECTORY = 20;

/**
 * The system calls the boundaries name, by architecture, with the AUDIT_ARCH_* value of
 * linux/audit.h that seccomp reports for them (asm/unistd_64.h on x86-64, asm-generic/unistd.h on
 * arm64). io_uring and Landlock have the same numbers on both.
 */
const ARCHITECTURES = {
  x64: { audit: 0xc000_003e, socket: 41, execve: 59, execveat: 322, seccomp: 317 },
  arm64: { audit: 0xc000_00b7, socket: 198, execve: 221, execveat: 281, seccomp: 277 },
} as const;
export type SeccompArchitecture = keyof typeof ARCHITECTURES;
const IO_URING_SETUP = 425;
const LANDLOCK_CREATE_RULESET = 444;
const LANDLOCK_RESTRICT_SELF = 446;

/** x32 system calls on x86-64 carry this bit in their number (__X32_SYSCALL_BIT): refused. */
const X32_SYSCALL_BIT = 0x4000_0000;

// Classic BPF as seccomp reads it (linux/filter.h, linux/seccomp.h).
const BPF_LOAD_WORD = 0x20; // BPF_LD | BPF_W | BPF_ABS
const BPF_JUMP_EQUAL = 0x15; // BPF_JMP | BPF_JEQ | BPF_K
const BPF_JUMP_AT_LEAST = 0x35; // BPF_JMP | BPF_JGE | BPF_K
const BPF_RETURN = 0x06; // BPF_RET | BPF_K
const SECCOMP_RET_ALLOW = 0x7fff_0000;
const SECCOMP_RET_ERRNO = 0x0005_0000;
/** Offsets in struct seccomp_data: int nr, then __u32 arch. */
const NUMBER_OFFSET = 0;
const ARCH_OFFSET = 4;
/** The size of one struct sock_filter: u16 code, u8 jt, u8 jf, u32 k. */
const INSTRUCTION_BYTES = 8;

const SECCOMP_SET_MODE_FILTER = 1;
const SECCOMP_FILTER_FLAG_TSYNC = 1;
/** struct sock_fprog: u16 len, then the pointer to the instructions at offset 8. */
const FILTER_PROGRAM_BYTES = 16;
const FILTER_POINTER_OFFSET = 8;

const PR_GET_DUMPABLE = 3;
const PR_SET_DUMPABLE = 4;
const PR_SET_NO_NEW_PRIVS = 38;
const PR_GET_NO_NEW_PRIVS = 39;

/**
 * The seccomp filter, as the bytes of its instructions, for `architecture`: system calls of any
 * other ABI and x32 ones are refused, then socket, io_uring_setup and, with `refuseExec`, execve
 * and execveat; everything else is allowed. Each test jumps forward to the last instruction, which
 * refuses with EACCES.
 */
export function seccompFilter(architecture: SeccompArchitecture, refuseExec: boolean): Buffer {
  const calls = ARCHITECTURES[architecture];
  const tests: (readonly [number, number])[] = [
    ...(architecture === "x64" ? [[BPF_JUMP_AT_LEAST, X32_SYSCALL_BIT] as const] : []),
    [BPF_JUMP_EQUAL, calls.socket],
    [BPF_JUMP_EQUAL, IO_URING_SETUP],
    ...(refuseExec
      ? ([
          [BPF_JUMP_EQUAL, calls.execve],
          [BPF_JUMP_EQUAL, calls.execveat],
        ] as const)
      : []),
  ];
  const program: (readonly [number, number, number, number])[] = [
    [BPF_LOAD_WORD, 0, 0, ARCH_OFFSET],
    // Past the load, the tests and the allow, to the refusal.
    [BPF_JUMP_EQUAL, 0, tests.length + 2, calls.audit],
    [BPF_LOAD_WORD, 0, 0, NUMBER_OFFSET],
    ...tests.map(([code, value], index) => [code, tests.length - index, 0, value] as const),
    [BPF_RETURN, 0, 0, SECCOMP_RET_ALLOW],
    [BPF_RETURN, 0, 0, SECCOMP_RET_ERRNO | REFUSED],
  ];
  const bytes = Buffer.alloc(program.length * INSTRUCTION_BYTES);
  program.forEach(([code, jumpTrue, jumpFalse, value], index) => {
    const at = index * INSTRUCTION_BYTES;
    bytes.writeUInt16LE(code, at);
    bytes.writeUInt8(jumpTrue, at + 2);
    bytes.writeUInt8(jumpFalse, at + 3);
    bytes.writeUInt32LE(value >>> 0, at + 4);
  });
  return bytes;
}

/** The architecture of this process as seccomp knows it; undefined for one without a filter. */
function seccompArchitecture(): SeccompArchitecture | undefined {
  return process.arch === "x64" || process.arch === "arm64" ? process.arch : undefined;
}

// Landlock (linux/landlock.h).
/** LANDLOCK_CREATE_RULESET_VERSION: asks for the ABI version instead of creating a ruleset. */
const CREATE_RULESET_VERSION = 1;
/** Applies the domain to every thread of the process at once. */
const RESTRICT_SELF_TSYNC = 1 << 3;
/** The rights that change the file system, by the ABI that added them. */
const WRITE_RIGHTS_ABI_1 =
  (1n << 1n) | // WRITE_FILE
  (1n << 4n) | // REMOVE_DIR
  (1n << 5n) | // REMOVE_FILE
  (1n << 6n) | // MAKE_CHAR
  (1n << 7n) | // MAKE_DIR
  (1n << 8n) | // MAKE_REG
  (1n << 9n) | // MAKE_SOCK
  (1n << 10n) | // MAKE_FIFO
  (1n << 11n) | // MAKE_BLOCK
  (1n << 12n); // MAKE_SYM
const REFER = 1n << 13n; // ABI 2
const TRUNCATE = 1n << 14n; // ABI 3
/** TCP bind and connect, ABI 4. */
const TCP_RIGHTS = (1n << 0n) | (1n << 1n);
const NETWORK_ABI = 4;
/** struct landlock_ruleset_attr up to the network rights: two u64; ABI 1 to 3 know the first. */
const RULESET_ATTR_BYTES = 16;

/** The rights to change the file system that Landlock of `abi` handles. */
export function landlockWriteRights(abi: number): bigint {
  return WRITE_RIGHTS_ABI_1 | (abi >= 2 ? REFER : 0n) | (abi >= 3 ? TRUNCATE : 0n);
}

// Probes.
const AF_INET = 2;
const SOCK_DGRAM = 2;
const O_WRONLY = 1;
/** Every descriptor a probe opens is closed at once, and none reaches a program it starts. */
const CLOEXEC = 0o2_000_000;
/** struct io_uring_params is 120 bytes; zero asks for the defaults. */
const IO_URING_PARAMS_BYTES = 120;
/** A path where no program can be: below a file that is not a directory. */
const NO_PROGRAM = "/dev/null/mnemocode-probe";

// Every argument of syscall is passed as a pointer-sized value: a number as a bigint, a structure
// as its buffer. node:ffi takes one signature per function.
const LIBC_FUNCTIONS = {
  syscall: { arguments: ["i64", "pointer", "pointer", "pointer"], return: "i64" },
  prctl: { arguments: ["i32", "u64", "u64", "u64", "u64"], return: "i32" },
  setrlimit: { arguments: ["i32", "buffer"], return: "i32" },
  socket: { arguments: ["i32", "i32", "i32"], return: "i32" },
  open: { arguments: ["string", "i32"], return: "i32" },
  close: { arguments: ["i32"], return: "i32" },
  execve: { arguments: ["string", "buffer", "buffer"], return: "i32" },
  __errno_location: { arguments: [], return: "pointer" },
} as const;

/** A system call's argument: a number, or the buffer of a structure. */
type Argument = bigint | Buffer | null;

/** The C library's functions that the boundaries and their probes call. */
class Libc {
  readonly #ffi: NodeFfi;
  readonly #functions;

  constructor(ffi: NodeFfi) {
    this.#ffi = ffi;
    this.#functions = ffi.dlopen(LIBC, LIBC_FUNCTIONS).functions;
  }

  get call() {
    return this.#functions;
  }

  /** The system call `number` with up to three arguments; its result, -1 on failure. */
  syscall(
    number: number,
    first: Argument = 0n,
    second: Argument = 0n,
    third: Argument = 0n,
  ): bigint {
    return this.#functions.syscall(BigInt(number), first, second, third);
  }

  /** errno of the call just made, read before any other call can change it. */
  errno(): number {
    return this.#ffi.getInt32(this.#functions.__errno_location(), 0);
  }

  /** The error number of a call that returned `result`: undefined when it succeeded. */
  failure(result: number | bigint): number | undefined {
    return result < 0 ? this.errno() : undefined;
  }

  /** The address of `bytes`, for a structure that holds a pointer. */
  address(bytes: Buffer): bigint {
    return this.#ffi.getRawPointer(bytes);
  }
}

/** The Linux kernel's boundaries, as described at the top. */
export class LinuxSandbox implements SystemSandbox {
  /** The boundaries that the kernel enforces and a probe confirmed, and what it did not. */
  readonly #record = new SandboxRecord();
  readonly #libc: Libc | undefined;
  #coreDumps: CoreDumps;

  constructor(access: SystemAccess) {
    this.#libc = this.#record.reach("the C library", access, (ffi) => new Libc(ffi));
    this.#coreDumps = this.#record.coreDumpsNotOff();
  }

  start(): void {
    const libc = this.#libc;
    if (libc === undefined) return;
    this.#coreDumps = switchOffCoreDumps(() => {
      if (libc.call.setrlimit(RLIMIT_CORE, noLimit()) !== 0)
        throw new Error("setrlimit refused RLIMIT_CORE 0");
      if (libc.call.prctl(PR_SET_DUMPABLE, 0n, 0n, 0n, 0n) !== 0) throw new Error("prctl refused");
      if (libc.call.prctl(PR_GET_DUMPABLE, 0n, 0n, 0n, 0n) !== 0)
        throw new Error("the process is still dumpable");
    });
  }

  restrict(needs: SandboxNeeds): void {
    const libc = this.#libc;
    if (libc === undefined) return;
    this.#record.attempt("no_new_privs", () => {
      const set = libc.call.prctl(PR_SET_NO_NEW_PRIVS, 1n, 0n, 0n, 0n);
      if (set !== 0 || libc.call.prctl(PR_GET_NO_NEW_PRIVS, 0n, 0n, 0n, 0n) !== 1)
        throw new Error("refused, so neither seccomp nor Landlock can be used");
    });
    if (libc.call.prctl(PR_GET_NO_NEW_PRIVS, 0n, 0n, 0n, 0n) !== 1) return;
    this.#record.attempt("seccomp", () => this.#filter(libc, !needs.runsPrograms));
    if (!needs.writes) this.#record.attempt("Landlock", () => this.#forbidWrites(libc));
  }

  held(): readonly string[] {
    const kernel = this.#record.held;
    return kernel.length > 0 ? [`kernel: ${kernel.join(", ")}`] : [];
  }

  missing(): readonly string[] {
    return this.#record.reasons;
  }

  coreDumps(): CoreDumps {
    return this.#coreDumps;
  }

  /** Installs the seccomp filter on every thread, then probes it. */
  #filter(libc: Libc, refuseExec: boolean): void {
    const architecture = seccompArchitecture();
    if (architecture === undefined) throw new Error(`no filter for ${process.arch}`);
    const filter = seccompFilter(architecture, refuseExec);
    const program = Buffer.alloc(FILTER_PROGRAM_BYTES);
    program.writeUInt16LE(filter.length / INSTRUCTION_BYTES, 0);
    program.writeBigUInt64LE(libc.address(filter), FILTER_POINTER_OFFSET);
    const result = libc.syscall(
      ARCHITECTURES[architecture].seccomp,
      BigInt(SECCOMP_SET_MODE_FILTER),
      BigInt(SECCOMP_FILTER_FLAG_TSYNC),
      program,
    );
    // A positive result names a thread that could not take the filter; nothing was installed.
    if (result !== 0n)
      throw new Error(`refused for every thread (${libc.failure(result) ?? `thread ${result}`})`);
    this.#record.claim("no sockets", sockets(libc), "a socket or an io_uring was not refused");
    if (refuseExec)
      this.#record.claim("no other programs", programs(libc), "starting a program was not refused");
  }

  /** Refuses every change to the file system on every thread, then probes it. */
  #forbidWrites(libc: Libc): void {
    const abi = libc.syscall(LANDLOCK_CREATE_RULESET, null, 0n, BigInt(CREATE_RULESET_VERSION));
    if (abi < 1n) throw new Error("switched off or missing in this kernel");
    const withNetwork = abi >= BigInt(NETWORK_ABI);
    const attribute = Buffer.alloc(withNetwork ? RULESET_ATTR_BYTES : RULESET_ATTR_BYTES / 2);
    attribute.writeBigUInt64LE(landlockWriteRights(Number(abi)), 0);
    if (withNetwork) attribute.writeBigUInt64LE(TCP_RIGHTS, 8);
    const ruleset = libc.syscall(LANDLOCK_CREATE_RULESET, attribute, BigInt(attribute.length), 0n);
    if (ruleset < 0n) throw new Error(`the ruleset was refused (error ${libc.errno()})`);
    try {
      // No rule grants any of the handled rights: they are refused everywhere.
      const result = libc.syscall(LANDLOCK_RESTRICT_SELF, ruleset, BigInt(RESTRICT_SELF_TSYNC));
      if (result !== 0n)
        throw new Error(`this kernel cannot restrict every thread at once (error ${libc.errno()})`);
    } finally {
      libc.call.close(Number(ruleset));
    }
    this.#record.claim("no file writes", writes(libc), "/dev/null opened for writing");
  }
}

/**
 * Both a socket and an io_uring, which could open a socket without the socket call, are refused.
 */
function sockets(libc: Libc): Found {
  const socket = libc.call.socket(AF_INET, SOCK_DGRAM | CLOEXEC, 0);
  const socketRefused = socket < 0 && libc.errno() === REFUSED;
  if (socket >= 0) libc.call.close(socket);
  const ring = libc.syscall(IO_URING_SETUP, 1n, Buffer.alloc(IO_URING_PARAMS_BYTES));
  const ringRefused = ring < 0n && libc.errno() === REFUSED;
  if (ring >= 0n) libc.call.close(Number(ring));
  return socketRefused && ringRefused ? "holds" : "broken";
}

/** Starting a program where none can be: refused, or "not a directory" where nothing refuses it. */
function programs(libc: Libc): Found {
  // argv and envp: a NULL pointer alone, an empty list.
  const empty = Buffer.alloc(8);
  const failure = libc.failure(libc.call.execve(NO_PROGRAM, empty, empty));
  if (failure === REFUSED) return "holds";
  return failure === NOT_A_DIRECTORY ? "broken" : "unknown";
}

/**
 * /dev/null opened for writing is refused; a system without it, or another refusal, cannot tell.
 */
function writes(libc: Libc): Found {
  const file = libc.call.open("/dev/null", O_WRONLY | CLOEXEC);
  if (file >= 0) {
    libc.call.close(file);
    return "broken";
  }
  return libc.errno() === REFUSED ? "holds" : "unknown";
}
