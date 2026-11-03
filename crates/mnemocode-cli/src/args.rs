//! The command line's options (MnemoCode TS 0.1.0's `arguments.ts` and `option-copy.ts`): every
//! option is "--name value", once or more, or "--name" alone for an on-or-off one, and "--dates"
//! takes every value up to the next option. A flag that would carry secret material, such as
//! `--mnemonic`, is refused before anything is parsed, and its value is never read
//! (CAP-CLI-SECRET-ARGV-REFUSAL). Which options a command takes is checked by the command's table.

use std::collections::BTreeMap;
use std::fmt;

use mnemocode::refusal::Refusal;
use mnemocode::text::numbers::{WholeRange, whole_number_of};
use mnemocode::text::words::list_in_words;

/// The value of an option: on, one text, or several.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Given {
    /// An on-or-off option given.
    On,
    /// One value.
    One(String),
    /// Several values, in order.
    Many(Vec<String>),
}

/// The options of one command line, by their names without "--".
pub(crate) type Parsed = BTreeMap<String, Given>;

/// The refusals of the options, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ArgsError {
    /// A value without an option.
    UnnamedValue,
    /// A list option without values.
    AtLeastOneValue(String),
    /// An option without its value.
    RequiresValue(String),
    /// An option beside --ask-secrets that it would ask for.
    AskSecretsCombined(String),
    /// A choice outside its list.
    Refused(String, String),
    /// A required option missing.
    Required(String),
    /// A number outside its range.
    Integer(String, String),
    /// An option given twice.
    OnlyOneValue(String),
    /// A text option without one value.
    ExactlyOneValue(String),
    /// An option the command does not take.
    Unsupported(String, String),
    /// A value given to an on-or-off option.
    FlagWithValue(String),
    /// A secret on the command line.
    PrivateMaterial(String, String),
    /// Standard input named by two options.
    MultipleStandardInputs,
}

impl fmt::Display for ArgsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnnamedValue => f.write_str(
                "This command does not accept an unnamed value. Use the appropriate named option.",
            ),
            Self::AtLeastOneValue(subject) => write!(f, "{subject} needs at least one value."),
            Self::RequiresValue(subject) => write!(f, "{subject} requires a value."),
            Self::AskSecretsCombined(flags) => write!(f, "--ask-secrets cannot be combined with {flags}."),
            Self::Refused(key, choices) => write!(f, "--{key} must be {choices}."),
            Self::Required(named) => write!(f, "{named} is required."),
            Self::Integer(named, range) => write!(f, "{named} must be a base-10 integer from {range}."),
            Self::OnlyOneValue(label) => write!(f, "Provide only one value for the {label} setting."),
            Self::ExactlyOneValue(label) => write!(f, "Provide exactly one value for the {label} setting."),
            Self::Unsupported(command, label) => {
                write!(f, "The {command} command does not support the {label} setting.")
            }
            Self::FlagWithValue(subject) => write!(
                f,
                "{subject} is an on-or-off choice and does not accept a separate value."
            ),
            Self::PrivateMaterial(flag, advice) => write!(
                f,
                "Secret material for {flag} must not be passed as a command-line value. Use {advice}."
            ),
            Self::MultipleStandardInputs => f.write_str(
                "Standard input can supply only one material source per command; use local files for the other sources.",
            ),
        }
    }
}

impl std::error::Error for ArgsError {}

impl Refusal for ArgsError {
    fn code(&self) -> &'static str {
        match self {
            Self::UnnamedValue => {
                "cli.arguments.command-does-not-accept-unnamed-value-use-appropriate"
            }
            Self::AtLeastOneValue(_) => "cli.arguments.at-least-one-value",
            Self::RequiresValue(_) => "cli.arguments.requires-value",
            Self::AskSecretsCombined(_) => "cli.arguments.ask-secrets-cannot-combined",
            Self::Refused(..) => "cli.arguments.refused",
            Self::Required(_) => "cli.arguments.required",
            Self::Integer(..) => "cli.arguments.base-10-integer-from",
            Self::OnlyOneValue(_) => "cli.arguments.provide-only-one-value-setting",
            Self::ExactlyOneValue(_) => "cli.arguments.provide-exactly-one-value-setting",
            Self::Unsupported(..) => "cli.arguments.command-does-not-support-setting",
            Self::FlagWithValue(_) => "cli.arguments.on-off-choice-does-not-accept-separate-value",
            Self::PrivateMaterial(..) => "cli.arguments.private-material-argv",
            Self::MultipleStandardInputs => "cli.arguments.multiple-standard-input-sources",
        }
    }
}

/// Where a date goes instead of the command line.
const DATE_SOURCE_ADVICE: &str = "--dates-file PATH or --ask-secrets";
const OLD_DATE_SOURCE_ADVICE: &str = "--old-dates-file PATH or --ask-secrets";

/// The flags that would carry secret material, each with where the secret goes instead.
const PRIVATE_MATERIAL_FLAGS: [(&str, &str); 8] = [
    ("--mnemonic", "--mnemonic-file PATH or --ask-secrets"),
    (
        "--input",
        "--input-file PATH, --qr-file PATH or --ask-secrets",
    ),
    (
        "--share",
        "--share-file PATH, --share-qr PATH or --ask-secrets",
    ),
    ("--date", DATE_SOURCE_ADVICE),
    ("--dates", DATE_SOURCE_ADVICE),
    ("--old-date", OLD_DATE_SOURCE_ADVICE),
    ("--old-dates", OLD_DATE_SOURCE_ADVICE),
    ("--last-word", "--last-word-file PATH or --ask-secrets"),
];

/// Refuses a flag that would carry secret material, without looking at its value.
pub(crate) fn assert_safe_material_argv(argv: &[String]) -> Result<(), ArgsError> {
    for item in argv {
        if let Some((flag, advice)) = PRIVATE_MATERIAL_FLAGS.iter().find(|(flag, _)| item == flag) {
            return Err(ArgsError::PrivateMaterial(
                (*flag).to_owned(),
                (*advice).to_owned(),
            ));
        }
    }
    Ok(())
}

/// The on-or-off options, for every command.
const BOOLEAN_OPTIONS: [&str; 13] = [
    "card-qr",
    "sskr",
    "show-masked-words",
    "all",
    "recovery-guide",
    "ask-secrets",
    "cards",
    "legacy-valid-last-word",
    "list",
    "missing-word",
    "list-candidates",
    "plaintext-candidates",
    "recognised",
];

/// The options that take a list of values: the flag typed, and the key they are kept under.
const LIST_OPTIONS: [(&str, &str); 2] = [("dates", "date"), ("old-dates", OLD_DATES_KEY)];

/// The key of the dates of the old backup, which Re-encode reads beside the new backup's.
pub(crate) const OLD_DATES_KEY: &str = "old-date";

/// The options of a command, `items` being what follows its name; refuses an unnamed value, a
/// missing value, and a value given to an on-or-off option.
pub(crate) fn parse_arguments(items: &[String]) -> Result<Parsed, ArgsError> {
    let mut parsed = Parsed::new();
    let mut index = 0;
    while let Some(item) = items.get(index) {
        let Some(key) = item.strip_prefix("--") else {
            return Err(ArgsError::UnnamedValue);
        };
        if let Some((_, list_key)) = LIST_OPTIONS.iter().find(|(flag, _)| *flag == key) {
            let mut values = Vec::new();
            while let Some(next) = items.get(index + 1).filter(|next| !next.starts_with("--")) {
                values.push(next.clone());
                index += 1;
            }
            if values.is_empty() {
                return Err(ArgsError::AtLeastOneValue(option_subject(key)));
            }
            let entry = parsed.remove(*list_key);
            let mut joined = match entry {
                None | Some(Given::On) => Vec::new(),
                Some(Given::One(value)) => vec![value],
                Some(Given::Many(values)) => values,
            };
            joined.append(&mut values);
            parsed.insert((*list_key).to_owned(), Given::Many(joined));
            index += 1;
            continue;
        }
        match items.get(index + 1).filter(|next| !next.starts_with("--")) {
            None => {
                if !BOOLEAN_OPTIONS.contains(&key) {
                    return Err(ArgsError::RequiresValue(option_subject(key)));
                }
                parsed.insert(key.to_owned(), Given::On);
                index += 1;
            }
            Some(next) => {
                let given = match parsed.remove(key) {
                    None => Given::One(next.clone()),
                    Some(Given::One(first)) => Given::Many(vec![first, next.clone()]),
                    Some(Given::Many(mut values)) => {
                        values.push(next.clone());
                        Given::Many(values)
                    }
                    Some(Given::On) => Given::Many(vec![next.clone()]),
                };
                parsed.insert(key.to_owned(), given);
                index += 2;
            }
        }
    }
    // An on-or-off option takes no value, for every command.
    for key in BOOLEAN_OPTIONS {
        assert_flag(&parsed, key)?;
    }
    Ok(parsed)
}

/// The flag of the option kept under `key`, as it is typed: "--dates" for "date".
pub(crate) fn flag_of(key: &str) -> String {
    let flag = LIST_OPTIONS
        .iter()
        .find(|(_, list_key)| *list_key == key)
        .map_or(key, |(flag, _)| flag);
    format!("--{flag}")
}

/// Refuses any of `options` given beside --ask-secrets, which asks for them instead.
pub(crate) fn assert_asked_not_given(parsed: &Parsed, options: &[&str]) -> Result<(), ArgsError> {
    if !is_on(parsed, "ask-secrets") {
        return Ok(());
    }
    let given: Vec<String> = options
        .iter()
        .filter(|key| parsed.contains_key(**key))
        .map(|key| flag_of(key))
        .collect();
    if given.is_empty() {
        return Ok(());
    }
    Err(ArgsError::AskSecretsCombined(list_in_words(&given, "or")))
}

/// Whether the on-or-off option `key` is given.
pub(crate) fn is_on(parsed: &Parsed, key: &str) -> bool {
    parsed.get(key) == Some(&Given::On)
}

/// The one value of `key`, if it has one.
pub(crate) fn value<'a>(parsed: &'a Parsed, key: &str) -> Option<&'a str> {
    match parsed.get(key) {
        Some(Given::One(value)) => Some(value),
        _ => None,
    }
}

/// Every value of `key`, in order.
pub(crate) fn values<'a>(parsed: &'a Parsed, key: &str) -> Vec<&'a str> {
    match parsed.get(key) {
        Some(Given::One(value)) => vec![value.as_str()],
        Some(Given::Many(values)) => values.iter().map(String::as_str).collect(),
        _ => Vec::new(),
    }
}

/// The option `key`, which must be one of `choices`; `None` when it is not given.
pub(crate) fn choice_option<'a>(
    parsed: &Parsed,
    key: &str,
    choices: &[&'a str],
) -> Result<Option<&'a str>, ArgsError> {
    let Some(given) = value(parsed, key) else {
        return Ok(None);
    };
    choices
        .iter()
        .find(|choice| **choice == given)
        .copied()
        .map(Some)
        .ok_or_else(|| ArgsError::Refused(key.to_owned(), list_in_words(choices, "or")))
}

/// A whole number option: canonical base-10 (no sign, exponent, point or leading zero) within
/// `range`; `default` when it is not given, else refused as required. `label` names the value
/// where the option means another thing for this command.
pub(crate) fn integer_option(
    parsed: &Parsed,
    key: &str,
    range: WholeRange,
    default: Option<u64>,
    label: Option<&str>,
) -> Result<u64, ArgsError> {
    let named = label.map_or_else(|| option_value(key), |label| format!("The {label} value"));
    let Some(raw) = value(parsed, key) else {
        return default.ok_or(ArgsError::Required(named));
    };
    let canonical = raw == "0"
        || (raw.bytes().all(|byte| byte.is_ascii_digit())
            && !raw.starts_with('0')
            && !raw.is_empty());
    let parsed_value = if canonical {
        whole_number_of(raw, range)
    } else {
        None
    };
    parsed_value.ok_or_else(|| ArgsError::Integer(named, range.through()))
}

/// Refuses an option given more than once, unless it is one of `repeatable`.
pub(crate) fn assert_single_values(parsed: &Parsed, repeatable: &[&str]) -> Result<(), ArgsError> {
    for (key, given) in parsed {
        if matches!(given, Given::Many(_)) && !repeatable.contains(&key.as_str()) {
            return Err(ArgsError::OnlyOneValue(option_label(key).to_owned()));
        }
    }
    Ok(())
}

/// Refuses each of `names` given without a value or more than once.
pub(crate) fn assert_text_values(parsed: &Parsed, names: &[&str]) -> Result<(), ArgsError> {
    for name in names {
        if parsed
            .get(*name)
            .is_some_and(|given| !matches!(given, Given::One(_)))
        {
            return Err(ArgsError::ExactlyOneValue(option_label(name).to_owned()));
        }
    }
    Ok(())
}

/// The options that may be given more than once.
pub(crate) const REPEATABLE_OPTIONS: [&str; 5] =
    ["date", OLD_DATES_KEY, "share", "share-file", "share-qr"];

/// Refuses an option the command does not take, after options given twice.
pub(crate) fn assert_allowed(
    parsed: &Parsed,
    command: &str,
    allowed: &[&str],
) -> Result<(), ArgsError> {
    assert_single_values(parsed, &REPEATABLE_OPTIONS)?;
    if let Some(unknown) = parsed.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(ArgsError::Unsupported(
            command.to_owned(),
            option_label(unknown).to_owned(),
        ));
    }
    Ok(())
}

/// Refuses a value given to the on-or-off option `key`.
pub(crate) fn assert_flag(parsed: &Parsed, key: &str) -> Result<(), ArgsError> {
    match parsed.get(key) {
        Some(given) if *given != Given::On => Err(ArgsError::FlagWithValue(option_subject(key))),
        _ => Ok(()),
    }
}

/// Text-file inputs that also accept "-" for the command's one standard-input source.
pub(crate) const STDIN_INPUT_OPTIONS: [&str; 6] = [
    "mnemonic-file",
    "input-file",
    "share-file",
    "dates-file",
    "old-dates-file",
    "last-word-file",
];

/// Refuses dates asked and given as a file at once, and standard input named by two options.
pub(crate) fn assert_private_file_sources(parsed: &Parsed) -> Result<(), ArgsError> {
    assert_asked_not_given(parsed, &["dates-file", "old-dates-file", "last-word-file"])?;
    let sources = STDIN_INPUT_OPTIONS
        .iter()
        .filter(|key| values(parsed, key).contains(&"-"))
        .count();
    if sources > 1 {
        return Err(ArgsError::MultipleStandardInputs);
    }
    Ok(())
}

/// The options that name a file to save, and those that name a new folder to save into.
pub(crate) const FILE_OUTPUTS: [&str; 5] = ["output", "pdf", "qr", "heir-sheet", "candidates-file"];
pub(crate) const FOLDER_OUTPUTS: [&str; 4] =
    ["cards-dir", "images-dir", "word-lists-dir", "qr-dir"];

/// The label of an option in a sentence; "unknown option" for any other name.
pub(crate) fn option_label(key: &str) -> &'static str {
    OPTION_LABELS
        .iter()
        .find(|(name, _)| *name == key)
        .map_or("unknown option", |(_, label)| label)
}

/// "The <label> setting".
pub(crate) fn option_subject(key: &str) -> String {
    format!("The {} setting", option_label(key))
}

/// "The <label> value".
pub(crate) fn option_value(key: &str) -> String {
    format!("The {} value", option_label(key))
}

/// How each option is named in a sentence (TS 0.1.0's OPTION_LABELS).
const OPTION_LABELS: [(&str, &str); 98] = [
    ("card-name", "card name"),
    ("card-role", "card role"),
    ("card-company", "card company"),
    ("card-email", "card email"),
    ("card-phone", "card phone"),
    ("card-website", "card website"),
    ("card-location", "card location"),
    ("studio-name", "studio name"),
    ("card-slogan", "card slogan"),
    ("card-subtitle", "card subtitle"),
    ("card-footer", "card footer"),
    ("card-reference-label", "card reference label"),
    ("all", "all templates selection"),
    ("account", "account"),
    ("branch", "branch"),
    ("address", "address"),
    ("master-xpub", "master extended public key"),
    ("account-xpub", "account extended public key"),
    ("ask-secrets", "secret prompt mode"),
    ("backup-check", "written-backup check"),
    ("bip39-passphrase-file", "BIP39 passphrase file"),
    ("bitcoin-address", "Bitcoin address"),
    ("bitcoin-profile", "Bitcoin address profile"),
    ("coin", "coin"),
    ("coin-address", "coin address"),
    ("card-layout", "card layout"),
    ("card-qr", "card QR code"),
    ("candidates-file", "candidates file"),
    ("candidates-key", "Scanner key"),
    ("candidates-key-file", "Scanner key file"),
    ("candidates-passphrase-file", "candidates passphrase file"),
    ("missing-word", "missing word search"),
    ("plaintext-candidates", "unencrypted candidates"),
    ("cards", "terminal color card display"),
    ("cards-dir", "folder for individual card files"),
    ("compressed-public-key", "compressed public key"),
    ("encoded-fingerprint", "encoded fingerprint"),
    ("date", "date list"),
    ("dates", "date list"),
    ("dates-file", "dates file"),
    ("format", "representation format"),
    ("heir-sheet", "instructions for heirs file"),
    ("heir-sheet-size", "size of the instructions for heirs"),
    ("image-format", "image format"),
    ("images-dir", "image output folder"),
    ("index", "word index"),
    ("table-format", "word list format"),
    ("recovery-guide", "manual recovery instructions"),
    ("word-lists-dir", "word list export folder"),
    ("input", "encoded text"),
    ("input-kind", "kind of the typed text"),
    ("input-file", "encoded input file"),
    ("last-word", "last word of the original seed phrase"),
    ("last-word-file", "original final-word file"),
    ("legacy-valid-last-word", "legacy checksum word replacement"),
    ("list", "template listing"),
    ("list-candidates", "listing of every candidate"),
    ("master-fingerprint", "master fingerprint"),
    ("max-results", "result limit"),
    ("max-candidates", "candidate search limit"),
    ("max-tries", "share repair search limit"),
    ("mnemonic", "mnemonic text"),
    ("mnemonic-file", "mnemonic file"),
    ("mode", "transformation mode"),
    ("network", "Bitcoin network"),
    ("old-date", "date list of the old backup"),
    ("old-dates", "date list of the old backup"),
    ("old-dates-file", "dates file of the old backup"),
    ("old-format", "representation format of the old backup"),
    ("old-mode", "transformation mode of the old backup"),
    ("orientation", "page orientation"),
    ("output", "output record file"),
    ("stitches-across", "stitches across"),
    ("page-size", "page size"),
    ("pdf", "PDF output file"),
    ("picture", "picture file"),
    ("progress-every", "progress interval"),
    ("qr", "QR output file"),
    ("qr-dir", "share QR output folder"),
    (
        "recognised",
        "confirmation that the seed phrase is recognised",
    ),
    ("qr-file", "QR input file"),
    ("scan-gap", "--scan-gap address count"),
    ("share", "share text"),
    ("share-file", "share file"),
    ("share-format", "share format"),
    ("show-original", "original seed phrase display"),
    ("show-masked-words", "Seedshift words display"),
    ("share-qr", "share QR file"),
    ("shares", "share count"),
    ("sskr", "SSKR mode"),
    ("template", "card template"),
    ("threshold", "share threshold"),
    ("title", "card title"),
    ("unicode", "Unicode value"),
    ("wif", "WIF"),
    ("wif-file", "WIF file"),
    ("word", "BIP39 word"),
    ("words", "mnemonic word count"),
];

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    #[test]
    fn options_are_read_as_ts_reads_them() {
        let parsed = parse_arguments(&strings(&[
            "--format",
            "3",
            "--dates",
            "2020-01-01",
            "2021",
            "--ask-secrets",
        ]));
        let parsed = parsed.unwrap_or_default();
        assert_eq!(value(&parsed, "format"), Some("3"));
        assert_eq!(values(&parsed, "date"), vec!["2020-01-01", "2021"]);
        assert!(is_on(&parsed, "ask-secrets"));
    }

    #[test]
    fn a_missing_value_and_an_unnamed_one_are_refused() {
        assert_eq!(
            parse_arguments(&strings(&["--format"])).map(|_| ()),
            Err(ArgsError::RequiresValue(
                "The representation format setting".to_owned()
            ))
        );
        assert_eq!(
            parse_arguments(&strings(&["x"])).map(|_| ()),
            Err(ArgsError::UnnamedValue)
        );
        assert_eq!(
            parse_arguments(&strings(&["--sskr", "yes"])).map(|_| ()).map_err(|error| error.to_string()),
            Err("The SSKR mode setting is an on-or-off choice and does not accept a separate value.".to_owned())
        );
    }

    #[test]
    fn secret_flags_are_refused_before_parsing() {
        let refused = assert_safe_material_argv(&strings(&["encode", "--mnemonic", "abandon"]));
        assert_eq!(
            refused.map_err(|error| error.to_string()),
            Err("Secret material for --mnemonic must not be passed as a command-line value. Use --mnemonic-file PATH or --ask-secrets.".to_owned())
        );
    }

    #[test]
    fn whole_numbers_are_canonical() {
        let range = WholeRange::new(1, 16);
        let parsed = parse_arguments(&strings(&["--shares", "07"])).unwrap_or_default();
        assert!(integer_option(&parsed, "shares", range, None, None).is_err());
        let parsed = parse_arguments(&strings(&["--shares", "7"])).unwrap_or_default();
        assert_eq!(integer_option(&parsed, "shares", range, None, None), Ok(7));
    }
}
