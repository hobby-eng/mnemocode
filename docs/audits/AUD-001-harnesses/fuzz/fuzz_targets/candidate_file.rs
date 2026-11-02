//! The readers of candidate files: the list's format, and age with the published test identity.
#![no_main]

use libfuzzer_sys::fuzz_target;
use mnemocode::candidates::age::{Identity, Opener, Recipient, decrypt};
use mnemocode::candidates::format::CandidateList;

/// The test identity of age's own documentation: public, opens nothing of anyone's.
const TEST_IDENTITY: &str =
    "AGE-SECRET-KEY-1GFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPQ4EGAEX";

fuzz_target!(|data: &[u8]| {
    let _ = CandidateList::decode(data);
    if let Ok(identity) = Identity::parse(TEST_IDENTITY) {
        let _ = decrypt(data, Opener::Identity(&identity));
    }
    if let Ok(text) = std::str::from_utf8(data) {
        let _ = Identity::parse(text);
        let _ = Recipient::parse(text);
    }
});
