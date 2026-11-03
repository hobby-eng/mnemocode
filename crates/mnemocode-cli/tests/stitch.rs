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
/// phrase back with the public dates.
#[track_caller]
fn decoded_legend(folder: &Path) -> String {
    let decode = [
        "decode",
        "--input-file",
        "legend.txt",
        "--dates-file",
        DATES,
    ];
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
        &stitch(&["--picture", PHRASE, "--pdf", "p.pdf"]),
        "no PNG or JPEG",
    );
    fs::create_dir(folder.join("photos")).expect("a folder");
    assert_refused(
        &folder,
        &stitch(&["--picture", "photos", "--pdf", "p.pdf"]),
        "must be a regular file",
    );
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
    assert!(mnemocode_embroidery::legend::is_line(&legend), "{legend}");
    decoded_legend(&folder);
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
    let errors = decoded_legend(&folder);
    let named = format!("Row {} of the legend did not fit", place + 1);
    assert!(errors.contains(&named), "{errors}");
}
