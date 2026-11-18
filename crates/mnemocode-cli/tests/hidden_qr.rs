//! Hidden QR records through the real protected command line and normal recovery entry points.
#![expect(
    clippy::disallowed_methods,
    reason = "integration tests write public fixtures and run the protected CLI"
)]
mod common;
use common::{folder, read, run, saved};
use std::fs;

#[test]
fn a_separate_hidden_qr_keeps_the_exact_record_and_the_chosen_public_text() {
    let dir = folder("hidden-qr-exact");
    let text = "#000064 #1EAB91\npublic test Δ";
    fs::write(dir.join("record.txt"), text).unwrap();
    saved(
        &dir,
        &[
            "qr-hide",
            "--input-file",
            "record.txt",
            "--qr",
            "hidden.png",
            "--qr-text",
            "Public collection",
        ],
    );
    let png = read(&dir, "hidden.png");
    assert_eq!(
        mnemocode::qr::read_png(&png).unwrap().as_str(),
        "Public collection"
    );
    assert_eq!(
        mnemocode::qr::hidden::read_png(&png).unwrap().as_str(),
        text
    );
    saved(
        &dir,
        &[
            "qr-open",
            "--qr-file",
            "hidden.png",
            "--output",
            "opened.txt",
        ],
    );
    assert_eq!(read(&dir, "opened.txt"), text.as_bytes());
}
#[test]
fn encode_and_decode_use_hidden_qr_without_changing_the_backup() {
    let dir = folder("hidden-qr-backup");
    saved(
        &dir,
        &[
            "encode",
            "--mode",
            "direct",
            "--mnemonic-file",
            common::PHRASE,
            "--format",
            "unicode",
            "--qr",
            "hidden.png",
            "--qr-hidden",
            "--qr-text",
            "Design study",
        ],
    );
    let image = read(&dir, "hidden.png");
    assert_eq!(
        mnemocode::qr::read_png(&image).unwrap().as_str(),
        "Design study"
    );
    let output = run(
        &dir,
        &[
            "decode",
            "--mode",
            "direct",
            "--format",
            "unicode",
            "--qr-file",
            "hidden.png",
        ],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("abandon"));
}
#[test]
fn an_oversized_record_is_refused_before_any_image_is_saved() {
    let dir = folder("hidden-qr-limit");
    fs::write(dir.join("record.txt"), "x".repeat(2400)).unwrap();
    common::assert_refused(
        &dir,
        &[
            "qr-hide",
            "--input-file",
            "record.txt",
            "--qr",
            "hidden.png",
        ],
        "do not fit",
    );
}

#[test]
fn a_pdf_sidecar_and_share_qrs_use_the_same_hidden_format() {
    let dir = folder("hidden-qr-pdf-shares");
    saved(
        &dir,
        &[
            "encode",
            "--mode",
            "direct",
            "--mnemonic-file",
            common::PHRASE,
            "--format",
            "unicode",
            "--pdf",
            "cards.pdf",
            "--page-size",
            "a5",
            "--qr-hidden",
            "--card-qr-png",
            "--card-name",
            "Public Test",
        ],
    );
    let image = read(&dir, "cards-qr.png");
    assert!(
        mnemocode::qr::read_png(&image)
            .unwrap()
            .as_str()
            .contains("FN:Public Test")
    );
    assert!(
        !mnemocode::qr::hidden::read_png(&image)
            .unwrap()
            .as_str()
            .is_empty()
    );
    saved(
        &dir,
        &[
            "sskr-export",
            "--share-file",
            common::SHARES,
            "--format",
            "ur",
            "--qr-dir",
            "shares",
            "--qr-hidden",
            "--qr-text",
            "Public shares study",
        ],
    );
    let image = read(&dir, "shares/share-1-qr.png");
    assert_eq!(
        mnemocode::qr::read_png(&image).unwrap().as_str(),
        "Public shares study"
    );
    assert_eq!(
        mnemocode::qr::hidden::read_png(&image).unwrap().as_str(),
        common::PUBLIC_SHARES[0]
    );
}

#[test]
fn public_text_without_hidden_mode_is_refused_by_encode_and_re_encode() {
    let dir = folder("hidden-qr-validation");
    for command in ["encode", "re-encode"] {
        common::assert_refused(
            &dir,
            &[command, "--qr", "refused.png", "--qr-text", "Public note"],
            "--qr-hidden with --qr-text",
        );
    }
}
