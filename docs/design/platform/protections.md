# Platform protections of the Rust MnemoCode

Label: platform. Targets: the command line on Linux, macOS and Windows; the WebAssembly inside
`multi-chain-wallet-tools` pages. Each measure, with its threat, call, privileges, read-back,
refusal and primary sources, is in `protections.json` (66 measures: 32 required, 9 optional,
25 rejected). This file holds the decisions, what exists today, and the open points.

## Decisions

1. **Refusal policy.** A secret command refuses to start only when the core-dump protection does
   not read back: `RLIMIT_CORE` not {0, 0} (Linux, macOS), `PR_GET_DUMPABLE` not 0 (Linux), and a
   tracer present (`TracerPid` ≠ 0, Linux; owner, 2026-10-27). Every other measure that the system refuses
   is reported in the startup checks, on the Protection line and in the self-test, never assumed
   (owner rule of 2026-10-13, CAP-CLI-SECRET-GATE; RUST-11). A refused memory lock warns once. Apart
   from the protections, a command whose result is secret refuses on a terminal without a private
   screen (`N-PRIVATE-SCREEN`, owner, 2026-10-27).
2. **A fresh process per secret command** (`N-FRESH-PROCESS`). The menu starts each command as a
   new process of the same executable, as the TypeScript program does. Landlock before ABI 8 binds only the calling thread, and no_new_privs, the seccomp filter, the Landlock domain, the Seatbelt profile and the job bind the process for good, so a menu that ran a command in a thread would stay bound by it.
   Order at start, before
   the first thread, proved by a test like mhfe's G10:
   - Linux: `RLIMIT_CORE` 0, `PR_SET_DUMPABLE` 0, `RLIMIT_DATA` cap → parse options, make the missing
     output folders and open them → `no_new_privs` → seccomp with TSYNC → Landlock → read back
     everything → threads, then secrets.
   - macOS: `RLIMIT_CORE` 0, `PT_DENY_ATTACH` → options → Seatbelt (deny network) → read back.
   - Windows: `SetDefaultDllDirectories`, `WerSetFlags(NOHEAP)`, job with a memory limit → options →
     read back; no network or write restriction exists without an administrator.
3. **Secrets under counted page locks** (ADR 0003, which replaced this report's "pages of their
   own"). A secret buffer reserved at its final size is locked (`mlock`; `VirtualLock` after
   raising the working set) before it is filled, with locks counted per page
   (`mhfe/src/memory.rs:231-349`), since one `munlock` unlocks a page for every buffer on it. Small
   secrets share pages within the budget; an owner over the budget is not locked, and the lock
   warning names it. The zeroing allocator wipes every freed block and marks none `MADV_DONTDUMP` (RUST-13 as
   amended on 2026-10-27); large work areas, the scrypt area of an age encryption and card rasters
   among them, get a free-memory check before allocation and the swap warning.
4. **Linux sandbox.** seccomp refuses other architectures, x32, `socket`, `socketpair` and the three
   `io_uring` calls; Landlock handles every file-changing right of the kernel's ABI and grants the
   publication rights beneath the parent folder of each output, opened before the secret; the
   preflight makes a missing parent, with any missing folders above it, before the secret (owner, 2026-10-27;
   TS makes them at publication, `private-file.ts:271`), and those stay after a cancel, since a
   Landlocked process cannot remove the folder its rule sits on. It applies on the private screen too: re-encode asks its outputs before
   the old phrase, a second Landlock restriction rules them before that phrase is read, and the save retry keeps to the ruled folders. No network namespace: on the release targets it closes no path the socket
   filter leaves open (owner, 2026-10-27; RUST-10 amended). No `execve` denial on Linux or in Seatbelt, and no
   limit on child processes in the Windows job: filters, Landlock domains, the Seatbelt profile and the job
   pass to a started program, which gains nothing the process lacks (owner, 2026-10-27; TS 0.1.0 has all three).
5. **Memory limits** (owner requirement 2): a free-memory check before any large work area on all
   three systems, and a hard cap, `RLIMIT_DATA` on Linux and a job object's process-memory limit on
   Windows, set to one named value: the measured peak of the heaviest operation (an age-encrypted candidate
   list at its largest, about 0.6 GiB, and the largest card export) plus a quarter, rounded up to
   a multiple of 64 MiB (about 0.7 GiB if the list is the heaviest); a test runs that operation
   under it (owner, 2026-10-27). macOS enforces neither
   limit reliably and gets none.
6. **Crash reporting.** On Linux, dumpable read back as 0 makes the kernel drop every dump before
   it reads `core_pattern`, piped ones included (https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/tree/fs/coredump.c?h=v6.8#n553; copies in skeptic `round3/`), so no handler
   is read or named. On Windows the line names an administrator's `LocalDumps` setting.
7. **No secret goes to another program** (`N-NO-SECRET-CHILD`): card images are rasterised in
   process, not by `pdftocairo`, whose memory after `execve` is dumpable, readable by the same user
   and swappable.
8. **Ending signals are handled by the main thread; Ctrl+Z suspends, as in TS** (`N-SIGNALS`).
   SIGINT, SIGTERM, SIGHUP and SIGQUIT only set a flag (handlers without `SA_RESTART`; other
   threads block them). The main thread, woken by `EINTR` from its terminal read or seeing the
   flag between search steps and library calls, restores the terminal, leaves the private screen,
   removes the staging folders and exits with 128 + the signal (130 and "Cancelled." for SIGINT,
   as TS, and for SIGQUIT, as mhfe): removing folders is not async-signal-safe, and a handler that
   redrew the screen could let the main thread finish a secret line on the main screen. SIGTSTP
   gives the terminal back from raw mode, then stops the process group; on continue raw mode comes
   back, and the private screen, which stayed up, needs no drawing. mhfe's SIGTSTP-to-SIGINT would
   end the search that TS suspends (`CAP-CLI-LONG-SEARCH-CONTROL`, RUST-14). Windows: the console
   handler sets the same flag and, for a closed console, waits for the cleanup within the system's
   5 s. Without a private screen a secret result is refused when standard output is a terminal and
   written as TS to a file or a pipe (`N-PRIVATE-SCREEN`, owner, 2026-10-27).

## Required measures

| Target    | Measure                                                                                                                                                                                        | Read back · on refusal                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Linux     | `L-CORE-LIMIT` setrlimit(RLIMIT_CORE, 0)                                                                                                                                                       | getrlimit · refuse secrets                               |
| Linux     | `L-DUMPABLE` prctl(PR_SET_DUMPABLE, 0): stops ptrace, /proc/PID/mem, process_vm_readv by the same user                                                                                         | PR_GET_DUMPABLE after the last step · refuse secrets     |
| Linux     | `L-TRACER` TracerPid in /proc/self/status                                                                                                                                                      | the reading · refuse secrets                             |
| Linux     | `L-MLOCK` mlock with locks counted per page (ADR 0003)                                                                                                                                         | mlock result, startup probe naming RLIMIT_MEMLOCK · warn |
| Linux     | `L-SWAP-CHECK` /proc/swaps to dm-crypt; zram only without `backing_dev`; names hibernation                                                                                                     | the reading, "cannot tell" when unreadable · warn        |
| Linux     | `L-RLIMIT-DATA` the memory cap                                                                                                                                                                 | getrlimit · report                                       |
| Linux     | `L-NO-NEW-PRIVS`                                                                                                                                                                               | PR_GET_NO_NEW_PRIVS · report, skip seccomp and Landlock  |
| Linux     | `L-SECCOMP-SOCKETS` filter with TSYNC                                                                                                                                                          | probes: socket and io_uring_setup give EACCES · report   |
| Linux     | `L-LANDLOCK-WRITES` rights by ABI, a rule on each output's parent folder                                                                                                                       | probe: /dev/null for writing gives EACCES · report       |
| macOS     | `M-CORE-LIMIT` setrlimit(RLIMIT_CORE, 0)                                                                                                                                                       | getrlimit · refuse secrets                               |
| macOS     | `M-DENY-ATTACH` ptrace(PT_DENY_ATTACH)                                                                                                                                                         | none exists; a traced process exits · report "requested" |
| macOS     | `M-SEATBELT-NETWORK` sandbox_init `(deny network*)`                                                                                                                                            | probe: UDP connect refused · report                      |
| Windows   | `W-WER-NOHEAP` WerSetFlags(NOHEAP), read LocalDumps                                                                                                                                            | WerGetFlags · report                                     |
| Windows   | `W-DLL-SEARCH` the GNU target's imports gated to KnownDLLs; SetDefaultDllDirectories                                                                                                           | release gate, call result · gate fails                   |
| Windows   | `W-VIRTUALLOCK` raise working set by the lock budget, VirtualLock counted per page                                                                                                             | call results · warn                                      |
| Windows   | `W-JOB-MEMORY` job with ProcessMemoryLimit                                                                                                                                                     | IsProcessInJob, QueryInformationJobObject · report       |
| All three | `N-MEMORY-PRECHECK`, `N-FRESH-PROCESS`, `N-NO-ECHO`, `N-PRIVATE-SCREEN`, `N-SIGNALS`, `N-NO-CLIPBOARD`, `N-NO-ARGV-ENV`, `N-PRIVATE-FILES`, `N-CLOUD-FOLDERS`, `N-NO-SECRET-CHILD`, `N-REPORT` | see the JSON                                             |
| Browser   | `B-WIPE`, `B-CSP-OFFLINE`, `B-VAULT-FRAME`, `B-NO-STORAGE`, `B-EGRESS-TRIPWIRE`                                                                                                                | see below                                                |

Privileges: none of the required native measures needs an administrator. `mlock` and
`VirtualLock` are bounded by `RLIMIT_MEMLOCK` (8 MiB since Linux 5.16, 64 KiB before) and by
the working set.

## Optional and rejected, in one line each

Optional: `M-MLOCK` (macOS
encrypts swap; kept as the same `cfg(unix)` code), `L-MEMLOCK-SOFT`, `L-MEMFD-SECRET` (the one call
that inhibits hibernation; second allocation path), `M-HARDENED-RUNTIME` (task_for_pid and DYLD
injection need same-user code), `W-MITIGATIONS` (AppInit needs an administrator, hooks need user32),
`L-LANDLOCK-NET` (inherited sockets come from the trusted parent), `M-SEATBELT-WRITES` (untested
against terminal output), `B-WORKER`, `B-WASM-MAX-MEMORY`.

Rejected: `L-CRASH-HANDLER`, `L-DONTDUMP-SECRETS` and `L-DONTDUMP-WORK` (no dump once
dumpable reads 0), `M-REPORTCRASH` and `B-NO-MLOCK` (no API), `L-YAMA` (dumpable already covers it),
`L-SECCOMP-EXTRA`, `N-GUARD-PAGES`, `L-WIPEONFORK` and `L-INHERITED-FDS` (guard the program's own
code or a trusted parent, CORE-54), `L-MLOCKALL` (fails past the lock limit), `L-RLIMIT-AS` (counts
reservations), `M-MEMORY-LIMIT` (not enforced), `M-SWAP` (always encrypted), `W-PAGEFILE` (needs an
administrator to tell), `N-SLEEP-INHIBIT` (idle sleep only), `L-SECCOMP-EXEC`, `M-SEATBELT-EXEC` and
`W-JOB-NO-CHILDREN` (a child gains nothing the process lacks; owner, 2026-10-27), `L-NETNS` (no path left
open by the socket filter on the release targets; owner, 2026-10-27), `W-MEMORY-READERS` (the owner keeps
WRITE_DAC; PPL needs Microsoft signing), `W-NETWORK-SANDBOX` (AppContainer needs a broker, a profile
and brokered files), `L-LANDLOCK-SCOPES`, `N-UMASK`, `B-COOP-COEP`.

## What exists today

|                        | mhfe `67e0b4c`                                                                                            | MnemoCode TypeScript `7d0d4ee`                                                                                                      | `mnemocode-rust` (unborn)                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux core dumps       | limit and dumpable, both read back (`protect.rs:34-49,112-216`)                                           | both set, only dumpable read back (`sandbox-linux.ts:257-267`)                                                                      | both, read back (`protection/linux.rs`)                                                                                                      |
| Linux readers          | dumpable                                                                                                  | dumpable                                                                                                                            | dumpable; refuses a tracer                                                                                                                   |
| Linux lock, dump marks | mlock with a shared-page count; DONTDUMP on Argon2 only                                                   | none (V8 aborts on locked pages, `sandbox-linux.ts:21-24`)                                                                          | own mmap per secret with guard pages, DONTDUMP, WIPEONFORK, mlock, smaps read-back; refuses on any failure                                   |
| Linux swap             | dm-crypt and zram check (`protect.rs:829-931`)                                                            | same (`swap-check.ts`)                                                                                                              | none                                                                                                                                         |
| Linux sandbox          | seccomp per thread (sockets, io_uring), Landlock ABI 1-4 per thread, user and network namespace, probes   | seccomp TSYNC (sockets, io_uring_setup, exec), Landlock with the ABI 8 TSYNC flag on every kernel                                   | seccomp with 13 denials, a syscall ceiling and an ioctl list; Landlock ABI ≥ 5 on opened outputs; network namespace without a user namespace |
| macOS                  | RLIMIT_CORE read back, mlock                                                                              | RLIMIT_CORE (no read-back), PT_DENY_ATTACH, Seatbelt (network, exec) with probes                                                    | refuses to run                                                                                                                               |
| Windows                | nothing (reported)                                                                                        | WER NOHEAP, mitigation policies, job without children, all read back                                                                | refuses to run                                                                                                                               |
| Memory limits          | free-memory check before Argon2 (`engine/native.rs:45-48`, `cgroup.rs`)                                   | none                                                                                                                                | explicit allocation maximum                                                                                                                  |
| Terminal               | raw input, private screen; SIGINT, SIGTERM, SIGHUP; SIGQUIT and SIGTSTP raise SIGINT (`protect.rs:51-89`) | raw input, private screen, SIGINT; Ctrl+Z during a search stops the job with the private screen shown (`terminal-input.ts:477-497`) | no terminal code                                                                                                                             |

What each platform still lacks against the required set: Linux, the core-limit read-back (TS),
`L-TRACER` (mhfe, TS), zram writeback in the swap check, rules for outputs in
Landlock (mhfe and TS drop Landlock for any command that saves), the memory cap; macOS, the
core-limit read-back; Windows, `W-VIRTUALLOCK`, `W-DLL-SEARCH`, `W-JOB-MEMORY` and the LocalDumps
reading. RUST-09 to RUST-13 cover core dumps, the Linux sandbox, read-back, the release profile and
secrets in memory; they say nothing for Windows' missing sandbox, macOS' encrypted swap, the
crash-handler case or memory caps (see the changes below).

From `mnemocode-rust` the design keeps the read-back of both core-dump settings and Landlock rules
on opened output folders; it drops guard pages, WIPEONFORK, smaps parsing, the extra syscall
denials, the syscall ceiling, the ioctl list, the descriptor refusal, the refusal to run without a
lock, and the refusal to run on macOS and Windows.

## Browser

Page code can wipe what it owns: Rust zeroizes each secret in linear memory on drop, and the page
fills its `Uint8Array`s with zeros. It cannot wipe JS strings, the value of a DOM field, or the
browser's own copies; it cannot lock memory, see swap or stop crash reports. So (`B-WIPE`): every
WASM file registers the zeroing allocator (ADR 0003), so wasm-bindgen's argument copies, `&str`
and `&[u8]` alike, are wiped when the shim frees them; a secret entry's other arguments are
numbers, booleans or `JsValue` converted inside Rust, since the glue copies a secret in its prelude
without a `finally` and a later argument check that throws (`_assertClass`, `_assertChar`,
`_assertNonNull`; `wasm-bindgen-cli-support-0.2.129/src/js/binding.rs:836-839,959-975`) would leave
the copy never freed, as mhfe's AUD-012-SEC001 left copies on a refused option; the page wipes its
`Uint8Array`s after the call; a text result leaves once, as one JS string, on request; a test
scans `memory.buffer` for a public test secret after each operation.

wallet-tools already gives the rest, and MnemoCode adds nothing to it: the offline pages' exact CSP
with `connect-src 'none'` and `'wasm-unsafe-eval'`, checked by the artifact gate
(`apps/key-derivation/scripts/verify-key-derivation-artifact.mjs:51-55`); no storage APIs in the
built page (same gate, `:397-399`); on the network page, the opaque-origin vault frame with its own
`connect-src 'none'` and the validated MessagePort of `packages/network-boundary`; the egress
tripwire `SecretEgressGuard` of `packages/secret-boundary`. `packages/secret-vault` is only the
frame's bootstrap and `packages/build-security` only build identity; neither protects memory.
COOP and COEP are not needed: MnemoCode uses no SharedArrayBuffer, and a page opened as a file
cannot send headers.

## Corrections to the inputs

- TS `CAP-CLI-LINUX-LANDLOCK` claims Landlock from Linux 5.13; the TS passes
  `LANDLOCK_RESTRICT_SELF_TSYNC` (ABI 8) on every kernel (`sandbox-linux.ts:152,331`), which
  earlier ABIs refuse, so no Landlock applies before ABI 8.
- mhfe and TS count every zram device as memory; zram with `backing_dev` writes pages to a disk.
- mhfe `protect.rs:588-590` gives commands that write no network namespace, as "no owner of a new
  file maps to the system's users". File creation checks the caller's kernel user id, which the
  file system maps: in the probe, files made, linked and renamed in the namespace are 1000:1000 on
  disk (`probe-netns/README.txt`, skeptic `round2/probe-ga/README.txt`).
- `mnemocode-rust` enters a network namespace with `unshare(CLONE_NEWNET)` alone
  (`isolation/linux.rs:29`), which needs CAP_SYS_ADMIN: never for a normal user.
- TS reads back neither core limit (`sandbox-linux.ts:260-265`, `sandbox-macos.ts:102`).

## Changes for the coding guide

- RUST-09: read back after any credential change.
- RUST-10: the network namespace is out (owner, 2026-10-27, done in the guide); still to name the
  exemptions: Windows has no unprivileged network or write restriction; macOS has Seatbelt for the
  network only.
- RUST-13: the swap warning is for Linux (macOS encrypts swap, Windows cannot tell); zram counts
  only without `backing_dev`; Windows locks with `VirtualLock` after raising the working set;
  locks are counted per page, since one `munlock` unlocks a page for every secret on it (ADR 0003).
- A memory cap (`RLIMIT_DATA`, job memory limit) and a free-memory check before large areas,
  answering owner requirement 2, are in no rule yet.

## Owner decisions and release checks

1. Decided on 2026-10-27: a tracer refuses secrets on Linux (`L-TRACER`).
2. Decided on 2026-10-27: no `execve` denial in `CAP-CLI-LINUX-SECCOMP` and
   `CAP-CLI-MACOS-SEATBELT`, no limit on child processes in `CAP-CLI-WINDOWS-JOB-NO-CHILDREN`, whose job
   keeps the memory cap; `CAP-CLI-WINDOWS-MITIGATIONS` stays as TS (port), its measure `W-MITIGATIONS` optional.
3. Decided on 2026-10-27: no network namespace; its clause left RUST-10.
4. Decided on 2026-10-27: the cap of decision 5 plus the free-memory check.
5. A release check, not an owner decision: on each new macOS (27 now), whether `sandbox_init`
   with a custom profile still runs; if Apple removes it, macOS has no network block left
   (`M-SEATBELT-NETWORK`).
6. Decided on 2026-10-27: card images rasterised in process, at the owner's parity level (PLAN).
7. Decided on 2026-10-27: `x86_64-pc-windows-gnu`, as mhfe, with the KnownDLL import gate
   (`W-DLL-SEARCH`), checked on an empty executable in increment 0, and rust-lld's --dependent-load-flag
   beside it where increment 0 finds it works.
8. Decided on 2026-10-27: a secret result is refused on a terminal without a private screen, as
   mhfe (AUD-007-SEC001), and written as TS to a file or a pipe.
9. Decided on 2026-10-27: an output's missing parent is made before the secret, so the rule sits
   on the parent; folders made so stay after a cancel.
10. Not needed: `L-NETNS` was dropped on 2026-10-27.
