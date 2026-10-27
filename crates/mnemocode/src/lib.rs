//! MnemoCode's rules, called by the command line (`mnemocode-cli`) and by the WebAssembly binding
//! (`mnemocode-wasm`) alike, so that both give the same results.
//!
//! The foundation every part may use: [`secret`] (owners that wipe secrets, page locks, the zeroing
//! allocator), [`refusal`] (stable codes), [`checksum`] (CRC-32), [`text`] (white space, safe
//! display, numbers, words, codes), [`random`] (the host's randomness), [`self_check`] (known-answer
//! rows) and [`search`] (searches the host steps). The parts arrive in the order of
//! `docs/design/architect/PLAN.md`; a front end never holds a rule of its own.

pub mod checksum;
pub mod random;
pub mod refusal;
pub mod search;
pub mod secret;
pub mod self_check;
pub mod text;
