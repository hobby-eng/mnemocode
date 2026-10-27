//! What every binding module shares (ARCHITECTURE.md §6, §7): a library refusal turned into the
//! JavaScript error a page catches, of the kind TS throws (`Error`, `RangeError` or `TypeError`)
//! and with the refusal's stable `code` as a read-only property, as TS 0.1.0's refusals carry it;
//! the browser's randomness behind the library's `Random` port; and the stack scrub after each call
//! that handled a secret.

use mnemocode::refusal::{Refusal, RefusalKind};
use mnemocode::secret::scrub_stack;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// JavaScript's `Error`.
    #[wasm_bindgen(js_name = Error)]
    type JsPlainError;

    /// `new Error(message)`.
    #[wasm_bindgen(constructor, js_class = "Error")]
    fn new(message: &str) -> JsPlainError;

    /// JavaScript's `RangeError`.
    #[wasm_bindgen(js_name = RangeError)]
    type JsRangeError;

    /// `new RangeError(message)`.
    #[wasm_bindgen(constructor, js_class = "RangeError")]
    fn new(message: &str) -> JsRangeError;

    /// JavaScript's `TypeError`.
    #[wasm_bindgen(js_name = TypeError)]
    type JsTypeError;

    /// `new TypeError(message)`.
    #[wasm_bindgen(constructor, js_class = "TypeError")]
    fn new(message: &str) -> JsTypeError;

    /// `JSON.parse(text)`, which makes the property descriptor without js-sys.
    #[wasm_bindgen(js_namespace = JSON, js_name = parse)]
    fn json_parse(text: &str) -> JsValue;

    /// `Object.defineProperty(target, key, descriptor)`.
    #[wasm_bindgen(js_namespace = Object, js_name = defineProperty)]
    fn define_property(target: &JsValue, key: &str, descriptor: &JsValue) -> JsValue;
}

/// `refusal` as the error a binding entry throws: of TS's kind for the condition, its `message` the
/// refusal's message, and `code` its stable code, which the page cannot change or delete, as TS
/// defines it (`src/core/error-catalog.ts`).
pub fn refused(refusal: &impl Refusal) -> JsValue {
    let message = refusal.to_string();
    let error: JsValue = match refusal.kind() {
        RefusalKind::Error => JsPlainError::new(&message).into(),
        RefusalKind::Range => JsRangeError::new(&message).into(),
        RefusalKind::Type => JsTypeError::new(&message).into(),
    };
    // A code is static program data of letters, digits, dots and hyphens: no JSON escape needed.
    // As TS's catalog defines it: enumerable, so that JSON.stringify and Object.keys keep it, and
    // neither writable nor configurable, which a property descriptor leaves out by default.
    let descriptor = json_parse(&format!(
        "{{\"value\":\"{}\",\"enumerable\":true}}",
        refusal.code()
    ));
    define_property(&error, "code", &descriptor);
    error
}

/// What `call` gives, with the stack below the entry scrubbed once it returns: for every entry
/// that handles a secret, since the libraries leave copies on the stack that no owner wipes. `call`
/// runs in a frame of its own below the entry's, never inlined into it, so its locals are below the
/// frame that scrubs (zeroize's `zeroize_stack` asks for this). `T` must not hold a secret by
/// value: it comes back into the entry's frame; a secret result is an owner that keeps its bytes on
/// the heap.
pub fn after_secret<T>(call: impl FnOnce() -> T) -> T {
    let result = run_apart(call);
    scrub_stack();
    result
}

/// Runs `call` in a frame of its own.
#[inline(never)]
fn run_apart<T>(call: impl FnOnce() -> T) -> T {
    call()
}

/// The browser's cryptographically secure randomness (`crypto.getRandomValues`, through
/// getrandom's `wasm_js` backend) behind the library's `Random` port.
#[cfg(target_arch = "wasm32")]
pub struct BrowserRandom;

#[cfg(target_arch = "wasm32")]
impl mnemocode::random::Random for BrowserRandom {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), mnemocode::random::RandomError> {
        getrandom::fill(bytes).map_err(|_| mnemocode::random::RandomError::Unavailable)
    }
}
