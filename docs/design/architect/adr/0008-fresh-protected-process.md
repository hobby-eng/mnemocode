# A fresh, protected process for every secret command

## Context

Landlock before ABI 8 binds only the calling thread, and no_new_privs, the seccomp filter, the Landlock domain, the Seatbelt profile and the job bind the process for good, so a menu that ran a command in a thread would stay bound by it; mhfe's menu commands run in threads
(`mhfe/src/bin/mhfe/main.rs:224-236`). The owner ruled on 2026-10-13
that missing sandbox parts are reported, never a refusal; only core dumps that cannot be switched
off refuse a secret (CAP-CLI-SECRET-GATE); on 2026-10-27 the owner added a tracer attached on
Linux. The TS menu already starts each command as a process
(CAP-CLI-MENU-COMMAND-PROCESS). The platform report gives the measures, the order and the refusal
policy (decisions 1, 2, 5, 7).

## Decision

The menu builds a command line and starts it as a new process of the same executable; no secret
passes to it. Every process sets its core-dump limits on the first lines of `main`; a secret command
then parses its options, opens its output folders, applies the system protections for its needs
before any thread (Linux: no_new_privs,
seccomp with TSYNC, Landlock on the parent folder of each output from ABI 2, a missing parent made first, none on
ABI 1 for a command that saves; macOS: Seatbelt;
Windows: DLL search order, WER, a job with the memory cap), reads every one back, runs the startup
self-test, and only then asks for a secret. It refuses only when the core-dump protection does not
read back or a tracer is attached on Linux; everything else is reported on
the Protection line and in the self-test. Apart from the protections, a command whose result is
secret refuses on a terminal without a private screen (owner, 2026-10-27). No secret goes to another program: page images are drawn
in process (ADR 0009).

## Rejected alternatives

- Commands in threads of the menu: no single-threaded Landlock, and the menu would stay bound by
  the first command's protections.
- Refusing on every missing measure (`mnemocode-rust`): contradicts the owner's rule and refuses on
  kernels below Landlock ABI 5 and on macOS and Windows (design/assess, decision 3).

## Consequences

- A test like mhfe's G10 proves the order; probe tests read each protection back in a child.
- The menu itself handles no secret, so it needs only the core-dump limits.
- Outputs must be known, their missing parent folders made and all opened before the secret,
  which the output preflight does; folders made so stay after a cancel, since the restricted
  process cannot remove the folder its rule sits on. A command that saves nothing gets no write
  rule, as TS.
- On the private screen too (owner, 2026-10-27): re-encode asks its new backup's outputs before the
  old phrase, and a failed save's new name (CAP-CLI-SAVE-RETRY) is taken only in the folders
  ruled before the secret (TS `src/cli/command-options.ts:185`, `re-encode-command.ts:478-488`).
