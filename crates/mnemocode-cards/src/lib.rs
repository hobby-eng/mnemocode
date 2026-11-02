//! MnemoCode's cards: templates, sheets, PDF documents and page images, drawn from the backups and
//! shares of the `mnemocode` library. The rules never depend on drawing: this crate depends on the
//! library, never the other way.

#![forbid(unsafe_code)]

mod assets;
pub mod checks;
pub mod content;
pub mod details;
pub mod export;
pub mod heir;
pub mod palette;
pub mod pdf;
pub mod plan;
pub mod preflight;
pub mod raster;
pub mod scene;
pub mod settings;
pub mod sheet;
pub mod templates;
pub mod text_rules;
