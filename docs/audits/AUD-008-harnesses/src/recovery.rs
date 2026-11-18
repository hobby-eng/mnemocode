//! Regression assertions for public recovery APIs; every input is synthetic.
use mnemocode::recovery::reading::{BackupReading, ReadingRules};
use mnemocode::{
    backup::Backup, bip39::phrase::Phrase, dates::parse_date, forms::Form, modes::Mode,
};

#[test]
fn encoding_the_returned_mode_keeps_the_recovery_word() {
    let phrase = Phrase::of_entropy(&[0; 16]).unwrap();
    let dates = [parse_date("23-09-2026").unwrap()];
    let first = Backup::encode(&phrase, &dates, Form::Indexes, Mode::SeedshiftLegacy).unwrap();
    let second = Backup::encode(&phrase, &dates, Form::Indexes, first.backup.mode()).unwrap();
    assert_eq!(first.backup.indexes(), second.backup.indexes());
    assert_eq!(first.original_last_word, second.original_last_word);
}

#[test]
fn a_serialized_backup_agrees_with_its_own_mode() {
    let phrase = Phrase::of_entropy(&[0; 16]).unwrap();
    let dates = [parse_date("23-09-2026").unwrap()];
    let encoded = Backup::encode(&phrase, &dates, Form::Indexes, Mode::SeedshiftLegacy).unwrap();
    let record = encoded.backup.record().unwrap();
    let reading = BackupReading::of(
        record.as_str(),
        ReadingRules {
            seedshift_only: false,
            share_reader: "audit",
            words: None,
        },
    )
    .unwrap();
    assert_eq!(reading.mode_conflict(Some(encoded.backup.mode())), None);
}

#[test]
fn shorter_legacy_backup_survives_decoy_suffix() {
    let phrase = Phrase::of_entropy(&[0; 16]).unwrap();
    let dates = [parse_date("23-09-2026").unwrap()];
    let encoded = Backup::encode(&phrase, &dates, Form::Indexes, Mode::SeedshiftLegacy).unwrap();
    let mut indexes = encoded.backup.indexes().to_vec();
    indexes.extend([0, 0, 0]);
    let padded = Backup::of(&indexes, Form::Indexes, Mode::SeedshiftLegacy).unwrap();
    let restored = padded.shorter_phrases(&dates).unwrap();
    assert!(
        restored
            .iter()
            .any(|(words, value)| *words == 12 && value.checksum_valid)
    );
}

#[test]
fn admitted_png_does_not_print_all_bytes_in_debug() {
    let png = mnemocode::qr::png("public synthetic AUD-008 record").unwrap();
    let admitted = mnemocode::qr::admission::admit(&png).unwrap();
    let raw = format!("{:?}", &png[..]);
    assert!(
        !format!("{admitted:?}").contains(&raw),
        "Debug includes the entire PNG"
    );
}

#[test]
fn enumerate_wrong_dates_without_a_probability_claim() {
    let phrase = Phrase::of_entropy(&[0; 16]).unwrap();
    let encoded = Backup::encode(
        &phrase,
        &[parse_date("23-09-2026").unwrap()],
        Form::Indexes,
        Mode::SeedshiftLegacy,
    )
    .unwrap();
    let mut accepts = 0;
    let mut candidates = 0;
    for month in 1..=12 {
        for day in 1..=28 {
            let date = parse_date(&format!("{day:02}-{month:02}-2025")).unwrap();
            let found = encoded.backup.candidates(&[date]).unwrap();
            let valid = found.iter().filter(|value| value.checksum_valid).count();
            accepts += usize::from(valid > 0);
            candidates += valid;
        }
    }
    println!(
        "Synthetic legacy-valid fixture: {accepts}/336 wrong dates yield a checksum-valid candidate; {candidates} candidates total."
    );
    assert!(
        accepts > 21,
        "The fixture must distinguish the old 1/16 claim"
    );
}
