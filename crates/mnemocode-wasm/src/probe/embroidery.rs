//! The embroidery's entries of the memory scan: a public phrase, masked with its dates and then
//! itself, hidden in a pattern of a public picture, its legend and its PDF given out, and the legend
//! read back, typed and from the PDF, as a page does.

use mnemocode_embroidery::phrase::masked_entropy;
use mnemocode_embroidery::sample::gradient_png;

use super::{Given, Met, js};
use crate::embroidery::{
    StitchPattern, StitchShares, read_stitch_legend, read_stitch_pdf, read_stitch_share_legend,
};
use crate::files::{BackupFiles, read_backup_file};
use crate::host::phrase_and_dates;

/// Stitches across the pattern: few, since the gate interprets the WebAssembly, and enough for a
/// legend of the phrase.
const STITCHES_ACROSS: f64 = 120.0;

/// Calls the secret entries of the embroidery on `given`'s phrase and dates; where the walk is
/// telling, it says the masked phrase's entropy, which the legend holds.
pub(super) fn embroidery_entries(given: Given<'_>, met: &mut Met) {
    if met.telling {
        let masked = phrase_and_dates(given.phrase, given.dates)
            .ok()
            .and_then(|(phrase, dates)| masked_entropy(&phrase, &dates).ok());
        match masked {
            Some(entropy) => met.bytes(entropy.bytes()),
            None => met.failed("masked entropy"),
        }
    }
    let made = StitchPattern::new(
        js(given.phrase),
        js(given.dates),
        &gradient_png(),
        STITCHES_ACROSS,
        None,
    );
    let Some(pattern) = met.ok("stitch pattern", made) else {
        return;
    };
    let Some(legend) = met.ok("stitch legend", pattern.legend()) else {
        return;
    };
    met.text(&legend);
    if let Some(Some(read)) = met.ok("read stitch legend", read_stitch_legend(js(&legend))) {
        let record = met.gave("stitch record", read.record());
        met.text(&record);
    }
    let pdf = met.ok("stitch pdf", pattern.pdf(Some("linen-28".to_owned())));
    if let Some(pdf) = &pdf
        && let Some(Some(read)) = met.ok("read stitch pdf", read_stitch_pdf(pdf))
    {
        let record = met.gave("stitch pdf record", read.record());
        met.text(&record);
    }
    if let Some(pdf) = &pdf {
        file_entries(pdf, met);
    }
    share_entries(given, met);
    let direct = StitchPattern::new(
        js(given.phrase),
        js(""),
        &gradient_png(),
        STITCHES_ACROSS,
        Some("direct".to_owned()),
    );
    if let Some(pattern) = met.ok("stitch pattern of the phrase itself", direct)
        && let Some(legend) = met.ok("stitch legend of the phrase itself", pattern.legend())
    {
        met.text(&legend);
    }
}

/// The files part on a pattern's PDF, as a page reads a file picked: alone, and among the files of
/// a folder.
fn file_entries(pdf: &[u8], met: &mut Met) {
    if let Some(file) = met.ok("read backup file", read_backup_file(pdf)) {
        if let Some(Some(codes)) = met.ok("backup file codes", file.codes()) {
            met.text(&codes);
        }
        met.gave("backup file form", file.form());
    }
    let mut files = BackupFiles::new();
    met.ok("add backup file", files.add(pdf, "patterns/pattern.pdf"));
    let found = files.finish(Some("patterns".to_owned()));
    if let Some(Some(text)) = met.ok("found backup text", found.text(0.0)) {
        met.text(&text);
    }
}

/// Two shares of `given`'s phrase, each hidden in a pattern of the public picture, a legend and a
/// PDF given out.
fn share_entries(given: Given<'_>, met: &mut Met) {
    let made = StitchShares::new(
        js(given.phrase),
        js(given.dates),
        &gradient_png(),
        STITCHES_ACROSS,
        None,
        2.0,
        2.0,
    );
    let Some(shares) = met.ok("stitch shares", made) else {
        return;
    };
    if let Some(Some(legend)) = met.ok("stitch share legend", shares.legend(0.0)) {
        met.text(&legend);
        // The first pattern's legend reads back as share 1 of the set of 2, which the split made.
        match met.ok("read share legend", read_stitch_share_legend(js(&legend))) {
            Some(Some(read)) => {
                if read.member() != 1 || read.threshold() != 2 {
                    met.failed("share legend metadata");
                }
                let share = met.gave("share of a legend", read.share());
                met.text(&share);
            }
            Some(None) => met.failed("read share legend"),
            None => {}
        }
    }
    met.ok("stitch share pdf", shares.pdf(1.0, None));
}
