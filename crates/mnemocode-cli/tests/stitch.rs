//! `mnemocode stitch` from the command line: its options and its picture refused before the phrase
//! is read, the pattern and its legend saved, and the legend read back by Decode as the phrase it
//! holds, a mistyped row corrected and named. The program runs on public inputs, in a folder of each
//! test's own.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![expect(
    clippy::disallowed_methods,
    reason = "the test writes its public picture to the folder that it runs in"
)]

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use common::{DATES, PDF_START, PHRASE, assert_refused, folder, read, run, saved};
use mnemocode::self_check::vectors::PUBLIC_MNEMONIC;

/// The picture in every folder of these tests.
const PICTURE: &str = "gradient.png";

/// A folder of the test `name` with the public inputs and a picture of smooth shades.
fn with_picture(name: &str) -> PathBuf {
    let folder = folder(name);
    fs::write(
        folder.join(PICTURE),
        mnemocode_embroidery::sample::gradient_png(),
    )
    .expect("a picture");
    folder
}

/// What Decode says on standard error of the legend saved in `folder`, which must give the public
/// phrase back, with the public dates where `dated`: the legend line, or the pattern's PDF that
/// keeps it.
#[track_caller]
fn decoded_legend(folder: &Path, (file, dated): (&str, bool)) -> String {
    let mut decode = vec!["decode", "--input-file", file];
    if dated {
        decode.extend(["--dates-file", DATES]);
    }
    let output = run(folder, &decode);
    let errors = String::from_utf8_lossy(&output.stderr).into_owned();
    assert_eq!(output.status.code(), Some(0), "{errors}");
    assert!(String::from_utf8_lossy(&output.stdout).contains(PUBLIC_MNEMONIC));
    errors
}

/// `stitch` on the public phrase and dates, with `more` options.
fn stitch<'a>(more: &[&'a str]) -> Vec<&'a str> {
    let mut args = vec!["stitch", "--mnemonic-file", PHRASE, "--dates-file", DATES];
    args.extend_from_slice(more);
    args
}

#[test]
fn the_options_and_the_picture_are_refused_before_the_phrase_is_read() {
    let folder = with_picture("stitch-refusals");
    assert_refused(&folder, &stitch(&["--pdf", "p.pdf"]), "--picture PATH");
    assert_refused(&folder, &stitch(&["--picture", PICTURE]), "--pdf PATH");
    let narrow = ["--picture", PICTURE, "--pdf", "p.pdf", "--stitches-across"];
    assert_refused(
        &folder,
        &stitch(&[&narrow[..], &["39"]].concat()),
        "40 through 500",
    );
    assert_refused(
        &folder,
        &stitch(&[&narrow[..], &["300"]].concat()),
        "narrower than the pattern",
    );
    assert_refused(
        &folder,
        &stitch(&[&narrow[..], &["120", "--fabric", "linen-41"]].concat()),
        "linen-N for linen of N threads an inch",
    );
    assert_refused(
        &folder,
        &stitch(&["--picture", PHRASE, "--pdf", "p.pdf"]),
        "no PNG, JPEG or WebP",
    );
    fs::create_dir(folder.join("photos")).expect("a folder");
    assert_refused(
        &folder,
        &stitch(&["--picture", "photos", "--pdf", "p.pdf"]),
        "must be a regular file",
    );
}

/// The pattern here is for linen stitched over one thread, which only the cover and the skeins
/// tell from Aida.
#[test]
fn a_phrase_hidden_without_seedshift_reads_back_with_no_dates() {
    let folder = with_picture("stitch-direct");
    let args = [
        "stitch",
        "--mode",
        "direct",
        "--mnemonic-file",
        PHRASE,
        "--picture",
        PICTURE,
        "--stitches-across",
        "120",
        "--fabric",
        "linen-28",
        "--pdf",
        "pattern.pdf",
        "--output",
        "legend.txt",
    ];
    saved(&folder, &args);
    decoded_legend(&folder, ("legend.txt", false));
}

#[test]
fn the_legend_saved_reads_back_as_the_phrase_and_a_mistyped_row_is_named() {
    let folder = with_picture("stitch-legend");
    saved(
        &folder,
        &stitch(&[
            "--picture",
            PICTURE,
            "--stitches-across",
            "120",
            "--pdf",
            "pattern.pdf",
            "--output",
            "legend.txt",
        ]),
    );
    assert!(read(&folder, "pattern.pdf").starts_with(PDF_START));
    let legend = String::from_utf8(read(&folder, "legend.txt")).expect("a line");
    // The PDF keeps the line where Decode finds it; a PDF without one is refused in its own words.
    decoded_legend(&folder, ("pattern.pdf", true));
    fs::write(folder.join("other.pdf"), b"%PDF-1.7\n%%EOF\n").expect("a file");
    assert_refused(
        &folder,
        &["decode", "--input-file", "other.pdf", "--dates-file", DATES],
        "keeps no legend",
    );
    // A pattern's PDF with a QR image too is two sources, refused as any two are.
    let two = ["--input-file", "pattern.pdf", "--qr-file", PICTURE];
    for command in [
        &["decode"][..],
        &["recover-date"],
        &["re-encode", "--format", "5", "--recognised"],
    ] {
        assert_refused(
            &folder,
            &[command, &two[..]].concat(),
            "Choose one encoded input source",
        );
    }
    assert!(mnemocode_embroidery::legend::is_line(&legend), "{legend}");
    decoded_legend(&folder, ("legend.txt", true));
    // The last digit of the least row that carries one, changed, is found and named: a row of
    // 100 stitches or more, other than the biggest, which carries none.
    let rows: Vec<&str> = legend.split_whitespace().collect();
    let counts: Vec<u32> = rows
        .iter()
        .map(|row| {
            row.split_once(':')
                .expect("a row")
                .1
                .parse()
                .expect("a count")
        })
        .collect();
    let biggest = counts.iter().copied().max().expect("rows");
    let (count, place) = counts
        .iter()
        .enumerate()
        .filter(|&(_, &count)| count >= 100 && count != biggest)
        .map(|(place, &count)| (count, place))
        .min()
        .expect("a row that carries a digit");
    let symbol = rows[place].split_once(':').expect("a row").0;
    let mistyped = format!("{symbol}:{}", count - count % 10 + (count + 1) % 10);
    let mut changed = rows.clone();
    changed[place] = mistyped.as_str();
    fs::write(folder.join("legend.txt"), changed.join(" ")).expect("a line");
    let errors = decoded_legend(&folder, ("legend.txt", true));
    let named = format!("Row {} of the legend did not fit", place + 1);
    assert!(errors.contains(&named), "{errors}");
}

// A pattern is a new backup like any other: the legend line as text, a QR code of it, the copies
// on the screen and the sheet for heirs, as Encode saves and shows them.
#[test]
fn a_pattern_saves_and_shows_what_every_new_backup_does() {
    let folder = with_picture("stitch-common");
    let shown = run(
        &folder,
        &stitch(&[
            "--picture",
            PICTURE,
            "--stitches-across",
            "120",
            "--pdf",
            "pattern.pdf",
            "--output",
            "legend.txt",
            "--qr",
            "legend.png",
            "--show-original",
            "words",
            "--show-masked-words",
            "--heir-sheet",
            "heirs.pdf",
        ]),
    );
    let errors = String::from_utf8_lossy(&shown.stderr);
    assert_eq!(shown.status.code(), Some(0), "{errors}");
    let output = String::from_utf8_lossy(&shown.stdout);
    assert!(
        output.contains(PUBLIC_MNEMONIC),
        "the original copy: {output}"
    );
    assert!(
        output.contains("Seedshift phrase"),
        "the masked words: {output}"
    );
    assert!(read(&folder, "heirs.pdf").starts_with(PDF_START));
    // The QR code holds the legend line, which Decode reads back as the phrase.
    let qr = run(
        &folder,
        &["decode", "--qr-file", "legend.png", "--dates-file", DATES],
    );
    assert_eq!(
        qr.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&qr.stderr)
    );
    assert!(String::from_utf8_lossy(&qr.stdout).contains(PUBLIC_MNEMONIC));
    decoded_legend(&folder, ("legend.txt", true));
    // Masked words need Seedshift, as in Encode; refused before the phrase is read.
    assert_refused(
        &folder,
        &[
            "stitch",
            "--mnemonic-file",
            PHRASE,
            "--picture",
            PICTURE,
            "--pdf",
            "direct.pdf",
            "--mode",
            "direct",
            "--show-masked-words",
        ],
        "Seedshift",
    );
}

// The original Seedshift in a pattern keeps every word, the last one too: no warning, Decode gives
// the phrase itself, and the sheet for heirs is made as for any pattern.
#[test]
fn a_pattern_of_the_original_seedshift_keeps_every_word() {
    let folder = with_picture("stitch-original");
    let made = run(
        &folder,
        &stitch(&[
            "--mode",
            "seedshift-legacy",
            "--picture",
            PICTURE,
            "--stitches-across",
            "120",
            "--pdf",
            "pattern.pdf",
            "--output",
            "legend.txt",
            "--heir-sheet",
            "heirs.pdf",
        ]),
    );
    let errors = String::from_utf8_lossy(&made.stderr);
    assert_eq!(made.status.code(), Some(0), "{errors}");
    assert!(!errors.contains("last word"), "{errors}");
    assert!(read(&folder, "heirs.pdf").starts_with(PDF_START));
    let decoded = run(
        &folder,
        &[
            "decode",
            "--input-file",
            "legend.txt",
            "--dates-file",
            DATES,
        ],
    );
    let output = String::from_utf8_lossy(&decoded.stdout);
    assert_eq!(
        decoded.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&decoded.stderr)
    );
    assert_eq!(output.matches(PUBLIC_MNEMONIC).count(), 1, "{output}");
    assert!(!output.contains("candidates"), "{output}");
}

/// Restores the public phrase from the shares of patterns in `files`, text files of legend lines or
/// the patterns' PDFs; its exit code and what it wrote.
fn restored(folder: &Path, files: &[&str]) -> (Option<i32>, String) {
    let mut args = vec!["sskr-combine", "--mode", "seedshift", "--dates-file", DATES];
    for file in files {
        args.extend(["--share-file", file]);
    }
    let output = run(folder, &args);
    let written = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    (output.status.code(), written)
}

// One pattern a Shamir share, all from the same picture: any two of three restore the phrase, from
// their legend lines or from their PDFs, and one alone does not.
#[test]
fn any_two_of_three_patterns_of_shares_restore_the_phrase() {
    let folder = with_picture("stitch-shares");
    let output = run(
        &folder,
        &stitch(&[
            "--picture",
            PICTURE,
            "--threshold",
            "2",
            "--shares",
            "3",
            "--pdf-dir",
            "patterns",
            "--output",
            "legends.txt",
            "--qr-dir",
            "legend-qr",
        ]),
    );
    let shown = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(output.status.code(), Some(0), "{shown}");
    assert!(shown.contains("Share 3 of 3"), "{shown}");
    for place in 1..=3 {
        let pdf = read(&folder, &format!("patterns/share-{place}-pattern.pdf"));
        assert!(pdf.starts_with(PDF_START));
        assert!(
            folder
                .join(format!("legend-qr/share-{place}-qr.png"))
                .is_file()
        );
    }
    let legends = String::from_utf8(read(&folder, "legends.txt")).expect("text");
    let lines: Vec<&str> = legends.lines().collect();
    assert_eq!(lines.len(), 3);
    assert!(lines[0] != lines[1] && lines[1] != lines[2]);
    fs::write(
        folder.join("two.txt"),
        format!("{}\n{}\n", lines[0], lines[2]),
    )
    .expect("written");
    let (code, written) = restored(&folder, &["two.txt"]);
    assert_eq!(code, Some(0), "{written}");
    assert!(written.contains(PUBLIC_MNEMONIC), "{written}");
    let pdfs = [
        "patterns/share-2-pattern.pdf",
        "patterns/share-3-pattern.pdf",
    ];
    let (code, written) = restored(&folder, &pdfs);
    assert_eq!(code, Some(0), "{written}");
    assert!(written.contains(PUBLIC_MNEMONIC), "{written}");
    fs::write(folder.join("one.txt"), lines[1]).expect("written");
    let (code, written) = restored(&folder, &["one.txt"]);
    assert_ne!(code, Some(0), "{written}");
    assert!(!written.contains(PUBLIC_MNEMONIC), "{written}");
    // A legend copied from the screen, wrapped over several lines, is one share again.
    let rows: Vec<&str> = lines[1].split(' ').collect();
    let (top, rest) = rows.split_at(rows.len() / 2);
    let wrapped = format!(
        "\u{feff}{}\n{}\n{}\n",
        top.join(" "),
        rest.join(" "),
        lines[0]
    );
    fs::write(folder.join("wrapped.txt"), wrapped).expect("written");
    let (code, written) = restored(&folder, &["wrapped.txt"]);
    assert_eq!(code, Some(0), "{written}");
    assert!(written.contains(PUBLIC_MNEMONIC), "{written}");
    // The legends say that Seedshift masked the phrase: a restore without it is refused.
    let output = run(
        &folder,
        &[
            "sskr-combine",
            "--mode",
            "direct",
            "--share-file",
            "two.txt",
        ],
    );
    let written = String::from_utf8_lossy(&output.stderr);
    assert_ne!(output.status.code(), Some(0), "{written}");
    assert!(written.contains("masked with Seedshift"), "{written}");
}

// With shares every pattern has its own files: the options of one pattern are refused, and so are
// those of shares without a set, all before the phrase is read.
#[test]
fn the_options_of_one_pattern_and_of_shares_do_not_mix() {
    let folder = with_picture("stitch-share-options");
    let set = ["--picture", PICTURE, "--threshold", "2", "--shares", "3"];
    assert_refused(
        &folder,
        &stitch(&[&set[..], &["--pdf", "p.pdf"]].concat()),
        "not --pdf",
    );
    assert_refused(&folder, &stitch(&set), "--pdf-dir PATH");
    assert_refused(
        &folder,
        &stitch(&["--picture", PICTURE, "--pdf-dir", "patterns"]),
        "add --threshold and --shares",
    );
    assert_refused(
        &folder,
        &stitch(&[&set[..], &["--pdf-dir", "p", "--mode", "seedshift-legacy"]].concat()),
        "",
    );
}
