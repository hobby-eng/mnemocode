//! Every reader of typed text: nothing may panic, whatever the text.
#![no_main]

use libfuzzer_sys::fuzz_target;
use mnemocode::backup::Backup;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::dates::answer::DatesAnswer;
use mnemocode::forms::Form;
use mnemocode::forms::detection::detect;
use mnemocode::modes::Mode;
use mnemocode::recovery::marked::MissingCodes;
use mnemocode::sskr::forms::read_share;
use mnemocode::sskr::repair::read_repairable_share;
use mnemocode::wallet::evidence::parse_master_fingerprint;

const FORMS: [Form; 5] = [
    Form::English,
    Form::Indexes,
    Form::Unicode,
    Form::ColorsUnicode,
    Form::Colors,
];
const MODES: [Mode; 4] = [
    Mode::Direct,
    Mode::Seedshift,
    Mode::SeedshiftLegacy,
    Mode::SeedshiftLegacyValid,
];

fuzz_target!(|data: &[u8]| {
    let Ok(text) = std::str::from_utf8(data) else {
        return;
    };
    let _ = Phrase::parse(text);
    let _ = detect(text);
    for form in FORMS {
        let _ = form.read(text);
        for mode in MODES {
            let _ = Backup::read(text, form, mode);
            let _ = MissingCodes::read(text, form, mode);
        }
    }
    let _ = read_share(text);
    let _ = read_repairable_share(text);
    let _ = DatesAnswer::parse(text, Some(12), true);
    let _ = DatesAnswer::parse(text, None, false);
    let _ = parse_master_fingerprint(text);
});
