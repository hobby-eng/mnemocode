//! The material designs (MnemoCode TS 0.1.0's `export/material-cards.ts` and
//! `material-artwork.ts`, CAP-CARDS-MATERIAL-RENDER): a collection study of ordered exact
//! references, each shown as a sample of a material, the printed code staying exact while the
//! sample only follows the direction of its colour. A material design is printed on sheets only.

use std::rc::Rc;

use mnemocode::forms::colors::{ColorsError, is_rgb_reference, rgb_reference_digits};
use mnemocode::random::Random;
use mnemocode::text::words::capitalized;

use super::finishes::artwork_of;
use super::{CardDrawing, MaterialStyle, TemplateError};
use crate::content::ColorCards;
use crate::details::ExportDetails;
use crate::palette::{channels_hex, linear_channel, rgb_channels};
use crate::scene::{
    Blend, MM, MmRect, Page, Picture, Pixels, PointRect, Segment, Step, rectangle_path, rgb,
};
use crate::settings::{PageSize, ProfileField};
use crate::sheet::frame::{CollectionStudy, StudyTheme, draw_collection_study};
use crate::sheet::{MAX_SHEET_CARDS, SheetError, StudyBox};

/// How strongly a tint covers its photograph; the little of the photograph's own colour that shows
/// through keeps the surface natural.
pub const TINT_OPACITY: f64 = 0.85;
/// Codes are far more colourful than any real finish: their colourfulness is scaled per material,
/// then capped near that of the most colourful samples, so that the hue decides the match.
const CHROMA_CAP: f64 = 45.0;
/// Lightness counts half when a sample is matched to a code: the photographs offer only a few steps
/// of lightness, and the direction of the colour matters most.
const MATCH_LIGHTNESS_WEIGHT: f64 = 0.5;

/// One finish of a material; the RGB entries describe the artwork, never the encoded reference.
#[derive(Debug)]
pub struct Finish {
    /// The name of the finish: the label of its untinted sample.
    pub name: &'static str,
    /// Its colour on the photograph: the look of its untinted sample, and the lightness by which a
    /// catalogue colour chooses the finish it tints.
    pub color: &'static str,
    /// The part of the photograph that its sample shows: left, top, width and height, fractions.
    pub crop: [f64; 4],
    /// The surface word of a tinted sample's label; only a finish with one carries colours.
    pub surface: Option<&'static str>,
    /// Where the outline lies on this photograph, as scale, x shift and y shift.
    pub outline_fit: Option<[f64; 3]>,
    /// Shown only under a tint, because as photographed it looks too much like another finish.
    pub only_tinted: bool,
}

/// The artwork of a material design.
#[derive(Debug)]
pub struct MaterialArtwork {
    /// The page of the design study.
    pub study_theme: StudyTheme,
    /// The finishes cropped from its one photograph, in order; they are cropped alike.
    pub finishes: &'static [Finish],
    /// The colours the material really comes in: a name and a code.
    pub colours: &'static [(&'static str, &'static str)],
    /// How much of a reference's colourfulness counts when its sample is chosen.
    pub chroma_scale: f64,
    /// Whether a tinted label starts with the surface or ends with it.
    pub surface_first: bool,
    /// The part of a crop that a tint covers, as rings of x, y pairs with y downwards: the object,
    /// then any hole in it such as a screw.
    pub outline: &'static [&'static [f64]],
}

/// A sample of a material that a card shows for a code.
#[derive(Clone, Debug)]
pub struct MaterialSample {
    /// The finish whose part of the photograph the sample shows.
    pub finish: &'static Finish,
    /// The catalogue colour laid over the photograph; none for a finish as photographed.
    pub tint: Option<&'static str>,
    /// Its name, printed under its code on a sheet larger than a card.
    pub label: String,
    /// How the sample looks: the photograph's colour under its tint.
    pub look: String,
}

/// The sRGB transfer curve and D65 XYZ-to-Lab conversion. Distances choose decoration only; the
/// original hexadecimal reference remains untouched and fully recoverable.
fn lab(hex: &str) -> Result<[f64; 3], ColorsError> {
    let [red, green, blue] = rgb_channels(hex)?;
    let (r, g, b) = (
        linear_channel(red),
        linear_channel(green),
        linear_channel(blue),
    );
    let f = |value: f64| {
        if value > 216.0 / 24389.0 {
            libm::cbrt(value)
        } else {
            ((24389.0 / 27.0) * value + 16.0) / 116.0
        }
    };
    let x = f((0.412_456_4 * r + 0.357_576_1 * g + 0.180_437_5 * b) / 0.95047);
    let y = f(0.212_672_9 * r + 0.715_152_2 * g + 0.072_175 * b);
    let z = f((0.019_333_9 * r + 0.119_192 * g + 0.950_304_1 * b) / 1.08883);
    Ok([116.0 * y - 16.0, 500.0 * (x - y), 200.0 * (y - z)])
}

/// How a photograph of colour `base` looks under the colour `tint`, as the PDF "Color" blend mode
/// paints it (ISO 32000-1, 11.3.5.3), mixed with the photograph by [`TINT_OPACITY`].
pub fn tinted_look(base: &str, tint: &str) -> Result<String, ColorsError> {
    let luminosity = |[r, g, b]: [f64; 3]| 0.3 * r + 0.59 * g + 0.11 * b;
    let backdrop = rgb_channels(base)?;
    let light = luminosity(backdrop);
    let tinted = rgb_channels(tint)?;
    let shift = light - luminosity(tinted);
    let shifted = tinted.map(|value| value + shift);
    // ClipColor: pulls the channels toward the luminosity until they fit between 0 and 1.
    let low = shifted.iter().copied().fold(f64::INFINITY, f64::min);
    let high = shifted.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let clipped = shifted.map(|mut value| {
        if low < 0.0 {
            value = light + ((value - light) * light) / (light - low);
        }
        if high > 1.0 {
            value = light + ((value - light) * (1.0 - light)) / (high - light);
        }
        value
    });
    let mut look = [0.0; 3];
    for (at, value) in look.iter_mut().enumerate() {
        *value = (1.0 - TINT_OPACITY) * backdrop[at] + TINT_OPACITY * clipped[at];
    }
    Ok(channels_hex(look))
}

/// Every sample a material can show: its finishes as photographed and each catalogue colour, laid
/// over the tintable photograph of nearest lightness, since the tint keeps the photograph's light,
/// shading and texture.
pub fn material_samples(style: MaterialStyle) -> Result<Vec<MaterialSample>, ColorsError> {
    let artwork = artwork_of(style);
    let mut samples: Vec<MaterialSample> = artwork
        .finishes
        .iter()
        .filter(|finish| !finish.only_tinted)
        .map(|finish| MaterialSample {
            finish,
            tint: None,
            label: finish.name.to_owned(),
            look: finish.color.to_owned(),
        })
        .collect();
    let tintable: Vec<&'static Finish> = artwork
        .finishes
        .iter()
        .filter(|finish| finish.surface.is_some())
        .collect();
    for (name, color) in artwork.colours {
        let lightness = lab(color)?[0];
        let mut finish = tintable[0];
        for candidate in &tintable[1..] {
            let near = (lab(candidate.color)?[0] - lightness).abs();
            if near < (lab(finish.color)?[0] - lightness).abs() {
                finish = candidate;
            }
        }
        let surface = finish.surface.unwrap_or_default();
        let label = if artwork.surface_first {
            format!("{} {}", capitalized(surface), name.to_lowercase())
        } else {
            format!("{name} {surface}")
        };
        samples.push(MaterialSample {
            finish,
            tint: Some(color),
            label,
            look: tinted_look(finish.color, color)?,
        });
    }
    Ok(samples)
}

/// The sample of every reference of a card. Every distinct reference gets its own sample: the pairs
/// of reference and sample are taken nearest first, each sample at most once, so that two codes
/// never look alike while each keeps the direction of its colour as far as the catalogue allows. A
/// repeated reference keeps its sample; its neighbours take part in the choice.
pub fn choose_material_samples(
    style: MaterialStyle,
    references: &[String],
) -> Result<Vec<MaterialSample>, TemplateError> {
    if !references
        .iter()
        .all(|reference| is_rgb_reference(reference))
    {
        return Err(TemplateError::NoReference);
    }
    let chroma_scale = artwork_of(style).chroma_scale;
    let samples = material_samples(style)?;
    let mut codes: Vec<String> = Vec::new();
    for reference in references {
        let digits = digits_of(reference)?;
        if !codes.contains(&digits) {
            codes.push(digits);
        }
    }
    if codes.len() > samples.len() {
        return Err(TemplateError::TooFewSamples(style.name(), samples.len()));
    }
    let point = |[l, a, b]: [f64; 3]| [l * MATCH_LIGHTNESS_WEIGHT, a, b];
    let looks: Vec<[f64; 3]> = samples
        .iter()
        .map(|sample| Ok(point(lab(&sample.look)?)))
        .collect::<Result<_, ColorsError>>()?;
    let mut pairs: Vec<(usize, usize, f64)> = Vec::with_capacity(codes.len() * looks.len());
    for (c, code) in codes.iter().enumerate() {
        let [l, a, b] = lab(code)?;
        let chroma = libm::hypot(a, b);
        let scale = if chroma == 0.0 {
            0.0
        } else {
            (chroma * chroma_scale).min(CHROMA_CAP) / chroma
        };
        let target = point([l, a * scale, b * scale]);
        for (s, look) in looks.iter().enumerate() {
            let distance: f64 = look
                .iter()
                .zip(target)
                .map(|(value, other)| (value - other) * (value - other))
                .sum();
            pairs.push((c, s, distance));
        }
    }
    pairs.sort_by(|x, y| x.2.total_cmp(&y.2).then(x.0.cmp(&y.0)).then(x.1.cmp(&y.1)));
    let mut chosen: Vec<Option<&MaterialSample>> = vec![None; codes.len()];
    let mut taken = vec![false; samples.len()];
    for (c, s, _) in pairs {
        if chosen[c].is_none() && !taken[s] {
            chosen[c] = Some(&samples[s]);
            taken[s] = true;
        }
    }
    references
        .iter()
        .map(|reference| {
            let digits = digits_of(reference)?;
            let place = codes.iter().position(|code| *code == digits);
            place
                .and_then(|place| chosen[place])
                .cloned()
                .ok_or(TemplateError::NoReference)
        })
        .collect()
}

/// The digits of `reference`, in one case.
fn digits_of(reference: &str) -> Result<String, TemplateError> {
    rgb_reference_digits(reference).map_err(|_| TemplateError::NoReference)
}

/// The file of the photograph of `style`; none where the build leaves its design out.
const fn photograph_file(style: MaterialStyle) -> Option<&'static [u8]> {
    match style {
        #[cfg(feature = "template-material-enclosure")]
        MaterialStyle::Enclosure => Some(crate::assets::MATERIAL_ENCLOSURE),
        #[cfg(feature = "template-material-kitchen")]
        MaterialStyle::Kitchen => Some(crate::assets::MATERIAL_KITCHEN),
        #[cfg(feature = "template-material-switch")]
        MaterialStyle::Switch => Some(crate::assets::MATERIAL_SWITCH),
        #[cfg(feature = "template-material-tile")]
        MaterialStyle::Tile => Some(crate::assets::MATERIAL_TILE),
        #[cfg(feature = "template-material-vehicle")]
        MaterialStyle::Vehicle => Some(crate::assets::MATERIAL_VEHICLE),
        #[allow(
            unreachable_patterns,
            reason = "with every design built, nothing is left"
        )]
        _ => None,
    }
}

/// The photograph of `style`, with its size from the JPEG file.
pub(super) fn photograph(style: MaterialStyle) -> Result<Picture, TemplateError> {
    let file = photograph_file(style).ok_or(TemplateError::Artwork)?;
    let (width, height) = crate::raster::jpeg_size(file).ok_or(TemplateError::Artwork)?;
    Ok(Picture {
        width,
        height,
        pixels: Pixels::Jpeg(file),
    })
}

/// The aspect of a finish's crop, width over height.
fn crop_aspect(image: &Picture, finish: &Finish) -> f64 {
    let [_, _, crop_width, crop_height] = finish.crop;
    (f64::from(image.width) * crop_width) / (f64::from(image.height) * crop_height)
}

/// The shape of a sample of `style`: the finishes are cropped alike.
pub(super) fn material_aspect(
    drawing: &CardDrawing,
    style: MaterialStyle,
) -> Result<f64, TemplateError> {
    let image = drawing.material_photograph(style)?;
    Ok(crop_aspect(&image, &artwork_of(style).finishes[0]))
}

/// Where a sample's photograph lies in a box: as large as fits, centred.
fn sample_area(image: &Picture, finish: &Finish, place: MmRect) -> MmRect {
    let aspect = crop_aspect(image, finish);
    let width = place.width.min(place.height * aspect);
    let height = width / aspect;
    MmRect {
        x: place.x + (place.width - width) / 2.0,
        y: place.y + (place.height - height) / 2.0,
        width,
        height,
    }
}

/// Draws `sample` in `place`: the crop of the photograph, and the tint where it has one, which
/// covers only the object inside the material's outline, keeping the photograph's light.
fn draw_sample(
    page: &mut Page,
    image: &Rc<Picture>,
    artwork: &MaterialArtwork,
    sample: &MaterialSample,
    place: MmRect,
) -> Result<(), TemplateError> {
    let [cx, cy, cw, ch] = sample.finish.crop;
    let area = sample_area(image, sample.finish, place);
    let (dw, dh) = (area.width, area.height);
    let placed = page.rect(area);
    let (left, bottom) = (placed.x, placed.y);
    page.steps.push(Step::Save);
    page.steps.push(Step::Clip {
        path: rectangle_path(placed),
        even_odd: false,
    });
    page.steps.push(Step::Image {
        picture: Rc::clone(image),
        place: PointRect {
            x: left - (cx / cw) * dw * MM,
            y: bottom - ((1.0 - cy - ch) / ch) * dh * MM,
            width: (dw / cw) * MM,
            height: (dh / ch) * MM,
        },
    });
    if let Some(tint) = sample.tint {
        let [scale, dx, dy] = sample.finish.outline_fit.unwrap_or([1.0, 0.0, 0.0]);
        // Outline points are fractions of the crop with y downwards; the page's y runs upwards.
        let at = |ring: &[f64], i: usize| {
            (
                left + (ring[i] * scale + dx) * dw * MM,
                bottom + (1.0 - ring[i + 1] * scale - dy) * dh * MM,
            )
        };
        let mut outline = Vec::new();
        for ring in artwork.outline {
            let (x, y) = at(ring, 0);
            outline.push(Segment::Move(x, y));
            for i in (2..ring.len()).step_by(2) {
                let (x, y) = at(ring, i);
                outline.push(Segment::Line(x, y));
            }
            outline.push(Segment::Close);
        }
        let [red, green, blue] = rgb_channels(tint)?;
        // Even-odd, so that a hole in the outline, such as a screw, stays untinted.
        page.steps.push(Step::Clip {
            path: outline,
            even_odd: true,
        });
        page.steps.push(Step::Fill {
            path: rectangle_path(placed),
            color: rgb(red, green, blue),
            opacity: TINT_OPACITY,
            blend: Blend::Color,
        });
    }
    page.steps.push(Step::Restore);
    Ok(())
}

/// The lines under the first `count` samples of a sheet: each one's number and code, and on a
/// sheet larger than a card the name of its sample. Compact studies keep the exact references.
fn study_captions(
    cards: &ColorCards,
    samples: &[MaterialSample],
    compact: bool,
    count: usize,
) -> Vec<Vec<String>> {
    (0..count)
        .map(|index| {
            let mut lines = vec![cards.codes.numbered(index, "  ")];
            if !compact {
                lines.push(samples[index].label.clone());
            }
            lines
        })
        .collect()
}

/// The captions of the first `count` cards of a sheet, whose samples are chosen for those cards
/// alone, as their sheet chooses them.
pub(super) fn sheet_captions(
    style: MaterialStyle,
    cards: &ColorCards,
    compact: bool,
    count: usize,
) -> Result<Vec<Vec<String>>, TemplateError> {
    let samples = choose_material_samples(style, &cards.codes.colors[..count])?;
    Ok(study_captions(cards, &samples, compact, count))
}

/// A collection study of ordered exact references, with its QR code where asked.
pub(super) fn render_material_card(
    drawing: &CardDrawing,
    random: &mut dyn Random,
    style: MaterialStyle,
    cards: &ColorCards,
) -> Result<Page, TemplateError> {
    cards.check()?;
    let colors = &cards.codes.colors;
    if colors.is_empty() {
        return Err(TemplateError::Empty);
    }
    if colors.len() > MAX_SHEET_CARDS {
        return Err(TemplateError::TooManyReferences);
    }
    // A material design is printed on sheets only: A6 unless another size is asked for.
    let size = PageSize::resolve(cards.settings.page_size, false);
    let artwork = artwork_of(style);
    // Through an export the content carries the details settled for it, which come back unchanged.
    let details = ExportDetails::of(random, &cards.settings, None)?;
    let image = drawing.material_photograph(style)?;
    // Chosen for all references of the card together, so that no two of them look alike.
    let samples = choose_material_samples(style, colors)?;
    let compact = size == PageSize::Business;
    let aspect = crop_aspect(&image, &artwork.finishes[0]);
    let picture_area =
        |place: &StudyBox| sample_area(&image, samples[place.index].finish, place.rect());
    let mut sized = cards.clone();
    sized.settings.page_size = Some(size);
    let study = CollectionStudy {
        font: &drawing.font,
        cards: &sized,
        presentation: &details.presentation,
        prepared_for: details.profile.get(ProfileField::Name).unwrap_or_default(),
        theme: artwork.study_theme,
        aspect,
        captions: study_captions(cards, &samples, compact, colors.len()),
        picture_area: Some(&picture_area),
    };
    let page = draw_collection_study(&study, &mut |page, place| {
        draw_sample(page, &image, artwork, &samples[place.index], place.rect())
            .map_err(|error| SheetError::Design(Box::new(error)))
    })?;
    Ok(page)
}
