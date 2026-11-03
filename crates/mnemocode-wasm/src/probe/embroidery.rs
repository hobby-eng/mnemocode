//! The embroidery's entries of the memory scan: a public phrase, masked with its dates, hidden in a
//! pattern of a public picture, its legend and its PDF given out, and the legend read back, as a
//! page does.

use mnemocode_embroidery::phrase::masked_entropy;
use mnemocode_embroidery::sample::gradient_png;

use super::{Given, Met, js};
use crate::embroidery::{StitchPattern, read_stitch_legend};
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
    );
    let Some(pattern) = met.ok("stitch pattern", made) else {
        return;
    };
    let Some(legend) = met.ok("stitch legend", pattern.legend()) else {
        return;
    };
    met.text(&legend);
    met.ok("stitch pdf", pattern.pdf());
    if let Some(Some(read)) = met.ok("read stitch legend", read_stitch_legend(js(&legend))) {
        let record = met.gave("stitch record", read.record());
        met.text(&record);
    }
}
