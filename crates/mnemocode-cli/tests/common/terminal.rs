//! The program on a pseudo-terminal, as a person drives it, for the tests that need one.

#![allow(dead_code, reason = "each test file takes what it needs")]

use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};

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

    /// `program` with `args` in `setting`.
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
        command.cwd(setting.folder);
        let child = pair.slave.spawn_command(command).expect("the program runs");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("a reader");
        let seen = Arc::new(Mutex::new(Vec::new()));
        let filled = Arc::clone(&seen);
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
        Self {
            child,
            keys: pair.master.take_writer().expect("a writer"),
            seen,
            from: 0,
            terminal: pair.master,
        }
    }

    pub(crate) fn written(&self) -> String {
        let seen = self.seen.lock().expect("what was written");
        String::from_utf8_lossy(&seen).into_owned()
    }

    /// Waits until the program writes `text`.
    pub(crate) fn wait_for(&mut self, text: &str) {
        let deadline = Instant::now() + PATIENCE;
        loop {
            let written = self.written();
            if let Some(at) = written[self.from..].find(text) {
                self.from += at + text.len();
                return;
            }
            assert!(Instant::now() < deadline, "no {text:?} in {written:?}");
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
