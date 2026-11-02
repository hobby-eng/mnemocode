//! The reader of QR images: a PNG of any bytes is read or refused, without a panic.
#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = mnemocode::qr::read_png(data);
});
