//! Entries for the `wasm` gate's memory scan of the binding itself, built only into the test
//! profile `test/probe` (wasm-profiles.json), never into a page's file: each takes a public marker
//! the way a secret entry takes a secret, and the gate searches the instance's memory for it after
//! the call (B-WIPE). They show that the zeroing allocator wipes a freed and a reallocated block and
//! that `after_secret` scrubs the stack of the work it runs; `probeRefusal` shows a refusal's kind
//! and code as a page receives them.

use mnemocode::text::pieces::PiecesError;
use wasm_bindgen::prelude::*;

use crate::host::{after_secret, refused};

/// Copies `marker` into a heap block of its own and frees it.
#[wasm_bindgen(js_name = probeFreed)]
pub fn probe_freed(marker: &[u8]) {
    let copy = marker.to_vec();
    std::hint::black_box(&copy);
}

/// Grows a vector byte by byte to hold `marker` several times over, so that it is reallocated as
/// it grows, then shrinks it and frees it.
#[wasm_bindgen(js_name = probeGrown)]
pub fn probe_grown(marker: &[u8]) {
    let mut grown = Vec::new();
    for _ in 0..8 {
        for byte in marker {
            grown.push(*byte);
        }
    }
    grown.truncate(marker.len());
    grown.shrink_to_fit();
    std::hint::black_box(&grown);
}

/// Copies `marker` into an array on the stack of work run through `after_secret`.
#[wasm_bindgen(js_name = probeStack)]
pub fn probe_stack(marker: &[u8]) {
    after_secret(|| {
        let mut area = [0_u8; 256];
        let length = marker.len().min(area.len());
        area[..length].copy_from_slice(&marker[..length]);
        std::hint::black_box(&mut area);
    });
}

/// Throws the refusal of a piece width of 0, a `RangeError` in TS.
#[wasm_bindgen(js_name = probeRefusal)]
pub fn probe_refusal() -> Result<(), JsValue> {
    Err(refused(&PiecesError::Width))
}
