//! The cards part for a page (`browser-cards`): the designs of this file, the sheets and separate
//! cards of a backup and of shares, sample cards and the sheet for heirs, each drawn in Rust, as a
//! PDF or as page images. A secret crosses as a `JsValue` that Rust reads (ARCHITECTURE.md §6), so
//! what is public stands in the receiver, [`CardExport`]. What a page gets back holds the codes:
//! it drops [`CardPlan`] and [`CardDocuments`] soon after, which wipes them.

use std::cell::RefCell;
use std::fmt;
use std::rc::Rc;

use mnemocode::backup::Backup;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::refusal::Refusal;
use mnemocode::self_check::{Check, Tier};
use mnemocode_cards::checks::{CARD_EXPORT, ROWS};
use mnemocode_cards::content::backup_card_content;
use mnemocode_cards::details::{CardCopy, CardSession as Details, ExportDetails};
use mnemocode_cards::export::{
    CardJob, CardPreview, CardPreviewOptions, DesignSelection, NamedDocument, planned_card_job,
    render_cards, render_individual_cards, separate_card_job,
};
use mnemocode_cards::heir::{
    HeirBackup, HeirError, HeirRoute, HeirSheetFacts, HeirSheetSize, heir_sheet_text,
    render_heir_sheet,
};
use mnemocode_cards::pdf::document;
use mnemocode_cards::raster::{ImageFormat, page_image};
use mnemocode_cards::settings::{CardProfile, CardSettings, Orientation, PageSize, ProfileField};
use mnemocode_cards::templates::{CARD_TEMPLATES, CardDrawing, CardTemplate, select_template};
use wasm_bindgen::prelude::*;

use crate::host::{BrowserRandom, after_secret, name, place, refused, text};

/// A part of the cards that a page names and none has.
#[derive(Debug)]
struct NoSuchPart;

impl fmt::Display for NoSuchPart {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("The cards have no such detail or text.")
    }
}

impl std::error::Error for NoSuchPart {}

impl Refusal for NoSuchPart {
    fn code(&self) -> &'static str {
        "wasm.cards.no-such-part"
    }
}

/// `result` with its refusal as the error a page catches.
fn thrown<T, E: Refusal>(result: Result<T, E>) -> Result<T, JsValue> {
    result.map_err(|refusal| refused(&refusal))
}

/// One design of this file.
#[wasm_bindgen]
pub struct CardDesign(&'static CardTemplate);

#[wasm_bindgen]
impl CardDesign {
    /// Its id, as a page names it.
    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.0.id.to_owned()
    }

    /// Its name.
    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.0.name()
    }

    /// What it draws.
    #[wasm_bindgen(getter)]
    pub fn description(&self) -> String {
        self.0.description()
    }

    /// Whether it draws separate cards as well as sheets.
    #[wasm_bindgen(getter, js_name = drawsSeparateCards)]
    pub fn draws_separate_cards(&self) -> bool {
        self.0.draws_separate_cards()
    }
}

/// How many designs this file holds.
#[wasm_bindgen(js_name = cardDesignCount)]
pub fn card_design_count() -> usize {
    CARD_TEMPLATES.len()
}

/// The design at `at`, from 0; none past the last.
#[wasm_bindgen(js_name = cardDesign)]
pub fn card_design(at: f64) -> Option<CardDesign> {
    CARD_TEMPLATES.get(place(at)).map(CardDesign)
}

/// The page, the design and the details of the cards of one export, all public; what is left out is
/// invented with the browser's randomness when the cards are planned.
#[wasm_bindgen]
pub struct CardExport {
    drawing: Rc<CardDrawing>,
    template: Option<String>,
    page_size: Option<PageSize>,
    orientation: Option<Orientation>,
    profile: CardProfile,
    copy: CardCopy,
    title: Option<String>,
    card_qr: bool,
    session: Option<Rc<RefCell<Details>>>,
}

#[wasm_bindgen]
impl CardExport {
    /// The cards of the design `template`, on the page `page_size` turned to `orientation`, each
    /// the default where it is left out, with a QR code on a sheet where `card_qr` says so. A size
    /// or a turn of none is refused here.
    #[wasm_bindgen(constructor)]
    pub fn new(
        template: Option<String>,
        page_size: Option<String>,
        orientation: Option<String>,
        card_qr: bool,
    ) -> Result<CardExport, JsValue> {
        Ok(Self {
            drawing: Rc::new(CardDrawing::new()),
            template,
            page_size: page_size
                .map(|size| thrown(PageSize::parse(Some(&size))))
                .transpose()?,
            orientation: thrown(Orientation::parse(orientation.as_deref()))?,
            profile: CardProfile::default(),
            copy: CardCopy::default(),
            title: None,
            card_qr,
            session: None,
        })
    }

    /// The `value` of the person's detail `field`: name, role, company, email, phone, website or
    /// location.
    #[wasm_bindgen(js_name = setDetail)]
    pub fn set_detail(&mut self, field: &str, value: String) -> Result<(), JsValue> {
        let found = ProfileField::ALL
            .into_iter()
            .find(|known| known.name() == field);
        self.profile.set(thrown(found.ok_or(NoSuchPart))?, value);
        Ok(())
    }

    /// The text `part` of the design: studioName, slogan, subtitle, footer or referenceLabel; "-"
    /// hides its line.
    #[wasm_bindgen(js_name = setText)]
    pub fn set_text(&mut self, part: &str, value: String) -> Result<(), JsValue> {
        let slot = match part {
            "studioName" => &mut self.copy.studio_name,
            "slogan" => &mut self.copy.slogan,
            "subtitle" => &mut self.copy.subtitle,
            "footer" => &mut self.copy.footer,
            "referenceLabel" => &mut self.copy.reference_label,
            _ => return thrown(Err(NoSuchPart)),
        };
        *slot = Some(value);
        Ok(())
    }

    /// The title of the sheet, in place of the studio name.
    #[wasm_bindgen(js_name = setTitle)]
    pub fn set_title(&mut self, title: String) {
        self.title = Some(title);
    }

    /// The design of this export.
    fn design(&self) -> Result<&'static CardTemplate, JsValue> {
        thrown(select_template(self.template.as_deref()))
    }

    /// Takes the details left out from `session`, so that this export repeats what it chose.
    #[wasm_bindgen(js_name = useSession)]
    pub fn use_session(&mut self, session: &CardSession) {
        self.session = Some(Rc::clone(&session.0));
    }

    /// The settings of its cards, with the details that were left out invented, for `design`.
    fn settings(&self, design: Option<&CardTemplate>) -> Result<CardSettings, JsValue> {
        let profile = thrown(self.profile.validated())?;
        let sector = design.and_then(CardTemplate::sector);
        let details = thrown(match &self.session {
            Some(session) => {
                session
                    .borrow_mut()
                    .settings_for(&mut BrowserRandom, sector, &profile, &self.copy)
            }
            None => ExportDetails::drawn(&mut BrowserRandom, &profile, &self.copy, sector),
        })?;
        Ok(CardSettings {
            page_size: self.page_size,
            orientation: self.orientation,
            profile: details.profile,
            presentation: Some(details.presentation),
            card_qr: self.card_qr,
        })
    }

    /// The cards of the backup `codes`, written in the form `form` and masked in `mode`, planned
    /// once for every file of the export, so that each shows the same cards.
    pub fn backup(
        &self,
        codes: JsValue,
        form: JsValue,
        mode: JsValue,
    ) -> Result<CardPlan, JsValue> {
        after_secret(|| {
            let form = thrown(Form::named(&name(&form)))?;
            let mode = thrown(Mode::named(&name(&mode)))?;
            let backup = thrown(Backup::read(&text(&codes)?, form, mode))?;
            let template = self.design()?;
            let settings = self.settings(Some(template))?;
            let cards = thrown(backup_card_content(
                &backup,
                settings,
                self.title.as_deref(),
            ))?;
            let job = thrown(planned_card_job(
                &self.drawing,
                &mut BrowserRandom,
                &CardJob { template, cards },
            ))?;
            Ok(CardPlan {
                drawing: Rc::clone(&self.drawing),
                job,
                orientation: self.orientation,
            })
        })
    }

    /// Sample cards of a random phrase of `words` words (0: the default), of this design or of
    /// `every` design.
    pub fn preview(&self, words: f64, every: bool) -> Result<CardDocuments, JsValue> {
        let selection = if every {
            DesignSelection::Every
        } else {
            DesignSelection::One(self.template.as_deref())
        };
        let template = if every { None } else { Some(self.design()?) };
        let preview = thrown(CardPreview::new(
            &mut BrowserRandom,
            CardPreviewOptions {
                words: (place(words) != 0).then(|| place(words)),
                settings: self.settings(template)?,
                title: self.title.clone(),
                color_form: None,
            },
        ))?;
        let jobs = thrown(preview.jobs(selection))?;
        let pages = thrown(render_cards(&self.drawing, &mut BrowserRandom, &jobs))?;
        Ok(CardDocuments {
            drawing: Rc::clone(&self.drawing),
            documents: vec![NamedDocument {
                name: mnemocode_cards::export::SAMPLE_FILE_BASE.to_owned(),
                pages,
            }],
        })
    }
}

/// The details that a working session invented: one person, and one employer for each sector, kept
/// across exports until the page frees it.
#[wasm_bindgen]
pub struct CardSession(Rc<RefCell<Details>>);

#[wasm_bindgen]
impl CardSession {
    /// A session with nothing chosen yet.
    #[wasm_bindgen(constructor)]
    pub fn new() -> CardSession {
        Self(Rc::default())
    }
}

impl Default for CardSession {
    fn default() -> Self {
        Self::new()
    }
}

/// The cards of a backup, planned once: its sheets and its separate cards show the same cards.
#[wasm_bindgen]
pub struct CardPlan {
    drawing: Rc<CardDrawing>,
    job: CardJob,
    orientation: Option<Orientation>,
}

#[wasm_bindgen]
impl CardPlan {
    /// The sheets: one document.
    pub fn sheets(&self) -> Result<CardDocuments, JsValue> {
        after_secret(|| {
            let job = [CardJob {
                template: self.job.template,
                cards: self.job.cards.clone(),
            }];
            let pages = thrown(render_cards(&self.drawing, &mut BrowserRandom, &job))?;
            Ok(CardDocuments {
                drawing: Rc::clone(&self.drawing),
                documents: vec![NamedDocument {
                    name: "sheets".to_owned(),
                    pages,
                }],
            })
        })
    }

    /// The separate cards: a document for each.
    pub fn separate(&self) -> Result<CardDocuments, JsValue> {
        after_secret(|| {
            let job = thrown(separate_card_job(&self.job, self.orientation))?;
            let documents = thrown(render_individual_cards(
                &self.drawing,
                &mut BrowserRandom,
                job.template,
                &job.cards,
            ))?;
            Ok(CardDocuments {
                drawing: Rc::clone(&self.drawing),
                documents,
            })
        })
    }
}

/// Drawn documents, each a PDF or images of its pages when a page asks for them.
#[wasm_bindgen]
pub struct CardDocuments {
    drawing: Rc<CardDrawing>,
    documents: Vec<NamedDocument>,
}

impl CardDocuments {
    /// The document at `at`, refused past the last.
    fn document(&self, at: f64) -> Result<&NamedDocument, JsValue> {
        thrown(self.documents.get(place(at)).ok_or(NoSuchPart))
    }
}

#[wasm_bindgen]
impl CardDocuments {
    /// How many documents there are.
    #[wasm_bindgen(getter)]
    pub fn count(&self) -> usize {
        self.documents.len()
    }

    /// The name of the document at `at`.
    pub fn name(&self, at: f64) -> Result<String, JsValue> {
        Ok(self.document(at)?.name.clone())
    }

    /// How many pages the document at `at` has.
    #[wasm_bindgen(js_name = pageCount)]
    pub fn page_count(&self, at: f64) -> Result<usize, JsValue> {
        Ok(self.document(at)?.pages.len())
    }

    /// The document at `at` as a PDF file.
    pub fn pdf(&self, at: f64) -> Result<Vec<u8>, JsValue> {
        after_secret(|| {
            let pdf = thrown(document(&self.drawing.font, &self.document(at)?.pages))?;
            Ok(pdf.to_vec())
        })
    }

    /// The page `page` of the document at `at`, as an image in `format`: png or jpg.
    pub fn image(&self, at: f64, page: f64, format: &str) -> Result<Vec<u8>, JsValue> {
        after_secret(|| {
            let format = thrown(ImageFormat::parse(Some(format)))?;
            let page = thrown(self.document(at)?.pages.get(place(page)).ok_or(NoSuchPart))?;
            let image = thrown(page_image(&self.drawing.font, page, format))?;
            Ok(image.to_vec())
        })
    }
}

/// The cards of shares.
#[cfg(feature = "browser-sskr")]
pub mod shares {
    use mnemocode::sskr::forms::ShareFormat;
    use mnemocode_cards::content::SskrLayout;
    use mnemocode_cards::export::{ShareCardOptions, ShareCardSet, own_share_cards};
    use mnemocode_cards::templates::{DEFAULT_SHARE_TEMPLATE_ID, select_template};

    use super::{
        BrowserRandom, CardDocuments, CardDrawing, CardExport, JsValue, NamedDocument, NoSuchPart,
        Rc, after_secret, name, place, text, thrown, wasm_bindgen,
    };

    /// The cards of a set of shares, planned once.
    #[wasm_bindgen]
    pub struct ShareCards {
        drawing: Rc<CardDrawing>,
        set: ShareCardSet,
    }

    #[wasm_bindgen]
    impl CardExport {
        /// The cards of `records`, shares as written, in `format` and the layout `layout`, the
        /// default where it is left out.
        pub fn shares(
            &self,
            records: Vec<JsValue>,
            format: JsValue,
            layout: JsValue,
        ) -> Result<ShareCards, JsValue> {
            after_secret(|| {
                let layout = (!layout.is_undefined()).then(|| name(&layout));
                let records = records.iter().map(text).collect::<Result<Vec<_>, _>>()?;
                let share_format = thrown(ShareFormat::named(&name(&format)))?;
                let template = thrown(select_template(Some(
                    self.template
                        .as_deref()
                        .unwrap_or(DEFAULT_SHARE_TEMPLATE_ID),
                )))?;
                let options = ShareCardOptions {
                    template,
                    layout: thrown(SskrLayout::parse(layout.as_deref()))?,
                    share_format,
                    title: self.title.clone(),
                    settings: self.settings(Some(template))?,
                };
                let set = thrown(ShareCardSet::create(
                    &self.drawing,
                    &mut BrowserRandom,
                    &records,
                    &options,
                ))?;
                Ok(ShareCards {
                    drawing: Rc::clone(&self.drawing),
                    set,
                })
            })
        }
    }

    #[wasm_bindgen]
    impl ShareCards {
        /// How many shares the set holds.
        #[wasm_bindgen(getter)]
        pub fn count(&self) -> usize {
            self.set.shares().count()
        }

        /// The documents of the share at `at`, from 0.
        pub fn documents(&self, at: f64) -> Result<CardDocuments, JsValue> {
            after_secret(|| {
                let place = place(at);
                let share = thrown(self.set.shares().nth(place).ok_or(NoSuchPart))?;
                let mut documents: Vec<NamedDocument> = Vec::with_capacity(share.documents);
                for index in 0..share.documents {
                    documents.push(thrown(self.set.document(
                        &self.drawing,
                        &mut BrowserRandom,
                        place,
                        index,
                    ))?);
                }
                Ok(CardDocuments {
                    drawing: Rc::clone(&self.drawing),
                    documents,
                })
            })
        }

        /// The QR code that the sheets of the share at `at` print, as its text; none on separate
        /// cards.
        #[wasm_bindgen(js_name = qrPayload)]
        pub fn qr_payload(&self, at: f64) -> Result<Option<String>, JsValue> {
            after_secret(|| {
                Ok(self
                    .set
                    .qr_codes()
                    .get(place(at))
                    .map(|code| code.payload.clone()))
            })
        }
    }

    /// The codes of one share on its cards in `format`, before the decoys, for the sheet for heirs;
    /// none in a form without cards.
    #[wasm_bindgen(js_name = ownShareCards)]
    pub fn own_cards(record: JsValue, format: JsValue) -> Result<Option<usize>, JsValue> {
        after_secret(|| {
            let format = thrown(ShareFormat::named(&name(&format)))?;
            thrown(own_share_cards(&text(&record)?, format))
        })
    }

    /// The facts of a sheet for shares.
    pub(super) fn heir_shares(
        format: &str,
        threshold: f64,
        count: f64,
        codes: Option<usize>,
    ) -> Result<super::HeirBackup, JsValue> {
        Ok(super::HeirBackup::Shares {
            format: thrown(ShareFormat::named(format))?,
            threshold: place(threshold),
            count: place(count),
            codes,
        })
    }
}

/// The count `value` of a sheet for heirs; `refusal` where it is no whole number.
fn heir_count(value: f64, refusal: HeirError) -> Result<usize, JsValue> {
    let count = place(value);
    if count == usize::MAX {
        return thrown(Err(refusal));
    }
    Ok(count)
}

/// The way through a page to the seed phrase, told by the page, for the sheet for heirs. Its steps
/// are written with {dates}, which the sheet fills in, or leaves out where no dates are asked.
#[wasm_bindgen]
pub struct HeirPage {
    subtitle: String,
    address: String,
    start: Vec<String>,
    steps: Vec<String>,
    date_digit_help: Option<String>,
    size: HeirSheetSize,
}

#[wasm_bindgen]
impl HeirPage {
    /// A route: the line under the title, the one address that the sheet prints, the steps that
    /// open the page, those that lead to the phrase, what to do with an unclear digit of a date,
    /// and the size of the sheet, the default where it is left out.
    #[wasm_bindgen(constructor)]
    pub fn new(
        subtitle: String,
        address: String,
        start: Vec<String>,
        steps: Vec<String>,
        date_digit_help: Option<String>,
        size: Option<String>,
    ) -> Result<HeirPage, JsValue> {
        Ok(Self {
            subtitle,
            address,
            start,
            steps,
            date_digit_help,
            size: thrown(HeirSheetSize::parse(size.as_deref()))?,
        })
    }

    /// The sheet for an encoded backup of `words` words in `form`, masked in `mode` with `dates`
    /// dates.
    #[wasm_bindgen(js_name = encodedSheet)]
    pub fn encoded_sheet(
        &self,
        form: &str,
        words: f64,
        mode: &str,
        dates: f64,
    ) -> Result<Vec<u8>, JsValue> {
        let backup = HeirBackup::Encoded {
            form: thrown(Form::named(form))?,
            words: place(words),
        };
        self.sheet(backup, mode, dates)
    }

    /// The sheet for `count` shares in `format` of which `threshold` restore the phrase, each with
    /// `codes` codes on its cards (NaN: not said).
    #[cfg(feature = "browser-sskr")]
    #[wasm_bindgen(js_name = sharesSheet)]
    pub fn shares_sheet(
        &self,
        format: &str,
        threshold: f64,
        count: f64,
        codes: f64,
        mode: &str,
        dates: f64,
    ) -> Result<Vec<u8>, JsValue> {
        let codes = (!codes.is_nan())
            .then(|| heir_count(codes, HeirError::Codes))
            .transpose()?;
        let backup = shares::heir_shares(format, threshold, count, codes)?;
        self.sheet(backup, mode, dates)
    }

    /// The sheet of `backup`.
    fn sheet(&self, backup: HeirBackup, mode: &str, dates: f64) -> Result<Vec<u8>, JsValue> {
        let facts = HeirSheetFacts {
            backup,
            mode: thrown(Mode::named(mode))?,
            dates: heir_count(dates, HeirError::Dates)?,
        };
        let words = thrown(heir_sheet_text(self, &facts))?;
        let font = mnemocode_cards::scene::UiFont::load();
        let pages = thrown(render_heir_sheet(&font, &words, self.size))?;
        Ok(thrown(document(&font, &pages))?.to_vec())
    }

    /// The steps of the route, with `dates`.
    fn steps_with(&self, dates: Option<&str>) -> Vec<String> {
        let filled = dates.map_or_else(String::new, |dates| format!(", then {dates}"));
        self.steps
            .iter()
            .map(|step| step.replace("{dates}", &filled))
            .collect()
    }
}

impl HeirRoute for HeirPage {
    fn subtitle(&self) -> String {
        self.subtitle.clone()
    }

    fn address(&self) -> String {
        self.address.clone()
    }

    fn start(&self) -> Vec<String> {
        self.start.clone()
    }

    fn decode(&self, _mode: Mode, _words: usize, dates: Option<&str>) -> Vec<String> {
        self.steps_with(dates)
    }

    fn restore(&self, _mode: Mode, _threshold: usize, dates: Option<&str>) -> Vec<String> {
        self.steps_with(dates)
    }

    fn date_digit_help(&self) -> Option<String> {
        self.date_digit_help.clone()
    }
}

/// The cards' known answers: the startup cases, or with `full` every case and a sheet of each
/// family.
#[wasm_bindgen(js_name = selfCheckCards)]
pub fn self_check_cards(full: bool) -> Result<(), JsValue> {
    let tier = if full { Tier::Full } else { Tier::Startup };
    thrown(
        ROWS.iter()
            .chain([&CARD_EXPORT])
            .try_for_each(|row| row.run(tier)),
    )
}

#[cfg(test)]
mod tests {
    use mnemocode::self_check::vectors::PUBLIC_MNEMONIC;

    use super::*;

    #[cfg(feature = "template-business-it")]
    #[test]
    fn separate_cards_keep_the_turn_of_their_export() {
        let phrase = mnemocode::bip39::phrase::Phrase::parse(PUBLIC_MNEMONIC).unwrap();
        let encoding = Backup::encode(&phrase, &[], Form::Colors, Mode::Direct, false).unwrap();
        let drawing = Rc::new(CardDrawing::new());
        let template = select_template(Some("business-it")).unwrap();
        let cards = backup_card_content(&encoding.backup, CardSettings::default(), None).unwrap();
        let job =
            planned_card_job(&drawing, &mut BrowserRandom, &CardJob { template, cards }).unwrap();
        let plan = CardPlan {
            drawing,
            job,
            orientation: Some(Orientation::Portrait),
        };
        let documents = plan.separate().ok().expect("separate cards");
        let page = &documents.documents[0].pages[0];
        assert!(page.width < page.height);
    }
}
