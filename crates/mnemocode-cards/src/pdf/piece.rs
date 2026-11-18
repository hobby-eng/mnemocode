//! A page's private data read back from a PDF that [`super::PdfPages::add_with_piece`] wrote: the
//! application's entry in the page's `PieceInfo`, its `Private` object, and that object's stream,
//! inflated. It reads this writer's files, whose objects stand one after another uncompressed; a
//! file that another program has rewritten into object streams gives nothing, and the person types
//! what the page shows instead.

use miniz_oxide::inflate::decompress_slice_iter_to_slice;
use mnemocode::secret::SecretBytes;

use crate::printed::find;

/// The most bytes a page's private data inflates to.
const MOST_PRIVATE: usize = 1 << 20;

/// The private data of `application` in a page of `pdf`; none where no page has it or the file is
/// not as this writer writes it.
#[must_use]
pub fn private_data(pdf: &[u8], application: &str) -> Option<SecretBytes> {
    object_data(pdf, private_references(pdf, application).next()?)
}

/// The stream of the object `id` of `pdf`, inflated.
fn object_data(pdf: &[u8], id: usize) -> Option<SecretBytes> {
    let object = find(pdf, format!("\n{id} 0 obj").as_bytes(), 0)?;
    let length_at = find(pdf, b"/Length", object)? + b"/Length".len();
    let length = leading_number(&pdf[length_at..])?;
    let mut start = find(pdf, b"stream", length_at)? + b"stream".len();
    if pdf.get(start) == Some(&b'\r') {
        start += 1;
    }
    if pdf.get(start) == Some(&b'\n') {
        start += 1;
    }
    let compressed = pdf.get(start..start.checked_add(length)?)?;
    // Inflated into a buffer of its whole bound at once: a growing one would leave copies behind.
    let mut inflating = SecretBytes::large("a page's private data", vec![0; MOST_PRIVATE]);
    let inflated =
        decompress_slice_iter_to_slice(&mut inflating, std::iter::once(compressed), true, false)
            .ok()?;
    Some(SecretBytes::copy_of(
        "a page's private data",
        &inflating[..inflated],
    ))
}

/// This writer emits one application dictionary inside each page's PieceInfo.
/// A matching PDF structural name elsewhere is not an application key.
fn private_references<'a>(pdf: &'a [u8], application: &'a str) -> impl Iterator<Item = usize> + 'a {
    pdf.iter().enumerate().filter_map(move |(at, byte)| {
        if *byte != b'/' {
            return None;
        }
        let after = name_end(pdf, at + 1, b"PieceInfo")?;
        let entries = pdf
            .get(after..)?
            .trim_ascii_start()
            .strip_prefix(b"<<")?
            .trim_ascii_start();
        let key = entries.strip_prefix(b"/")?;
        let after_key = name_end(key, 0, application.as_bytes())?;
        let dictionary = key
            .get(after_key..)?
            .trim_ascii_start()
            .strip_prefix(b"<<")?;
        let end = find(dictionary, b">>", 0)?;
        let entry = &dictionary[..end];
        let private = find(entry, b"/Private", 0)? + b"/Private".len();
        if !entry.get(private).is_some_and(|byte| name_delimiter(*byte)) {
            return None;
        }
        leading_number(&entry[private..])
    })
}

/// Match the whole PDF name, decoding the escapes this writer emits for Name bytes.
fn name_end(pdf: &[u8], mut at: usize, expected: &[u8]) -> Option<usize> {
    for expected in expected {
        let mut byte = *pdf.get(at)?;
        if byte == b'#' {
            let digits = std::str::from_utf8(pdf.get(at + 1..at + 3)?).ok()?;
            byte = u8::from_str_radix(digits, 16).ok()?;
            at += 3;
        } else {
            if name_delimiter(byte) {
                return None;
            }
            at += 1;
        }
        if byte != *expected {
            return None;
        }
    }
    pdf.get(at)
        .is_none_or(|byte| name_delimiter(*byte))
        .then_some(at)
}

/// ISO 32000-1 name terminators: PDF white space or a lexical delimiter.
fn name_delimiter(byte: u8) -> bool {
    matches!(
        byte,
        0 | 9
            | 10
            | 12
            | 13
            | b' '
            | b'('
            | b')'
            | b'<'
            | b'>'
            | b'['
            | b']'
            | b'{'
            | b'}'
            | b'/'
            | b'%'
    )
}

/// The whole number that `bytes` start with, after white space.
fn leading_number(bytes: &[u8]) -> Option<usize> {
    let digits: Vec<u8> = bytes
        .iter()
        .skip_while(|b| b.is_ascii_whitespace())
        .take_while(|b| b.is_ascii_digit())
        .copied()
        .collect();
    std::str::from_utf8(&digits).ok()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::document_with_piece;
    use crate::scene::{Page, UiFont};

    #[test]
    fn a_page_s_private_data_reads_back_and_a_page_without_it_gives_none() {
        let font = UiFont::load();
        let pages = [Page::new(210.0, 297.0), Page::new(210.0, 297.0)];
        let line = b"28:1725 25:2163 57:3275";
        let pdf = document_with_piece(&font, &pages, Some((1, "FlossKey", line))).unwrap();
        assert_eq!(&*private_data(&pdf, "FlossKey").unwrap(), line);
        assert!(private_data(&pdf, "Other").is_none());
        // The data is compressed: the line itself is nowhere in the file.
        assert!(!pdf.windows(line.len()).any(|w| w == line));
        let plain = document_with_piece(&font, &pages, None).unwrap();
        assert!(private_data(&plain, "FlossKey").is_none());
    }
    #[test]
    fn application_names_match_whole_pdf_names_including_the_writers_escapes() {
        let font = UiFont::load();
        let pages = [Page::new(210.0, 297.0)];
        let payload = b"public PDF application fixture";
        for application in ["Foobar", "Floss Key#(one)", "Floss/Key"] {
            let pdf = document_with_piece(&font, &pages, Some((0, application, payload))).unwrap();
            assert_eq!(&*private_data(&pdf, application).unwrap(), payload);
            assert!(private_data(&pdf, &application[..3]).is_none());
            for absent in ["Absent", "Type", "Catalog", "Private", "PieceInfo"] {
                assert!(
                    private_data(&pdf, absent).is_none(),
                    "absent application {absent}"
                );
            }
        }
    }
}
