//! Collector checks using a deterministic public SSKR input, without rendering any files.
use mnemocode::{
    random::{Random, RandomError},
    secret::SecretText,
    sskr::{engine, restore::restore_complete, share::Share},
};
use mnemocode_embroidery::found::{Collector, FileKind, Held};
use std::path::{Path, PathBuf};

struct PublicRandom;
impl Random for PublicRandom {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = index as u8;
        }
        Ok(())
    }
}

#[test]
fn different_groups_keep_the_same_numbered_member() {
    let groups = [engine::Group {
        threshold: 1,
        count: 1,
    }; 2];
    let payloads = engine::split(&[0; 16], 2, &groups, &mut PublicRandom).unwrap();
    let shares: Vec<Share> = payloads
        .iter()
        .map(|bytes| Share::of_payload(bytes).unwrap())
        .collect();
    assert!(restore_complete(&shares.iter().collect::<Vec<_>>(), None).is_ok());
    let mut collector = Collector::new();
    for (index, share) in shares.into_iter().enumerate() {
        collector.add_held(
            PathBuf::from(format!("public-{index}.png")),
            Some(FileKind::Qr),
            Held::Share(share, SecretText::copy_of("public fixture", "synthetic")),
        );
    }
    let found = collector.finish(Path::new("."));
    assert_eq!(found.len(), 1);
    assert_eq!(
        found[0].shares().len(),
        2,
        "A complete two-group quorum lost a member"
    );
    assert!(restore_complete(&found[0].shares().iter().collect::<Vec<_>>(), None).is_ok());
}

#[test]
fn discovered_filename_cannot_escape_the_private_screen() {
    let mut collector = Collector::new();
    collector.add_held(
        PathBuf::from("public-\u{1b}[?1049l.png"),
        Some(FileKind::Qr),
        Held::Whole(SecretText::copy_of("public fixture", "synthetic")),
    );
    let found = collector.finish(Path::new("."));
    assert!(
        !found[0].note.contains('\u{1b}'),
        "display note retains terminal escape"
    );
}

#[test]
fn incomplete_surplus_share_does_not_block_a_complete_quorum() {
    let groups = [engine::Group {
        threshold: 2,
        count: 3,
    }];
    let payloads = engine::split(&[0; 16], 1, &groups, &mut PublicRandom).unwrap();
    let shares: Vec<Share> = payloads
        .iter()
        .map(|bytes| Share::of_payload(bytes).unwrap())
        .collect();
    assert!(restore_complete(&[&shares[0], &shares[1]], None).is_ok());
    let mut collector = Collector::new();
    for share in &shares[..2] {
        collector.add_held(
            PathBuf::from("complete.png"),
            Some(FileKind::Qr),
            Held::Share(share.copy(), share.ur()),
        );
    }
    let page = mnemocode_cards::printed::Page {
        document: "public-incomplete-third-share".to_owned(),
        share: Some(mnemocode_cards::export::share_reference(&shares[2])),
        codes: vec![(2, SecretText::copy_of("public code", "5BF6"))],
    };
    collector.add_held(
        PathBuf::from("incomplete.pdf"),
        Some(FileKind::Cards),
        Held::Cards(vec![page]),
    );
    let found = collector.finish(Path::new("."));
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].shares().len(), 2);
    assert!(
        found[0].trouble.is_none(),
        "Usable quorum excluded: {:?}",
        found[0].trouble
    );
}

#[test]
fn an_mnc1_record_is_classified_by_its_payload() {
    use mnemocode::{
        backup::Backup, bip39::phrase::Phrase, dates::parse_date, forms::Form, modes::Mode,
    };
    let phrase = Phrase::of_entropy(&[0; 16]).unwrap();
    let encoded = Backup::encode(
        &phrase,
        &[parse_date("23-09-2026").unwrap()],
        Form::Indexes,
        Mode::Seedshift,
    )
    .unwrap();
    let record = encoded.backup.record().unwrap();
    assert_eq!(
        mnemocode_embroidery::found::codes_of(&record),
        "word numbers"
    );
}
