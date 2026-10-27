//! The rules of text that every part shares (TS `src/core/`): white space as typed text and
//! ECMAScript take it, strict UTF-8, text from outside shown safely, whole numbers typed in a
//! range, the words of running text and of places, codes as text, bytes as hexadecimal, pieces of
//! one width, and the names of byte limits. Each lives in one submodule and is written once
//! (CORE-10); the front ends call these instead of writing their own.

pub mod codes;
pub mod display;
pub mod hex;
pub mod limits;
pub mod numbers;
pub mod pieces;
pub mod space;
pub mod utf8;
pub mod words;
