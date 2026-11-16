//! A result for the screen with standard output on a second terminal (AUD-007-SEC002): the private
//! screen is on the first, so the phrase goes there and is cleared with it; the second never sees it.
//! The public test phrase only.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![cfg(unix)]
#![expect(
    clippy::disallowed_methods,
    reason = "the test runs the program on two pseudo-terminals and waits for it"
)]

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use mnemocode::self_check::vectors::PUBLIC_UNICODE_CODES;
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};

const PROGRAM: &str = env!("CARGO_BIN_EXE_mnemocode");
/// A word of the public test phrase, which the codes decode to.
const WORD: &str = "abandon";

/// What `master` gets, read in the background.
fn collect(master: &dyn MasterPty) -> Arc<Mutex<Vec<u8>>> {
    let mut reader = master.try_clone_reader().expect("a reader");
    let seen = Arc::new(Mutex::new(Vec::new()));
    let filled = Arc::clone(&seen);
    thread::spawn(move || {
        let mut chunk = [0; 4096];
        while let Ok(count) = reader.read(&mut chunk) {
            if count == 0 {
                break;
            }
            filled
                .lock()
                .expect("what was written")
                .extend_from_slice(&chunk[..count]);
        }
    });
    seen
}

fn text(seen: &Arc<Mutex<Vec<u8>>>) -> String {
    String::from_utf8_lossy(&seen.lock().expect("what was written")).into_owned()
}

fn wait_for(seen: &Arc<Mutex<Vec<u8>>>, wanted: &str) {
    let until = Instant::now() + Duration::from_secs(180);
    while !text(seen).contains(wanted) {
        assert!(Instant::now() < until, "no {wanted:?} in {}", text(seen));
        thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn a_decoded_phrase_stays_off_a_second_terminal_on_standard_output() {
    let size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };
    let first = native_pty_system()
        .openpty(size)
        .expect("the first pseudo-terminal");
    let second = native_pty_system()
        .openpty(size)
        .expect("the second pseudo-terminal");
    let second_name = second
        .master
        .tty_name()
        .expect("the second terminal's name");
    let on_second = collect(second.master.as_ref());
    let on_first = collect(first.master.as_ref());
    let mut keys = first.master.take_writer().expect("a writer");
    let mut command = CommandBuilder::new("sh");
    command.args([
        "-c",
        "exec \"$0\" decode --ask-secrets --mode direct --format unicode > \"$1\"",
        PROGRAM,
        second_name.to_str().expect("a path"),
    ]);
    command.env("TERM", "xterm-256color");
    command.cwd(env!("CARGO_TARGET_TMPDIR"));
    let mut child = first
        .slave
        .spawn_command(command)
        .expect("the program runs");
    drop(first.slave);
    wait_for(&on_first, " to cancel");
    keys.write_all(format!("{}\r", PUBLIC_UNICODE_CODES.join(" ")).as_bytes())
        .expect("the codes");
    wait_for(&on_first, "Press Enter to clear this screen.");
    keys.write_all(b"\r").expect("Enter");
    let status = child.wait().expect("the program ends");
    assert!(status.success(), "{}", text(&on_first));
    assert!(
        text(&on_first).contains(WORD),
        "the private screen shows the phrase"
    );
    assert!(
        !text(&on_second).contains(WORD),
        "the second terminal got: {}",
        text(&on_second)
    );
    drop(second.slave);
}
