//! AUD-001's differential run: the same inputs, on synthetic phrases from a fixed generator, go to
//! the Rust executable and to a reference program (MnemoCode 0.1.0), and each command must end the
//! same way: exit code, standard output, standard error and the files it writes. Inputs are also
//! damaged at random, so that the two programs meet records and shares no recording holds.
//!
//! Usage: aud001-differential <rust-executable> <work-folder> <cases> <seed> <reference command...>
//! It exits 1 if any case differs, 2 if it could not run; every difference is written to
//! <work-folder>/differences.txt.

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

/// SplitMix64: a public, fixed sequence, so that a run can be repeated; nothing here is a secret.
struct Generator(u64);

impl Generator {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn below(&mut self, upper: usize) -> usize {
        (self.next() % upper as u64) as usize
    }

    fn pick<'a>(&mut self, choices: &'a [&'a str]) -> &'a str {
        choices[self.below(choices.len())]
    }
}

/// The outcome of one command in one folder.
#[derive(PartialEq, Eq, Debug)]
struct Outcome {
    code: Option<i32>,
    out: String,
    err: String,
    files: Vec<(String, Vec<u8>)>,
}

/// Runs `program` with `args` in a new folder that holds `inputs`.
fn run(program: &[String], folder: &Path, inputs: &[(&str, &str)], args: &[String]) -> Outcome {
    let _ = fs::remove_dir_all(folder);
    fs::create_dir_all(folder).expect("the work folder must be writable");
    for (name, text) in inputs {
        fs::write(folder.join(name), text).expect("the work folder must be writable");
    }
    let output = Command::new(&program[0])
        .args(&program[1..])
        .args(args)
        .current_dir(folder)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .output()
        .expect("the program must start");
    let mut names: Vec<_> = fs::read_dir(folder)
        .expect("the work folder must be readable")
        .map(|entry| entry.expect("an entry").path())
        .filter(|path| path.is_file())
        .collect();
    names.sort();
    let files = names
        .iter()
        .map(|path| {
            let name = path.file_name().expect("a name").to_string_lossy().into_owned();
            (name, fs::read(path).expect("a written file"))
        })
        .filter(|(name, _)| !inputs.iter().any(|(input, _)| input == name))
        .collect();
    Outcome {
        code: output.status.code(),
        out: String::from_utf8_lossy(&output.stdout).into_owned(),
        err: String::from_utf8_lossy(&output.stderr).into_owned(),
        files,
    }
}

/// One run of the harness: both programs, its folders, its counts and its report.
struct Run {
    rust: Vec<String>,
    reference: Vec<String>,
    work: PathBuf,
    cases: usize,
    differences: usize,
    report: String,
}

impl Run {
    /// Runs one case in both programs and compares them; gives the reference's outcome.
    fn compare(&mut self, label: &str, inputs: &[(&str, &str)], args: &[&str]) -> Outcome {
        let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        let rust = run(&self.rust, &self.work.join("case"), inputs, &args);
        let reference = run(&self.reference, &self.work.join("case"), inputs, &args);
        self.cases += 1;
        if rust != reference {
            self.note(label, inputs, &args, &rust, &reference);
        }
        reference
    }

    /// Writes a difference into the report.
    fn note(
        &mut self,
        label: &str,
        inputs: &[(&str, &str)],
        args: &[String],
        rust: &Outcome,
        reference: &Outcome,
    ) {
        self.differences += 1;
        let _ = writeln!(self.report, "=== {label}: {}", args.join(" "));
        for (name, text) in inputs {
            let _ = writeln!(self.report, "--- input {name}\n{text}");
        }
        let _ = writeln!(self.report, "--- rust      {:?}\n{}\n{}", rust.code, rust.out, rust.err);
        let _ = writeln!(self.report, "--- reference {:?}\n{}\n{}", reference.code, reference.out, reference.err);
        for (side, outcome) in [("rust", rust), ("reference", reference)] {
            for (name, bytes) in &outcome.files {
                let _ = writeln!(self.report, "--- {side} file {name}: {} bytes", bytes.len());
            }
        }
    }

    /// Says that `what` failed.
    fn fail(&mut self, label: &str, what: &str) {
        self.differences += 1;
        let _ = writeln!(self.report, "=== {label}: {what}");
    }

    /// Runs `args` in `program` and keeps the file `name` it writes.
    fn written(&self, program: &[String], inputs: &[(&str, &str)], args: &[&str], name: &str) -> Option<String> {
        let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        let outcome = run(program, &self.work.join("case"), inputs, &args);
        let file = outcome.files.iter().find(|(file, _)| file == name)?;
        String::from_utf8(file.1.clone()).ok()
    }
}

/// A synthetic phrase of 12 to 24 words.
fn phrase(generator: &mut Generator) -> String {
    let bytes = [16, 20, 24, 28, 32][generator.below(5)];
    let entropy: Vec<u8> = (0..bytes).map(|_| generator.next() as u8).collect();
    bip39::Mnemonic::from_entropy(&entropy).expect("a valid length").to_string()
}

/// A date of the kind that a person writes down, with a four-digit year.
fn date(generator: &mut Generator) -> String {
    format!(
        "{:02}-{:02}-{}",
        1 + generator.below(28),
        1 + generator.below(12),
        1950 + generator.below(120)
    )
}

/// `text` damaged in one of the ways that a copy by hand or a bad scan gives.
fn damaged(generator: &mut Generator, text: &str) -> String {
    let characters: Vec<char> = text.chars().collect();
    let at = generator.below(characters.len().max(1));
    let words: Vec<&str> = text.split_whitespace().collect();
    let word = generator.below(words.len().max(1));
    match generator.below(11) {
        0 => {
            let mut changed = characters.clone();
            changed[at] = char::from(b'a' + generator.below(26) as u8);
            changed.into_iter().collect()
        }
        1 => {
            let mut changed = characters.clone();
            changed.remove(at);
            changed.into_iter().collect()
        }
        2 => {
            let mut changed = characters.clone();
            changed.insert(at, '?');
            changed.into_iter().collect()
        }
        3 => {
            let mut changed = words.clone();
            changed.remove(word);
            changed.join(" ")
        }
        4 => {
            let mut changed = words.clone();
            changed[word] = "?";
            changed.join(" ")
        }
        5 => {
            let mut changed = words.clone();
            changed.swap(word, generator.below(words.len().max(1)));
            changed.join(" ")
        }
        6 => text.to_uppercase(),
        7 => text.replace(' ', "  ").replace(':', " : "),
        8 => format!("\u{feff}{text}"),
        9 => text.replace('\n', "\r\n").replace(' ', "\t"),
        _ => {
            let mut changed = characters.clone();
            changed.insert(at, generator.pick(&["\u{a0}", "\u{200b}", "é", "\u{5bf6}", "\t", "\n"]).chars().next().unwrap_or(' '));
            changed.into_iter().collect()
        }
    }
}

/// The cases of one synthetic phrase.
fn cases_of_phrase(run: &mut Run, generator: &mut Generator) {
    let phrase = phrase(generator);
    let words: Vec<&str> = phrase.split(' ').collect();
    let dates: Vec<String> = (0..1 + generator.below(words.len() / 3)).map(|_| date(generator)).collect();
    let date_lines = dates.join("\n") + "\n";
    let phrase_line = format!("{phrase}\n");
    let (mode, extra) = [
        ("direct", None),
        ("seedshift", None),
        ("seedshift-legacy", None),
        ("seedshift-legacy", Some("--legacy-valid-last-word")),
    ][generator.below(4)];
    let format = generator.pick(&["1", "2", "3", "4", "5"]);
    let inputs = [("phrase.txt", phrase_line.as_str()), ("dates.txt", date_lines.as_str())];

    let mut encode = vec!["encode", "--mnemonic-file", "phrase.txt", "--mode", mode, "--format", format, "--output", "record.txt"];
    if mode != "direct" {
        encode.extend(["--dates-file", "dates.txt"]);
    }
    encode.extend(extra);
    let outcome = run.compare("encode", &inputs, &encode);
    let Some((_, record)) = outcome.files.iter().find(|(name, _)| name == "record.txt") else {
        return;
    };
    let record = String::from_utf8_lossy(record).into_owned();

    let with_record = [("record.txt", record.as_str()), ("dates.txt", date_lines.as_str())];
    let dates_needed = mode != "direct";
    let mut decode = vec!["decode", "--input-file", "record.txt"];
    if dates_needed {
        decode.extend(["--dates-file", "dates.txt"]);
    }
    let restored = run.compare("decode", &with_record, &decode);
    if extra.is_none() && !restored.out.contains(&phrase) {
        run.fail("decode", &format!("the reference did not restore the phrase of mode {mode}"));
    }

    for _ in 0..3 {
        let broken = damaged(generator, &record);
        let inputs = [("record.txt", broken.as_str()), ("dates.txt", date_lines.as_str())];
        run.compare("damaged record", &inputs, &decode);
    }

    let mut pattern: Vec<char> = dates[0].chars().collect();
    pattern[generator.below(2)] = '?';
    let pattern: String = pattern.into_iter().collect();
    let patterns = std::iter::once(pattern)
        .chain(dates[1..].iter().cloned())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    if dates_needed && extra.is_none() {
        let inputs = [("record.txt", record.as_str()), ("dates.txt", patterns.as_str())];
        let args = ["recover-date", "--input-file", "record.txt", "--dates-file", "dates.txt", "--master-fingerprint", "73c5da0a"];
        run.compare("recover-date", &inputs, &args);
    }

    let mut marked = words.clone();
    marked[generator.below(words.len())] = "?";
    if generator.below(3) == 0 {
        marked[generator.below(words.len())] = "ab*";
    }
    let marked = marked.join(" ") + "\n";
    run.compare("recover-word", &[("phrase.txt", marked.as_str())], &["recover-word", "--mnemonic-file", "phrase.txt"]);

    if !marked.contains("ab*") {
        let args = ["recover-word", "--mnemonic-file", "phrase.txt", "--candidates-file", "list.mncl", "--plaintext-candidates"];
        run.compare("candidate list", &[("phrase.txt", marked.as_str())], &args);
    }

    // English words and word numbers are never saved unmasked.
    let qr_format = generator.pick(&["3", "4", "5"]);
    let qr_args = ["encode", "--mnemonic-file", "phrase.txt", "--mode", "direct", "--format", qr_format, "--qr", "code.png"];
    for (first, second) in [("rust", "reference"), ("reference", "rust")] {
        let (from, to) = if first == "rust" { (run.rust.clone(), run.reference.clone()) } else { (run.reference.clone(), run.rust.clone()) };
        let folder = run.work.join("case");
        let args: Vec<String> = qr_args.iter().map(|arg| (*arg).to_owned()).collect();
        let written = crate::run(&from, &folder, &[("phrase.txt", phrase_line.as_str())], &args);
        let Some((_, image)) = written.files.iter().find(|(name, _)| name == "code.png") else {
            run.fail("qr", &format!("{first} wrote no image"));
            continue;
        };
        let image = image.clone();
        let other = run.work.join("other");
        let _ = fs::remove_dir_all(&other);
        fs::create_dir_all(&other).expect("the work folder must be writable");
        fs::write(other.join("code.png"), image).expect("the work folder must be writable");
        let read = Command::new(&to[0])
            .args(&to[1..])
            .args(["decode", "--qr-file", "code.png"])
            .current_dir(&other)
            .env("NO_COLOR", "1")
            .stdin(Stdio::null())
            .output()
            .expect("the program must start");
        if !String::from_utf8_lossy(&read.stdout).contains(&phrase) {
            run.fail("qr", &format!("{second} did not read the image of {first}: {}", String::from_utf8_lossy(&read.stderr)));
        }
    }

    let word = words[generator.below(words.len())];
    let index = generator.below(2050).to_string();
    run.compare("table", &[], &["table", "--word", word]);
    run.compare("table", &[], &["table", "--index", &index]);

    let share_format = generator.pick(&["ur", "words", "indexes", "unicode", "colors", "colors-unicode"]);
    let split = ["sskr-split", "--mnemonic-file", "phrase.txt", "--threshold", "2", "--shares", "3", "--format", share_format, "--output", "shares.txt"];
    for (first, second) in [("rust", "reference"), ("reference", "rust")] {
        let (from, to) = if first == "rust" { (run.rust.clone(), run.reference.clone()) } else { (run.reference.clone(), run.rust.clone()) };
        let Some(shares) = run.written(&from, &[("phrase.txt", phrase_line.as_str())], &split, "shares.txt") else {
            run.fail("sskr-split", &format!("{first} wrote no shares of form {share_format}"));
            continue;
        };
        let args: Vec<String> = ["sskr-combine", "--share-file", "shares.txt"].iter().map(|arg| (*arg).to_owned()).collect();
        let outcome = crate::run(&to, &run.work.join("case"), &[("shares.txt", shares.as_str())], &args);
        if outcome.code != Some(0) || !outcome.out.contains(&phrase) {
            run.fail("sskr-combine", &format!("{second} did not restore the shares of {first} in form {share_format}: {}", outcome.err));
        }
        if first == "reference" {
            let broken = damaged(generator, &shares);
            run.compare("damaged shares", &[("shares.txt", broken.as_str())], &["sskr-combine", "--share-file", "shares.txt"]);
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 5 {
        eprintln!("Usage: aud001-differential <rust-executable> <work-folder> <cases> <seed> <reference command...>");
        return ExitCode::from(2);
    }
    let (Ok(phrases), Ok(seed)) = (args[2].parse::<usize>(), args[3].parse::<u64>()) else {
        eprintln!("The cases and the seed are whole numbers.");
        return ExitCode::from(2);
    };
    let mut run = Run {
        rust: vec![args[0].clone()],
        reference: args[4..].to_vec(),
        work: PathBuf::from(&args[1]),
        cases: 0,
        differences: 0,
        report: String::new(),
    };
    let mut generator = Generator(seed);
    for done in 0..phrases {
        cases_of_phrase(&mut run, &mut generator);
        fs::write(run.work.join("differences.txt"), &run.report).expect("the work folder must be writable");
        println!("phrase {} of {phrases}: {} cases, {} differences", done + 1, run.cases, run.differences);
    }
    if run.differences == 0 { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}
