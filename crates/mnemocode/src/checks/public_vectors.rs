//! The public vectors of MnemoCode v1 (vectors/mnemocode-v1.json, its `vectors`), compiled in: each
//! phrase, its mode and dates, its codes in every form and, where given, the master fingerprints of
//! the phrase and of its codes. `tests/public_vectors.rs` holds this table equal to the file.

use crate::modes::Mode;

/// One public vector.
#[derive(Debug)]
pub struct PublicVector {
    /// Its name in the file.
    pub name: &'static str,
    /// The mode its codes are in.
    pub mode: Mode,
    /// The phrase.
    pub source: &'static str,
    /// The dates, DD-MM-YYYY.
    pub dates: &'static [&'static str],
    /// The codes in English words.
    pub english: &'static str,
    /// The codes in word numbers.
    pub indexes: &'static str,
    /// The codes in Unicode codes.
    pub unicode: &'static str,
    /// The codes in colours.
    pub colors: &'static str,
    /// The codes in Color Unicode.
    pub colors_unicode: &'static str,
    /// The master fingerprint of the phrase with no passphrase.
    pub source_fingerprint: Option<&'static str>,
    /// The master fingerprint of the codes read as a phrase.
    pub encoded_fingerprint: Option<&'static str>,
}

/// The vectors, in the file's order.
pub const PUBLIC_VECTORS: [PublicVector; 7] = [
    PublicVector {
        name: "direct-12",
        mode: Mode::Direct,
        source: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        dates: &[],
        english: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        indexes: "1 1 1 1 1 1 1 1 1 1 1 4",
        unicode: "768476847684768476847684768476847684768476845728",
        colors: "#000064 #1EAB91 #3D0964 #5BB491 #7A1264 #98BD91 #B71B64 #D5C694",
        colors_unicode: "E000E064E13AE191E271E064E3ABE191E4E2E064E61CE191E753E064E88DE194",
        source_fingerprint: Some("73c5da0a"),
        encoded_fingerprint: Some("73c5da0a"),
    },
    PublicVector {
        name: "checksum-valid-seedshift-12",
        mode: Mode::Seedshift,
        source: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        dates: &["23-09-2026"],
        english: "wool abuse actual wool abuse actual wool abuse actual wool abuse congress",
        indexes: "2027 10 24 2027 10 24 2027 10 24 2027 10 377",
        unicode: "8F44901950118F44901950118F44901950118F4490194E14",
        colors: "#0317CC #200B38 #4020CC #5D1438 #7D29CC #9A1D38 #BA32CC #D72799",
        colors_unicode: "E01FF0CCE148E338E290F0CCE3B9E338E501F0CCE62AE338E772F0CCE89BE499",
        source_fingerprint: None,
        encoded_fingerprint: None,
    },
    PublicVector {
        name: "checksum-valid-seedshift-15",
        mode: Mode::Seedshift,
        source: "abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math exhibit",
        dates: &["07-11-1951", "08-08-1988", "23-09-2026"],
        english: "view annual like above fabric afraid buddy carbon assume february eager business wet meat horror",
        indexes: "1952 76 1038 5 652 37 236 276 112 675 552 249 1997 1105 878",
        unicode: "76E75982659C4E0D8DD14E3B68396D77517696D9614B5E795BBF91CE8CB7",
        colors: "#02FA80 #1ADF0E #1E867A #35B625 #3D6532 #57E470 #5C9531 #72BFF9 #7D1E1F #8A1AFE",
        colors_unicode: "E01EEC80E113E40EE138EE7AE226E025E274F132E384E070E3B4E131E497E0F9E501E51FE586E4FE",
        source_fingerprint: None,
        encoded_fingerprint: None,
    },
    PublicVector {
        name: "checksum-valid-seedshift-18",
        mode: Mode::Seedshift,
        source: "abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rib",
        dates: &["07-11-1951", "08-08-1988", "23-09-2026"],
        english: "view annual like above fabric afraid buddy carbon assume february eager business wet meat essence lend blame island",
        indexes: "1952 76 1038 5 652 37 236 276 112 675 552 249 1997 1105 619 1024 186 948",
        unicode: "76E75982659C4E0D8DD14E3B68396D77517696D9614B5E795BBF91CE4F547ADF984C71C8",
        colors: "#02FA80 #1ADF0E #1E867A #35B625 #3D6532 #57E470 #5C9531 #72BFF9 #7D1E1F #8A19FB #9A2681 #B4FBD4",
        colors_unicode: "E01EEC80E113E40EE138EE7AE226E025E274F132E384E070E3B4E131E497E0F9E501E51FE586E3FBE62AEC81E73DE6D4",
        source_fingerprint: None,
        encoded_fingerprint: None,
    },
    PublicVector {
        name: "checksum-valid-seedshift-21",
        mode: Mode::Seedshift,
        source: "abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch saddle",
        dates: &["07-11-1951", "08-08-1988", "23-09-2026"],
        english: "view annual like above fabric afraid buddy carbon assume february eager business wet meat essence lend blame roof when culture canyon",
        indexes: "1952 76 1038 5 652 37 236 276 112 675 552 249 1997 1105 619 1024 186 1502 2002 429 271",
        unicode: "76E75982659C4E0D8DD14E3B68396D77517696D9614B5E795BBF91CE4F547ADF984C796588D55E02767E",
        colors: "#02FA80 #1ADF0E #1E867A #35B625 #3D6532 #57E470 #5C9531 #72BFF9 #7D1E1F #8A19FB #9A2681 #B4FDFE #BA290C #CACB1F",
        colors_unicode: "E01EEC80E113E40EE138EE7AE226E025E274F132E384E070E3B4E131E497E0F9E501E51FE586E3FBE62AEC81E73DE8FEE772E70CE81CEF1F",
        source_fingerprint: None,
        encoded_fingerprint: None,
    },
    PublicVector {
        name: "checksum-valid-seedshift-24",
        mode: Mode::Seedshift,
        source: "abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware",
        dates: &["07-11-1951", "08-08-1988", "23-09-2026"],
        english: "view annual like above fabric afraid buddy carbon assume february eager business wet meat essence lend blame roof when culture razor alpha just vehicle",
        indexes: "1952 76 1038 5 652 37 236 276 112 675 552 249 1997 1105 619 1024 186 1502 2002 429 1430 57 972 1936",
        unicode: "76E75982659C4E0D8DD14E3B68396D77517696D9614B5E795BBF91CE4F547ADF984C796588D55E026885884C82D7614C",
        colors: "#02FA80 #1ADF0E #1E867A #35B625 #3D6532 #57E470 #5C9531 #72BFF9 #7D1E1F #8A19FB #9A2681 #B4FDFE #BA290C #CACFA6 #D5B5CD #EFE5D0",
        colors_unicode: "E01EEC80E113E40EE138EE7AE226E025E274F132E384E070E3B4E131E497E0F9E501E51FE586E3FBE62AEC81E73DE8FEE772E70CE81CF3A6E88CE9CDE998EDD0",
        source_fingerprint: None,
        encoded_fingerprint: None,
    },
    PublicVector {
        name: "legacy-seedshift-12",
        mode: Mode::SeedshiftLegacy,
        source: "oppose duck hello neglect reveal key humor mosquito road evoke flock hedgehog",
        dates: &["27-04-1956", "10-07-1963", "31-01-1994"],
        english: "mosquito dust hotel maximum rich kitten hair mother salute dream flush hospital",
        indexes: "1153 547 882 1100 1483 987 835 1154 1527 533 719 880",
        unicode: "5BF65B57616272386C2E6FC34E4E534895CA52E2932F4E95",
        colors: "#01C269 #25B3E2 #3EB6BE #683B8B #7B5837 #A0D9D7 #B7EB3B #D88920",
        colors_unicode: "E012E069E182E1E2E282E4BEE42BE88BE4EFE137E66FE2D7E75BE83BE8A9E820",
        source_fingerprint: None,
        encoded_fingerprint: None,
    },
];
