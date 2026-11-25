//! Protected cross-stitch setup: Seedshift and its dates first, then the picture, fabric, size and
//! output. The chosen folders are restricted before the seed phrase is read. The size is offered as
//! paper sizes or as a width in centimetres or stitches.

use std::path::Path;

use mnemocode::text::numbers::{WholeRange, typed_whole_number};
use mnemocode_embroidery::fabric::{self, DEFAULT_FABRIC, DETAILED_ACROSS, FABRICS, Fabric};
use mnemocode_embroidery::picture::{self, DEFAULT_WIDTH};

use super::asking::{ask_list, ask_list_at};
use super::encode_questions::file_questions;
use super::given::PATH_LIMIT;
use super::output_questions::{input_file, new_folder, output_file};
use crate::gate::Stop;
use crate::input::read_picture;
use crate::terminal::{Choice, Chosen, Explanation, LineQuestion, ask_line};

/// A cross-stitch pattern by default, its name saying nothing of what it holds.
pub(crate) const PATTERN_FILE: &str = "cross-stitch-pattern.pdf";

/// How large the person makes the pattern.
#[derive(Clone, Copy)]
enum Size {
    /// A paper size's stitches across.
    Across(usize),
    /// A width typed in centimetres, within the least and the most that can be typed.
    Centimetres(f64, f64),
    /// A width typed in stitches.
    Stitches,
}

/// The questions of a cross-stitch pattern: those of every new backup, with the pattern's own.
pub(crate) fn ask_pattern(finish: &mut super::new_backup::Finish<'_>) -> Result<bool, Stop> {
    super::new_backup::ask_new_backup(super::new_backup::Way::Embroidery, finish)
}

/// The pattern's own questions, after Seedshift: the picture, the fabric and the size; stitch's
/// options for them, or none for back. Its PDF is named last (pattern_file).
pub(crate) fn ask_pattern_own() -> Result<Option<Vec<String>>, Stop> {
    use super::new_backup::{answered, run_steps};
    let fabrics: Vec<Choice<Fabric>> = FABRICS
        .iter()
        .map(|&fabric| {
            let usual = match fabric {
                DEFAULT_FABRIC => ", the most usual",
                Fabric::LinenOverOne(_) => ", fine: for detail in a small piece",
                Fabric::Aida(_) => "",
            };
            let note = format!(
                "{:.1} stitches a centimetre{usual}",
                fabric.per_centimetre()
            );
            Choice::noted(&fabric.short_name(), &note, fabric)
        })
        .collect();
    let mut chosen = None;
    let mut fabric = DEFAULT_FABRIC;
    let mut across = 0;
    // The picture, the fabric and the size, Shift+Tab going back a step.
    let done = run_steps(3, Vec::new, |step| {
        Ok(match step {
            0 => answered(ask_picture()?.map(|(picture, widths)| {
                // The pattern goes into the new folder of the task, never over its own picture.
                chosen = Some((picture, widths));
            })),
            1 => answered(
                ask_list("Which fabric?", "Fabric", &fabrics, None)?.map(|asked| fabric = asked),
            ),
            _ => match &chosen {
                Some((picture, widths)) => {
                    answered(ask_size(picture.size, *widths, fabric)?.map(|asked| across = asked))
                }
                None => super::new_backup::Answered::Back,
            },
        })
    })?;
    let Some((picture, _)) = chosen.filter(|_| done) else {
        return Ok(None);
    };
    let mut run = vec!["--picture".to_owned(), picture.path];
    run.extend(["--stitches-across".to_owned(), across.to_string()]);
    if fabric != DEFAULT_FABRIC {
        run.extend(["--fabric".to_owned(), fabric.option()]);
    }
    Ok(Some(run))
}

/// The pattern's PDF, named in the task's folder; none for back.
pub(crate) fn pattern_file() -> Result<Option<Vec<String>>, Stop> {
    Ok(output_file(PATTERN_FILE)?.map(|pdf| vec!["--pdf".to_owned(), pdf]))
}

/// A new folder for the patterns of the shares, a PDF each, in the task's folder; none for back.
pub(crate) fn pattern_folder() -> Result<Option<Vec<String>>, Stop> {
    Ok(new_folder("cross-stitch-patterns")?.map(|folder| vec!["--pdf-dir".to_owned(), folder]))
}

/// A picture as the menu read it: its path and its upright size in pixels.
struct Picture {
    path: String,
    size: (usize, usize),
}

/// Asks for the picture, read at once, so that a file that cannot be one is asked again; with the
/// stitches across it may have.
fn ask_picture() -> Result<Option<(Picture, WholeRange)>, Stop> {
    let how = LineQuestion {
        what: Some("the name of a PNG, JPEG or WebP file"),
        note: Some(
            "MnemoCode makes a cross-stitch chart from this picture and hides the seed phrase in the chart's floss key. A photograph with smooth shades works best.",
        ),
        limit: PATH_LIMIT,
        ..LineQuestion::default()
    };
    let mut read = None;
    let typed = ask_line(file_questions::PICTURE, "Picture", how, |answer: &str| {
        let path =
            input_file(answer, picture::MAX_FILE_BYTES).map_err(|error| error.to_string())?;
        let file = read_picture(Path::new(&path)).map_err(|error| error.to_string())?;
        let size = picture::upright_size(&file).map_err(|error| error.to_string())?;
        let widths = fabric::widths(size).map_err(|refusal| refusal.to_string())?;
        read = Some((size, widths));
        Ok::<_, String>(path)
    })?;
    match (typed, read) {
        (Chosen::One(path), Some((size, widths))) => Ok(Some((Picture { path, size }, widths))),
        (Chosen::Cancelled, _) => Err(Stop::Cancelled),
        _ => Ok(None),
    }
}

/// Asks how large the pattern is on `fabric`: a paper size, A4 first, or a width in
/// centimetres or stitches within `widths`; the stitches across, or none for back. Stitch asks it
/// again where the size chosen cannot hold the phrase.
pub(crate) fn ask_size(
    size: (usize, usize),
    widths: WholeRange,
    fabric: Fabric,
) -> Result<Option<usize>, Stop> {
    let count = fabric.count();
    // Each sheet with the stitches the picture takes in it inside the print margin, and their size
    // on the fabric; the chart is drawn on that sheet.
    let offered = fabric::offered_sizes(size, fabric);
    let first = fabric::first_offered(&offered).unwrap_or(0);
    let mut choices: Vec<Choice<Size>> = Vec::new();
    for &fabric::OfferedSize {
        format,
        across,
        down,
    } in &offered
    {
        let label = format!(
            "{}, {} x {} cm",
            format.name,
            format.short / 10.0,
            format.long / 10.0
        );
        let note = format!(
            "{across} x {down} stitches, {:.1} x {:.1} cm",
            fabric::centimetres(across, count),
            fabric::centimetres(down, count)
        );
        choices.push(Choice::noted(&label, &note, Size::Across(across)));
    }
    // Few stitches on fine linen may leave no width to type in centimetres: stitches only then.
    if let Some((least, most)) = fabric::centimetre_range(widths, count) {
        choices.push(Choice::noted(
            "Width in centimetres",
            &format!("{least:.1} to {most:.1}"),
            Size::Centimetres(least, most),
        ));
    }
    choices.push(Choice::noted(
        "Stitches across",
        &widths.to(),
        Size::Stitches,
    ));
    let question = format!("How large, on {}?", fabric.short_name());
    let explanation = Explanation {
        lines: vec![format!(
            "More stitches give more detail: a photograph looks real from about {DETAILED_ACROSS} across."
        )],
        more: Vec::new(),
    };
    match ask_list_at(&question, "Size", &choices, (first, Some(&explanation)))? {
        None => Ok(None),
        Some(Size::Across(across)) => Ok(Some(across)),
        Some(Size::Centimetres(least, most)) => {
            let range = format!("{least:.1} to {most:.1}");
            let what = format!("a number of centimetres from {range}");
            let how = LineQuestion {
                what: Some(&what),
                limit: PATH_LIMIT,
                ..LineQuestion::default()
            };
            let question = format!("Enter the width in centimetres ({range})");
            let typed = ask_line(&question, "Width", how, |answer: &str| {
                typed_centimetres(answer, widths, count)
                    .map(|across| across.to_string())
                    .ok_or_else(|| format!("Type {what}."))
            })?;
            chosen_width(typed)
        }
        Some(Size::Stitches) => {
            let fallback = DEFAULT_WIDTH.clamp(widths.min as usize, widths.max as usize);
            let fallback = fallback.to_string();
            let what = format!("a number from {}", widths.to());
            let how = LineQuestion {
                fallback: Some(&fallback),
                what: Some(&what),
                limit: PATH_LIMIT,
                ..LineQuestion::default()
            };
            let question = format!("How many stitches across? ({})", widths.to());
            let typed = ask_line(&question, "Across", how, |answer: &str| {
                typed_whole_number(answer, widths, None).map(|across| across.to_string())
            })?;
            chosen_width(typed)
        }
    }
}

/// The stitches across of `answer` in centimetres, a comma or a point before its decimals, on
/// fabric of `count`, as [`fabric::typed_width`] takes them.
fn typed_centimetres(answer: &str, widths: WholeRange, count: u64) -> Option<usize> {
    let typed: f64 = answer.trim().replace(',', ".").parse().ok()?;
    fabric::typed_width(typed, widths, count)
}

/// The width typed, as stitches across; none for back.
fn chosen_width(typed: Chosen<String>) -> Result<Option<usize>, Stop> {
    match typed {
        Chosen::One(across) => Ok(across.parse().ok()),
        Chosen::Back => Ok(None),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_width_typed_with_a_comma_or_a_point_reads_as_the_library_takes_it() {
        // The width's own rule is fabric::typed_width's, tested there; this is the typed text.
        let widths = WholeRange::new(40, 500);
        assert_eq!(typed_centimetres("21", widths, 14), Some(115));
        assert_eq!(typed_centimetres(" 21,0 ", widths, 14), Some(115));
        assert_eq!(typed_centimetres("21 cm", widths, 14), None);
        assert_eq!(typed_centimetres("NaN", widths, 14), None);
    }
}
