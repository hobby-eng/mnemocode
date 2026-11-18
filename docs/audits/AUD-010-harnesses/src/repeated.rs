//! Export identities must distinguish printed decoys, not only their palette.
use mnemocode::{
    backup::Backup,
    bip39::phrase::Phrase,
    forms::Form,
    modes::Mode,
    random::{Random, RandomError},
};
use mnemocode_cards::{
    content::backup_card_content,
    printed::{found_in, pages_in, xmp},
    settings::{CardSettings, PageSize},
    templates::{CardDrawing, select_template},
};

struct Filled(u8);
impl Random for Filled {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
        bytes.fill(self.0);
        Ok(())
    }
}

fn check(form: Form) {
    let phrase = Phrase::of_entropy(&[0; 16]).unwrap();
    let encoded = Backup::encode(&phrase, &[], form, Mode::Direct).unwrap();
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
        let mut random = Filled(byte);
        let cards = base
            .with_decoy_pool(&mut random)
            .unwrap()
            .kept_individual()
            .unwrap();
        let scene = select_template(Some("business-it"))
            .unwrap()
            .draw(&CardDrawing::new(), &mut random, &cards, None, 0)
            .unwrap();
        let one = pages_in(xmp(&scene.kept.unwrap()).as_bytes());
        let single = found_in(std::slice::from_ref(&one));
        assert_eq!(single.len(), 1);
        assert_eq!(single[0].parts.len(), 1);
        let expected = (0..cards.codes.colors.len())
            .map(|i| match form {
                Form::Colors => format!("#{}", cards.codes.printed(i)),
                _ => cards.codes.printed(i).to_owned(),
            })
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
        "{}: same document ID = {}",
        form.name(),
        pages[0][0].document == pages[1][0].document
    );
    let merged = found_in(&pages);
    assert!(!merged.is_empty());
    for found in &merged {
        for part in &found.parts {
            if let Err(error) = part {
                println!("{} collection error: {error:?}", form.name());
            }
        }
    }
    assert!(
        merged
            .iter()
            .all(|found| !found.parts.is_empty() && found.parts.iter().all(Result::is_ok)),
        "individually readable exports must remain readable together"
    );
}

#[test]
fn colors_exports_remain_readable_together() {
    check(Form::Colors);
}

#[test]
fn unicode_exports_remain_readable_together() {
    check(Form::Unicode);
}
