//! The self-test (MnemoCode TS 0.1.0's `cli/self-test.ts`, CAP-CLI-SELF-TEST): the library's rows
//! of this build, with the command line's around them, and the quick checks before every command.

use std::fmt;
use std::path::Path;

use mnemocode::checks::public_vectors::PUBLIC_VECTORS;
use mnemocode::checks::{ROUND_TRIPS, rows, startup};
use mnemocode::refusal::Refusal;
use mnemocode::self_check::vectors::{FIRST_SHARE_COLORS, OFFICIAL_SHARES};
use mnemocode::self_check::{Check, CheckFailure, Tier, expect_refused, expect_same, ok};
use mnemocode_cards::checks::{self as card_checks, CARD_EXPORT};

use super::VERSION;
use super::cards::{save_qr_beside, save_qr_inside};
use super::given::PATH_LIMIT;
use crate::gate::Stop;
use crate::input::{answered_text, read_qr_bytes};
use crate::os::{self, Protection};
use crate::terminal::{
    self, Channel, beside_mark, can_redraw, heading_line, paint, seconds_of, style,
};

/// The column of the names of the checks, as wide as the longest name with room to spare.
const NAME_WIDTH: usize = 24;
/// The mark before a check's name on a terminal, and its space.
const CHECK_MARK: &str = "✓ ";
/// Where a check's detail starts on a terminal: after its mark, its name's column and a space.
const DETAIL_COLUMN: usize = 2 + NAME_WIDTH + 1;
/// What stands before the summary on a terminal.
const PASSED: &str = "✓ Passed:";
/// The rule above and below the rows where nothing is drawn.
const RULE: &str = "────────────────────────────────────────────────────────────────────────";
/// Holds a time and its unit together while a line is broken at spaces.
const NO_BREAK_SPACE: &str = "\u{a0}";
/// What a refusal of the self-test's own text files names them by.
const TEST_FILE: &str = "The test file";
/// The row that the check of text files stands before, as in TS's report.
const AFTER_TEXT_FILES: &str = "QR adapter";
/// The row that the rows of the cards stand before.
const AFTER_CARDS: &str = "Word hints";

/// A failure of the quick checks, before any secret is read.
#[derive(Debug)]
struct CoreFailed(CheckFailure);

impl fmt::Display for CoreFailed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "CRITICAL: MnemoCode core self-test failed.\nNo mnemonic data was processed.\n{}",
            self.0
        )
    }
}

impl std::error::Error for CoreFailed {}

impl Refusal for CoreFailed {
    fn code(&self) -> &'static str {
        "cli.self-test.critical-mnemo-code-core-self-test-failed-no"
    }
}

/// The quick checks before a command: a failure stops it before any secret is read, with a message
/// that never names the secret.
pub(crate) fn assert_core() -> Result<(), Stop> {
    startup()
        .and_then(|()| card_checks::startup())
        .and_then(|()| text_file_startup())
        .map_err(|failure| CoreFailed(failure).into())
}

/// Inline input stays inline and a remote file link fails before any text is read.
fn text_file_startup() -> Result<(), CheckFailure> {
    let share = OFFICIAL_SHARES[0];
    let inline = ok(answered_text(share, TEST_FILE, PATH_LIMIT))?;
    expect_same(inline.as_str(), share, "An inline UR is no file path")?;
    expect_refused(
        answered_text("file://example.invalid/backup.txt", TEST_FILE, PATH_LIMIT),
        "cli.text-file.local-file-required",
        "A remote file link",
    )
}

/// One synthetic share file read without changing its lines.
fn text_file_input() -> Result<(), CheckFailure> {
    text_file_startup()?;
    let checked = os::in_temporary_folder("mnemocode-self-test-", |folder| {
        let path = folder.join("public shares.txt");
        let text = format!("{}\n{}\n", OFFICIAL_SHARES[0], OFFICIAL_SHARES[2]);
        ok(os::write_new_private_file(&path, text.as_bytes()).map_err(os::FileError::from))?;
        let quoted = format!("\"{}\"", path.to_string_lossy());
        let read = ok(answered_text(&quoted, TEST_FILE, PATH_LIMIT))?;
        expect_same(read.as_str(), text.as_str(), "All share file lines")?;
        let missing = folder.join("missing.txt");
        expect_refused(
            answered_text(&missing.to_string_lossy(), TEST_FILE, PATH_LIMIT),
            "cli.bounded-read.file-unreadable",
            "A missing text file",
        )
    });
    ok(checked.map_err(os::FileError::from))?
}

/// The QR image that a sheet's QR code is also saved as: beside the PDF and named after it, under
/// the next free name when that is taken, inside a folder of cards by a share's reference, and read
/// back as the first share of the official vector; an empty one refused.
fn qr_beside_sheets() -> Result<(), CheckFailure> {
    let saved = |result: Result<Option<String>, Stop>, name: &'static str| {
        result.ok().flatten().ok_or(CheckFailure::Mismatch(name))
    };
    let checked = os::in_temporary_folder("mnemocode-self-test-", |folder| {
        let in_folder = |name: &str| folder.join(name).to_string_lossy().into_owned();
        let sheet = in_folder("cards.pdf");
        let name = "QR image beside a PDF";
        let beside = saved(save_qr_beside(FIRST_SHARE_COLORS, &sheet, ""), name)?;
        expect_same(beside.as_str(), in_folder("cards-qr.png").as_str(), name)?;
        let name = "QR image beside a PDF under a taken name";
        let next = saved(save_qr_beside(FIRST_SHARE_COLORS, &sheet, ""), name)?;
        expect_same(next.as_str(), in_folder("cards-qr-1.png").as_str(), name)?;
        let name = "QR image inside a folder of cards";
        let folder_text = folder.to_string_lossy();
        let inside = saved(
            save_qr_inside(FIRST_SHARE_COLORS, &folder_text, "4BBF-1-1"),
            name,
        )?;
        expect_same(inside.as_str(), in_folder("4BBF-1-1-qr.png").as_str(), name)?;
        let image = ok(read_qr_bytes(Path::new(&beside)))?;
        expect_same(
            ok(mnemocode::qr::read_png(&image))?.as_str(),
            FIRST_SHARE_COLORS,
            "QR image beside a PDF read back",
        )?;
        expect_refused(
            mnemocode::qr::png(""),
            "export.qr-image.qr-payload-not-empty",
            "An empty QR image",
        )
    });
    ok(checked.map_err(os::FileError::from))?
}

/// The rows that passed, each with its name and what it covers, timed.
#[derive(Default)]
struct Report(Vec<(String, String)>);

impl Report {
    /// Runs `check`, a row that fails ending the report, unless an ending signal has come.
    fn run(
        &mut self,
        name: &str,
        detail: &str,
        check: impl FnOnce() -> Result<(), CheckFailure>,
    ) -> Result<(), CheckFailure> {
        // The command ends with the signal (main), whatever is still to run.
        if os::pending_signal().is_some() {
            return Ok(());
        }
        let seconds = seconds_of(check)?;
        self.0.push((
            name.to_owned(),
            format!("{detail} ({:.1} ms)", seconds * 1000.0),
        ));
        Ok(())
    }

    /// Prints the report, in the tools' terminal look on a terminal.
    fn print(&self, summary: &str) -> Result<(), Stop> {
        let mut lines = Vec::new();
        if can_redraw(Channel::Output) {
            lines.push(String::new());
            lines.push(heading_line(
                Channel::Output,
                &format!("Self-test {VERSION}"),
            ));
            let muted = |line: &str| paint(Channel::Output, style::MUTED, line);
            for (name, detail) in &self.0 {
                let mark = paint(Channel::Output, style::GOOD, CHECK_MARK);
                let mark = format!("{mark}{name:<NAME_WIDTH$} ");
                lines.extend(report_lines(&mark, DETAIL_COLUMN, detail, &muted));
            }
            let mark = format!("{} ", paint(Channel::Output, style::GOOD, PASSED));
            let plain = |line: &str| line.to_owned();
            lines.extend(report_lines(
                &mark,
                PASSED.chars().count() + 1,
                summary,
                &plain,
            ));
        } else {
            lines.push(format!("MnemoCode {VERSION} self-test"));
            lines.push(RULE.to_owned());
            for (name, detail) in &self.0 {
                lines.push(format!("✓ {name:<NAME_WIDTH$} {detail}"));
            }
            lines.push(RULE.to_owned());
            lines.push(format!("PASS  {summary}"));
        }
        for line in lines {
            terminal::result_line(&line);
        }
        Ok(())
    }
}

/// A line of the report on a terminal, wrapped under its own column; a time stays whole on its line.
fn report_lines(
    mark: &str,
    indent: usize,
    text: &str,
    style: &dyn Fn(&str) -> String,
) -> Vec<String> {
    let kept = text.replace(" ms", &format!("{NO_BREAK_SPACE}ms"));
    let restored = |line: &str| style(&line.replace(NO_BREAK_SPACE, " "));
    beside_mark(mark, indent, &kept, &restored)
}

/// Runs the self-test: `protection` as this run holds it, then every row of this build.
pub(crate) fn run(protection: &Protection) -> Result<(), Stop> {
    let mut report = Report::default();
    let total = seconds_of(|| {
        report.run("Process protection", &protection.summary(), || {
            protection.refusal().map_or(Ok(()), |reason| {
                Err(CheckFailure::Refused {
                    code: "cli.protection.protection-refused",
                    message: reason,
                })
            })
        })?;
        report.run("System sandbox", &protection.report(), || Ok(()))?;
        for row in rows() {
            if row.name() == AFTER_CARDS {
                for cards in card_checks::ROWS {
                    report.run(cards.name(), cards.detail(), || cards.run(Tier::Full))?;
                }
            }
            if row.name() == AFTER_TEXT_FILES {
                let detail = "local UTF-8 file, share lines retained, missing file refused";
                report.run("Text file input", detail, text_file_input)?;
            }
            report.run(row.name(), row.detail(), || row.run(Tier::Full))?;
        }
        let detail = "PNG named after its PDF, free names, read back";
        report.run("QR beside sheets", detail, qr_beside_sheets)?;
        report.run(CARD_EXPORT.name(), CARD_EXPORT.detail(), || {
            CARD_EXPORT.run(Tier::Full)
        })?;
        Ok::<_, CheckFailure>(())
    })?;
    if os::pending_signal().is_some() {
        return Err(Stop::Cancelled);
    }
    report.print(&format!(
        "{} public vectors; {ROUND_TRIPS} representation round trips; {:.1} ms total.",
        PUBLIC_VECTORS.len(),
        total * 1000.0
    ))
}
