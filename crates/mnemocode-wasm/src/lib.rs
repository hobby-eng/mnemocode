//! MnemoCode's WebAssembly binding for the wallet-tools pages: one module per library part, each
//! behind its `browser-*` feature, so that a page's file holds only the parts it uses
//! (docs/design/architect/ADR 0007).

#![forbid(unsafe_code)]
