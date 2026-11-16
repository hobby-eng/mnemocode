//! The embroidery part for a page (`browser-embroidery`): a phrase, masked with Seedshift dates
//! unless the page asks otherwise, hidden in the legend of a pattern of the page's picture; and a
//! legend line or pattern PDF read back as its phrase's record (docs/SEEDSTITCH.md). Secrets cross
//! as `JsValue`s that Rust reads (ARCHITECTURE.md §6); results hold the phrase, so a page drops
//! [`StitchPattern`] and [`StitchLegend`] soon after, which wipes them.

use std::fmt;

use mnemocode::modes::Mode;
use mnemocode::refusal::Refusal;
use mnemocode::self_check::{Check, Tier};
use mnemocode::text::numbers::WholeRange;
use mnemocode_embroidery::checks::ROW;
use mnemocode_embroidery::fabric::{self, DEFAULT_FABRIC, DETAILED_ACROSS, Fabric, OfferedSize};
use mnemocode_embroidery::hide::{Hidden, hide};
use mnemocode_embroidery::phrase::{LineRecord, legend_entropy, record_of_legend};
use mnemocode_embroidery::picture::{self, DEFAULT_WIDTH, WIDTHS};
use mnemocode_embroidery::{chart, legend};
use wasm_bindgen::prelude::*;

use crate::host::{BrowserRandom, after_secret, phrase_and_dates, place, refused, text, whole};

/// The fabric that `named` names as `stitch --fabric` does ("14" or "linen-28"), 14-count Aida
/// where a page leaves it out.
fn fabric_of(named: Option<String>) -> Result<Fabric, JsValue> {
    named
        .as_deref()
        .map_or(Ok(DEFAULT_FABRIC), Fabric::named)
        .map_err(|refusal| refused(&refusal))
}

/// A pattern whose legend holds a phrase, and how near it looks to its picture.
#[wasm_bindgen]
pub struct StitchPattern {
    hidden: Hidden,
    seen_difference: f64,
}

impl StitchPattern {
    /// [`StitchPattern::new`] of the text read, `width` stitches across, in `mode`.
    fn of_text(
        (phrase, dates): (&str, &str),
        picture: &[u8],
        width: u64,
        mode: Mode,
    ) -> Result<Self, JsValue> {
        let width = WIDTHS
            .contains(width)
            .then_some(width as usize)
            .ok_or_else(|| refused(&picture::PictureError::WidthOutOfRange))?;
        let (phrase, dates) = phrase_and_dates(phrase, dates)?;
        let entropy = legend_entropy(&phrase, mode, &dates).map_err(|refusal| refused(&refusal))?;
        let grid = picture::grid(picture, width).map_err(|refusal| refused(&refusal))?;
        let hidden =
            hide(&grid, &entropy, &mut BrowserRandom).map_err(|refusal| refused(&refusal))?;
        let seen_difference = hidden.pattern().seen_difference(&grid);
        Ok(Self {
            hidden,
            seen_difference,
        })
    }

    /// [`StitchPattern::pdf`] for `fabric`.
    fn pdf_for(&self, fabric: Fabric) -> Result<Vec<u8>, JsValue> {
        chart::chart(&self.hidden, fabric)
            .map(|pdf| pdf.to_vec())
            .map_err(|refusal| refused(&refusal))
    }
}

#[wasm_bindgen]
impl StitchPattern {
    /// `phrase`, masked with `dates` (a typed line) by Seedshift, hidden in the legend of a pattern
    /// of `picture` (PNG, JPEG or WebP), `stitchesAcross` wide (0: 200). `mode` may be left out, or
    /// is "seedshift" or "direct" (the phrase itself, no dates, readable by anyone). Refused as the
    /// library refuses its inputs, and where the picture has too few colors to hold the phrase.
    #[wasm_bindgen(constructor)]
    pub fn new(
        phrase: JsValue,
        dates: JsValue,
        picture: &[u8],
        stitches_across: f64,
        mode: Option<String>,
    ) -> Result<StitchPattern, JsValue> {
        let width = match whole(stitches_across) {
            0 => DEFAULT_WIDTH as u64,
            width => width,
        };
        after_secret(|| {
            let mode = mode.as_deref().map_or(Ok(Mode::Seedshift), Mode::named);
            let mode = mode.map_err(|refusal| refused(&refusal))?;
            Self::of_text((&text(&phrase)?, &text(&dates)?), picture, width, mode)
        })
    }

    /// The legend as a person types it back: each row's symbol number, a colon and its stitches.
    pub fn legend(&self) -> Result<String, JsValue> {
        after_secret(|| {
            legend::line(self.hidden.rows())
                .map(|line| line.as_str().to_owned())
                .map_err(|refusal| refused(&refusal))
        })
    }

    /// The pattern as a PDF dressed as a bought one: a cover, the floss key and the chart in colour,
    /// for `fabric`, as `stitch --fabric` names it ("14" or "linen-28"), 14-count Aida where a page
    /// leaves it out. The key page keeps the legend line, which [`read_stitch_pdf`] reads back.
    pub fn pdf(&self, fabric: Option<String>) -> Result<Vec<u8>, JsValue> {
        after_secret(|| self.pdf_for(fabric_of(fabric)?))
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

/// How large a pattern of a picture may be on a fabric, as the menu offers it: the sheets from A6 to
/// A2 that hold the picture, each with the stitches it takes there, and the widths the picture
/// allows. The picture is no secret.
#[wasm_bindgen]
pub struct StitchSizes {
    offered: Vec<OfferedSize>,
    widths: WholeRange,
    fabric: Fabric,
}

#[wasm_bindgen]
impl StitchSizes {
    /// The sizes of `picture`, a PNG, JPEG or WebP file, on `fabric` ("14" or "linen-28"; 14-count
    /// Aida where a page leaves it out). Refused as the library refuses the picture and the fabric.
    #[wasm_bindgen(constructor)]
    pub fn new(picture: &[u8], fabric: Option<String>) -> Result<StitchSizes, JsValue> {
        let fabric = fabric_of(fabric)?;
        let size = picture::upright_size(picture).map_err(|refusal| refused(&refusal))?;
        let widths = fabric::widths(size).map_err(|refusal| refused(&refusal))?;
        Ok(Self {
            offered: fabric::offered_sizes(size, fabric),
            widths,
            fabric,
        })
    }

    /// How many sheets hold the picture.
    #[wasm_bindgen(getter)]
    pub fn count(&self) -> usize {
        self.offered.len()
    }

    /// The name of the sheet at `at`, smallest first, as "A4"; none past the last.
    pub fn name(&self, at: f64) -> Option<String> {
        self.offered
            .get(place(at))
            .map(|size| size.format.name.to_owned())
    }

    /// The stitches across the picture takes in the sheet at `at`; none past the last.
    pub fn across(&self, at: f64) -> Option<usize> {
        self.offered.get(place(at)).map(|size| size.across)
    }

    /// The stitches down the picture takes in the sheet at `at`; none past the last.
    pub fn down(&self, at: f64) -> Option<usize> {
        self.offered.get(place(at)).map(|size| size.down)
    }

    /// The short side of the sheet at `at`, in millimetres; none past the last.
    #[wasm_bindgen(js_name = shortSide)]
    pub fn short_side(&self, at: f64) -> Option<f64> {
        self.offered.get(place(at)).map(|size| size.format.short)
    }

    /// The long side of the sheet at `at`, in millimetres; none past the last.
    #[wasm_bindgen(js_name = longSide)]
    pub fn long_side(&self, at: f64) -> Option<f64> {
        self.offered.get(place(at)).map(|size| size.format.long)
    }

    /// The centimetres across that the stitches of the sheet at `at` take on the fabric; none past
    /// the last.
    #[wasm_bindgen(js_name = centimetresAcross)]
    pub fn centimetres_across(&self, at: f64) -> Option<f64> {
        let size = self.offered.get(place(at))?;
        Some(fabric::centimetres(size.across, self.fabric.count()))
    }

    /// The centimetres down that the stitches of the sheet at `at` take on the fabric; none past
    /// the last.
    #[wasm_bindgen(js_name = centimetresDown)]
    pub fn centimetres_down(&self, at: f64) -> Option<f64> {
        let size = self.offered.get(place(at))?;
        Some(fabric::centimetres(size.down, self.fabric.count()))
    }

    /// The place of the sheet a page selects first: the smallest that gives [`DETAILED_ACROSS`]
    /// stitches across, else the largest; none where no sheet holds the picture.
    #[wasm_bindgen(getter)]
    pub fn first(&self) -> Option<usize> {
        fabric::first_offered(&self.offered)
    }

    /// The fewest stitches across the picture may have.
    #[wasm_bindgen(getter, js_name = fewestAcross)]
    pub fn fewest_across(&self) -> f64 {
        self.widths.min as f64
    }

    /// The most stitches across the picture may have.
    #[wasm_bindgen(getter, js_name = mostAcross)]
    pub fn most_across(&self) -> f64 {
        self.widths.max as f64
    }

    /// The stitches across from which a photograph looks real, for the page to say why it selects
    /// [`StitchSizes::first`].
    #[wasm_bindgen(getter, js_name = detailedFrom)]
    pub fn detailed_from(&self) -> usize {
        DETAILED_ACROSS
    }

    /// The least width, to a millimetre, that [`StitchSizes::typed_width`] takes; none where no
    /// width in millimetres gives the stitches allowed, as for a few on fine linen: the page then
    /// asks for stitches only.
    #[wasm_bindgen(getter, js_name = fewestCentimetres)]
    pub fn fewest_centimetres(&self) -> Option<f64> {
        fabric::centimetre_range(self.widths, self.fabric.count()).map(|(least, _)| least)
    }

    /// The most width, to a millimetre, that [`StitchSizes::typed_width`] takes; none where
    /// [`StitchSizes::fewest_centimetres`] is none.
    #[wasm_bindgen(getter, js_name = mostCentimetres)]
    pub fn most_centimetres(&self) -> Option<f64> {
        fabric::centimetre_range(self.widths, self.fabric.count()).map(|(_, most)| most)
    }

    /// The stitches across of a width of `centimetres` that a person typed; none where it is no
    /// number above 0 or its stitches are not within the widths the picture allows.
    #[wasm_bindgen(js_name = typedWidth)]
    pub fn typed_width(&self, centimetres: f64) -> Option<usize> {
        fabric::typed_width(centimetres, self.widths, self.fabric.count())
    }
}

/// A legend line read back.
#[wasm_bindgen]
pub struct StitchLegend(LineRecord);

#[wasm_bindgen]
impl StitchLegend {
    /// The record of the phrase: `MNC1:seedshift:indexes:…`, which the recovery part decodes with
    /// the dates, or `MNC1:direct:indexes:…` for a legend made with `--mode direct`.
    pub fn record(&self) -> String {
        after_secret(|| self.0.record().as_str().to_owned())
    }

    /// The row, from 1, that did not fit and was read as the only change of it that gives a phrase,
    /// for the page to ask the person to check it; undefined where the line read as it is, or where
    /// changes of several rows give the phrase (see `corrected`).
    #[wasm_bindgen(getter, js_name = correctedRow)]
    pub fn corrected_row(&self) -> Option<usize> {
        self.0.corrected_row()
    }

    /// Whether a row did not fit and was read as changed; true with no correctedRow where changes of
    /// several rows give the same phrase, and the page asks for all the rows to be checked.
    #[wasm_bindgen(getter)]
    pub fn corrected(&self) -> bool {
        self.0.corrected()
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

/// A pattern's PDF larger than [`chart::MAX_PATTERN_PDF_BYTES`], refused before it is read.
#[derive(Debug)]
struct PdfTooLarge;

impl fmt::Display for PdfTooLarge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "A pattern's PDF is read up to {} MiB.",
            chart::MAX_PATTERN_PDF_BYTES / 1024 / 1024
        )
    }
}

impl std::error::Error for PdfTooLarge {}

impl Refusal for PdfTooLarge {
    fn code(&self) -> &'static str {
        "wasm.embroidery.pdf-too-large"
    }
}

/// The most bytes [`read_stitch_pdf`] reads. The page checks a file's size against it before it
/// reads the file: the bytes are copied into WebAssembly memory before the function runs.
#[wasm_bindgen(js_name = stitchPdfMaxBytes)]
#[must_use]
pub fn stitch_pdf_max_bytes() -> u32 {
    u32::try_from(chart::MAX_PATTERN_PDF_BYTES).unwrap_or(u32::MAX)
}

/// Whether `pdf` is read for a legend at all: refused above the limit, as the command line refuses
/// the file; false for what is no PDF.
fn admitted_pdf(pdf: &[u8]) -> Result<bool, PdfTooLarge> {
    if pdf.len() > chart::MAX_PATTERN_PDF_BYTES {
        return Err(PdfTooLarge);
    }
    Ok(pdf.starts_with(b"%PDF-"))
}

/// The legend line that the PDF `pdf` of a pattern keeps, read back as [`read_stitch_legend`]
/// reads a typed one; undefined where the PDF keeps none, as when another program saved it again,
/// and the page asks for the legend typed from the key instead. Refused above
/// [`stitch_pdf_max_bytes`].
#[wasm_bindgen(js_name = readStitchPdf)]
pub fn read_stitch_pdf(pdf: &[u8]) -> Result<Option<StitchLegend>, JsValue> {
    if !admitted_pdf(pdf).map_err(|refusal| refused(&refusal))? {
        return Ok(None);
    }
    after_secret(|| match chart::legend_of_pdf(pdf) {
        Some(line) => record_of_legend(line.as_str())
            .map(|read| read.map(StitchLegend))
            .map_err(|refusal| refused(&refusal)),
        None => Ok(None),
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
    use mnemocode_embroidery::sample::{gradient_png, narrow_png};

    use super::*;

    /// Trezor's published 24-word test vector.
    const VOID: &str = "void come effort suffer camp survey warrior heavy shoot primary clutch crush \
                        open amazing screen patrol group space point ten exist slush involve unfold";

    // AUD-007-API002: the browser refuses a PDF above the command line's limit before scanning it.
    #[test]
    fn a_pattern_pdf_is_admitted_up_to_the_limit_of_the_command_line() {
        assert_eq!(
            stitch_pdf_max_bytes() as usize,
            chart::MAX_PATTERN_PDF_BYTES
        );
        let mut pdf = b"%PDF-1.7\n".to_vec();
        pdf.resize(chart::MAX_PATTERN_PDF_BYTES, b' ');
        assert!(admitted_pdf(&pdf).unwrap());
        pdf.push(b' ');
        assert!(admitted_pdf(&pdf).is_err());
        assert!(!admitted_pdf(b"not a PDF").unwrap());
    }

    // AUD-007-FUN002, as the audit's browser check met it: the narrowest picture gives one width,
    // offered in centimetres only where a typed width gives it.
    #[test]
    fn the_narrowest_picture_offers_only_widths_that_are_taken_when_typed() {
        let aida = StitchSizes::new(&narrow_png(), Some("14".to_owned())).unwrap();
        let (least, most) = (
            aida.fewest_centimetres().unwrap(),
            aida.most_centimetres().unwrap(),
        );
        assert!(least <= most, "{least} {most}");
        assert_eq!(
            (aida.typed_width(least), aida.typed_width(most)),
            (Some(40), Some(40))
        );
        let linen = StitchSizes::new(&narrow_png(), Some("linen-36".to_owned())).unwrap();
        assert_eq!(
            (linen.fewest_centimetres(), linen.most_centimetres()),
            (None, None)
        );
        assert_eq!(linen.typed_width(2.8), None);
    }

    #[test]
    fn a_pattern_is_made_and_its_legend_read_back_as_the_library_does() {
        let made = |mode| StitchPattern::of_text((VOID, "23-09-2026"), &gradient_png(), 120, mode);
        let pattern = made(Mode::Seedshift).unwrap();
        assert_eq!(pattern.width(), 120);
        assert!(pattern.rows() >= 12);
        let pdf = pattern.pdf_for(DEFAULT_FABRIC).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        let legend = pattern.legend().unwrap();
        let kept = read_stitch_pdf(&pdf).unwrap().unwrap();
        assert_eq!(
            kept.record(),
            record_of_legend(&legend)
                .unwrap()
                .unwrap()
                .record()
                .as_str()
        );
        assert!(read_stitch_pdf(b"%PDF-1.7\n%%EOF\n").unwrap().is_none());
        // Refusals cross as JS values, which a native test cannot make: the library's own tests and
        // the page's take them.
        let direct =
            StitchPattern::of_text((VOID, ""), &gradient_png(), 120, Mode::Direct).unwrap();
        let line = direct.legend().unwrap();
        let read = record_of_legend(&line).unwrap().unwrap();
        assert!(read.record().as_str().starts_with("MNC1:direct:indexes:"));
        // The gradient is 240 by 160 pixels: no sheet gives it more stitches than its pixels.
        let sizes = StitchSizes::new(&gradient_png(), None).unwrap();
        assert_eq!(sizes.name(0.0).as_deref(), Some("A6"));
        assert!((0..sizes.count()).all(|at| sizes.across(at as f64).unwrap() <= 240));
        assert_eq!((sizes.fewest_across(), sizes.most_across()), (40.0, 240.0));
        assert_eq!(sizes.typed_width(21.0), Some(115));
        assert_eq!(sizes.typed_width(f64::NAN), None);
        // A3's long side, 400 mm inside its margin, holds 220 stitches of Aida 14: the first that
        // gives 200 across.
        assert_eq!(sizes.first(), Some(3));
        assert_eq!(sizes.name(3.0).as_deref(), Some("A3"));
        assert!(sizes.name(9.0).is_none() && sizes.centimetres_across(-1.0).is_none());
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
