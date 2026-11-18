//! Bounded, public-input probes of the API reviewed by AUD-008.
//! No production code, original vector, or existing test is changed by these probes.

#[cfg(test)]
mod collector;
#[cfg(test)]
mod recovery;
#[cfg(test)]
mod share_candidates;

#[cfg(test)]
mod tests {
    use mnemocode::backup::Backup;
    use mnemocode::bip39::phrase::Phrase;
    use mnemocode::dates::parse_date;
    use mnemocode::forms::Form;
    use mnemocode::modes::Mode;
    use mnemocode_cards::printed::{self, Kept, PrintedError};

    #[test]
    fn current_encodings_round_trip_across_lengths_forms_and_modes() {
        let dates = [parse_date("23-09-2026").unwrap()];
        let mut cases = 0;
        for length in [16, 20, 24, 28, 32] {
            let bytes: Vec<u8> = (0..length).map(|index| index as u8).collect();
            let phrase = Phrase::of_entropy(&bytes).unwrap();
            let expected: Vec<u16> = (0..phrase.len())
                .map(|index| phrase.index(index).unwrap() as u16)
                .collect();
            for form in [
                Form::English,
                Form::Indexes,
                Form::Unicode,
                Form::ColorsUnicode,
                Form::Colors,
            ] {
                for mode in [Mode::Direct, Mode::Seedshift, Mode::SeedshiftLegacy] {
                    if mode == Mode::Direct && matches!(form, Form::English | Form::Indexes) {
                        continue;
                    }
                    let dates = if mode == Mode::Direct {
                        &[][..]
                    } else {
                        &dates[..]
                    };
                    let encoded = Backup::encode(&phrase, dates, form, mode).unwrap();
                    let text = encoded.backup.text().unwrap();
                    let read = Backup::read(text.as_str(), form, mode).unwrap();
                    let decoded = if let Some(word) = encoded.original_last_word {
                        read.decode_with_last_word(dates, word).unwrap()
                    } else {
                        read.decode(dates).unwrap()
                    };
                    assert_eq!(
                        decoded.recovered.as_slice(),
                        expected,
                        "{length} {form:?} {mode:?}"
                    );
                    assert!(decoded.checksum_valid);
                    cases += 1;
                }
            }
        }
        assert_eq!(cases, 65);
    }

    fn card(number: usize, code: &str) -> Vec<printed::Page> {
        let kept = Kept {
            document: "xmp.did:public-synthetic-set".to_owned(),
            share: None,
            swatches: vec![(format!("{number:02} {code}"), "#123456".to_owned())],
        };
        printed::pages_in(printed::xmp(&kept).as_bytes())
    }

    #[test]
    fn printed_metadata_merges_reorders_and_rejects_conflicts() {
        let inputs = [card(2, "4E00"), card(1, "5BF6"), card(2, "4E00")];
        let found = printed::found_in(&inputs);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].parts.len(), 1);
        assert_eq!(found[0].parts[0].as_ref().unwrap().as_str(), "5BF6 4E00");
        let conflict = printed::found_in(&[card(1, "5BF6"), card(1, "4E00")]);
        assert!(matches!(
            conflict[0].parts[0],
            Err(PrintedError::Different(1))
        ));
        let gap = printed::found_in(&[card(2, "4E00")]);
        assert!(matches!(gap[0].parts[0], Err(PrintedError::Missing(1))));
    }
}
