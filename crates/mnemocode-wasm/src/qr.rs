//! The QR part for a page (`browser-qr`): a payload's QR image as PNG bytes and its matrix, both
//! read back before they are given out, the text of a QR code in a PNG file, and the part's
//! self-check. The payload and the image hold a backup or a share: the page drops them soon after.
//! A payload crosses as a `JsValue` that Rust reads (ARCHITECTURE.md §6).

use mnemocode::checks::Part;
use wasm_bindgen::prelude::*;

use crate::host::{after_secret, place, refused, self_check, text};

/// The modules of a QR symbol, without its quiet zone, which a page draws itself.
#[wasm_bindgen]
pub struct QrMatrix(mnemocode::qr::Matrix);

#[wasm_bindgen]
impl QrMatrix {
    /// The matrix of `payload` at level M, read back before it is given out.
    pub fn of(payload: JsValue) -> Result<QrMatrix, JsValue> {
        after_secret(|| matrix_of(&text(&payload)?))
    }

    /// The modules on a side.
    #[wasm_bindgen(getter)]
    pub fn size(&self) -> usize {
        self.0.size()
    }

    /// Whether the module at `row` and `column`, each a whole number from 0, is dark: never one
    /// outside the matrix.
    #[wasm_bindgen(js_name = isDark)]
    pub fn is_dark(&self, row: f64, column: f64) -> bool {
        self.0.is_dark(place(row), place(column))
    }
}

/// The matrix of the payload read.
fn matrix_of(payload: &str) -> Result<QrMatrix, JsValue> {
    mnemocode::qr::matrix(payload)
        .map(QrMatrix)
        .map_err(|refusal| refused(&refusal))
}

/// The image of the payload read.
fn png_of(payload: &str) -> Result<Vec<u8>, JsValue> {
    mnemocode::qr::png(payload)
        .map(|image| image.to_vec())
        .map_err(|refusal| refused(&refusal))
}

/// The PNG image of `payload`, 720 pixels with the quiet zone of four modules, read back first.
#[wasm_bindgen(js_name = qrPng)]
pub fn qr_png(payload: JsValue) -> Result<Vec<u8>, JsValue> {
    after_secret(|| png_of(&text(&payload)?))
}

/// The text of the QR code in the PNG file `bytes`, admitted and read as the library reads it.
#[wasm_bindgen(js_name = readQrPng)]
pub fn read_qr_png(bytes: &[u8]) -> Result<String, JsValue> {
    after_secret(|| {
        mnemocode::qr::read_png(bytes)
            .map(|text| text.as_str().to_owned())
            .map_err(|refusal| refused(&refusal))
    })
}

/// The QR part's known answers: the startup cases, or with `full` every case.
#[wasm_bindgen(js_name = selfCheckQr)]
pub fn self_check_qr(full: bool) -> Result<(), JsValue> {
    self_check(Part::Qr, full)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_image_and_a_matrix_read_back_as_their_payload() {
        let payload = "MNC1:direct:unicode:768476847684768476847684768476847684768476845728";
        let image = png_of(payload).unwrap();
        assert_eq!(read_qr_png(&image).unwrap(), payload);
        let matrix = matrix_of(payload).unwrap();
        assert!(matrix.is_dark(0.0, 0.0));
        let size = f64::from(u32::try_from(matrix.size()).unwrap());
        assert!(!matrix.is_dark(size, 0.0));
        assert!(!matrix.is_dark(f64::NAN, 0.0));
        assert!(!matrix.is_dark(-1.0, 0.0));
    }
}
