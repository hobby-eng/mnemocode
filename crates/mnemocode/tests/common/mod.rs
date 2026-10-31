//! What the tests that replay a recording of the TS program share.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]

use serde_json::Value;

pub(crate) fn text(value: &Value) -> &str {
    value.as_str().expect("a string")
}

pub(crate) fn texts(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("an array")
        .iter()
        .map(|item| text(item).to_owned())
        .collect()
}
