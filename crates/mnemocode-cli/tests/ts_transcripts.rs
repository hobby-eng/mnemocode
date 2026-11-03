//! The command line against MnemoCode TS 0.1.0 (RUST-14, CORE-33): every command that the TS
//! repository's `scripts/rust-parity/transcripts.mjs` ran on public inputs, run again, standard
//! output, standard error and the exit status the same byte for byte.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![expect(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "the test writes its public inputs to a folder of its own and runs the program there"
)]

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

const RECORDED: &str = include_str!("../../../vectors/ts-0.1.0/transcripts-v1.json");

/// What TS's help says that differs here, each by a decision of PLAN.md's "Parity with TS 0.1.0":
/// images need no other program, a missing folder is made, each text input has its own limit, and
/// re-encode asks the new backup first; the stitch command is new.
const WRITTEN_IN: [(&str, &str); 24] = [
    // The owner's request of 2026-11-03, through the mhfe session: an address names its coins, as
    // every coin whose form it has, and a key's form its Bitcoin profiles; --bitcoin-profile is gone.
    (
        "      --bitcoin-address <ADDRESS>\n          A Bitcoin address of the wallet, one of the --scan-gap from the\n          selected place.\n\n      --coin-address <ADDRESS>\n          An address of another coin, one of the --scan-gap from the place, with\n          --coin.\n\n          Single-key receiving addresses of the coins of mhfe, on their standard\n          paths: Bitcoin Cash, Cosmos, Dash (also Platform), Dogecoin, Ethereum\n          and EVM networks, Ethereum Classic, Injective, Litecoin, Tron, XRP and\n          Zcash (transparent). The address tells its type and network.\n\n      --coin <ID>\n          The coin of --coin-address, such as ethereum, litecoin or\n          bitcoin-cash.\n\n",
        "      --bitcoin-address <ADDRESS>\n          A Bitcoin address of the wallet, one of the --scan-gap from the\n          selected place.\n\n          Its form names its path: 1… BIP44, 3… BIP49, bc1q… BIP84 and bc1p…\n          BIP86.\n\n      --coin-address <ADDRESS>\n          An address of the wallet, of any coin, one of the --scan-gap from the\n          place.\n\n          Single-key receiving addresses on their standard paths: Bitcoin,\n          Bitcoin Cash, Cosmos, Dash (also Platform), Dogecoin, Ethereum and EVM\n          networks, Ethereum Classic, Injective, Litecoin, Tron, XRP and Zcash\n          (transparent). The address tells its coin, type and network. Where\n          coins share a form, as 1…, 3… and 0x… do, the paths of each are\n          searched.\n\n      --coin <ID>\n          Read --coin-address as this coin's alone, such as ethereum or\n          bitcoin-cash.\n\n",
    ),
    (
        "          The same forms as --master-xpub are accepted.\n\n      --compressed-public-key <HEX>\n          A 33-byte compressed public key, one of the --scan-gap from the\n          selected place.\n\n",
        "          The same forms as --master-xpub are accepted. A ypub or upub is looked\n          for at BIP49, a zpub or vpub at BIP84; any other form at BIP44, BIP49,\n          BIP84 and BIP86.\n\n      --compressed-public-key <HEX>\n          A 33-byte compressed public key, one of the --scan-gap from the\n          selected place.\n\n          It is looked for at BIP44, BIP49, BIP84 and BIP86, as a WIF is.\n\n",
    ),
    (
        "      --bitcoin-profile <NAME>\n          auto (default), or a comma-separated list of address types.\n\n          The types are legacy (BIP44), nested-segwit (BIP49), native-segwit\n          (BIP84) and taproot (BIP86), such as native-segwit,taproot, each named\n          once. auto tries all four at the selected place.\n\n",
        "",
    ),
    (
        "      --coin-address <ADDRESS>     An address of another coin, one of the\n                                   --scan-gap from the place, with --coin\n      --coin <ID>                  The coin of --coin-address, such as ethereum,\n                                   litecoin or bitcoin-cash\n",
        "      --coin-address <ADDRESS>     An address of the wallet, of any coin, one of\n                                   the --scan-gap from the place\n      --coin <ID>                  Read --coin-address as this coin's alone,\n                                   such as ethereum or bitcoin-cash\n",
    ),
    (
        "      --bitcoin-profile <NAME>     auto (default), or a comma-separated list of\n                                   address types\n",
        "",
    ),
    (
        "    --dates-file date-patterns.txt \\\n    --bitcoin-address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu \\\n    --bitcoin-profile native-segwit\n",
        "    --dates-file date-patterns.txt \\\n    --coin-address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu\n",
    ),
    // The owner's SeedStitch of 2026-11-03 (ADR 0010): a command TS does not have.
    (
        "  sskr-export   Print existing Shamir shares as cards\n  preview",
        "  sskr-export   Print existing Shamir shares as cards\n  stitch        Hide a phrase in the legend of a cross-stitch pattern\n  preview",
    ),
    // The owner's corrections of 2026-11-02 (PLAN.md, parity).
    (
        "Standard input must be the terminal; without one, or in a terminal\n          that says TERM=dumb, the command stops at once. Output sent to a file\n          goes there as before.",
        "Standard input and standard error must be the terminal; without them,\n          or in a terminal that says TERM=dumb, the command stops at once.\n          Output sent to a file goes there as before.",
    ),
    (
        "pixels on a side and 8 megapixels",
        "pixels on a side and 2 megapixels",
    ),
    (
        "Needs the Poppler program pdftocairo; PDF files do not. Pages are\n          drawn at 300 dpi. If pdftocairo is missing, MnemoCode says so before\n          it asks for a secret.",
        "Pages are drawn at 300 dpi.",
    ),
    (
        "The file is written into a folder that already exists.",
        "A folder of its path that is missing is made.",
    ),
    (
        "With --ask-secrets the codes are asked first, then at once their dates, then the\nphrase is shown to confirm; only then, unless options give it, the new backup is\nasked, with the questions of Encode in the menu. A backup of the original\nSeedshift with a valid last word keeps nothing of the original last word: give\nit, as you remember it.",
        "With --ask-secrets the new backup is asked first, with the questions of Encode\nin the menu, unless options give it; then the codes, then at once their dates,\nthen the phrase is shown to confirm. A backup of the original Seedshift with a\nvalid last word keeps nothing of the original last word: give it, as you\nremember it.",
    ),
    (
        "(else --ask-secrets asks for it once the phrase is confirmed):",
        "(else --ask-secrets asks for it first):",
    ),
    (
        "Text input may be up to 1 MiB.",
        "The file may be up to 256 bytes.",
    ),
    (
        "Read dates from a local UTF-8 file; - reads standard input.\n",
        "Read dates from a local UTF-8 file; - reads standard input.\n\n          The file may be up to 128 bytes.\n",
    ),
    (
        "Read dates with ? for forgotten digits from a file or -.\n",
        "Read dates with ? for forgotten digits from a file or -.\n\n          The file may be up to 4 KiB.\n",
    ),
    (
        "Read the old backup's dates from a file or -.\n",
        "Read the old backup's dates from a file or -.\n\n          The file may be up to 128 bytes.\n",
    ),
    (
        "Read the encoded record from a file; - reads standard input.\n",
        "Read the encoded record from a file; - reads standard input.\n\n          The file may be up to 64 KiB.\n",
    ),
    (
        "A private key in WIF form, read from a protected local file.\n",
        "A private key in WIF form, read from a protected local file.\n\n          The file may be up to 64 bytes.\n",
    ),
    (
        "The BIP39 passphrase of the wallet, if it has one; the file is secret.\n",
        "The BIP39 passphrase of the wallet, if it has one; the file is secret.\n\n          The file may be up to 4 KiB.\n",
    ),
    (
        "A file of shares, one per line or with ; between them; may be\n          repeated.\n",
        "A file of shares, one per line or with ; between them; may be\n          repeated.\n\n          Each file may be up to 64 KiB.\n",
    ),
    (
        "Encrypt the list with a passphrase of 12 characters or more, read from\n          a file.\n",
        "Encrypt the list with a passphrase of 12 characters or more, read from\n          a file.\n\n          The file may be up to 4 KiB.\n",
    ),
    (
        "The same key, read from a text file.\n",
        "The same key, read from a text file.\n\n          The file may be up to 4 KiB.\n",
    ),
    (
        "Read the original final word for seedshift-legacy-valid from a file or\n          -.\n",
        "Read the original final word for seedshift-legacy-valid from a file or\n          -.\n\n          The file may be up to 256 bytes.\n",
    ),
];

/// The anchors of the warnings about the machine itself, which the one that recorded TS did not
/// give: swap that is not encrypted, and memory that the system did not lock.
const MACHINE_WARNINGS: [&str; 2] = ["#unencrypted-swap", "#memory-lock"];

/// Standard error without the warnings about the machine that runs the test, each with its
/// "More:" line, as a CI runner gives them; what the command itself writes stays.
fn without_machine_warnings(text: &str) -> String {
    let mut kept = Vec::new();
    let mut lines = text.split_inclusive('\n').peekable();
    while let Some(line) = lines.next() {
        let next = lines.peek().map_or("", |next| next.trim_end());
        if next.starts_with("More: ")
            && MACHINE_WARNINGS.iter().any(|anchor| next.ends_with(anchor))
        {
            lines.next();
            continue;
        }
        kept.push(line);
    }
    kept.concat()
}

/// What TS wrote for `args`, with this program's version in place of TS's own and the differences
/// written in; recover-word's phrase may be a pattern, which has a limit of its own.
fn expected(args: &[&str], text: &str) -> String {
    let version = env!("CARGO_PKG_VERSION");
    let mut text = text
        .replace("MnemoCode 0.1.0", &format!("MnemoCode {version}"))
        .replace("mnemocode 0.1.0", &format!("mnemocode {version}"));
    if args.contains(&"recover-word") {
        text = text.replace(
            "Text input may be up to 1 MiB.",
            "The file may be up to 32 KiB.",
        );
    }
    for (recorded, written) in WRITTEN_IN {
        text = text.replace(recorded, written);
    }
    text
}

#[test]
fn every_command_writes_what_ts_writes() {
    let recorded: Value = serde_json::from_str(RECORDED).expect("the recorded file is JSON");
    let folder = Path::new(env!("CARGO_TARGET_TMPDIR")).join("transcripts");
    // The commands that save need their names free, as they were for TS, on every run.
    let _absent = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).expect("a folder");
    for (name, text) in recorded["files"].as_object().expect("the files") {
        let text = text.as_str().expect("a text");
        fs::write(folder.join(name), text).expect("a file");
    }
    for entry in recorded["commands"].as_array().expect("the commands") {
        let args: Vec<&str> = entry["args"]
            .as_array()
            .expect("the arguments")
            .iter()
            .map(|argument| argument.as_str().expect("an argument"))
            .collect();
        let output = Command::new(env!("CARGO_BIN_EXE_mnemocode"))
            .args(&args)
            .current_dir(&folder)
            .stdin(Stdio::null())
            .output()
            .expect("the program runs");
        let name = args.join(" ");
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            expected(&args, entry["stdout"].as_str().expect("standard output")),
            "{name}"
        );
        assert_eq!(
            without_machine_warnings(&String::from_utf8_lossy(&output.stderr)),
            entry["stderr"].as_str().expect("standard error"),
            "{name}"
        );
        assert_eq!(
            output.status.code().map(i64::from),
            entry["status"].as_i64(),
            "{name}"
        );
    }
}
