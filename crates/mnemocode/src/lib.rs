//! MnemoCode's rules, called by the command line (`mnemocode-cli`) and by the WebAssembly binding
//! (`mnemocode-wasm`) alike, so that both give the same results.
//!
//! The modules arrive in the order of `docs/design/architect/PLAN.md`; a front end never holds a
//! rule of its own.
