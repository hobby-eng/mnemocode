// The cases that `node scripts/verify-code-rules.mjs --self-test` gives the parts that read source
// text, each with the problem the part must report (`expect`), or none for a case it must pass
// (CORE-28). Most are the ways past the gate that the review of increment 0 found.

/** A case of Rust sources: their paths and texts, and the problem expected. */
const rust = (name, expect, files) => ({
  name,
  expect,
  sources: Object.entries(files).map(([path, text]) => ({ path, text })),
});

export const CASES = [
  rust("a braced group's last item", "text may not use crate::wallet", {
    "crates/mnemocode/src/text.rs": "use crate::{refusal::Refusal, wallet};\n",
  }),
  rust("a braced group of plain names", "text may not use crate::bip39", {
    "crates/mnemocode/src/text.rs": "use crate::{bip39, refusal};\n",
  }),
  rust("super in a top-level module", "text may not use crate::wallet", {
    "crates/mnemocode/src/text.rs": "use super::wallet::Coin;\n",
  }),
  rust("super twice from a submodule", "text may not use crate::recovery", {
    "crates/mnemocode/src/text/words.rs": "use super::super::recovery::Search;\n",
  }),
  rust("a path in an expression", "random may not use crate::text", {
    "crates/mnemocode/src/random.rs": 'fn f() { crate::text::space::trim(""); }\n',
  }),
  rust("allowed uses and an inline test module's super", undefined, {
    "crates/mnemocode/src/text.rs":
      "use crate::refusal::Refusal;\nfn f() {}\n#[cfg(test)]\nmod tests {\n    use super::*;\n    use super::f;\n}\n",
  }),
  rust("a string and a comment that name paths", undefined, {
    "crates/mnemocode/src/random.rs":
      'use crate::refusal::Refusal;\n// crate::wallet\nconst A: &str = "crate::bip39";\n',
  }),
  rust("the cards crate past its library list", "the cards crate may not use mnemocode::wallet", {
    "crates/mnemocode-cards/src/lib.rs": "use mnemocode::{text, wallet::Coin};\n",
  }),
  rust("unsafe code allowed through cfg_attr", "allow(unsafe_code)", {
    "crates/mnemocode/src/lib.rs": '#![cfg_attr(all(), allow(unsafe_code, reason = "probe"))]\n',
  }),
  rust("a lint group allowed", "allow(clippy::style)", {
    "crates/mnemocode/src/lib.rs": '#![allow(clippy::style, reason = "probe")]\n',
  }),
  rust("warnings expected", "expect(warnings)", {
    "crates/mnemocode/src/text.rs": '#[expect(warnings, reason = "probe")]\nfn f() {}\n',
  }),
  rust("the disallowed std items expected in a crate root", "clippy::disallowed_methods", {
    "crates/mnemocode-cli/src/main.rs":
      '#![expect(clippy::disallowed_methods, reason = "probe")]\nfn main() {}\n',
  }),
  rust("the disallowed std items expected below the top", "clippy::disallowed_types", {
    "crates/mnemocode-cli/src/os.rs":
      'fn f() {}\n#[expect(clippy::disallowed_types, reason = "probe")]\nfn g() {}\n',
  }),
  rust("the disallowed std items expected at the top of an I/O module", undefined, {
    "crates/mnemocode-cli/src/os.rs":
      '//! The system.\n\n#![expect(clippy::disallowed_methods, reason = "the system")]\n',
  }),
  rust("a fake in a separate test file", "a test fake of Normalizer", {
    "crates/mnemocode/src/text.rs": "pub trait Normalizer {}\n#[cfg(test)]\nmod tests;\n",
    "crates/mnemocode/src/text/tests.rs": "struct Fake;\nimpl super::Normalizer for Fake {}\n",
  }),
  rust("a short test name", "test short needs a name", {
    "crates/mnemocode/src/text.rs":
      "#[cfg(test)]\nmod tests {\n    #[test]\n    fn short() {}\n}\n",
  }),
  {
    name: "a release profile with more codegen units",
    expect: "codegen-units = 1",
    manifest: '[profile.release]\npanic = "abort"\nlto = true\ncodegen-units = 16\n',
  },
  {
    name: "a release setting only in a comment",
    expect: "lto = true",
    manifest: '[profile.release]\npanic = "abort"\nlto = false # lto = true\ncodegen-units = 1\n',
  },
  {
    name: "the release profile of RUST-12",
    expect: undefined,
    manifest: '[profile.release]\npanic = "abort"\nlto = true\ncodegen-units = 1\nstrip = true\n',
  },
];
