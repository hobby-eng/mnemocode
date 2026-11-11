//! The pseudo-terminal harness's cleanup report while standard error is a closed pipe. It has a
//! test binary of its own: a test beside it that starts other processes could keep a copy of the
//! pipe's reader open, and the write that must fail would then succeed.

#![cfg(test)]
#![cfg(unix)]
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "the shared pseudo-terminal harness starts the CLI and times its answers"
)]

#[path = "common/terminal.rs"]
mod terminal;

use std::io::{Read as _, Write as _};
use std::process::{Command, Stdio};

use terminal::cleanup_failure;

const CHILD: &str = "MNEMOCODE_TEST_BROKEN_CLEANUP_STDERR";
const DONE: &[u8] = b"public cleanup child completed\n";

struct ReportsCleanupFailure;

impl Drop for ReportsCleanupFailure {
    fn drop(&mut self) {
        cleanup_failure(&std::io::Error::other("public synthetic PTY failure"));
    }
}

#[test]
#[expect(
    clippy::disallowed_methods,
    reason = "isolated public fault-test child uses its own OS pipes, environment and completion marker"
)]
fn cleanup_diagnostic_tolerates_closed_stderr_during_unwind() {
    if std::env::var_os(CHILD).is_some() {
        // Fault: the parent closes the stderr reader before releasing this handshake.
        // The real OS write therefore fails without changing the test process's global FDs.
        std::io::stdin()
            .read_exact(&mut [0])
            .expect("parent handshake");
        let failure = std::io::stderr()
            .write_all(b"public cleanup probe")
            .expect_err("the parent closed the pipe reader");
        assert_eq!(failure.kind(), std::io::ErrorKind::BrokenPipe);
        let unwound = std::panic::catch_unwind(|| {
            let _cleanup = ReportsCleanupFailure;
            // Fault: model a failed assertion while the PTY cleanup also reports an OS error.
            panic!("public synthetic assertion failure");
        });
        assert!(unwound.is_err());
        std::io::stdout()
            .write_all(DONE)
            .expect("child completion marker");
        std::io::stdout().flush().expect("flush completion marker");
        return;
    }

    let mut child = Command::new(std::env::current_exe().expect("current test executable"))
        .args([
            "--exact",
            "cleanup_diagnostic_tolerates_closed_stderr_during_unwind",
            "--nocapture",
        ])
        .env(CHILD, "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("public fault-test child");
    drop(child.stderr.take().expect("stderr pipe"));
    child
        .stdin
        .take()
        .expect("stdin pipe")
        .write_all(b"1")
        .expect("release child after closing stderr");
    let output = child.wait_with_output().expect("fault-test child output");
    assert!(output.status.success());
    assert!(output.stdout.windows(DONE.len()).any(|part| part == DONE));
}
