//! MnemoCode's cross-stitch patterns: a picture in DMC threads whose legend holds a phrase's
//! entropy in each row's symbol and the last digits of its stitch count ([`legend`]). The legend
//! reads back with no picture, so a front end normally hides a phrase masked with Seedshift dates
//! ([`phrase`]): unmasked, anyone can read it.

#![forbid(unsafe_code)]

pub mod chart;
pub mod checks;
pub mod color;
pub mod dmc;
pub mod fabric;
#[cfg(feature = "sskr")]
pub mod found;
pub mod hide;
pub mod legend;
pub mod pattern;
pub mod phrase;
pub mod picture;
pub mod sample;
