//! MnemoCode's cross-stitch patterns: a picture turned into DMC threads, whose legend holds the
//! entropy of a phrase in the symbol of each row and the last digits of its stitch count (format
//! 1, [`legend`]). The legend reads back with no picture; the pattern looks as near to the picture
//! as its threads allow, and the few stitches moved to set the counts are chosen where they show
//! least.
//!
//! A legend is a backup of the phrase it holds, as any of MnemoCode's records is: a front end
//! hides a phrase masked with Seedshift dates ([`phrase`]), never the phrase itself, since the
//! format is public.

#![forbid(unsafe_code)]

pub mod chart;
pub mod checks;
pub mod color;
pub mod dmc;
pub mod hide;
pub mod legend;
pub mod pattern;
pub mod phrase;
pub mod picture;
pub mod sample;
