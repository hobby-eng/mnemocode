// The protections that Windows gives a MnemoCode process without an administrator:
//
// - crash reports without the heap, where the seed phrase would be (WerSetFlags,
//   WER_FAULT_REPORTING_FLAG_NOHEAP), at start;
// - no extension DLLs, such as AppInit DLLs and global window hooks, and no DLLs from network
//   shares or from files of low integrity (process mitigation policies), at start: ways in which
//   another program puts code into this one;
// - no other programs, where the command starts none: a job object that holds one process, this
//   one, so that the kernel refuses every child. The menu, which starts each command, keeps the
//   right.
//
// Windows offers no program a way to refuse its own network or file writes without an
// administrator or a new process; the permission model alone refuses them. Each protection is read
// back from Windows before the summary names it. Core dumps are left as they are: Windows writes
// none unless an administrator set one up.

import {
  SandboxRecord,
  type CoreDumps,
  type NodeFfi,
  type SandboxNeeds,
  type SystemAccess,
  type SystemSandbox,
} from "./sandbox-record.js";

const KERNEL32 = "kernel32.dll";

/** WER_FAULT_REPORTING_FLAG_NOHEAP (werapi.h). */
const WER_NO_HEAP = 1;
/** PROCESS_MITIGATION_POLICY values (winnt.h). */
const EXTENSION_POINT_DISABLE_POLICY = 6;
const IMAGE_LOAD_POLICY = 10;
/** DisableExtensionPoints, the first bit of PROCESS_MITIGATION_EXTENSION_POINT_DISABLE_POLICY. */
const DISABLE_EXTENSION_POINTS = 1;
/** NoRemoteImages and NoLowMandatoryLabelImages of PROCESS_MITIGATION_IMAGE_LOAD_POLICY. */
const NO_REMOTE_OR_LOW_IMAGES = 0b11;
/** Each policy is one DWORD of flags. */
const POLICY_BYTES = 4;

/** JobObjectBasicLimitInformation (winnt.h, JOBOBJECTINFOCLASS). */
const BASIC_LIMIT_INFORMATION = 2;
/**
 * JOBOBJECT_BASIC_LIMIT_INFORMATION on 64-bit Windows: two LARGE_INTEGER, LimitFlags at 16, two
 * SIZE_T, ActiveProcessLimit at 40, then Affinity, PriorityClass and SchedulingClass.
 */
const BASIC_LIMIT_BYTES = 64;
const LIMIT_FLAGS_OFFSET = 16;
const ACTIVE_PROCESS_LIMIT_OFFSET = 40;
const JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x8;

const KERNEL32_FUNCTIONS = {
  GetCurrentProcess: { arguments: [], return: "pointer" },
  WerSetFlags: { arguments: ["u32"], return: "i32" },
  WerGetFlags: { arguments: ["pointer", "buffer"], return: "i32" },
  SetProcessMitigationPolicy: { arguments: ["i32", "buffer", "u64"], return: "i32" },
  GetProcessMitigationPolicy: { arguments: ["pointer", "i32", "buffer", "u64"], return: "i32" },
  CreateJobObjectW: { arguments: ["pointer", "pointer"], return: "pointer" },
  SetInformationJobObject: { arguments: ["pointer", "i32", "buffer", "u32"], return: "i32" },
  AssignProcessToJobObject: { arguments: ["pointer", "pointer"], return: "i32" },
  IsProcessInJob: { arguments: ["pointer", "pointer", "buffer"], return: "i32" },
  QueryInformationJobObject: {
    arguments: ["pointer", "i32", "buffer", "u32", "pointer"],
    return: "i32",
  },
  GetLastError: { arguments: [], return: "u32" },
} as const;

type Kernel32 = ReturnType<typeof loadKernel32>;

/** Windows's protections, as described at the top. */
export class WindowsSandbox implements SystemSandbox {
  /** What Windows confirmed, in the order applied, and what it did not. */
  readonly #record = new SandboxRecord();
  readonly #kernel32: Kernel32 | undefined;

  constructor(access: SystemAccess) {
    this.#kernel32 = this.#record.reach("kernel32", access, loadKernel32);
  }

  start(): void {
    const kernel32 = this.#kernel32;
    if (kernel32 === undefined) return;
    this.#record.attempt("crash reports", () => {
      if (kernel32.WerSetFlags(WER_NO_HEAP) !== 0) throw new Error("WerSetFlags refused");
      const flags = Buffer.alloc(4);
      if (kernel32.WerGetFlags(kernel32.GetCurrentProcess(), flags) !== 0)
        throw new Error("WerGetFlags refused");
      if ((flags.readUInt32LE(0) & WER_NO_HEAP) === 0)
        throw new Error("the heap is still reported");
      this.#record.hold("no heap in crash reports");
    });
    this.#policy(
      kernel32,
      EXTENSION_POINT_DISABLE_POLICY,
      DISABLE_EXTENSION_POINTS,
      "no extension DLLs",
    );
    this.#policy(
      kernel32,
      IMAGE_LOAD_POLICY,
      NO_REMOTE_OR_LOW_IMAGES,
      "no DLLs from network shares",
    );
  }

  restrict(needs: SandboxNeeds): void {
    const kernel32 = this.#kernel32;
    if (kernel32 !== undefined && !needs.runsPrograms)
      this.#record.attempt("job object", () => this.#forbidPrograms(kernel32));
    const refused = needs.writes ? "network is" : "network and file writes are";
    this.#record.lack(`${refused} refused by the permission model only`);
  }

  held(): readonly string[] {
    return this.#record.held;
  }

  missing(): readonly string[] {
    return this.#record.reasons;
  }

  /** The memory is not locked here: swap may hold some of it. */
  keepsMemoryFromSwap(): boolean {
    return false;
  }

  /** Left as Windows has them: it writes no dump unless an administrator set one up. */
  coreDumps(): CoreDumps {
    return { state: "untouched" };
  }

  /** Sets the mitigation `policy` to `flags` and reads it back. */
  #policy(kernel32: Kernel32, policy: number, flags: number, boundary: string): void {
    this.#record.attempt(boundary, () => {
      const wanted = Buffer.alloc(POLICY_BYTES);
      wanted.writeUInt32LE(flags, 0);
      if (kernel32.SetProcessMitigationPolicy(policy, wanted, BigInt(POLICY_BYTES)) === 0)
        throw new Error(`refused (error ${kernel32.GetLastError()})`);
      const read = Buffer.alloc(POLICY_BYTES);
      const current = kernel32.GetCurrentProcess();
      if (kernel32.GetProcessMitigationPolicy(current, policy, read, BigInt(POLICY_BYTES)) === 0)
        throw new Error(`not readable (error ${kernel32.GetLastError()})`);
      if ((read.readUInt32LE(0) & flags) !== flags) throw new Error("not in force");
      this.#record.hold(boundary);
    });
  }

  /** Puts this process alone into a job that holds one process, and reads the job back. */
  #forbidPrograms(kernel32: Kernel32): void {
    const job = kernel32.CreateJobObjectW(null, null);
    if (job === 0n) throw new Error(`not created (error ${kernel32.GetLastError()})`);
    const limit = Buffer.alloc(BASIC_LIMIT_BYTES);
    limit.writeUInt32LE(JOB_OBJECT_LIMIT_ACTIVE_PROCESS, LIMIT_FLAGS_OFFSET);
    limit.writeUInt32LE(1, ACTIVE_PROCESS_LIMIT_OFFSET);
    if (
      kernel32.SetInformationJobObject(job, BASIC_LIMIT_INFORMATION, limit, BASIC_LIMIT_BYTES) === 0
    )
      throw new Error(`its limit was refused (error ${kernel32.GetLastError()})`);
    // The job's handle stays open for the life of the process; the job ends with it.
    const current = kernel32.GetCurrentProcess();
    if (kernel32.AssignProcessToJobObject(job, current) === 0)
      throw new Error(`this process could not join it (error ${kernel32.GetLastError()})`);
    const inJob = Buffer.alloc(4);
    const read = Buffer.alloc(BASIC_LIMIT_BYTES);
    const joined =
      kernel32.IsProcessInJob(current, job, inJob) !== 0 &&
      inJob.readInt32LE(0) !== 0 &&
      kernel32.QueryInformationJobObject(
        job,
        BASIC_LIMIT_INFORMATION,
        read,
        BASIC_LIMIT_BYTES,
        null,
      ) !== 0;
    const limited =
      (read.readUInt32LE(LIMIT_FLAGS_OFFSET) & JOB_OBJECT_LIMIT_ACTIVE_PROCESS) !== 0 &&
      read.readUInt32LE(ACTIVE_PROCESS_LIMIT_OFFSET) === 1;
    if (!joined || !limited) throw new Error("its limit could not be read back");
    this.#record.hold("Windows: no other programs");
  }
}

/** The functions of kernel32 that the protections call. */
function loadKernel32(ffi: NodeFfi) {
  return ffi.dlopen(KERNEL32, KERNEL32_FUNCTIONS).functions;
}
