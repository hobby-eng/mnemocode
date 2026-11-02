//! AUD-001's probes of the executable: what a file, a path or a person can do at its edges, on the
//! public test phrase only. Each line says ok or FAIL; the program exits 1 if any probe failed.
//!
//! Usage: probes <rust-executable> <empty-work-folder>

use std::fs;
use std::io::Write as _;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::Path;
use std::process::{Command, ExitCode, Output, Stdio};
use std::time::{Duration, Instant};

const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

struct Probes {
    exe: String,
    work: String,
    failed: usize,
}

impl Probes {
    fn run(&self, args: &[&str]) -> Output {
        self.run_with(args, &[])
    }

    fn run_with(&self, args: &[&str], stdin: &[u8]) -> Output {
        let mut child = Command::new(&self.exe)
            .args(args)
            .current_dir(&self.work)
            .env("NO_COLOR", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("the executable must start");
        let mut pipe = child.stdin.take().expect("a pipe");
        // A refusal may close the pipe early: what it did not read is not the probe's concern.
        let _ = pipe.write_all(stdin);
        drop(pipe);
        child.wait_with_output().expect("the executable must end")
    }

    fn check(&mut self, name: &str, holds: bool, shown: &Output) {
        if holds {
            println!("ok    {name}");
        } else {
            self.failed += 1;
            println!(
                "FAIL  {name}\n      exit {:?}\n      stdout {}\n      stderr {}",
                shown.status.code(),
                String::from_utf8_lossy(&shown.stdout),
                String::from_utf8_lossy(&shown.stderr)
            );
        }
    }

    fn path(&self, name: &str) -> String {
        format!("{}/{name}", self.work)
    }
}

/// Whether a command ended by itself with a refusal and left no trace of a crash.
fn refused(output: &Output) -> bool {
    output.status.code() == Some(1) && !output.stderr.windows(5).any(|bytes| bytes == b"panic")
}

/// Whether `output` shows the phrase's text or a control byte that moves the cursor.
fn echoes(output: &Output, text: &str) -> bool {
    let both = [output.stdout.as_slice(), output.stderr.as_slice()].concat();
    String::from_utf8_lossy(&both).contains(text)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [exe, work] = args.as_slice() else {
        eprintln!("Usage: probes <rust-executable> <empty-work-folder>");
        return ExitCode::from(2);
    };
    let mut probes = Probes { exe: exe.clone(), work: work.clone(), failed: 0 };
    fs::write(probes.path("phrase.txt"), format!("{PHRASE}\n")).expect("the work folder");
    let encode = ["encode", "--mnemonic-file", "phrase.txt", "--mode", "direct", "--format", "3", "--output"];
    let output_to = |name: &str| {
        let mut args = encode.to_vec();
        args.push(Box::leak(name.to_owned().into_boxed_str()));
        args
    };

    // Outputs.
    let out = probes.run(&output_to("record.txt"));
    let mode = fs::metadata(probes.path("record.txt")).map(|file| file.permissions().mode() & 0o777);
    probes.check("a saved record is readable by its owner alone", out.status.success() && mode.ok() == Some(0o600), &out);

    symlink(probes.path("target-new.txt"), probes.path("dangling.txt")).expect("a link");
    let out = probes.run(&output_to("dangling.txt"));
    probes.check("a dangling link as output writes nothing through it", !Path::new(&probes.path("target-new.txt")).exists(), &out);

    fs::write(probes.path("kept.txt"), "kept\n").expect("the work folder");
    symlink(probes.path("kept.txt"), probes.path("link.txt")).expect("a link");
    let out = probes.run(&output_to("link.txt"));
    let kept = fs::read_to_string(probes.path("kept.txt")).unwrap_or_default();
    probes.check("a link to a file as output leaves that file as it was", kept == "kept\n", &out);

    let out = probes.run(&output_to("phrase.txt"));
    let phrase = fs::read_to_string(probes.path("phrase.txt")).unwrap_or_default();
    probes.check("an output named as the input is refused and the input stays", refused(&out) && phrase.starts_with(PHRASE), &out);

    let leftovers: Vec<_> = fs::read_dir(&probes.work)
        .expect("the work folder")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with('.') || name.contains("tmp") || name.contains("staging"))
        .collect();
    let out = probes.run(&["table", "--word", "abandon"]);
    probes.check("no staging file stays behind", leftovers.is_empty(), &out);

    // Inputs of the wrong kind.
    let out = probes.run(&["encode", "--mnemonic-file", ".", "--mode", "direct", "--format", "3"]);
    probes.check("a folder as input is refused", refused(&out), &out);

    let start = Instant::now();
    let out = probes.run(&["encode", "--mnemonic-file", "/dev/zero", "--mode", "direct", "--format", "3"]);
    probes.check("an endless device as input is refused at once", refused(&out) && start.elapsed() < Duration::from_secs(5), &out);

    let long = vec![b'a'; 64 * 1024 * 1024];
    let start = Instant::now();
    let out = probes.run_with(&["decode", "--input-file", "-", "--mode", "direct"], &long);
    probes.check("64 MiB on standard input is refused at the limit", refused(&out) && start.elapsed() < Duration::from_secs(5), &out);

    fs::write(probes.path("latin.txt"), [0xff, 0xfe, b'a', b' ', 0xc3]).expect("the work folder");
    let out = probes.run(&["encode", "--mnemonic-file", "latin.txt", "--mode", "direct", "--format", "3"]);
    probes.check("a file that is not UTF-8 is refused", refused(&out), &out);

    // Refusals say nothing of what was typed.
    let out = probes.run(&["encode", "--mnemonic", PHRASE, "--mode", "direct"]);
    probes.check("a phrase as an argument is refused and not repeated", refused(&out) && !echoes(&out, "abandon"), &out);
    let out = probes.run(&["encode", "--mnemonic-file", "phrase.txt", "--mode", PHRASE]);
    probes.check("a phrase as a mode is refused and not repeated", refused(&out) && !echoes(&out, "abandon"), &out);
    let out = probes.run(&["encode", &format!("--{}", PHRASE.replace(' ', "-"))]);
    probes.check("a phrase as an option is refused and not repeated", refused(&out) && !echoes(&out, "abandon"), &out);
    let out = probes.run(&[PHRASE]);
    probes.check("a phrase as a command is refused and not repeated", refused(&out) && !echoes(&out, "abandon"), &out);

    // A file name cannot drive the terminal.
    let hostile = "name\u{1b}[2J\u{7}.txt";
    let out = probes.run(&["encode", "--mnemonic-file", hostile, "--mode", "direct", "--format", "3"]);
    let both = [out.stdout.as_slice(), out.stderr.as_slice()].concat();
    probes.check("a control character of a path is not shown", refused(&out) && !both.contains(&0x1b), &out);

    if probes.failed == 0 {
        println!("all probes held");
        ExitCode::SUCCESS
    } else {
        println!("{} probes failed", probes.failed);
        ExitCode::FAILURE
    }
}
