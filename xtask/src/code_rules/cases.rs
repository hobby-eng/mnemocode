//! The cases that `cargo xtask code-rules --self-test` gives the parts that read source text, each
//! with the problem the part must report, or none for a case it must pass (CORE-28). Most are the
//! ways past the gate that the reviews of increments 0 and 1 found.

/// What a case gives the parts: Rust sources by path, or a workspace manifest.
pub(super) enum Input {
    Sources(Vec<(&'static str, &'static str)>),
    Manifest(&'static str),
}

/// One case: its name, what it gives and the problem expected, or none.
pub(super) struct Case {
    pub(super) name: &'static str,
    pub(super) expect: Option<&'static str>,
    pub(super) input: Input,
}

impl Case {
    fn sources(
        name: &'static str,
        expect: Option<&'static str>,
        files: Vec<(&'static str, &'static str)>,
    ) -> Self {
        Self {
            name,
            expect,
            input: Input::Sources(files),
        }
    }

    fn manifest(name: &'static str, expect: Option<&'static str>, manifest: &'static str) -> Self {
        Self {
            name,
            expect,
            input: Input::Manifest(manifest),
        }
    }
}

/// Every case.
#[expect(
    clippy::too_many_lines,
    reason = "a table of cases, one after another, reads best whole"
)]
pub(super) fn cases() -> Vec<Case> {
    vec![
        Case::sources(
            "a braced group's last item",
            Some("text may not use crate::wallet"),
            vec![(
                "crates/mnemocode/src/text.rs",
                "use crate::{refusal::Refusal, wallet};\n",
            )],
        ),
        Case::sources(
            "a braced group of plain names",
            Some("text may not use crate::bip39"),
            vec![(
                "crates/mnemocode/src/text.rs",
                "use crate::{bip39, refusal};\n",
            )],
        ),
        Case::sources(
            "super in a top-level module",
            Some("text may not use crate::wallet"),
            vec![("crates/mnemocode/src/text.rs", "use super::wallet::Coin;\n")],
        ),
        Case::sources(
            "super twice from a submodule",
            Some("text may not use crate::recovery"),
            vec![(
                "crates/mnemocode/src/text/words.rs",
                "use super::super::recovery::Search;\n",
            )],
        ),
        Case::sources(
            "a path in an expression",
            Some("random may not use crate::text"),
            vec![(
                "crates/mnemocode/src/random.rs",
                "fn f() { crate::text::space::trim(\"\"); }\n",
            )],
        ),
        Case::sources(
            "allowed uses and an inline test module's super",
            None,
            vec![(
                "crates/mnemocode/src/text.rs",
                "use crate::refusal::Refusal;\nfn f() {}\n#[cfg(test)]\nmod tests {\n    use super::*;\n    use super::f;\n}\n",
            )],
        ),
        Case::sources(
            "a string and a comment that name paths",
            None,
            vec![(
                "crates/mnemocode/src/random.rs",
                "use crate::refusal::Refusal;\n// crate::wallet\nconst A: &str = \"crate::bip39\";\n",
            )],
        ),
        Case::sources(
            "the cards crate past its library list",
            Some("the cards crate may not use mnemocode::wallet"),
            vec![(
                "crates/mnemocode-cards/src/lib.rs",
                "use mnemocode::{text, wallet::Coin};\n",
            )],
        ),
        Case::sources(
            "unsafe code allowed through cfg_attr",
            Some("allow(unsafe_code)"),
            vec![(
                "crates/mnemocode/src/lib.rs",
                "#![cfg_attr(all(), allow(unsafe_code, reason = \"probe\"))]\n",
            )],
        ),
        Case::sources(
            "a lint group allowed",
            Some("allow(clippy::style)"),
            vec![(
                "crates/mnemocode/src/lib.rs",
                "#![allow(clippy::style, reason = \"probe\")]\n",
            )],
        ),
        Case::sources(
            "warnings expected",
            Some("expect(warnings)"),
            vec![(
                "crates/mnemocode/src/text.rs",
                "#[expect(warnings, reason = \"probe\")]\nfn f() {}\n",
            )],
        ),
        Case::sources(
            "the disallowed std items expected in a crate root",
            Some("clippy::disallowed_methods"),
            vec![(
                "crates/mnemocode-cli/src/main.rs",
                "#![expect(clippy::disallowed_methods, reason = \"probe\")]\nfn main() {}\n",
            )],
        ),
        Case::sources(
            "the disallowed std items expected below the top",
            Some("clippy::disallowed_types"),
            vec![(
                "crates/mnemocode-cli/src/os.rs",
                "fn f() {}\n#[expect(clippy::disallowed_types, reason = \"probe\")]\nfn g() {}\n",
            )],
        ),
        Case::sources(
            "the disallowed std items expected at the top of an I/O module",
            None,
            vec![(
                "crates/mnemocode-cli/src/os.rs",
                "//! The system.\n\n#![expect(clippy::disallowed_methods, reason = \"the system\")]\n",
            )],
        ),
        Case::sources(
            "the disallowed std items expected in a test module",
            None,
            vec![(
                "crates/mnemocode/src/checksum.rs",
                "fn f() {}\n#[cfg(test)]\nmod tests {\n    #![expect(clippy::disallowed_methods, reason = \"a test reads a file\")]\n}\n",
            )],
        ),
        Case::sources(
            "the disallowed std items expected in a test module for one system",
            None,
            vec![(
                "crates/mnemocode/src/checksum.rs",
                "fn f() {}\n#[cfg(test)]\n#[cfg(unix)]\nmod tests {\n    #![expect(clippy::disallowed_methods, reason = \"a test reads a file\")]\n}\n",
            )],
        ),
        Case::sources(
            "the disallowed std items allowed in a test module",
            Some("is expected only at the top"),
            vec![(
                "crates/mnemocode/src/checksum.rs",
                "fn f() {}\n#[cfg(test)]\nmod tests {\n    #![allow(clippy::disallowed_methods, reason = \"probe\")]\n}\n",
            )],
        ),
        Case::sources(
            "an old lint name allowed through renamed_and_removed_lints",
            Some("renamed_and_removed_lints"),
            vec![(
                "crates/mnemocode/src/checksum.rs",
                "#![allow(renamed_and_removed_lints, reason = \"probe\")]\n#![allow(clippy::disallowed_method, reason = \"probe\")]\n",
            )],
        ),
        Case::sources(
            "an old lint name expected outside the I/O modules",
            Some("clippy::disallowed_type"),
            vec![(
                "crates/mnemocode/src/checksum.rs",
                "#![expect(clippy::disallowed_type, reason = \"probe\")]\n",
            )],
        ),
        Case::sources(
            "a folder named tests in src",
            Some("is expected only at the top"),
            vec![
                ("crates/mnemocode/src/text.rs", "pub mod tests;\n"),
                (
                    "crates/mnemocode/src/text/tests/real.rs",
                    "#![expect(clippy::disallowed_methods, reason = \"probe\")]\n",
                ),
            ],
        ),
        Case::sources(
            "the crate root under another name",
            Some("the crate root under another name"),
            vec![(
                "crates/mnemocode/src/text.rs",
                "use crate as root;\nfn f() { root::wallet::Coin::new(); }\n",
            )],
        ),
        Case::sources(
            "self as a name in a crate group",
            Some("the crate root under another name"),
            vec![(
                "crates/mnemocode/src/text.rs",
                "use crate::{self as root};\n",
            )],
        ),
        Case::sources(
            "a glob of the crate root",
            Some("the crate root under another name"),
            vec![(
                "crates/mnemocode/src/random.rs",
                "use super::*;\nfn f() { text::space::trim(\"\"); }\n",
            )],
        ),
        Case::sources(
            "the crate root reached through super twice",
            Some("the crate root under another name"),
            vec![(
                "crates/mnemocode/src/random.rs",
                "mod m {\n    use super::super as root;\n}\n",
            )],
        ),
        Case::sources(
            "the library under another name",
            Some("a workspace crate under another name"),
            vec![(
                "crates/mnemocode-cards/src/lib.rs",
                "use mnemocode as m;\nfn f() { m::wallet::f(); }\n",
            )],
        ),
        Case::sources(
            "a lint allowed in a macro's body",
            Some("allow(unsafe_code)"),
            vec![(
                "crates/mnemocode/src/random.rs",
                "macro_rules! raw {\n    () => {\n        #[allow(unsafe_code, reason = \"p\")]\n        fn f(p: *const u8) -> u8 { unsafe { *p } }\n    };\n}\nraw!();\n",
            )],
        ),
        Case::sources(
            "a short test in a macro's body",
            Some("test short needs a name"),
            vec![(
                "crates/mnemocode/src/text.rs",
                "#[cfg(test)]\nmod tests {\n    macro_rules! t {\n        () => {\n            #[test]\n            fn short() {}\n        };\n    }\n    t!();\n}\n",
            )],
        ),
        Case::sources(
            "a fake implemented in a macro's body",
            Some("a test fake of Normalizer"),
            vec![
                (
                    "crates/mnemocode/src/text.rs",
                    "pub trait Normalizer {}\n#[cfg(test)]\nmod tests;\n",
                ),
                (
                    "crates/mnemocode/src/text/tests.rs",
                    "struct Fake;\nmacro_rules! fake { () => { impl<T> super::Normalizer for Fake {} }; }\nfake!();\n",
                ),
            ],
        ),
        Case::sources(
            "self then super up to a forbidden module",
            Some("random may not use crate::text"),
            vec![(
                "crates/mnemocode/src/random.rs",
                "fn f() { self::super::text::space::trim(\"\"); }\n",
            )],
        ),
        Case::sources(
            "the library renamed as self in a group",
            Some("a workspace crate under another name"),
            vec![(
                "crates/mnemocode-cards/src/lib.rs",
                "use mnemocode::{self as m};\n",
            )],
        ),
        Case::sources(
            "a lint attribute built from a macro's parameter",
            Some("built from a macro's parameters"),
            vec![(
                "crates/mnemocode/src/random.rs",
                "macro_rules! lint { ($l:ident) => { #[allow($l, reason = \"p\")] fn f() {} }; }\nlint!(unsafe_code);\n",
            )],
        ),
        Case::sources(
            "a lint given to a macro that makes an attribute of it",
            Some("given to a macro"),
            vec![(
                "crates/mnemocode/src/random.rs",
                "macro_rules! attr { ($m:meta) => { #[$m] fn f() {} }; }\nattr!(allow(unsafe_code, reason = \"p\"));\n",
            )],
        ),
        Case::sources(
            "doc comments forwarded through a macro",
            None,
            vec![(
                "crates/mnemocode/src/checksum.rs",
                "macro_rules! documented { ($(#[$attr:meta])* $name:ident) => { $(#[$attr])* fn $name() {} }; }\ndocumented!(\n    /// A function.\n    f\n);\n",
            )],
        ),
        Case::sources(
            "a method named as a lint inside a macro call",
            None,
            vec![(
                "crates/mnemocode/src/checksum.rs",
                "fn f(v: Option<u8>) -> String { format!(\"{}\", v.expect(\"e\")) }\n",
            )],
        ),
        Case::sources(
            "a path ending in a lint's name inside a macro call",
            None,
            vec![(
                "crates/mnemocode/src/checksum.rs",
                "fn f() -> String { format!(\"{}\", log::warn(\"e\")) }\n",
            )],
        ),
        Case::sources(
            "a leading path separator before the library",
            Some("the cards crate may not use mnemocode::wallet"),
            vec![(
                "crates/mnemocode-cards/src/lib.rs",
                "use ::mnemocode::wallet::Coin;\n",
            )],
        ),
        Case::sources(
            "a macro's crate path",
            Some("text may not use crate::wallet"),
            vec![(
                "crates/mnemocode/src/text.rs",
                "macro_rules! m { () => { $crate::wallet::f() }; }\n",
            )],
        ),
        Case::sources(
            "the system generator named as a value",
            Some("OsRng"),
            vec![(
                "crates/mnemocode/src/random.rs",
                "fn f() { let mut rng = rand_core::OsRng; }\n",
            )],
        ),
        Case::sources(
            "a fake in a separate test file",
            Some("a test fake of Normalizer"),
            vec![
                (
                    "crates/mnemocode/src/text.rs",
                    "pub trait Normalizer {}\n#[cfg(test)]\nmod tests;\n",
                ),
                (
                    "crates/mnemocode/src/text/tests.rs",
                    "struct Fake;\nimpl super::Normalizer for Fake {}\n",
                ),
            ],
        ),
        Case::sources(
            "a short test name",
            Some("test short needs a name"),
            vec![(
                "crates/mnemocode/src/text.rs",
                "#[cfg(test)]\nmod tests {\n    #[test]\n    fn short() {}\n}\n",
            )],
        ),
        Case::manifest(
            "a release profile with more codegen units",
            Some("codegen-units = 1"),
            "[profile.release]\npanic = \"abort\"\nlto = true\ncodegen-units = 16\n",
        ),
        Case::manifest(
            "a release setting only in a comment",
            Some("lto = true"),
            "[profile.release]\npanic = \"abort\"\nlto = false # lto = true\ncodegen-units = 1\n",
        ),
        Case::manifest(
            "the release profile of RUST-12",
            None,
            "[profile.release]\npanic = \"abort\"\nlto = true\ncodegen-units = 1\nstrip = true\n",
        ),
    ]
}
