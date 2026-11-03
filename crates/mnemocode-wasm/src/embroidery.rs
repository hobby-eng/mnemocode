//! The embroidery part for a page (`browser-embroidery`): a phrase, masked with Seedshift dates,
//! hidden in the legend of a cross-stitch pattern of the page's picture, and a legend line read
//! back as the record of the masked phrase, which the recovery part decodes with the dates
//! (docs/SEEDSTITCH.md). The phrase, the dates and a legend cross as `JsValue`s that Rust reads
//! (ARCHITECTURE.md §6); the picture is no secret and crosses as bytes. What a page gets back holds
//! the masked phrase: it drops [`StitchPattern`] and [`StitchLegend`] soon after, which wipes them.

use mnemocode::self_check::{Check, Tier};
use mnemocode_embroidery::checks::ROW;
use mnemocode_embroidery::hide::{Hidden, hide};
use mnemocode_embroidery::phrase::{LineRecord, masked_entropy, record_of_legend};
use mnemocode_embroidery::picture::{self, DEFAULT_WIDTH, WIDTHS};
use mnemocode_embroidery::{chart, legend};
use wasm_bindgen::prelude::*;

use crate::host::{BrowserRandom, after_secret, phrase_and_dates, refused, text, whole};

/// A pattern whose legend holds a masked phrase, and how near it looks to its picture.
#[wasm_bindgen]
pub struct StitchPattern {
    hidden: Hidden,
    seen_difference: f64,
}

impl StitchPattern {
    /// [`StitchPattern::new`] of the text read, `width` stitches across.
    fn of_text(phrase: &str, dates: &str, picture: &[u8], width: u64) -> Result<Self, JsValue> {
        let width = WIDTHS
            .contains(width)
            .then_some(width as usize)
            .ok_or_else(|| refused(&picture::PictureError::WidthOutOfRange))?;
        let (phrase, dates) = phrase_and_dates(phrase, dates)?;
        let entropy = masked_entropy(&phrase, &dates).map_err(|refusal| refused(&refusal))?;
        let grid = picture::grid(picture, width).map_err(|refusal| refused(&refusal))?;
        let hidden =
            hide(&grid, &entropy, &mut BrowserRandom).map_err(|refusal| refused(&refusal))?;
        let seen_difference = hidden.pattern().seen_difference(&grid);
        Ok(Self {
            hidden,
            seen_difference,
        })
    }
}

#[wasm_bindgen]
impl StitchPattern {
    /// `phrase`, masked with `dates` (a typed line of them) by MnemoCode Seedshift, hidden in the
    /// legend of a pattern of `picture`, a PNG or JPEG file, `stitchesAcross` wide (0: 200).
    /// Refused as the library refuses the phrase, the dates, the picture and the width, and where
    /// the picture has too few colors to hold the phrase.
    #[wasm_bindgen(constructor)]
    pub fn new(
        phrase: JsValue,
        dates: JsValue,
        picture: &[u8],
        stitches_across: f64,
    ) -> Result<StitchPattern, JsValue> {
        let width = match whole(stitches_across) {
            0 => DEFAULT_WIDTH as u64,
            width => width,
        };
        after_secret(|| Self::of_text(&text(&phrase)?, &text(&dates)?, picture, width))
    }

    /// The legend as a person types it back: each row's symbol number, a colon and its stitches.
    pub fn legend(&self) -> Result<String, JsValue> {
        after_secret(|| {
            legend::line(self.hidden.rows())
                .map(|line| line.as_str().to_owned())
                .map_err(|refusal| refused(&refusal))
        })
    }

    /// The pattern as a PDF: a cover, the legend and the chart pages.
    pub fn pdf(&self) -> Result<Vec<u8>, JsValue> {
        after_secret(|| {
            chart::chart(&self.hidden)
                .map(|pdf| pdf.to_vec())
                .map_err(|refusal| refused(&refusal))
        })
    }

    /// The rows of the legend.
    #[wasm_bindgen(getter)]
    pub fn rows(&self) -> usize {
        self.hidden.rows().len()
    }

    /// The stitches across.
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> usize {
        self.hidden.pattern().width()
    }

    /// The stitches down.
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> usize {
        self.hidden.pattern().height()
    }

    /// The stitches moved to set the counts.
    #[wasm_bindgen(getter)]
    pub fn moved(&self) -> usize {
        self.hidden.moved()
    }

    /// How far the pattern is from the picture, seen from a little distance: the mean CIELAB
    /// difference of the two, each blurred.
    #[wasm_bindgen(getter, js_name = seenDifference)]
    pub fn seen_difference(&self) -> f64 {
        self.seen_difference
    }
}

/// A legend line read back.
#[wasm_bindgen]
pub struct StitchLegend(LineRecord);

#[wasm_bindgen]
impl StitchLegend {
    /// The record of the masked phrase, `MNC1:seedshift:indexes:…`, which the recovery part decodes
    /// with the dates.
    pub fn record(&self) -> String {
        after_secret(|| self.0.record().as_str().to_owned())
    }

    /// The row, from 1, that did not fit and was read as the only change of it that gives a phrase,
    /// for the page to ask the person to check it; undefined where the line read as it is.
    #[wasm_bindgen(getter, js_name = correctedRow)]
    pub fn corrected_row(&self) -> Option<usize> {
        self.0.corrected_row()
    }
}

/// The legend line `line` read back; undefined where the text is no legend line, such as codes or a
/// record. Refused for a line that is no legend, or that reads as no phrase or as more than one.
#[wasm_bindgen(js_name = readStitchLegend)]
pub fn read_stitch_legend(line: JsValue) -> Result<Option<StitchLegend>, JsValue> {
    after_secret(|| {
        record_of_legend(&text(&line)?)
            .map(|read| read.map(StitchLegend))
            .map_err(|refusal| refused(&refusal))
    })
}

/// The embroidery part's known answers: the startup cases, or with `full` every case.
#[wasm_bindgen(js_name = selfCheckEmbroidery)]
pub fn self_check_embroidery(full: bool) -> Result<(), JsValue> {
    let tier = if full { Tier::Full } else { Tier::Startup };
    ROW.run(tier).map_err(|failure| refused(&failure))
}

#[cfg(test)]
mod tests {
    use mnemocode_embroidery::legend::EXAMPLE;
    use mnemocode_embroidery::sample::gradient_png;

    use super::*;

    /// Trezor's published 24-word test vector.
    const VOID: &str = "void come effort suffer camp survey warrior heavy shoot primary clutch crush \
                        open amazing screen patrol group space point ten exist slush involve unfold";

    #[test]
    fn a_pattern_is_made_and_its_legend_read_back_as_the_library_does() {
        let pattern = StitchPattern::of_text(VOID, "23-09-2026", &gradient_png(), 120).unwrap();
        assert_eq!(pattern.width(), 120);
        assert!(pattern.rows() >= 12);
        assert!(pattern.pdf().unwrap().starts_with(b"%PDF-"));
        let legend = pattern.legend().unwrap();
        let read = record_of_legend(&legend).unwrap().unwrap();
        assert_eq!(read.corrected_row(), None);
        assert!(
            read.record()
                .as_str()
                .starts_with("MNC1:seedshift:indexes:")
        );
        assert!(record_of_legend(EXAMPLE).unwrap().is_some());
        assert!(record_of_legend("1 2 3").unwrap().is_none());
        assert!(self_check_embroidery(false).is_ok());
    }
}
