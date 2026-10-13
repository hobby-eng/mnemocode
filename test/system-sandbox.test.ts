import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PROTECTION_FLAGS } from "../src/cli/protection.js";
import {
  landlockWriteRights,
  seccompFilter,
  type SeccompArchitecture,
} from "../src/cli/sandbox-linux.js";
import { macSandboxProfile } from "../src/cli/sandbox-macos.js";
import { SandboxGaps } from "../src/cli/system-sandbox.js";

const execute = promisify(execFile);

/** AUDIT_ARCH_* of linux/audit.h. */
const AUDIT_ARCH = { x64: 0xc000_003e, arm64: 0xc000_00b7, i386: 0x4000_0003 } as const;
/** System call numbers (asm/unistd_64.h on x86-64, asm-generic/unistd.h on arm64). */
const CALLS = {
  x64: { read: 0, socket: 41, socketpair: 53, execve: 59, execveat: 322, ioUringEnter: 426 },
  arm64: { read: 63, socket: 198, socketpair: 199, execve: 221, execveat: 281, ioUringEnter: 426 },
} as const;
const IO_URING_SETUP = 425;
const ALLOW = 0x7fff_0000;
/** SECCOMP_RET_ERRNO with EACCES. */
const REFUSE = 0x0005_000d;

/**
 * Runs a seccomp filter as the kernel's classic BPF does, on a system call `number` of `arch`:
 * written apart from the filter's builder, so that a wrong jump or value shows.
 */
function verdict(filter: Buffer, arch: number, number: number): number {
  const data = Buffer.alloc(8);
  data.writeInt32LE(number | 0, 0);
  data.writeUInt32LE(arch >>> 0, 4);
  let accumulator = 0;
  for (let at = 0; at * 8 < filter.length;) {
    const code = filter.readUInt16LE(at * 8);
    const jumpTrue = filter.readUInt8(at * 8 + 2);
    const jumpFalse = filter.readUInt8(at * 8 + 3);
    const value = filter.readUInt32LE(at * 8 + 4);
    if (code === 0x20) {
      accumulator = data.readUInt32LE(value);
      at += 1;
    } else if (code === 0x15 || code === 0x35) {
      const taken = code === 0x15 ? accumulator === value : accumulator >= value;
      at += 1 + (taken ? jumpTrue : jumpFalse);
    } else if (code === 0x06) return value;
    else throw new Error(`instruction ${code} is not one of the filter's`);
  }
  throw new Error("the filter ran past its end");
}

describe("the seccomp filter of Linux", () => {
  for (const architecture of ["x64", "arm64"] as const satisfies SeccompArchitecture[]) {
    const arch = AUDIT_ARCH[architecture];
    const calls = CALLS[architecture];

    it(`refuses sockets and new io_uring instances on ${architecture}, and execve when asked`, () => {
      for (const refuseExec of [false, true]) {
        const filter = seccompFilter(architecture, refuseExec);
        expect(verdict(filter, arch, calls.socket)).toBe(REFUSE);
        expect(verdict(filter, arch, IO_URING_SETUP)).toBe(REFUSE);
        const exec = refuseExec ? REFUSE : ALLOW;
        expect(verdict(filter, arch, calls.execve)).toBe(exec);
        expect(verdict(filter, arch, calls.execveat)).toBe(exec);
        // What Node.js and libuv keep using: plain calls, the pipes of a child's streams, and
        // the rings that libuv opened at start.
        for (const allowed of [calls.read, calls.socketpair, calls.ioUringEnter])
          expect(verdict(filter, arch, allowed), String(allowed)).toBe(ALLOW);
        // System calls of another ABI are refused whatever their number.
        expect(verdict(filter, AUDIT_ARCH.i386, calls.read)).toBe(REFUSE);
      }
    });
  }

  it("refuses x32 system calls on x86-64", () => {
    const x32Socket = 0x4000_0000 + CALLS.x64.socket;
    expect(verdict(seccompFilter("x64", false), AUDIT_ARCH.x64, x32Socket)).toBe(REFUSE);
    expect(verdict(seccompFilter("x64", false), AUDIT_ARCH.x64, 0x4000_0000)).toBe(REFUSE);
  });
});

describe("Landlock's rights to change files", () => {
  it("handles the rights that each ABI knows (linux/landlock.h)", () => {
    // WRITE_FILE, REMOVE_DIR to MAKE_SYM; then REFER (ABI 2) and TRUNCATE (ABI 3).
    expect(landlockWriteRights(1)).toBe(0x1ff2n);
    expect(landlockWriteRights(2)).toBe(0x3ff2n);
    expect(landlockWriteRights(3)).toBe(0x7ff2n);
    expect(landlockWriteRights(8)).toBe(0x7ff2n);
  });
});

describe("the macOS sandbox profile", () => {
  it("refuses the network always, and other programs where none is started", () => {
    expect(macSandboxProfile({ writes: false, runsPrograms: false })).toBe(
      "(version 1)\n(allow default)\n(deny network*)\n(deny process-exec*)",
    );
    expect(macSandboxProfile({ writes: true, runsPrograms: true })).toBe(
      "(version 1)\n(allow default)\n(deny network*)",
    );
  });
});

describe("what a sandbox lacks", () => {
  it("records a step that throws as the reason, and goes on", () => {
    const gaps = new SandboxGaps();
    gaps.attempt("seccomp", () => {
      throw new Error("refused");
    });
    gaps.attempt("Landlock", () => undefined);
    gaps.lack("memory: not locked");
    expect(gaps.reasons).toEqual(["seccomp: refused", "memory: not locked"]);
  });
});

describe("the sandbox of this system, in a protected process", () => {
  /** The summary and the report of a protected process for a command with `needs`. */
  async function protectedRun(writes: boolean, runsPrograms: boolean) {
    const args = JSON.stringify({
      ...(writes ? { output: "x.txt" } : {}),
      ...(runsPrograms ? { "images-dir": "images" } : {}),
    });
    const script = `
      import("./dist/cli/protection.js").then(async (protection) => {
        await protection.hardenProcess();
        protection.dropUnneeded(false, ${args});
        console.log(JSON.stringify({
          summary: protection.protectionSummary(),
          report: protection.sandboxReport(),
          ffi: process.permission.has("ffi"),
        }));
      });`;
    const { stdout } = await execute(process.execPath, [
      ...PROTECTION_FLAGS,
      "--input-type=module",
      "-e",
      script,
    ]);
    return JSON.parse(stdout) as { summary: string; report: string; ffi: boolean };
  }

  it("enforces what the system offers, and gives up FFI after it", async () => {
    const run = await protectedRun(false, false);
    expect(run.ffi).toBe(false);
    // What every runner of CI offers: seccomp on every thread on Linux, the sandbox and denied
    // attaching on macOS, the job object and the mitigation policies on Windows.
    if (process.platform === "linux")
      expect(run.summary).toContain("kernel: no sockets, no other programs");
    if (process.platform === "darwin") {
      expect(run.summary).toContain("no debugger attach");
      expect(run.summary).toContain("sandbox: no network, no other programs");
    }
    if (process.platform === "win32") {
      expect(run.summary).toContain("no heap in crash reports");
      expect(run.summary).toContain("no extension DLLs");
      expect(run.summary).toContain("Windows: no other programs");
    }
    // Landlock for every thread is newer than some kernels: either it holds, or the report says
    // why not.
    if (process.platform === "linux") {
      const landlock = /kernel: [^·]*no file writes/u.test(run.summary);
      expect(landlock || run.report.includes("Landlock: ")).toBe(true);
    }
  });

  it("keeps what a command needs: other programs where it draws images", async () => {
    const run = await protectedRun(true, true);
    expect(run.summary).not.toMatch(/(kernel|sandbox|Windows): [^·]*no other programs/u);
    if (process.platform === "linux") {
      expect(run.summary).toContain("kernel: no sockets");
      expect(run.summary).not.toContain("kernel: no sockets, no file writes");
    }
  });
});
