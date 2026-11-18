//! Two tiny page scenes test document identity without generating PDF/PNG files.
use crate::fixture::PublicFixed;
use mnemocode::{backup::Backup, bip39::phrase::Phrase, forms::Form, modes::Mode};
use mnemocode_cards::{
    content::backup_card_content,
    printed::{found_in, pages_in, xmp},
    settings::{CardSettings, PageSize},
    templates::{CardDrawing, select_template},
};

#[test]
fn repeated_exports_with_different_decoys_remain_collectable() {
    let phrase = Phrase::of_entropy(&[0; 16]).unwrap();
    let encoded = Backup::encode(&phrase, &[], Form::Colors, Mode::Direct).unwrap();
    let base = backup_card_content(
        &encoded.backup,
        CardSettings {
            page_size: Some(PageSize::A4),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let mut pages = Vec::new();
    for byte in [0x11, 0x42] {
        let mut random = PublicFixed(byte);
        let cards = base
            .with_decoy_pool(&mut random)
            .unwrap()
            .kept_individual()
            .unwrap();
        let scene = select_template(Some("business-it"))
            .unwrap()
            .draw(&CardDrawing::new(), &mut random, &cards, None, 0)
            .unwrap();
        let kept = scene.kept.unwrap();
        let one = pages_in(xmp(&kept).as_bytes());
        assert_eq!(one.len(), 1);
        let single = found_in(std::slice::from_ref(&one));
        assert_eq!(single.len(), 1);
        assert_eq!(single[0].parts.len(), 1);
        assert!(single[0].parts[0].is_ok());
        let expected = (0..cards.codes.colors.len())
            .map(|i| format!("#{}", cards.codes.printed(i)))
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(single[0].parts[0].as_ref().unwrap().as_str(), expected);
        pages.push(one);
    }
    assert_ne!(
        pages[0][0].codes.last().unwrap().1,
        pages[1][0].codes.last().unwrap().1
    );
    println!(
        "same document ID: {}",
        pages[0][0].document == pages[1][0].document
    );
    let merged = found_in(&pages);
    assert!(!merged.is_empty());
    assert_eq!(
        merged
            .iter()
            .flat_map(|f| f.files.iter().copied())
            .collect::<std::collections::BTreeSet<_>>(),
        [0, 1].into_iter().collect()
    );
    assert!(
        merged
            .iter()
            .all(|f| !f.parts.is_empty() && f.parts.iter().all(Result::is_ok)),
        "Two individually readable exports conflict when their different decoys share a document ID"
    );
}
