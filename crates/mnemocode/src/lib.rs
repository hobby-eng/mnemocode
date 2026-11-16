//! MnemoCode's rules, shared by the command line (`mnemocode-cli`) and the WebAssembly binding
//! (`mnemocode-wasm`) so that both give the same results; a front end holds no rule of its own.
//!
//! The foundation is [`secret`], [`refusal`], [`text`], [`random`] and [`self_check`]; the parts
//! built on it follow `docs/design/architect/PLAN.md`.

pub mod backup;
pub mod bip32;
pub mod bip39;
pub mod candidates;
pub mod checks;
pub mod checksum;
pub mod dates;
pub mod forms;
pub mod modes;
pub mod pack;
pub mod qr;
pub mod random;
pub mod recovery;
pub mod refusal;
pub mod search;
pub mod secret;
pub mod self_check;
#[cfg(feature = "sskr")]
pub mod sskr;
pub mod text;
pub mod wallet;
