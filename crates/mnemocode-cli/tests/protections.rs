//! What protects a running command, read from outside it, and colour by the environment
//! (docs/design/architect/GATES.md, `pty`): the system's own view of the process, the program's
//! report of what held, and a tracer refused. The program runs on the public test phrase.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![cfg(unix)]
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "the test reads the system's view of the program, and runs the program"
)]

#[path = "common/terminal.rs"]
mod terminal;

use std::process::{Command, Stdio};

use terminal::{Session, Setting};

const PROGRAM: &str = env!("CARGO_BIN_EXE_mnemocode");

/// The program with `args` and `environment`, its standard output as a pipe.
fn piped(args: &[&str], environment: &[(&str, &str)]) -> String {
    let output = Command::new(PROGRAM)
        .args(args)
        .env_remove("NO_COLOR")
        .env_remove("CLICOLOR_FORCE")
        .env_remove("CLICOLOR")
        .envs(environment.iter().copied())
        .stdin(Stdio::null())
        .output()
        .expect("the program runs");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

#[cfg(target_os = "linux")]
#[test]
fn the_system_sees_a_command_at_its_first_question_protected() {
    use std::fs;
    let mut session = Session::start(PROGRAM, &["decode", "--ask-secrets"]);
    session.wait_for("(Esc cancels)");
    let process = session.process();
    let limits = fs::read_to_string(format!("/proc/{process}/limits")).expect("its limits");
    let core = limits
        .lines()
        .find(|line| line.starts_with("Max core file size"))
        .expect("the limit of core files");
    assert_eq!(core.split_whitespace().nth(4), Some("0"), "{core}");
    assert_eq!(core.split_whitespace().nth(5), Some("0"), "{core}");
    let status = fs::read_to_string(format!("/proc/{process}/status")).expect("its status");
    let field = |name: &str| {
        status
            .lines()
            .find_map(|line| line.strip_prefix(name))
            .map(str::trim)
            .map(str::to_owned)
    };
    assert_eq!(field("TracerPid:").as_deref(), Some("0"), "{status}");
    assert_eq!(field("NoNewPrivs:").as_deref(), Some("1"), "{status}");
    assert_eq!(field("Seccomp:").as_deref(), Some("2"), "{status}");
    session.press("\x03");
    session.end();
}

#[cfg(target_os = "linux")]
#[test]
fn the_report_says_that_the_probes_of_the_kernel_held() {
    let report = piped(&["self-test"], &[]);
    assert!(report.contains("no core dumps"), "{report}");
    assert!(report.contains("no sockets"), "{report}");
    assert!(report.contains("memory cap"), "{report}");
}

#[cfg(target_os = "linux")]
#[test]
fn a_command_under_a_tracer_asks_for_no_secret() {
    let traced = Command::new("strace")
        .args(["-f", "-o", "/dev/null", PROGRAM, "decode", "--ask-secrets"])
        .stdin(Stdio::null())
        .output();
    // Where no strace is installed there is nothing to trace with.
    let Ok(traced) = traced else {
        return;
    };
    let errors = String::from_utf8_lossy(&traced.stderr);
    if errors.contains("ptrace") {
        return;
    }
    assert_eq!(traced.status.code(), Some(1), "{errors}");
    assert!(errors.contains("traces MnemoCode"), "{errors}");
}

#[test]
fn colour_follows_the_environment() {
    const STYLE: &str = "\x1b[";
    let args = ["table", "--word", "abandon"];
    assert!(!piped(&args, &[]).contains(STYLE));
    assert!(!piped(&["--help"], &[("NO_COLOR", "1"), ("CLICOLOR_FORCE", "1")]).contains(STYLE));
    assert!(piped(&["--help"], &[("CLICOLOR_FORCE", "1")]).contains(STYLE));
    let folder = std::path::Path::new(env!("CARGO_TARGET_TMPDIR"));
    let on = |term: &str| {
        let setting = Setting {
            rows: 24,
            columns: 80,
            term,
            folder,
        };
        Session::start_with(&setting, PROGRAM, &["--help"]).end().1
    };
    assert!(on("xterm-256color").contains(STYLE));
    assert!(!on("dumb").contains(STYLE));
}
