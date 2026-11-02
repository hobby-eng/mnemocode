//! The invented details of one export (MnemoCode TS 0.1.0's `export/card-copy.ts`,
//! `card-identities.ts`, `export-details.ts` and `card-session.ts`, CAP-CARDS-INVENTED-DETAILS): the
//! person on its cards and the texts of its design, each given or chosen at random, settled once so
//! that every page, output and share of the export prints them. They hold no secret: the choices
//! are independent of every seed phrase and share.

use mnemocode::random::{Random, RandomError};
use unicode_normalization::UnicodeNormalization;
use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

use crate::content::ContentError;
use crate::settings::{CardPresentation, CardProfile, CardSettings, ProfileField};
use crate::text_rules::{HIDE_MARKER, card_text};

/// The names of the invented print studios that a collection sheet names as its maker.
pub const STUDIO_NAMES: [&str; 37] = [
    "Alder & Vale",
    "Luma Ridge Studio",
    "Stillform Atelier",
    "Orven Studio",
    "Moss & Grain",
    "Quiet Arc Studio",
    "Vellin Works",
    "Sable Row",
    "Neral Studio",
    "Cinder & Loom",
    "Avenfold",
    "Morrow Form",
    "Rillstone Studio",
    "Pale Oak Works",
    "Veyra Form",
    "Linden Trace",
    "Oriel Grain",
    "Arven Line",
    "Softline Atelier",
    "Wren & Slate",
    "Greyfold Press",
    "Slate Row Studio",
    "Harbor & Pine",
    "Ashgrove Creative",
    "Elmstead Design",
    "Paperfold Studio",
    "Marlow Type & Print",
    "Wexford Design Co.",
    "Oakline Creative",
    "Kestrel Print Studio",
    "Halden & Roe",
    "Millbrook Design",
    "Crossfield Creative",
    "Cobblestone Print Works",
    "Ridgeway Studio",
    "Larch & Lane Design",
    "Fallow & Reed",
];

/// The slogans that a card design may print, one chosen at random unless given.
pub const CARD_SLOGANS: [&str; 29] = [
    "Print, done properly.",
    "Small studio. Careful work.",
    "Considered design for everyday business.",
    "Identity, set in ink.",
    "Good paper. Better first impressions.",
    "Designed to be handed over.",
    "Clarity, printed.",
    "Made to be kept.",
    "Quiet design, lasting impression.",
    "Detail is the whole point.",
    "Ink, paper, and a little patience.",
    "Craft you can hold.",
    "Print with a point of view.",
    "Simple, sharp, memorable.",
    "First impressions, considered.",
    "Designed in-house, printed with care.",
    "Less noise. More paper.",
    "Built on good typography.",
    "From sketch to press.",
    "Honest work on good stock.",
    "Colour, weight, finish. Nothing else.",
    "Small runs, real care.",
    "Precision from the first proof.",
    "We sweat the small print.",
    "Paper with personality.",
    "Details, deliberately.",
    "Every card tells a story.",
    "Thoughtful print for thoughtful people.",
    "Form that fits in a pocket.",
];

/// The footers of a collection sheet, one chosen at random unless given.
pub const CARD_FOOTERS: [&str; 6] = [
    "PROOF SHEET",
    "CLIENT REVIEW",
    "SAMPLE SET",
    "COLOUR OPTIONS",
    "PRINT PROOF",
    "SELECTION SHEET",
];

/// The subtitles of a collection sheet, one chosen at random unless given.
pub const CARD_SUBTITLES: [&str; 5] = [
    "Colour options for review.",
    "Proof set, first round.",
    "Finishes and colourways.",
    "Client selection sheet.",
    "Sample set for approval.",
];

/// The label before a card's code when none is given.
const REFERENCE_LABEL: &str = "Ref.";

/// The sector of the invented employer on business cards, which the design suits.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum CompanySector {
    /// Software and networks.
    It,
    /// Architecture and interiors.
    Architecture,
    /// Property and estate agents.
    Property,
    /// Business consulting.
    Consulting,
}

/// The sectors, in the order that a random choice takes them.
const COMPANY_SECTORS: [CompanySector; 4] = [
    CompanySector::It,
    CompanySector::Architecture,
    CompanySector::Property,
    CompanySector::Consulting,
];

impl CompanySector {
    /// The employers of the sector, separate from the print studios of collection sheets.
    #[must_use]
    pub const fn employers(self) -> &'static [&'static str; 5] {
        match self {
            Self::It => &[
                "Norvale Systems",
                "Elmbridge Digital",
                "Rillford Technologies",
                "Ashmere Software",
                "Fenwick Networks",
            ],
            Self::Architecture => &[
                "Alderwick Architecture",
                "Larchfield Interiors",
                "Merewood Design",
                "Pennfold Spaces",
                "Ashcombe Atelier",
            ],
            Self::Property => &[
                "Bellmere Property",
                "Oakstead Homes",
                "Wrenford Estates",
                "Alderbridge Realty",
                "Merrow Property",
            ],
            Self::Consulting => &[
                "Halden Advisory",
                "Norwick Consulting",
                "Fieldmere Partners",
                "Ashford Operations",
                "Elmward Business Services",
            ],
        }
    }

    /// The roles that only an employer of the sector gives.
    #[must_use]
    pub const fn roles(self) -> &'static [&'static str] {
        match self {
            Self::It => &[
                "Software Engineer",
                "Solutions Architect",
                "IT Consultant",
                "Technical Director",
                "DevOps Engineer",
                "Senior DevOps Engineer",
            ],
            Self::Architecture => &[
                "Architect",
                "Interior Designer",
                "Architectural Designer",
                "Design Director",
            ],
            Self::Property => &[
                "Property Consultant",
                "Real Estate Advisor",
                "Property Manager",
            ],
            Self::Consulting => &[
                "Strategy Consultant",
                "Management Consultant",
                "Operations Consultant",
            ],
        }
    }
}

/// The roles that an employer of any sector may give the person on the cards.
pub const COMMON_ROLES: [&str; 10] = [
    "Sales Manager",
    "Sales Consultant",
    "Account Manager",
    "Client Advisor",
    "Business Consultant",
    "Business Development Manager",
    "Business Analyst",
    "Senior Business Analyst",
    "Operations Manager",
    "Project Manager",
];

/// Whole names stay together; no random cross-cultural first and surname combinations.
pub const PERSON_NAMES: [&str; 60] = [
    "Alex Morgan",
    "James Carter",
    "Daniel Brooks",
    "Oliver Reed",
    "Henry Bennett",
    "Thomas Hayes",
    "William Foster",
    "Ethan Clarke",
    "Liam Parker",
    "Samuel Ellis",
    "Emma Collins",
    "Olivia Bennett",
    "Charlotte Reed",
    "Amelia Brooks",
    "Sophia Turner",
    "Grace Morgan",
    "Hannah Clarke",
    "Emily Hayes",
    "Alice Foster",
    "Lucy Parker",
    "Lukas Weber",
    "Anna Fischer",
    "Jonas Bauer",
    "Clara Hoffmann",
    "Julien Moreau",
    "Camille Laurent",
    "Nicolas Martin",
    "Lea Dubois",
    "Matteo Rossi",
    "Giulia Conti",
    "Luca Ferraro",
    "Sofia Ricci",
    "Javier Navarro",
    "Lucia Romero",
    "Ines Costa",
    "Tiago Almeida",
    "Pieter de Vries",
    "Eva van Dijk",
    "Lars Nyberg",
    "Ingrid Berg",
    "Mikkel Larsen",
    "Aino Koskinen",
    "Jakub Nowak",
    "Zofia Kowalska",
    "Tomas Novak",
    "Petra Svobodova",
    "Andrei Popescu",
    "Elena Ionescu",
    "Nikos Papadakis",
    "Eleni Nikolaou",
    "Emre Yilmaz",
    "Selin Kaya",
    "Hana Tanaka",
    "Kenji Mori",
    "Arjun Mehta",
    "Priya Shah",
    "Minjun Kim",
    "Leila Mansour",
    "Omar Haddad",
    "Amina Diallo",
];

/// Invented contacts end in .example, reserved for examples (RFC 2606), so that an invented address
/// can never be the mailbox or website of a real company.
const INVENTED_DOMAIN_ENDING: &str = ".example";
/// Longest company part of an invented address: with more letters the email no longer fits the
/// narrowest email line of the cards at a legible size.
const LONGEST_DOMAIN_LABEL: usize = 18;
/// The phone number of every invented identity: a London number that Ofcom keeps for drama and
/// fiction, so that it rings no one.
const INVENTED_PHONE: &str = "+44 20 7946 0281";
/// Where an invented identity works when none is given.
const DEFAULT_LOCATION: &str = "International";

/// One of `values`, chosen with `random`.
fn picked<'a>(values: &[&'a str], random: &mut dyn Random) -> Result<&'a str, RandomError> {
    Ok(values[random.below(values.len() as u32)? as usize])
}

/// The sector that the given company or role names, compared without case.
fn known_sector(profile: &CardProfile) -> Option<CompanySector> {
    let same = |known: &&str, given: &str| known.to_lowercase() == given;
    if let Some(company) = profile.get(ProfileField::Company).map(str::to_lowercase) {
        let sector = COMPANY_SECTORS
            .into_iter()
            .find(|sector| sector.employers().iter().any(|name| same(name, &company)));
        if sector.is_some() {
            return sector;
        }
    }
    let role = profile.get(ProfileField::Role)?.to_lowercase();
    if role == "senior devops" || role == "devops" {
        return Some(CompanySector::It);
    }
    COMPANY_SECTORS
        .into_iter()
        .find(|sector| sector.roles().iter().any(|name| same(name, &role)))
}

/// Letters and digits of one word, as they can appear in a domain name.
fn domain_letters(word: &str) -> String {
    word.nfkd()
        .filter(|character| character.general_category_group() != GeneralCategoryGroup::Mark)
        .collect::<String>()
        .to_lowercase()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect()
}

/// The invented domain of `company`: a long name keeps its first words only, the way companies
/// shorten their domains.
fn contact_domain(company: &str) -> String {
    let mut label = String::new();
    for word in mnemocode::text::space::tokens(company).map(domain_letters) {
        if !label.is_empty() && label.len() + word.len() > LONGEST_DOMAIN_LABEL {
            break;
        }
        label.push_str(&word);
    }
    label.truncate(LONGEST_DOMAIN_LABEL);
    if label.is_empty() {
        label.push_str("company");
    }
    format!("{label}{INVENTED_DOMAIN_ENDING}")
}

/// The person on the cards: `supplied`, with the rest chosen with `random`. Explicit values always
/// win. Refuses what [`CardProfile::validated`] refuses.
pub fn card_identity(
    random: &mut dyn Random,
    supplied: &CardProfile,
    sector_hint: Option<CompanySector>,
) -> Result<CardProfile, ContentError> {
    let profile = supplied.validated()?;
    let sector = match known_sector(&profile).or(sector_hint) {
        Some(sector) => sector,
        None => COMPANY_SECTORS[random.below(COMPANY_SECTORS.len() as u32)? as usize],
    };
    let company = match profile.get(ProfileField::Company) {
        Some(company) => company.to_owned(),
        None => picked(sector.employers(), random)?.to_owned(),
    };
    let domain = contact_domain(&company);
    let mut person = CardProfile::default();
    let name = match profile.get(ProfileField::Name) {
        Some(name) => name.to_owned(),
        None => picked(&PERSON_NAMES, random)?.to_owned(),
    };
    let role = match profile.get(ProfileField::Role) {
        Some(role) => role.to_owned(),
        None => {
            let roles: Vec<&str> = sector
                .roles()
                .iter()
                .chain(&COMMON_ROLES)
                .copied()
                .collect();
            picked(&roles, random)?.to_owned()
        }
    };
    let given = |field| profile.get(field).map(str::to_owned);
    person.set(ProfileField::Name, name);
    person.set(ProfileField::Company, company);
    person.set(ProfileField::Role, role);
    person.set(
        ProfileField::Email,
        given(ProfileField::Email).unwrap_or_else(|| format!("contact@{domain}")),
    );
    person.set(
        ProfileField::Website,
        given(ProfileField::Website).unwrap_or(domain),
    );
    person.set(
        ProfileField::Phone,
        given(ProfileField::Phone).unwrap_or_else(|| INVENTED_PHONE.to_owned()),
    );
    person.set(
        ProfileField::Location,
        given(ProfileField::Location).unwrap_or_else(|| DEFAULT_LOCATION.to_owned()),
    );
    Ok(person)
}

/// Texts given for a design, each in place of the one chosen at random; a "-" hides its line.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CardCopy {
    /// The name of the studio that the sheet says made the study.
    pub studio_name: Option<String>,
    /// The line under the studio.
    pub slogan: Option<String>,
    /// The line under the heading.
    pub subtitle: Option<String>,
    /// The closing line of the page.
    pub footer: Option<String>,
    /// The label before each code.
    pub reference_label: Option<String>,
}

/// A text given, checked, or the one `fallback` chooses.
fn copy_value(
    value: Option<&str>,
    label: &str,
    fallback: impl FnOnce() -> Result<String, RandomError>,
) -> Result<String, ContentError> {
    match value {
        None => Ok(fallback()?),
        Some(HIDE_MARKER) => Ok(String::new()),
        Some(value) => Ok(card_text(value, label, "; use - to hide it.")?),
    }
}

/// A presentation that a host gives whole: each text checked, "" where its line is hidden.
pub fn checked_presentation(given: &CardPresentation) -> Result<CardPresentation, ContentError> {
    let checked = |value: &str, label: &str| -> Result<String, ContentError> {
        if value.is_empty() {
            return Ok(String::new());
        }
        Ok(card_text(value, label, "; give \"\" to hide its line.")?)
    };
    Ok(CardPresentation {
        studio_name: checked(&given.studio_name, "studio name")?,
        slogan: checked(&given.slogan, "slogan")?,
        subtitle: checked(&given.subtitle, "subtitle")?,
        footer: checked(&given.footer, "footer")?,
        reference_label: checked(&given.reference_label, "reference label")?,
    })
}

/// The texts of a design: those of `copy`, checked, and the rest chosen with `random`, in this
/// order of its choices.
pub fn resolve_presentation(
    random: &mut dyn Random,
    copy: &CardCopy,
) -> Result<CardPresentation, ContentError> {
    let studio_name = copy_value(copy.studio_name.as_deref(), "studio name", || {
        Ok(picked(&STUDIO_NAMES, random)?.to_owned())
    })?;
    let slogan = copy_value(copy.slogan.as_deref(), "slogan", || {
        Ok(picked(&CARD_SLOGANS, random)?.to_owned())
    })?;
    let subtitle = copy_value(copy.subtitle.as_deref(), "subtitle", || {
        Ok(picked(&CARD_SUBTITLES, random)?.to_owned())
    })?;
    let footer = copy_value(copy.footer.as_deref(), "footer", || {
        Ok(picked(&CARD_FOOTERS, random)?.to_owned())
    })?;
    let reference_label = copy_value(copy.reference_label.as_deref(), "reference label", || {
        Ok(REFERENCE_LABEL.to_owned())
    })?;
    Ok(CardPresentation {
        studio_name,
        slogan,
        subtitle,
        footer,
        reference_label,
    })
}

/// The person and the texts that the cards of one export print.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportDetails {
    /// The complete identity shared by every page and output of the export.
    pub profile: CardProfile,
    /// The presentation texts shared by every page and output of the export.
    pub presentation: CardPresentation,
}

impl ExportDetails {
    /// The details that `settings` give, the rest chosen with `random`: the texts first, then the
    /// person, whose employer is of `sector`, that of the export's first design.
    pub fn of(
        random: &mut dyn Random,
        settings: &CardSettings,
        sector: Option<CompanySector>,
    ) -> Result<Self, ContentError> {
        let presentation = settled_presentation(random, settings)?;
        let profile = card_identity(random, &settings.profile, sector)?;
        Ok(Self {
            profile,
            presentation,
        })
    }

    /// As [`ExportDetails::of`], with the person chosen before the texts: the order in which the
    /// business designs choose them when they are drawn directly, not through an export.
    pub fn person_first(
        random: &mut dyn Random,
        settings: &CardSettings,
        sector: Option<CompanySector>,
    ) -> Result<Self, ContentError> {
        let profile = card_identity(random, &settings.profile, sector)?;
        let presentation = settled_presentation(random, settings)?;
        Ok(Self {
            profile,
            presentation,
        })
    }

    /// New details: the person's details `supplied` and the texts `copy`, each given in place of
    /// the one chosen at random; the texts first, then the person.
    pub fn drawn(
        random: &mut dyn Random,
        supplied: &CardProfile,
        copy: &CardCopy,
        sector: Option<CompanySector>,
    ) -> Result<Self, ContentError> {
        let presentation = resolve_presentation(random, copy)?;
        let profile = card_identity(random, supplied, sector)?;
        Ok(Self {
            profile,
            presentation,
        })
    }
}

/// The texts that `settings` give whole, or chosen with `random`.
fn settled_presentation(
    random: &mut dyn Random,
    settings: &CardSettings,
) -> Result<CardPresentation, ContentError> {
    match &settings.presentation {
        Some(given) => checked_presentation(given),
        None => resolve_presentation(random, &CardCopy::default()),
    }
}

/// The company and the role remembered for a sector.
#[derive(Clone, Debug)]
struct Employment {
    company: String,
    role: String,
}

/// Remembers the random choices of one working session, so that a host that exports the same phrase
/// several times shows the same details: one person, and one employer for each sector, so that each
/// design gets one that suits it. Nothing here depends on the mnemonic.
#[derive(Debug, Default)]
pub struct CardSession {
    name: Option<String>,
    presentation: Option<CardPresentation>,
    employments: Vec<(Option<CompanySector>, Employment)>,
}

impl CardSession {
    /// Details for one export with a design whose employer is of `sector`. Values given always
    /// replace the remembered ones.
    pub fn settings_for(
        &mut self,
        random: &mut dyn Random,
        sector: Option<CompanySector>,
        supplied: &CardProfile,
        copy: &CardCopy,
    ) -> Result<ExportDetails, ContentError> {
        let remembered = self.employments.iter().find(|(key, _)| *key == sector);
        let employment = match remembered {
            Some((_, employment)) => employment.clone(),
            None => {
                let chosen = card_identity(random, &CardProfile::default(), sector)?;
                let name = chosen
                    .get(ProfileField::Name)
                    .unwrap_or_default()
                    .to_owned();
                self.name.get_or_insert(name);
                let employment = Employment {
                    company: chosen
                        .get(ProfileField::Company)
                        .unwrap_or_default()
                        .to_owned(),
                    role: chosen
                        .get(ProfileField::Role)
                        .unwrap_or_default()
                        .to_owned(),
                };
                self.employments.push((sector, employment.clone()));
                employment
            }
        };
        let remembered = match self.presentation.clone() {
            Some(presentation) => presentation,
            None => {
                let chosen = resolve_presentation(random, &CardCopy::default())?;
                self.presentation = Some(chosen.clone());
                chosen
            }
        };
        let own = supplied.validated()?;
        // Email and website follow the company that is finally printed.
        let mut person = CardProfile::default();
        person.set(ProfileField::Name, self.name.clone().unwrap_or_default());
        person.set(ProfileField::Company, employment.company);
        person.set(ProfileField::Role, employment.role);
        let hidden_or = |value: &str, given: &Option<String>| {
            given.clone().unwrap_or_else(|| {
                if value.is_empty() {
                    HIDE_MARKER.to_owned()
                } else {
                    value.to_owned()
                }
            })
        };
        let texts = CardCopy {
            studio_name: Some(hidden_or(&remembered.studio_name, &copy.studio_name)),
            slogan: Some(hidden_or(&remembered.slogan, &copy.slogan)),
            subtitle: Some(hidden_or(&remembered.subtitle, &copy.subtitle)),
            footer: Some(hidden_or(&remembered.footer, &copy.footer)),
            reference_label: Some(hidden_or(
                &remembered.reference_label,
                &copy.reference_label,
            )),
        };
        ExportDetails::drawn(random, &person.overlaid(&own), &texts, sector)
    }
}
