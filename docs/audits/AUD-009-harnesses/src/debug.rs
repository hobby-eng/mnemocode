//! Newly introduced hint owners must obey the existing redacted Debug contract.
use crate::fixture::PublicFixed;
use mnemocode::{
    bip39::phrase::Phrase,
    dates::parse_date,
    modes::Mode,
    recovery::shares::{SearchLimits, flow::ShareRestoreRequest},
    sskr::{split::split_backup, typed::ShareInput},
};

#[test]
fn split_result_redacts_the_recovery_word() {
    let phrase = Phrase::of_entropy(&[0; 16]).unwrap();
    let split = split_backup(
        &phrase,
        Mode::SeedshiftLegacy,
        &[parse_date("23-09-2026").unwrap()],
        2,
        3,
        &mut PublicFixed(0x42),
    )
    .unwrap();
    assert!(split.original_last_word.is_some());
    for text in [format!("{split:?}"), format!("{split:#?}")] {
        assert!(
            !text.contains("original_last_word: Some"),
            "Debug exposes the recovery hint"
        );
    }
}

#[test]
fn restore_request_redacts_the_recovery_word() {
    let request = ShareRestoreRequest {
        input: ShareInput::new("audit"),
        mode: Mode::SeedshiftLegacy,
        dates: None,
        wallet: None,
        keep: None,
        limits: SearchLimits::default(),
        confirmed: false,
        last_word: Some(26),
    };
    for text in [format!("{request:?}"), format!("{request:#?}")] {
        assert!(
            !text.contains("last_word: Some"),
            "Debug exposes the recovery hint"
        );
    }
}
