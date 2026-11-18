//! Checks the recovery hint through share reconstruction and embroidery entropy.
use crate::fixture::PublicFixed;
use mnemocode::{
    backup::Backup,
    bip39::phrase::Phrase,
    dates::{Date, parse_date},
    forms::Form,
    modes::Mode,
    sskr::{restore::restore_complete, share::Share, split::split_backup},
};
use mnemocode_embroidery::phrase::{legacy_entropy, share_entropies};

fn verify(held: &Phrase, hint: u16, dates: &[Date], expected: &Phrase) {
    let codes: Vec<u16> = (0..held.len())
        .map(|i| held.index(i).unwrap() as u16)
        .collect();
    let backup = Backup::of(&codes, Form::Indexes, Mode::SeedshiftLegacyValid).unwrap();
    let result = backup.decode_with_last_word(dates, hint).unwrap();
    assert!(result.checksum_valid);
    let expected: Vec<u16> = (0..expected.len())
        .map(|i| expected.index(i).unwrap() as u16)
        .collect();
    assert_eq!(result.recovered.as_slice(), expected);
}

#[test]
fn all_phrase_lengths_retain_the_hint_through_share_and_embroidery_producers() {
    let dates = [parse_date("23-09-2026").unwrap()];
    for length in [16, 20, 24, 28, 32] {
        let entropy: Vec<u8> = (0..length).map(|n| n as u8).collect();
        let phrase = Phrase::of_entropy(&entropy).unwrap();
        let split = split_backup(
            &phrase,
            Mode::SeedshiftLegacy,
            &dates,
            2,
            3,
            &mut PublicFixed(0x42),
        )
        .unwrap();
        let restored = restore_complete(&[&split.shares[0], &split.shares[2]], None).unwrap();
        verify(
            &restored.phrase,
            split.original_last_word.unwrap(),
            &dates,
            &phrase,
        );

        let legend = legacy_entropy(&phrase, &dates).unwrap();
        let held = Phrase::of_entropy(legend.bytes()).unwrap();
        verify(&held, legend.last_words().unwrap().0, &dates, &phrase);

        let legends = share_entropies(
            &phrase,
            (Mode::SeedshiftLegacy, &dates),
            (2, 3),
            &mut PublicFixed(0x11),
        )
        .unwrap();
        let a = Share::of_payload(legends[0].bytes()).unwrap();
        let b = Share::of_payload(legends[2].bytes()).unwrap();
        let restored = restore_complete(&[&a, &b], None).unwrap();
        let hint = legends[0].last_words().unwrap().0;
        assert!(
            legends
                .iter()
                .all(|legend| legend.last_words().unwrap().0 == hint)
        );
        verify(&restored.phrase, hint, &dates, &phrase);
    }
}
