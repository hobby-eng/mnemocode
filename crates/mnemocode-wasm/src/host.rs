//! What every binding module shares (ARCHITECTURE.md §6, §7): a library refusal turned into the
//! JavaScript error a page catches, of the kind TS throws (`Error`, `RangeError` or `TypeError`)
//! and with the refusal's stable `code` as a read-only property, as TS 0.1.0's refusals carry it;
//! the arguments of a secret entry, which cross as `JsValue`s that Rust reads, so that the glue
//! copies nothing it could leave behind; the browser's randomness behind the library's `Random`
//! port; and the stack scrub after each call that handled a secret.

use std::fmt;

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
/// getrandom's `wasm_js` backend) behind the library's `Random` port; the system's in a native
/// build.
pub struct BrowserRandom;

impl mnemocode::random::Random for BrowserRandom {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), mnemocode::random::RandomError> {
        getrandom::fill(bytes).map_err(|_| mnemocode::random::RandomError::Unavailable)
    }
}

/// Runs the rows of `part` of this build, the startup cases or with `full` every case; throws the
/// first difference, as the library words it.
pub fn self_check(part: mnemocode::checks::Part, full: bool) -> Result<(), JsValue> {
    use mnemocode::self_check::{Check, Tier};
    let tier = if full { Tier::Full } else { Tier::Startup };
    mnemocode::checks::part_rows(part)
        .try_for_each(|row| row.run(tier))
        .map_err(|failure| refused(&failure))
}

/// A whole number that a page passes, as the library reads one: a value that is no whole number
/// from 0 becomes the largest, which every range of the library refuses with its own words.
pub fn whole(value: f64) -> u64 {
    if value.is_finite() && value >= 0.0 && value.fract() == 0.0 && value < 9_007_199_254_740_992.0
    {
        value as u64
    } else {
        u64::MAX
    }
}

/// A secret argument that is not text, refused as TS refuses secret storage of another type.
#[derive(Debug)]
struct NotText;

impl fmt::Display for NotText {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret text storage needs text.")
    }
}

impl std::error::Error for NotText {}

impl Refusal for NotText {
    fn code(&self) -> &'static str {
        "core.secret-value.text"
    }

    fn kind(&self) -> RefusalKind {
        RefusalKind::Type
    }
}

// A secret entry takes its text as `JsValue`s, read here inside the call: the glue copies a `&str`
// argument into the instance's memory before it checks the next argument or the receiver, and a
// throw there leaves that copy never freed, so never wiped (ARCHITECTURE.md §6). Reading the text
// here copies it into a Rust `String`, which the zeroing allocator wipes when it is dropped.

/// The secret text `value`; refused unless it is text.
pub fn text(value: &JsValue) -> Result<String, JsValue> {
    value.as_string().ok_or_else(|| refused(&NotText))
}

/// The secret text `value`, empty when it is undefined, as TS's default of an optional secret.
pub fn optional_text(value: &JsValue) -> Result<String, JsValue> {
    if value.is_undefined() {
        Ok(String::new())
    } else {
        text(value)
    }
}

/// The name `value`, empty when it is no text, which the library refuses with its own words.
pub fn name(value: &JsValue) -> String {
    value.as_string().unwrap_or_default()
}

/// A place from 0 that a page passes: as [`whole`] reads it, the largest where it is none.
pub fn place(value: f64) -> usize {
    usize::try_from(whole(value)).unwrap_or(usize::MAX)
}
