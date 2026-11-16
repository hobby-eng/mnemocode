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

// The original Seedshift in a pattern: every word but the last is kept, the warning says so, and
// Decode gives every last word the owner may have had, the real phrase among them. No sheet for
// heirs leads through a replaced last word.
#[test]
fn a_pattern_of_the_original_seedshift_keeps_all_but_the_last_word() {
    let folder = with_picture("stitch-original");
    let legacy = [
        "--mode",
        "seedshift-legacy",
        "--picture",
        PICTURE,
        "--stitches-across",
        "120",
    ];
    let made = run(
        &folder,
        &stitch(
            &[
                &legacy[..],
                &["--pdf", "pattern.pdf", "--output", "legend.txt"],
            ]
            .concat(),
        ),
    );
    let errors = String::from_utf8_lossy(&made.stderr);
    assert_eq!(made.status.code(), Some(0), "{errors}");
    assert!(
        errors.contains("Only the Original Seedshift loses a word")
            && errors.contains("keeps 11 of the 12 words")
            && errors.contains("real last word"),
        "{errors}"
    );
    // What Encode says of a replaced last word: the link, and the words it names with the
    // result, in the stream that holds the legend.
    assert!(errors.contains("#transformation-modes"), "{errors}");
    let result = if errors.contains("Legend line") {
        errors.clone().into_owned()
    } else {
        String::from_utf8_lossy(&made.stdout).into_owned()
    };
    assert!(result.contains("decoding lists the candidates"), "{result}");
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
    assert_eq!(output.lines().count(), 128, "{output}");
    assert!(output.contains(PUBLIC_MNEMONIC), "{output}");
    assert_refused(
        &folder,
        &stitch(
            &[
                &legacy[..],
                &["--pdf", "heirs-pattern.pdf", "--heir-sheet", "heirs.pdf"],
            ]
            .concat(),
        ),
        "sheet",
    );
}
