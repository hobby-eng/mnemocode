//! A wrong candidate's recovery hint must not hide a later valid candidate.
use mnemocode::{
    backup::Backup,
    bip39::phrase::Phrase,
    dates::{answer::DatesAnswer, parse_date},
    forms::Form,
    modes::Mode,
    random::{Random, RandomError},
    recovery::{
        date_search::MatchLimits,
        shares::unmasking::{ShareUnmasking, Unmasked},
    },
    search::{Search, Step},
    sskr::{restore::ShareSet, split::split_backup},
};
use std::rc::Rc;

struct PublicFixed;
impl Random for PublicFixed {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
        bytes.fill(0x42);
        Ok(())
    }
}

#[test]
fn a_wrong_candidate_hint_does_not_abort_the_search() {
    let dates = [parse_date("03-02-2001").unwrap()];
    let first = Phrase::of_entropy(&[0; 16]).unwrap();
    let mut entropy = [0; 16];
    entropy[15] = 0x40;
    let target = Phrase::of_entropy(&entropy).unwrap();
    let set = |phrase: &Phrase| {
        let split = split_backup(
            phrase,
            Mode::SeedshiftLegacy,
            &dates,
            2,
            2,
            &mut PublicFixed,
        )
        .unwrap();
        let texts: Vec<String> = split
            .shares
            .iter()
            .map(|share| share.ur().as_str().to_owned())
            .collect();
        Rc::new(ShareSet::restore(&texts, None).unwrap())
    };
    let first = set(&first);
    let target_set = set(&target);
    let word = Backup::encode(&target, &dates, Form::Indexes, Mode::SeedshiftLegacy)
        .unwrap()
        .original_last_word
        .unwrap();
    let unmasking = ShareUnmasking::new(
        Mode::SeedshiftLegacy,
        Some(Rc::new(DatesAnswer::of(&dates))),
        None,
        MatchLimits::default(),
    )
    .unwrap()
    .with_last_word(Some(word));
    let mut control = unmasking.unmask(vec![target_set.clone()]);
    assert!(matches!(control.step(2).unwrap(), Step::Done(_)));
    assert!(matches!(
        control.finish(),
        Unmasked::Phrases { matches: 1, .. }
    ));
    let mut search = unmasking.unmask(vec![first, target_set]);
    assert!(matches!(search.step(2).unwrap(), Step::Done(_)));
    assert!(matches!(
        search.finish(),
        Unmasked::Phrases { matches: 1, .. }
    ));
}
