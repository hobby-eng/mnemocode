//! The codes that a page of cards prints, kept in its file for reading back where a design file
//! keeps its swatches: XMP metadata (ISO 16684-1), in a PDF page's `Metadata` stream, a PNG's
//! `iTXt` chunk and a JPEG's APP1 segment. Each code is a swatch named as its card labels it
//! ("01 7684") in the card's colour; a share's swatch group is named after the reference its cards
//! print; every file of one backup or share has the same document ID. The count of the set is not
//! kept, as no card names it either.

use std::fmt::Write as _;

use mnemocode::secret::{SecretBytes, SecretText};
use sha2::{Digest, Sha256};

/// The keyword of a PNG `iTXt` chunk that holds XMP.
pub const PNG_KEYWORD: &str = "XML:com.adobe.xmp";
/// The JPEG application segment of XMP, APP1, and what its data starts with.
pub const JPEG_SEGMENT: u8 = 1;
const JPEG_SIGNATURE: &str = "http://ns.adobe.com/xap/1.0/\0";
/// The name of a backup's swatch group, and what a share's starts with before its reference.
const BACKUP_GROUP: &str = "Card colours";
const SHARE_GROUP: &str = "Series ";
const PACKET_START: &str = "<x:xmpmeta";
const PACKET_END: &str = "</x:xmpmeta>";

/// The codes a page of cards prints, as its file keeps them.
#[derive(Clone, PartialEq, Eq)]
pub struct Kept {
    /// The same in every file of one backup or share, an `xmpMM:DocumentID`.
    pub document: String,
    /// The reference that a share's cards print; none for a backup.
    pub share: Option<String>,
    /// Each code its page prints, as its card labels it ("01 7684"), and the card's colour.
    pub swatches: Vec<(String, String)>,
}

impl std::fmt::Debug for Kept {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Kept(..)")
    }
}

/// The document ID of a set of cards whose codes, numbered as their cards label them, are
/// `numbered`: the same for every file of the set, another for any other set.
#[must_use]
pub fn document_id(numbered: &[String]) -> String {
    let mut hash = Sha256::new();
    for code in numbered {
        hash.update(code.as_bytes());
        hash.update(b"\n");
    }
    let digest = hash.finalize();
    let hex: String = digest[..16].iter().fold(String::new(), |mut text, byte| {
        let _ = write!(text, "{byte:02x}");
        text
    });
    format!(
        "xmp.did:{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

/// The XMP packet of `kept`, as design programs write their swatches.
#[must_use]
pub fn xmp(kept: &Kept) -> SecretText {
    let group = kept.share.as_ref().map_or_else(
        || BACKUP_GROUP.to_owned(),
        |share| format!("{SHARE_GROUP}{share}"),
    );
    let mut text = String::with_capacity(1024 + kept.swatches.len() * 320);
    text.push_str("<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n");
    text.push_str("<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\n <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n");
    text.push_str("  <rdf:Description rdf:about=\"\" xmlns:xmpMM=\"http://ns.adobe.com/xap/1.0/mm/\" xmlns:xmpTPg=\"http://ns.adobe.com/xap/1.0/t/pg/\" xmlns:xmpG=\"http://ns.adobe.com/xap/1.0/g/\">\n");
    let _ = writeln!(
        text,
        "   <xmpMM:DocumentID>{}</xmpMM:DocumentID>",
        escaped(&kept.document)
    );
    text.push_str(
        "   <xmpTPg:SwatchGroups>\n    <rdf:Seq>\n     <rdf:li rdf:parseType=\"Resource\">\n",
    );
    let _ = writeln!(
        text,
        "      <xmpG:groupName>{}</xmpG:groupName>\n      <xmpG:groupType>0</xmpG:groupType>\n      <xmpG:Colorants>\n       <rdf:Seq>",
        escaped(&group)
    );
    for (name, colour) in &kept.swatches {
        let [red, green, blue] = channels(colour);
        let _ = writeln!(
            text,
            "        <rdf:li rdf:parseType=\"Resource\"><xmpG:swatchName>{}</xmpG:swatchName><xmpG:mode>RGB</xmpG:mode><xmpG:type>PROCESS</xmpG:type><xmpG:red>{red}</xmpG:red><xmpG:green>{green}</xmpG:green><xmpG:blue>{blue}</xmpG:blue></rdf:li>",
            escaped(name)
        );
    }
    text.push_str("       </rdf:Seq>\n      </xmpG:Colorants>\n     </rdf:li>\n    </rdf:Seq>\n   </xmpTPg:SwatchGroups>\n");
    text.push_str("  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end=\"w\"?>");
    SecretText::take("printed codes", text)
}

/// The data of a PNG `iTXt` chunk of `kept`: its keyword, uncompressed, without a language.
#[must_use]
pub fn png_chunk(kept: &Kept) -> SecretBytes {
    let packet = xmp(kept);
    let mut data = Vec::with_capacity(PNG_KEYWORD.len() + 5 + packet.len());
    data.extend_from_slice(PNG_KEYWORD.as_bytes());
    data.extend_from_slice(&[0, 0, 0, 0, 0]);
    data.extend_from_slice(packet.as_bytes());
    SecretBytes::large("printed codes", data)
}

/// The data of a JPEG APP1 segment of `kept`.
#[must_use]
pub fn jpeg_segment(kept: &Kept) -> SecretBytes {
    let packet = xmp(kept);
    let mut data = Vec::with_capacity(JPEG_SIGNATURE.len() + packet.len());
    data.extend_from_slice(JPEG_SIGNATURE.as_bytes());
    data.extend_from_slice(packet.as_bytes());
    SecretBytes::large("printed codes", data)
}

/// `text` as XML character data.
fn escaped(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The red, green and blue of `#RRGGBB`, black where it is not one.
fn channels(colour: &str) -> [u8; 3] {
    let hex = colour.trim_start_matches('#');
    let channel = |at: usize| {
        hex.get(at..at + 2)
            .and_then(|digits| u8::from_str_radix(digits, 16).ok())
            .unwrap_or(0)
    };
    [channel(0), channel(2), channel(4)]
}

/// The codes of one page of cards read back from its file.
pub struct Page {
    /// The document ID of its set.
    pub document: String,
    /// The reference of its share; none for a backup's cards.
    pub share: Option<String>,
    /// Each code with its number: "7684", or a colour's "000064".
    pub codes: Vec<(usize, SecretText)>,
}

/// The pages of cards that `file`, a PDF, PNG or JPEG of this program's cards, keeps; none for any
/// other file.
#[must_use]
pub fn pages_in(file: &[u8]) -> Vec<Page> {
    let mut pages = Vec::new();
    let mut from = 0;
    while let Some(start) = find(file, PACKET_START.as_bytes(), from) {
        let Some(end) = find(file, PACKET_END.as_bytes(), start) else {
            break;
        };
        from = end + PACKET_END.len();
        if let Ok(packet) = std::str::from_utf8(&file[start..from])
            && let Some(page) = page_of(packet)
        {
            pages.push(page);
        }
    }
    pages
}

/// The page that an XMP `packet` of this program's cards keeps; none for any other packet.
fn page_of(packet: &str) -> Option<Page> {
    let document = element(packet, "xmpMM:DocumentID", 0)?.0.to_owned();
    let group = element(packet, "xmpG:groupName", 0)?.0;
    let share = match group.strip_prefix(SHARE_GROUP) {
        Some(reference) => Some(reference.to_owned()),
        None if group == BACKUP_GROUP => None,
        None => return None,
    };
    let mut codes = Vec::new();
    let mut from = 0;
    while let Some((name, end)) = element(packet, "xmpG:swatchName", from) {
        from = end;
        let (number, code) = name.split_once(' ')?;
        let number: usize = number.parse().ok()?;
        if number == 0 || code.is_empty() || !code.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        codes.push((number, SecretText::copy_of("printed codes", code)));
    }
    (!codes.is_empty()).then_some(Page {
        document,
        share,
        codes,
    })
}

/// The text of the first element `name` in `text` from `from`, and where it ends.
fn element<'a>(text: &'a str, name: &str, from: usize) -> Option<(&'a str, usize)> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let start = text.get(from..)?.find(&open)? + from + open.len();
    let end = text.get(start..)?.find(&close)? + start;
    Some((&text[start..end], end + close.len()))
}

/// Where `needle` first stands in `haystack` from `from`; the PDF reader's search too.
pub(crate) fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack
        .get(from..)?
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|at| from + at)
}

/// Why the codes of cards do not make a backup or a share.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrintedError {
    /// No card of this number was given.
    Missing(usize),
    /// Two files print different codes under this number.
    Different(usize),
    /// A line is no numbered code.
    Unreadable,
}

impl std::fmt::Display for PrintedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing(number) => write!(f, "card {number:02} is missing"),
            Self::Different(number) => {
                write!(f, "card {number:02} prints different codes in two files")
            }
            Self::Unreadable => f.write_str("the codes a card file keeps cannot be read"),
        }
    }
}

impl std::error::Error for PrintedError {}

impl mnemocode::refusal::Refusal for PrintedError {
    fn code(&self) -> &'static str {
        match self {
            Self::Missing(_) => "export.printed-codes.missing-card",
            Self::Different(_) => "export.printed-codes.different-codes",
            Self::Unreadable => "export.printed-codes.unreadable",
        }
    }
}

/// One backup or one set of shares that card files hold.
pub struct Found {
    /// The files it was read from, by their place in the list given.
    pub files: Vec<usize>,
    /// The set identifier of its shares, as their references print it; none for a backup.
    pub set: Option<String>,
    /// The backup's codes, or each share's, as a person types them: in the order of their
    /// numbers, separated by spaces, a colour as #RRGGBB; or why they are not complete.
    pub parts: Vec<Result<SecretText, PrintedError>>,
}

/// What the files read into `files`, a list of each file's pages, hold: each backup once, by its
/// document ID, and each set of shares once, by its identifier, in the order first found.
#[must_use]
pub fn found_in(files: &[Vec<Page>]) -> Vec<Found> {
    // Each part by its document or share reference: its numbered codes and what is wrong.
    type Part<'a> = (String, Vec<(usize, &'a str)>, Option<PrintedError>);
    // Each backup or set, by its key, then its parts.
    struct Gathered<'a> {
        key: String,
        set: Option<String>,
        files: Vec<usize>,
        parts: Vec<Part<'a>>,
    }
    let mut gathered: Vec<Gathered<'_>> = Vec::new();
    for (file, pages) in files.iter().enumerate() {
        for page in pages {
            let set = page
                .share
                .as_ref()
                .map(|share| share.split('-').next().unwrap_or(share).to_owned());
            let key = set.clone().unwrap_or_else(|| page.document.clone());
            // A share's cards by their share and their export: two exports of one share, whose
            // decoys differ, are two copies of it, not a conflict.
            let part = page.share.as_ref().map_or_else(
                || page.document.clone(),
                |share| format!("{share} {}", page.document),
            );
            let at = match gathered.iter().position(|found| found.key == key) {
                Some(at) => at,
                None => {
                    gathered.push(Gathered {
                        key,
                        set,
                        files: Vec::new(),
                        parts: Vec::new(),
                    });
                    gathered.len() - 1
                }
            };
            let found = &mut gathered[at];
            if !found.files.contains(&file) {
                found.files.push(file);
            }
            let place = match found.parts.iter().position(|(name, _, _)| *name == part) {
                Some(place) => place,
                None => {
                    found.parts.push((part, Vec::new(), None));
                    found.parts.len() - 1
                }
            };
            let (_, numbered, trouble) = &mut found.parts[place];
            for (number, code) in &page.codes {
                match numbered.iter().find(|(known, _)| known == number) {
                    Some((_, known)) if *known != code.as_str() => {
                        trouble.get_or_insert(PrintedError::Different(*number));
                    }
                    Some(_) => {}
                    None => numbered.push((*number, code.as_str())),
                }
            }
        }
    }
    gathered
        .into_iter()
        .map(|mut found| {
            found.parts.sort_by(|a, b| a.0.cmp(&b.0));
            Found {
                files: found.files,
                set: found.set,
                parts: found
                    .parts
                    .into_iter()
                    .map(|(_, numbered, trouble)| match trouble {
                        Some(trouble) => Err(trouble),
                        None => in_order(numbered),
                    })
                    .collect(),
            }
        })
        .collect()
}

/// `numbered`, the codes of one backup or share, in the order of their numbers as a person types
/// them; refused where a number is missing.
fn in_order(mut numbered: Vec<(usize, &str)>) -> Result<SecretText, PrintedError> {
    numbered.sort_unstable_by_key(|(number, _)| *number);
    for (place, (number, _)) in numbered.iter().enumerate() {
        if *number != place + 1 {
            return Err(PrintedError::Missing(place + 1));
        }
    }
    if numbered.is_empty() {
        return Err(PrintedError::Unreadable);
    }
    // One buffer of the whole length at once: a growing one would leave copies behind.
    let shown = |code: &str| code.len() + usize::from(code.len() == 6);
    let length = numbered
        .iter()
        .map(|(_, code)| shown(code) + 1)
        .sum::<usize>()
        - 1;
    let mut text = SecretBytes::large("printed codes", vec![b' '; length]);
    let mut at = 0;
    for (_, code) in &numbered {
        if code.len() == 6 {
            text[at] = b'#';
            at += 1;
        }
        text[at..at + code.len()].copy_from_slice(code.as_bytes());
        at += code.len() + 1;
    }
    SecretText::from_bytes(text).map_err(|_| PrintedError::Unreadable)
}
