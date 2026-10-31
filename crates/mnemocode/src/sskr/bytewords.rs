//! The 256 Bytewords of Blockchain Commons (BCR-2020-012), each the word of the byte of its place:
//! the words of a share's standard Bytewords, and their first and last letters the minimal
//! Bytewords of its compact UR. Copyright Blockchain Commons, BSD-2-Clause-Patent; the list is
//! MnemoCode TS 0.1.0's `src/sskr/bytewords-list.ts`, which bc-ur 0.19.2 holds too.

/// The words, in the order of their bytes.
pub const BYTEWORDS: [&str; 256] = [
    "able", "acid", "also", "apex", "aqua", "arch", "atom", "aunt", "away", "axis", "back", "bald",
    "barn", "belt", "beta", "bias", "blue", "body", "brag", "brew", "bulb", "buzz", "calm", "cash",
    "cats", "chef", "city", "claw", "code", "cola", "cook", "cost", "crux", "curl", "cusp", "cyan",
    "dark", "data", "days", "deli", "dice", "diet", "door", "down", "draw", "drop", "drum", "dull",
    "duty", "each", "easy", "echo", "edge", "epic", "even", "exam", "exit", "eyes", "fact", "fair",
    "fern", "figs", "film", "fish", "fizz", "flap", "flew", "flux", "foxy", "free", "frog", "fuel",
    "fund", "gala", "game", "gear", "gems", "gift", "girl", "glow", "good", "gray", "grim", "guru",
    "gush", "gyro", "half", "hang", "hard", "hawk", "heat", "help", "high", "hill", "holy", "hope",
    "horn", "huts", "iced", "idea", "idle", "inch", "inky", "into", "iris", "iron", "item", "jade",
    "jazz", "join", "jolt", "jowl", "judo", "jugs", "jump", "junk", "jury", "keep", "keno", "kept",
    "keys", "kick", "kiln", "king", "kite", "kiwi", "knob", "lamb", "lava", "lazy", "leaf", "legs",
    "liar", "limp", "lion", "list", "logo", "loud", "love", "luau", "luck", "lung", "main", "many",
    "math", "maze", "memo", "menu", "meow", "mild", "mint", "miss", "monk", "nail", "navy", "need",
    "news", "next", "noon", "note", "numb", "obey", "oboe", "omit", "onyx", "open", "oval", "owls",
    "paid", "part", "peck", "play", "plus", "poem", "pool", "pose", "puff", "puma", "purr", "quad",
    "quiz", "race", "ramp", "real", "redo", "rich", "road", "rock", "roof", "ruby", "ruin", "runs",
    "rust", "safe", "saga", "scar", "sets", "silk", "skew", "slot", "soap", "solo", "song", "stub",
    "surf", "swan", "taco", "task", "taxi", "tent", "tied", "time", "tiny", "toil", "tomb", "toys",
    "trip", "tuna", "twin", "ugly", "undo", "unit", "urge", "user", "vast", "very", "veto", "vial",
    "vibe", "view", "visa", "void", "vows", "wall", "wand", "warm", "wasp", "wave", "waxy", "webs",
    "what", "when", "whiz", "wolf", "work", "yank", "yawn", "yell", "yoga", "yurt", "zaps", "zero",
    "zest", "zinc", "zone", "zoom",
];

/// The byte of the whole `word`, or of its first and last letters in `minimal`; none for any other
/// text.
pub fn byte_of(word: &[u8], minimal: bool) -> Option<u8> {
    BYTEWORDS
        .iter()
        .position(|candidate| {
            let letters = candidate.as_bytes();
            if minimal {
                word.len() == 2 && letters.first() == word.first() && letters.last() == word.last()
            } else {
                letters == word
            }
        })
        .and_then(|index| u8::try_from(index).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_word_and_its_minimal_letters_name_their_byte() {
        // The published ends of the list; its words are checked whole against the BCR-2020-011
        // share of vectors/sskr-v1.json (sskr::text).
        assert_eq!((BYTEWORDS[0], BYTEWORDS[255]), ("able", "zoom"));
        assert_eq!(byte_of(b"zm", true), Some(255));
        assert_eq!(byte_of(b"able", false), Some(0));
        assert_eq!(byte_of(b"abl", false), None);
        assert_eq!(byte_of(b"zz", true), None);
    }
}
