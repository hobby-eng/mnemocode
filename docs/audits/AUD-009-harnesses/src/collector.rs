//! Card metadata consistency, with no PDF or raster output.
use crate::fixture::shares;
use mnemocode::{
    secret::SecretText,
    sskr::{forms::ShareFormat, restore::restore_complete, share::Share},
};
use mnemocode_cards::{export::share_reference, printed::Page};
use mnemocode_embroidery::found::{Collector, FileKind, Held};
use std::path::{Path, PathBuf};

fn page(share: &Share, reference: String, document: &str) -> Page {
    let text = ShareFormat::Unicode.write(share);
    Page {
        document: document.to_owned(),
        share: Some(reference),
        codes: text
            .as_str()
            .split_whitespace()
            .enumerate()
            .map(|(i, s)| (i + 1, SecretText::copy_of("public test code", s)))
            .collect(),
    }
}

#[test]
fn mismatched_internal_set_identifiers_are_not_advertised_as_a_quorum() {
    let a = shares(0x11);
    let b = shares(0x42);
    assert_ne!(a[0].info().identifier, b[1].info().identifier);
    assert!(restore_complete(&[&a[0], &a[1]], None).is_ok());
    assert!(matches!(
        restore_complete(&[&a[0], &b[1]], None),
        Err(mnemocode::sskr::restore::RestoreError::Set(
            mnemocode::sskr::set::SetError::Conflict(mnemocode::sskr::set::ConflictKind::Set)
        ))
    ));
    let mut collector = Collector::new();
    for (i, share) in [&a[0], &b[1]].into_iter().enumerate() {
        let reference = format!("{:04X}-1-{}", a[0].info().identifier, i + 1);
        let parsed_page = page(share, reference, &format!("public-{i}"));
        let control = mnemocode_cards::printed::found_in(&[vec![page(
            share,
            share_reference(share),
            &format!("control-{i}"),
        )]]);
        assert_eq!(control.len(), 1);
        assert_eq!(control[0].parts.len(), 1);
        let read =
            mnemocode::sskr::forms::read_share(control[0].parts[0].as_ref().unwrap().as_str())
                .unwrap();
        assert_eq!(read.share.payload(), share.payload());
        collector.add_held(
            PathBuf::from(format!("public-{i}.pdf")),
            Some(FileKind::Cards),
            Held::Cards(vec![parsed_page]),
        );
    }
    let found = collector.finish(Path::new("."));
    assert_eq!(found.len(), 1);
    assert!(
        found[0].trouble.is_some(),
        "Collector advertises a quorum that core restoration correctly rejects"
    );
}

#[test]
fn a_malformed_surplus_share_is_reported_without_disabling_recovery() {
    let s = shares(0x42);
    let mut collector = Collector::new();
    for (i, share) in s[..2].iter().enumerate() {
        collector.add_held(
            PathBuf::from(format!("public-{i}.png")),
            Some(FileKind::Qr),
            Held::Share(share.copy(), share.ur()),
        );
    }
    let mut broken = page(&s[2], share_reference(&s[2]), "public-broken");
    broken.codes.truncate(1);
    collector.add_held(
        PathBuf::from("public-broken.pdf"),
        Some(FileKind::Cards),
        Held::Cards(vec![broken]),
    );
    let found = collector.finish(Path::new("."));
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].shares().len(), 2);
    assert!(found[0].trouble.is_none());
    assert!(restore_complete(&found[0].shares().iter().collect::<Vec<_>>(), None).is_ok());
    assert!(
        found[0].warning.is_some(),
        "Malformed surplus card was silently discarded"
    );
}
