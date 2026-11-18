//! The program on a pseudo-terminal, as a person drives it, for the tests that need one.

#![allow(dead_code, reason = "each test file takes what it needs")]

use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};

#[path = "colour.rs"]
#[allow(
    clippy::duplicate_mod,
    reason = "a test that loads both helpers gets a second copy of this one list; each helper must also work alone"
)]
pub(crate) mod colour;

/// How long the program has to answer, a debug build on a busy machine.
const PATIENCE: Duration = Duration::from_secs(180);

/// What a session runs on and in.
pub(crate) struct Setting<'a> {
    pub(crate) rows: u16,
    pub(crate) columns: u16,
    pub(crate) term: &'a str,
    pub(crate) folder: &'a Path,
}

/// The program on a pseudo-terminal.
pub(crate) struct Session {
    child: Box<dyn Child + Send + Sync>,
    keys: Box<dyn Write + Send>,
    seen: Arc<Mutex<Vec<u8>>>,
    /// Where the next wait starts in what the program wrote.
    pub(crate) from: usize,
    terminal: Box<dyn MasterPty + Send>,
}

impl Session {
    /// `program` with `args` on 24 rows and 80 columns, in the tests' folder.
    pub(crate) fn start(program: &str, args: &[&str]) -> Self {
        let folder = Path::new(env!("CARGO_TARGET_TMPDIR"));
        let setting = Setting {
            rows: 24,
            columns: 80,
            term: "xterm-256color",
            folder,
        };
        Self::start_with(&setting, program, args)
    }

    /// `program` with `args` in `setting`, without the inherited colour settings: the setting's
    /// TERM alone decides colour.
    pub(crate) fn start_with(setting: &Setting<'_>, program: &str, args: &[&str]) -> Self {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: setting.rows,
                cols: setting.columns,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("a pseudo-terminal");
        let mut command = CommandBuilder::new(program);
        command.args(args);
        command.env("TERM", setting.term);
        for name in colour::SETTINGS {
            command.env_remove(name);
        }
        command.cwd(setting.folder);
        let mut reader = pair.master.try_clone_reader().expect("a reader");
        let keys = pair.master.take_writer().expect("a writer");
        let child = pair.slave.spawn_command(command).expect("the program runs");
        drop(pair.slave);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let filled = Arc::clone(&seen);
        // Own the child before thread creation, so unwinding also terminates it.
        let session = Self {
            child,
            keys,
            seen,
            from: 0,
            terminal: pair.master,
        };
        thread::spawn(move || {
            let mut chunk = [0; 4096];
            while let Ok(count) = reader.read(&mut chunk) {
                if count == 0 {
                    break;
                }
                let mut seen = filled.lock().expect("what was written");
                seen.extend_from_slice(&chunk[..count]);
            }
        });
        session
    }

    pub(crate) fn written(&self) -> String {
        let seen = self.seen.lock().expect("what was written");
        String::from_utf8_lossy(&seen).into_owned()
    }

    /// Waits until the program writes `text`, as a person sees it: its colours left out, unless
    /// `text` names terminal sequences itself.
    pub(crate) fn wait_for(&mut self, text: &str) {
        let deadline = Instant::now() + PATIENCE;
        loop {
            let written = self.written();
            if let Some(end) = shown_end(&written[self.from..], text) {
                self.from += end;
                return;
            }
            assert!(Instant::now() < deadline, "no {text:?} in {written:?}");
            thread::sleep(Duration::from_millis(10));
        }
    }

    /// Waits for the keys under a typed answer: "Press Esc to cancel", or "Esc menu" in a command
    /// that the menu started.
    pub(crate) fn wait_for_answer_keys(&mut self) {
        let deadline = Instant::now() + PATIENCE;
        loop {
            let written = self.written();
            let found = [" to cancel", " menu"]
                .iter()
                .filter_map(|text| written[self.from..].find(text).map(|at| at + text.len()))
                .min();
            if let Some(end) = found {
                self.from += end;
                return;
            }
            assert!(
                Instant::now() < deadline,
                "no keys under an answer in {written:?}"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    /// Gives the terminal `rows` and `columns`, as a person resizing its window does.
    pub(crate) fn resize(&self, rows: u16, columns: u16) {
        self.terminal
            .resize(PtySize {
                rows,
                cols: columns,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("the new size");
    }

    /// Whether the child has entered noncanonical input on the actual terminal.
    #[cfg(unix)]
    pub(crate) fn is_raw(&self) -> bool {
        self.terminal
            .get_termios()
            .is_some_and(|mode| mode.local_flags.bits() & libc::ICANON == 0)
    }

    /// The process of the program.
    pub(crate) fn process(&self) -> u32 {
        self.child.process_id().expect("a process")
    }

    pub(crate) fn press(&mut self, keys: &str) {
        self.keys.write_all(keys.as_bytes()).expect("the keys");
        self.keys.flush().expect("the keys");
    }

    /// Sends `signal`, by the name `kill` takes.
    pub(crate) fn signal(&self, signal: &str) {
        let process = self.child.process_id().expect("a process").to_string();
        let sent = Command::new("kill")
            .args(["-s", signal, &process])
            .status()
            .expect("kill runs");
        assert!(sent.success(), "{signal}");
    }

    /// What the program exits with, and all it wrote.
    pub(crate) fn end(mut self) -> (u32, String) {
        let deadline = Instant::now() + PATIENCE;
        loop {
            if let Some(status) = self.child.try_wait().expect("the program") {
                // The reader takes what was still under way.
                thread::sleep(Duration::from_millis(100));
                return (status.exit_code(), self.written());
            }
            assert!(
                Instant::now() < deadline,
                "still running: {}",
                self.written()
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        match self.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => cleanup_failure(&error),
        }
        // Drop also runs during a failed assertion: never panic or print the
        // captured terminal contents here. wait reaps even an exit/kill race.
        if let Err(error) = self.child.kill() {
            cleanup_failure(&error);
        }
        if let Err(error) = self.child.wait() {
            cleanup_failure(&error);
        }
    }
}

#[expect(
    clippy::disallowed_methods,
    reason = "best-effort public cleanup diagnostic only; no fixture or caller text is written"
)]
pub(crate) fn cleanup_failure(error: &std::io::Error) {
    // Drop cannot propagate a logging error, and must not panic while unwinding.
    let _reported = writeln!(
        std::io::stderr().lock(),
        "PTY test child cleanup failed: {error}"
    );
}

/// Where in `written` the first `text` ends, read without the colour sequences between its letters;
/// a `text` with sequences of its own is looked for as written.
fn shown_end(written: &str, text: &str) -> Option<usize> {
    if text.is_empty() || text.contains('\x1b') {
        return written.find(text).map(|at| at + text.len());
    }
    let bytes = written.as_bytes();
    let mut shown = String::with_capacity(written.len());
    // For each byte shown, where it ends in what was written.
    let mut ends = Vec::with_capacity(written.len());
    let mut chars = written.char_indices().peekable();
    while let Some((at, character)) = chars.next() {
        if character == '\x1b' && bytes.get(at + 1) == Some(&b'[') {
            let colour = bytes[at + 2..]
                .iter()
                .position(|byte| !(byte.is_ascii_digit() || *byte == b';'))
                .filter(|&length| bytes.get(at + 2 + length) == Some(&b'm'));
            if let Some(length) = colour {
                let after = at + 2 + length + 1;
                while chars.next_if(|&(next, _)| next < after).is_some() {}
                continue;
            }
        }
        shown.push(character);
        ends.extend(std::iter::repeat_n(
            at + character.len_utf8(),
            character.len_utf8(),
        ));
    }
    let start = shown.find(text)?;
    Some(ends[start + text.len() - 1])
}

/// The menu of `program` at the last question of a new color backup without Seedshift, shares or a
/// sheet for heirs: where it is saved.
pub(crate) fn at_where_a_color_backup_is_saved(program: &str) -> Session {
    let mut session = Session::start(program, &[]);
    session.wait_for("Choose an action");
    for (key, next) in [
        ("1", "Which form should the seed phrase take?"),
        ("5", "Use Seedshift?"),
        ("3", "Split it into Shamir shares?"),
        ("1", "Instructions for your heirs?"),
        ("1", "Where should the result be saved?"),
    ] {
        session.press(key);
        session.wait_for(next);
    }
    session
}
