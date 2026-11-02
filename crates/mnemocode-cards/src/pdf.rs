//! The PDF of pages (MnemoCode TS 0.1.0's `export/pdf-documents.ts`, CAP-CARDS-PDF-DOCUMENTS): the
//! steps of each page written with pdf-writer, the UI font embedded with only the characters drawn,
//! each image once, and no metadata: no document information dictionary, which would tell when a
//! backup was printed. The bytes differ from the TS's; the pages, text, positions and images do not.
//!
//! The objects go to a sink as they are made, and the table of where they lie comes last, which is
//! why it is written here: pdf-writer's `Pdf` holds the whole file in one buffer, and the cards of 16
//! shares take 337 MB in the largest design, which that buffer cannot grow to under a command's
//! memory cap, as a buffer that grows holds its old and its new bytes at once.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;
use std::io::{self, Write};
use std::rc::{Rc, Weak};

use miniz_oxide::deflate::compress_to_vec_zlib;
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretBytes;
use pdf_writer::types::{BlendMode as PdfBlend, CidFontType, FontFlags, SystemInfo, UnicodeCmap};
use pdf_writer::writers::Catalog;
use pdf_writer::{Chunk, Content, Filter, Name, Rect, Ref, Str};
use subsetter::GlyphRemapper;

use crate::scene::{Blend, Page, Path, Picture, Pixels, Segment, Step, UiFont};

/// The deflate level of the streams.
const DEFLATE_LEVEL: u8 = 6;
/// The name of the font in a PDF.
const FONT_NAME: &[u8] = b"AAAAAA+DejaVuSans";
/// The font's name in the resources of a page.
const FONT_RESOURCE: &[u8] = b"F0";
/// The start of a file: its version, and bytes past ASCII that tell a reader it is binary.
const FILE_HEADER: &[u8] = b"%PDF-1.7\n%\x80\x80\x80\x80\n\n";

/// Why a document could not be written.
#[derive(Debug)]
pub enum PdfError {
    /// The font could not be subset, in the words of its library.
    Font(String),
    /// The sink refused the bytes.
    Write(io::Error),
}

impl fmt::Display for PdfError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Font(reason) => write!(f, "The card font could not be embedded: {reason}."),
            Self::Write(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for PdfError {}

impl Refusal for PdfError {
    fn code(&self) -> &'static str {
        match self {
            Self::Font(_) => "export.pdf-documents.font-not-embedded",
            Self::Write(_) => "export.pdf-documents.not-written",
        }
    }
}

impl From<io::Error> for PdfError {
    fn from(error: io::Error) -> Self {
        Self::Write(error)
    }
}

/// Hands out the numbers of a document's objects.
struct Ids(i32);

impl Ids {
    fn next(&mut self) -> Ref {
        self.0 += 1;
        Ref::new(self.0)
    }
}

/// Deflates `data`.
fn deflated(data: &[u8]) -> Vec<u8> {
    compress_to_vec_zlib(data, DEFLATE_LEVEL)
}

/// The sink of a file, with how far it has come and where each object lies.
struct Output<W> {
    sink: W,
    length: usize,
    objects: Vec<(i32, usize)>,
}

impl<W: Write> Output<W> {
    fn write(&mut self, bytes: &[u8]) -> Result<(), PdfError> {
        self.sink.write_all(bytes)?;
        self.length += bytes.len();
        Ok(())
    }

    /// Writes the object `id` that `fill` makes.
    fn object(&mut self, id: Ref, fill: impl FnOnce(&mut Chunk)) -> Result<(), PdfError> {
        let mut chunk = Chunk::new();
        fill(&mut chunk);
        self.objects.push((id.get(), self.length));
        self.write(chunk.as_bytes())
    }

    /// Ends the file with the table of its objects and the trailer that names `catalog`
    /// (ISO 32000-1, 7.5.4 and 7.5.5), and gives its sink. Every number from 1 is an object.
    fn finish(mut self, catalog: Ref) -> Result<W, PdfError> {
        self.objects.sort_unstable();
        let start = self.length;
        let size = self.objects.len() + 1;
        let mut table = format!("xref\n0 {size}\n0000000000 65535 f\r\n");
        for (_, offset) in &self.objects {
            table.push_str(&format!("{offset:010} 00000 n\r\n"));
        }
        let root = catalog.get();
        table.push_str(&format!(
            "trailer\n<<\n  /Size {size}\n  /Root {root} 0 R\n>>\nstartxref\n{start}\n%%EOF"
        ));
        self.write(table.as_bytes())?;
        Ok(self.sink)
    }
}

/// Embeds `picture`.
fn embed_image<W: Write>(
    output: &mut Output<W>,
    ids: &mut Ids,
    picture: &Picture,
) -> Result<Ref, PdfError> {
    let id = ids.next();
    let (width, height) = (picture.width as i32, picture.height as i32);
    match &picture.pixels {
        Pixels::Jpeg(file) => output.object(id, |chunk| {
            let mut image = chunk.image_xobject(id, file);
            image.filter(Filter::DctDecode);
            image.width(width);
            image.height(height);
            image.color_space().device_rgb();
            image.bits_per_component(8);
        })?,
        Pixels::Rgb { data, alpha } => {
            let mask = alpha.as_ref().map(|_| ids.next());
            if let (Some(alpha), Some(mask)) = (alpha, mask) {
                let compressed = deflated(alpha);
                output.object(mask, |chunk| {
                    let mut image = chunk.image_xobject(mask, &compressed);
                    image.filter(Filter::FlateDecode);
                    image.width(width);
                    image.height(height);
                    image.color_space().device_gray();
                    image.bits_per_component(8);
                })?;
            }
            let compressed = deflated(data);
            output.object(id, |chunk| {
                let mut image = chunk.image_xobject(id, &compressed);
                image.filter(Filter::FlateDecode);
                image.width(width);
                image.height(height);
                image.color_space().device_rgb();
                image.bits_per_component(8);
                if let Some(mask) = mask {
                    image.s_mask(mask);
                }
            })?;
        }
    }
    Ok(id)
}

/// The name of an opacity and blend state, in thousandths so that it can be a key.
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
struct State {
    fill: u32,
    stroke: u32,
    blend: Blend,
}

/// The objects that the pages share.
struct Shared {
    states: HashMap<State, (Ref, String)>,
    /// Each image embedded, by the address of its picture. The weak reference keeps that address
    /// taken after a page lets its picture go, so that no later picture comes to the same key.
    images: HashMap<*const Picture, (Weak<Picture>, Ref, String)>,
}

impl Shared {
    /// The name of the state, added to the document where it is new.
    fn state<W: Write>(
        &mut self,
        output: &mut Output<W>,
        ids: &mut Ids,
        state: State,
    ) -> Result<String, PdfError> {
        if let Some((_, name)) = self.states.get(&state) {
            return Ok(name.clone());
        }
        let id = ids.next();
        output.object(id, |chunk| {
            let mut writer = chunk.ext_graphics(id);
            writer
                .non_stroking_alpha(state.fill as f32 / 1000.0)
                .stroking_alpha(state.stroke as f32 / 1000.0);
            if state.blend == Blend::Color {
                writer.blend_mode(PdfBlend::Color);
            }
        })?;
        let name = format!("G{}", self.states.len());
        self.states.insert(state, (id, name.clone()));
        Ok(name)
    }

    /// The name of the image, embedded where it is new.
    fn image<W: Write>(
        &mut self,
        output: &mut Output<W>,
        ids: &mut Ids,
        picture: &Rc<Picture>,
    ) -> Result<String, PdfError> {
        if let Some((_, _, name)) = self.images.get(&Rc::as_ptr(picture)) {
            return Ok(name.clone());
        }
        let embedded = embed_image(output, ids, picture)?;
        let name = format!("I{}", self.images.len());
        self.images.insert(
            Rc::as_ptr(picture),
            (Rc::downgrade(picture), embedded, name.clone()),
        );
        Ok(name)
    }
}

/// Writes `path` into `content`.
fn write_path(content: &mut Content, path: &Path) {
    for segment in path {
        match *segment {
            Segment::Move(x, y) => {
                content.move_to(x as f32, y as f32);
            }
            Segment::Line(x, y) => {
                content.line_to(x as f32, y as f32);
            }
            Segment::Curve(x1, y1, x2, y2, x, y) => {
                content.cubic_to(
                    x1 as f32, y1 as f32, x2 as f32, y2 as f32, x as f32, y as f32,
                );
            }
            Segment::Close => {
                content.close_path();
            }
        }
    }
}

/// The colour as PDF's operators take it.
fn channels(color: crate::scene::Rgb) -> (f32, f32, f32) {
    (color.red as f32, color.green as f32, color.blue as f32)
}

/// A share from 0 to 1, in thousandths.
fn thousandths(share: f64) -> u32 {
    (share * 1000.0 + 0.5) as u32
}

/// Keeps the graphics state and sets `value` on it; the name of `value` among the page's resources.
fn enter_state<W: Write>(
    content: &mut Content,
    output: &mut Output<W>,
    ids: &mut Ids,
    shared: &mut Shared,
    value: State,
) -> Result<String, PdfError> {
    content.save_state();
    let name = shared.state(output, ids, value)?;
    content.set_parameters(Name(name.as_bytes()));
    Ok(name)
}

/// What the glyphs of a document stand for: their numbers in its font, and the character of each
/// for the text that a PDF reader copies.
#[derive(Default)]
struct DrawnGlyphs {
    remapper: GlyphRemapper,
    characters: BTreeMap<u16, char>,
}

impl DrawnGlyphs {
    /// The bytes that show `glyphs`, which stand for `text`.
    fn shown(&mut self, glyphs: &[u16], text: &str) -> Vec<u8> {
        for (glyph, character) in glyphs.iter().zip(text.chars()) {
            self.characters.entry(*glyph).or_insert(character);
        }
        glyphs
            .iter()
            .flat_map(|glyph| self.remapper.remap(*glyph).to_be_bytes())
            .collect()
    }
}

/// The content of a page and the names of what it uses.
struct PageContent {
    bytes: Vec<u8>,
    states: BTreeSet<String>,
    images: BTreeSet<String>,
}

/// The content of `page`.
fn page_content<W: Write>(
    output: &mut Output<W>,
    ids: &mut Ids,
    page: &Page,
    shared: &mut Shared,
    drawn: &mut DrawnGlyphs,
) -> Result<PageContent, PdfError> {
    let mut content = Content::new();
    let (mut states, mut images) = (BTreeSet::new(), BTreeSet::new());
    for step in &page.steps {
        match step {
            Step::Save => {
                content.save_state();
            }
            Step::Restore => {
                content.restore_state();
            }
            Step::Transform([a, b, c, d, e, f]) => {
                content.transform([
                    *a as f32, *b as f32, *c as f32, *d as f32, *e as f32, *f as f32,
                ]);
            }
            Step::Clip { path, even_odd } => {
                write_path(&mut content, path);
                if *even_odd {
                    content.clip_even_odd();
                } else {
                    content.clip_nonzero();
                }
                content.end_path();
            }
            Step::Fill {
                path,
                color,
                opacity,
                blend,
            } => {
                let value = State {
                    fill: thousandths(*opacity),
                    stroke: 1000,
                    blend: *blend,
                };
                states.insert(enter_state(&mut content, output, ids, shared, value)?);
                let (red, green, blue) = channels(*color);
                content.set_fill_rgb(red, green, blue);
                write_path(&mut content, path);
                content.fill_nonzero();
                content.restore_state();
            }
            Step::Stroke {
                path,
                color,
                width,
                opacity,
            } => {
                let value = State {
                    fill: 1000,
                    stroke: thousandths(*opacity),
                    blend: Blend::Normal,
                };
                states.insert(enter_state(&mut content, output, ids, shared, value)?);
                let (red, green, blue) = channels(*color);
                content.set_stroke_rgb(red, green, blue);
                content.set_line_width(*width as f32);
                write_path(&mut content, path);
                content.stroke();
                content.restore_state();
            }
            Step::Image { picture, place } => {
                let name = shared.image(output, ids, picture)?;
                content.save_state();
                content.transform([
                    place.width as f32,
                    0.0,
                    0.0,
                    place.height as f32,
                    place.x as f32,
                    place.y as f32,
                ]);
                content.x_object(Name(name.as_bytes()));
                content.restore_state();
                images.insert(name);
            }
            Step::Text {
                glyphs,
                text,
                x,
                y,
                size,
                color,
            } => {
                let shown = drawn.shown(glyphs, text);
                let (red, green, blue) = channels(*color);
                content.set_fill_rgb(red, green, blue);
                content.begin_text();
                content.set_font(Name(FONT_RESOURCE), *size as f32);
                content.next_line(*x as f32, *y as f32);
                content.show(Str(&shown));
                content.end_text();
            }
        }
    }
    Ok(PageContent {
        bytes: content.finish().to_vec(),
        states,
        images,
    })
}

/// A PDF that takes its pages one at a time: each goes to the sink as it comes, its images deflated,
/// so that a host can let a page go before it draws the next. The font comes last, with the glyphs
/// that the pages drew. No document information is written.
pub struct PdfPages<W> {
    output: Output<W>,
    ids: Ids,
    catalog: Ref,
    tree: Ref,
    font: Ref,
    kids: Vec<Ref>,
    shared: Shared,
    drawn: DrawnGlyphs,
}

impl<W: Write> PdfPages<W> {
    /// A PDF of no page yet, written to `sink`.
    pub fn new(sink: W) -> Result<Self, PdfError> {
        let mut output = Output {
            sink,
            length: 0,
            objects: Vec::new(),
        };
        output.write(FILE_HEADER)?;
        let mut ids = Ids(0);
        let (catalog, tree, font) = (ids.next(), ids.next(), ids.next());
        output.object(catalog, |chunk| {
            chunk.indirect(catalog).start::<Catalog>().pages(tree);
        })?;
        Ok(Self {
            output,
            ids,
            catalog,
            tree,
            font,
            kids: Vec::new(),
            shared: Shared {
                states: HashMap::new(),
                images: HashMap::new(),
            },
            drawn: DrawnGlyphs::default(),
        })
    }

    /// Writes `page` after those so far.
    pub fn add(&mut self, page: &Page) -> Result<(), PdfError> {
        let content = page_content(
            &mut self.output,
            &mut self.ids,
            page,
            &mut self.shared,
            &mut self.drawn,
        )?;
        let (page_id, content_id) = (self.ids.next(), self.ids.next());
        let compressed = deflated(&content.bytes);
        self.output.object(content_id, |chunk| {
            chunk
                .stream(content_id, &compressed)
                .filter(Filter::FlateDecode);
        })?;
        self.kids.push(page_id);
        let (tree, font, shared) = (self.tree, self.font, &self.shared);
        self.output.object(page_id, |chunk| {
            let mut written = chunk.page(page_id);
            written.parent(tree);
            written.media_box(Rect::new(0.0, 0.0, page.width as f32, page.height as f32));
            written.contents(content_id);
            let mut resources = written.resources();
            resources.fonts().pair(Name(FONT_RESOURCE), font);
            {
                let mut map = resources.ext_g_states();
                for (id, name) in shared.states.values() {
                    if content.states.contains(name) {
                        map.pair(Name(name.as_bytes()), *id);
                    }
                }
            }
            let mut map = resources.x_objects();
            for (_, id, name) in shared.images.values() {
                if content.images.contains(name) {
                    map.pair(Name(name.as_bytes()), *id);
                }
            }
        })
    }

    /// Embeds the font, its subset of the glyphs drawn, with how to write them.
    fn embed_font(&mut self, font: &UiFont) -> Result<(), PdfError> {
        let remapper = &self.drawn.remapper;
        let subset = subsetter::subset(font.bytes(), 0, remapper)
            .map_err(|error| PdfError::Font(error.to_string()))?;
        let font_id = self.font;
        let (cid_id, descriptor_id, file_id, cmap_id) = (
            self.ids.next(),
            self.ids.next(),
            self.ids.next(),
            self.ids.next(),
        );
        let output = &mut self.output;
        let name = Name(FONT_NAME);
        output.object(font_id, |chunk| {
            chunk
                .type0_font(font_id)
                .base_font(name)
                .encoding_predefined(Name(b"Identity-H"))
                .descendant_font(cid_id)
                .to_unicode(cmap_id);
        })?;
        let info = SystemInfo {
            registry: Str(b"Adobe"),
            ordering: Str(b"Identity"),
            supplement: 0,
        };
        let scale = 1000.0 / font.per_em();
        let widths: Vec<f32> = remapper
            .remapped_gids()
            .map(|old| (font.advance(old) * scale) as f32)
            .collect();
        output.object(cid_id, |chunk| {
            let mut cid = chunk.cid_font(cid_id);
            cid.subtype(CidFontType::Type2)
                .base_font(name)
                .system_info(info)
                .font_descriptor(descriptor_id)
                .default_width(0.0)
                .cid_to_gid_map_predefined(Name(b"Identity"));
            cid.widths().consecutive(0, widths);
        })?;
        output.object(descriptor_id, |chunk| {
            chunk
                .font_descriptor(descriptor_id)
                .name(name)
                .flags(FontFlags::NON_SYMBOLIC)
                .bbox(Rect::new(-1021.0, -463.0, 1793.0, 1232.0))
                .italic_angle(0.0)
                .ascent(928.0)
                .descent(-236.0)
                .cap_height(729.0)
                .stem_v(80.0)
                .font_file2(file_id);
        })?;
        let compressed = deflated(&subset);
        output.object(file_id, |chunk| {
            let mut file = chunk.stream(file_id, &compressed);
            file.filter(Filter::FlateDecode);
            file.pair(Name(b"Length1"), subset.len() as i32);
        })?;
        let mut cmap = UnicodeCmap::new(Name(b"Custom"), info);
        for (old, character) in &self.drawn.characters {
            if let Some(new) = remapper.get(*old) {
                cmap.pair(new, *character);
            }
        }
        let cmap = cmap.finish();
        output.object(cmap_id, |chunk| {
            chunk.cmap(cmap_id, &cmap);
        })
    }

    /// Ends the file, and gives its sink.
    pub fn finish(mut self, font: &UiFont) -> Result<W, PdfError> {
        self.embed_font(font)?;
        let (tree, kids) = (self.tree, &self.kids);
        self.output.object(tree, |chunk| {
            chunk
                .pages(tree)
                .kids(kids.iter().copied())
                .count(kids.len() as i32);
        })?;
        self.output.finish(self.catalog)
    }
}

/// The PDF of `pages` already drawn, in their order: it shows the codes, so its bytes are held as a
/// secret. [`crate::export::pdf_of`] takes them as they are drawn.
pub fn document(font: &UiFont, pages: &[Page]) -> Result<SecretBytes, PdfError> {
    let mut pdf = PdfPages::new(Vec::new())?;
    for page in pages {
        pdf.add(page)?;
    }
    Ok(SecretBytes::large("a card document", pdf.finish(font)?))
}
