//! What the tests of the commands that save cards share: a folder of the test's own with the public
//! inputs in it, the program run there, and what they read of the files it saves. The program runs
//! on public inputs only. Each run starts the program's self-test, so a test runs it as few times
//! as its rule needs.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![allow(dead_code, reason = "each test file takes what it needs")]
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "the test writes its public inputs to a folder of its own and runs the program there"
)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use mnemocode::self_check::vectors::{PUBLIC_MNEMONIC, PUBLIC_MNEMONIC_24};

/// The file of the public phrase in every folder.
pub(crate) const PHRASE: &str = "phrase.txt";
/// The file of the phrase of 24 words.
pub(crate) const LONG_PHRASE: &str = "long-phrase.txt";
/// The file of one public share.
pub(crate) const SHARE: &str = "share.txt";
/// The file of two public shares of one set.
pub(crate) const SHARES: &str = "shares.txt";
/// The file of two public dates.
pub(crate) const DATES: &str = "dates.txt";
/// The file of the most dates that a phrase takes: one for every three words of 24.
pub(crate) const MOST_DATES: &str = "most-dates.txt";
/// The file that no command may write.
pub(crate) const NEVER: &str = "never.pdf";
/// The first of a split of vectors/sskr-v1.json into any 2 of 3, and its second.
pub(crate) const PUBLIC_SHARES: [&str; 2] = [
    "ur:sskr/goemjzaeadaejoinoyvotkwlptsskispvwbkbwjnamstlubnampf",
    "ur:sskr/goemjzaeadadflihpkmhspcheycndschfhcmkelyvaveiesolrls",
];
/// What every file of a PDF starts with.
pub(crate) const PDF_START: &[u8] = b"%PDF-";
/// What every PNG file starts with.
pub(crate) const PNG_START: &[u8] = &[137, 80, 78, 71, 13, 10, 26, 10];

/// What every folder starts with.
const INPUTS: [&str; 6] = [PHRASE, LONG_PHRASE, SHARE, SHARES, DATES, MOST_DATES];

/// A new folder of the test `name` with the public phrases and shares in it: no earlier run's files
/// stay, as the commands that save need their names free.
pub(crate) fn folder(name: &str) -> PathBuf {
    let folder = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("cards")
        .join(name);
    let _absent = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).expect("a folder");
    for (file, text) in [
        (PHRASE, format!("{PUBLIC_MNEMONIC}\n")),
        (LONG_PHRASE, format!("{PUBLIC_MNEMONIC_24}\n")),
        (SHARE, format!("{}\n", PUBLIC_SHARES[0])),
        (SHARES, format!("{}\n", PUBLIC_SHARES.join("\n"))),
        (DATES, "23-09-2026\n08-08-1988\n".to_owned()),
        (
            MOST_DATES,
            (1..=8).map(|day| format!("{day:02}-01-2020\n")).collect(),
        ),
    ] {
        fs::write(folder.join(file), text).expect("a file");
    }
    folder
}

/// The names in `folder`, sorted, without the inputs that `folder` put there.
pub(crate) fn outputs(folder: &Path) -> Vec<String> {
    names(folder)
        .into_iter()
        .filter(|name| !INPUTS.contains(&name.as_str()))
        .collect()
}

/// The names in `folder`, sorted.
pub(crate) fn names(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(folder)
        .expect("a folder")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

/// `count` file names numbered from 1 after `start`, with the ending `end`.
pub(crate) fn numbered(start: &str, count: usize, end: &str) -> Vec<String> {
    (1..=count)
        .map(|number| format!("{start}{number:02}{end}"))
        .collect()
}

/// Runs the program in `folder`, without a terminal.
pub(crate) fn run(folder: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mnemocode"))
        .args(args)
        .current_dir(folder)
        .stdin(Stdio::null())
        .output()
        .expect("the program runs")
}

/// What `args` say on standard error, which must succeed.
#[track_caller]
pub(crate) fn saved(folder: &Path, args: &[&str]) -> String {
    let output = run(folder, args);
    let errors = String::from_utf8_lossy(&output.stderr).into_owned();
    assert_eq!(output.status.code(), Some(0), "{args:?}: {errors}");
    errors
}

/// Expects `args` to be refused with words that hold `refusal`, and nothing to be written.
#[track_caller]
pub(crate) fn assert_refused(folder: &Path, args: &[&str], refusal: &str) {
    let before = names(folder);
    let output = run(folder, args);
    let errors = String::from_utf8_lossy(&output.stderr);
    assert_ne!(output.status.code(), Some(0), "{args:?}: {errors}");
    assert!(errors.contains(refusal), "{args:?}: {errors}");
    assert_eq!(names(folder), before, "{args:?}");
}

/// The file `name` of `folder`.
pub(crate) fn read(folder: &Path, name: &str) -> Vec<u8> {
    fs::read(folder.join(name)).expect("a saved file")
}

/// The size of each page of the PDF `file`, in whole millimetres.
pub(crate) fn page_sizes(file: &[u8]) -> Vec<(u32, u32)> {
    const MEDIA_BOX: &str = "/MediaBox [0 0 ";
    let text = String::from_utf8_lossy(file);
    let millimetres = |points: &str| {
        let points: f64 = points.parse().expect("a number");
        (points * 25.4 / 72.0).round() as u32
    };
    text.split(MEDIA_BOX)
        .skip(1)
        .map(|rest| {
            let (sizes, _) = rest.split_once(']').expect("a box");
            let (width, height) = sizes.split_once(' ').expect("two numbers");
            (millimetres(width), millimetres(height))
        })
        .collect()
}

/// Expects the PDF `file` to say nothing of when and by what it was made.
#[track_caller]
pub(crate) fn assert_no_metadata(file: &[u8]) {
    for key in ["/Info", "/CreationDate", "/ModDate", "/Producer", "/Title"] {
        let found = file.windows(key.len()).any(|place| place == key.as_bytes());
        assert!(!found, "{key}");
    }
}

/// Expects the folder `path` to be open to its owner alone, where the file system says so.
#[track_caller]
pub(crate) fn assert_private(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path).expect("a folder").permissions().mode();
        assert_eq!(mode & 0o777, 0o700, "{}", path.display());
    }
    #[cfg(not(unix))]
    assert!(path.is_dir());
}

/// What a PDF reader reads on each page of the PDF at `path`, its white space as single spaces: the
/// words of a file as a person gets them, which the streams of the file hold compressed. None
/// without Poppler's pdftotext: as in TS's card-numbering, the check is then skipped, not faked.
pub(crate) fn printed_pages(path: &Path) -> Option<Vec<String>> {
    let output = Command::new("pdftotext")
        .arg("-layout")
        .arg(path)
        .arg("-")
        .output()
        .ok()?;
    assert!(output.status.success(), "{}", path.display());
    let text = String::from_utf8(output.stdout).expect("the text of a PDF");
    Some(
        text.trim_end_matches('\u{c}')
            .split('\u{c}')
            .map(|page| page.split_whitespace().collect::<Vec<_>>().join(" "))
            .collect(),
    )
}

/// Expects the PDF `sheet` to print, page by page, what the card files `folder`/01.pdf and on
/// print: one plan and one set of details in both, whatever was chosen at random. Skipped as
/// [`printed_pages`] says.
#[track_caller]
pub(crate) fn assert_same_cards(sheet: &Path, folder: &Path, count: usize) {
    let Some(pages) = printed_pages(sheet) else {
        return;
    };
    assert_eq!(pages.len(), count);
    for (page, name) in pages.iter().zip(numbered("", count, ".pdf")) {
        let card = printed_pages(&folder.join(&name)).expect("Poppler reads every file");
        assert_eq!(card, [page.as_str()], "{name}");
    }
}

/// Expects the page images `images`/page-01.png and on to be the very files `cards`/01.png and on:
/// one plan and one set of details in both, whatever was chosen at random.
#[track_caller]
pub(crate) fn assert_same_pictures(images: &Path, cards: &Path, count: usize) {
    assert_eq!(names(images), numbered("page-", count, ".png"));
    assert_eq!(names(cards), numbered("", count, ".png"));
    for number in 1..=count {
        let (page, card) = (format!("page-{number:02}.png"), format!("{number:02}.png"));
        assert!(read(images, &page) == read(cards, &card), "{card}");
    }
}
