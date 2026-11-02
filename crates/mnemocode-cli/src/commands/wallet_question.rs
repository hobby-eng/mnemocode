//! The question how MnemoCode can recognise a wallet, asked on the private screen (MnemoCode TS
//! 0.1.0's `cli/wallet-question.ts`): its master fingerprint, or one of its first receiving
//! addresses, of any coin, each checked at once and asked again until it can be used, or "It
//! cannot" where the mode can list candidates without the wallet.

use mnemocode::text::numbers::typed_whole_number;
use mnemocode::wallet::coins::{AddressLocation, COINS, Coin};
use mnemocode::wallet::evidence::{Evidence, Place, parse_master_fingerprint};
use mnemocode::wallet::scan::{ADDRESS_COUNT_RANGE, address_count, default_address_count};

use super::asking::value_until;
use super::given::PATH_LIMIT;
use super::wallet_options::AskedEvidence;
use crate::args::option_label;
use crate::gate::Stop;
use crate::terminal::{Choice, Chosen, Explanation, LineQuestion, ListQuestion, ask_line, choose};

/// The answer that asks for another wallet in place of one given, with `value`.
pub(crate) fn change_wallet_answer<T>(value: T) -> Choice<T> {
    Choice::noted("Change the wallet", "the fingerprint or the address", value)
}

/// The answer that asks for the wallet to check candidates against, `note` saying what follows.
pub(crate) fn check_wallet_answer<T>(value: T, note: &str) -> Choice<T> {
    Choice::noted("Check them against the wallet", note, value)
}

/// The wallet as the question was told it.
#[derive(Debug)]
pub(crate) enum WalletAnswer {
    Wallet(AskedEvidence),
    /// "It cannot": every checksum-valid candidate is listed.
    None,
    /// Escape at the first question.
    Back,
}

/// Where an address is looked for, in the words of the questions.
struct AddressWords {
    note: String,
    prompt: String,
    what: String,
}

fn first_receiving(location: AddressLocation) -> bool {
    location.account == 0 && location.branch == 0 && location.index == 0
}

/// The place of an address as the questions name it, from the account on.
fn place_path(location: AddressLocation) -> String {
    let account = if first_receiving(location) {
        String::new()
    } else {
        format!("{}'/", location.account)
    };
    format!("m/.../{account}{}/{}", location.branch, location.index)
}

/// The words for an address at `location`, or among `addresses` of them from there.
fn address_words(location: AddressLocation, addresses: Option<u64>) -> AddressWords {
    let first = first_receiving(location);
    let path = place_path(location);
    if addresses == Some(1) {
        return if first {
            AddressWords {
                note: format!("its first receiving address, {path}"),
                prompt: "the first receiving one".to_owned(),
                what: "the wallet's first receiving address".to_owned(),
            }
        } else {
            AddressWords {
                note: format!("its address at {path}"),
                prompt: path.clone(),
                what: format!("the wallet's address at {path}"),
            }
        };
    }
    let count = addresses.map_or_else(String::new, |count| format!("{count} "));
    if first {
        return AddressWords {
            note: format!("one of its first {count}receiving addresses"),
            prompt: format!("one of the first {count}receiving ones"),
            what: "a receiving address of the wallet".to_owned(),
        };
    }
    AddressWords {
        note: format!("one of its {count}addresses from {path}"),
        prompt: format!("one of the {count}addresses from {path}"),
        what: format!("an address of the wallet from {path}"),
    }
}

/// How a front end asks the typed values of the question.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Asker {
    /// On the private screen: each value until it can be used; back goes to the list.
    Screen,
    /// In the menu, whose record keeps each answer: going back leaves the question.
    Menu,
}

/// One typed value of the question.
struct Value<'a> {
    prompt: &'a str,
    what: &'a str,
    /// Its line in the menu's record of answers.
    label: &'a str,
    fallback: Option<&'a str>,
}

impl Asker {
    /// Asks `value` until `parse` takes it; none when the person goes back.
    fn ask<T, E: std::fmt::Display>(
        self,
        value: &Value<'_>,
        mut parse: impl FnMut(&str) -> Result<T, E>,
    ) -> Result<Option<T>, Stop> {
        if self == Self::Screen {
            let prompt = value.fallback.map_or_else(
                || format!("{}:", value.prompt),
                |fallback| format!("{} (Enter: {fallback}):", value.prompt),
            );
            return value_until(&prompt, value.what, PATH_LIMIT, value.fallback, parse);
        }
        let how = LineQuestion {
            fallback: value.fallback,
            what: Some(value.what),
            limit: PATH_LIMIT,
            ..LineQuestion::default()
        };
        let mut parsed = None;
        let answer = ask_line(value.prompt, value.label, how, |answer: &str| {
            parsed = Some(parse(answer)?);
            Ok::<_, E>(answer.to_owned())
        })?;
        match answer {
            Chosen::One(_) => Ok(parsed),
            Chosen::Back => Ok(None),
            Chosen::Cancelled => Err(Stop::Cancelled),
        }
    }
}

/// How the wallet can be recognised.
#[derive(Clone, Copy)]
enum Way {
    Fingerprint,
    Address,
    None,
}

/// The coins of the way "Address": the first by name, and how many more.
fn coins_note() -> String {
    let named: Vec<&str> = COINS.iter().take(3).map(|coin| coin.name).collect();
    format!("{} and {} more coins", named.join(", "), COINS.len() - 3)
}

/// Asks among how many addresses from `place` the address typed is, Enter for the count that fits
/// from there; none when the person goes back.
fn ask_address_count(place: &Place, asker: Asker) -> Result<Option<u64>, Stop> {
    let location = place.location;
    let from = if first_receiving(location) {
        "the first".to_owned()
    } else {
        place_path(location)
    };
    let fallback = default_address_count(location.index).to_string();
    let prompt = format!("Compare with how many addresses from {from}");
    let value = Value {
        prompt: &prompt,
        what: "how many addresses",
        label: "Addresses",
        fallback: Some(&fallback),
    };
    asker.ask(&value, |answer: &str| {
        let count = typed_whole_number(answer, ADDRESS_COUNT_RANGE, None)
            .map_err(|refused| refused.to_string())?;
        address_count(Some(count), u64::from(location.index))
            .map(u64::from)
            .map_err(|refused| refused.to_string())
    })
}

/// How many addresses from `place` the evidence of an address is compared with, as `place` says,
/// or as the person says after it; none when they go back.
fn counted_addresses(place: &Place, asker: Asker) -> Result<Option<u64>, Stop> {
    place
        .addresses
        .map_or_else(|| ask_address_count(place, asker), |count| Ok(Some(count)))
}

/// Asks which coin the address is for, then its address at `place`, each asked until it is one of
/// that coin; none when the person goes back.
fn ask_address(
    place: &Place,
    words: &AddressWords,
    asker: Asker,
) -> Result<Option<AskedEvidence>, Stop> {
    let coins: Vec<Choice<&'static Coin>> = COINS
        .iter()
        .map(|coin| {
            Choice::noted(
                coin.name,
                coin.address_forms_on(place.network.testnet()),
                *coin,
            )
        })
        .collect();
    let asked = ListQuestion {
        question: "Which coin is the address for?",
        label: "Coin",
        quit: "goes back",
        explanation: None,
    };
    let coin = match choose(&asked, None, &coins)? {
        Chosen::One(coin) => coin,
        Chosen::Back => return Ok(None),
        Chosen::Cancelled => return Err(Stop::Cancelled),
    };
    let bitcoin = coin.id == "bitcoin";
    let (prompt, what) = if bitcoin {
        (
            format!("Bitcoin address ({})", words.prompt),
            words.what.clone(),
        )
    } else {
        (
            format!("Address ({}, {})", coin.name, words.prompt),
            format!("the wallet's address of {}", coin.name),
        )
    };
    let counted = |text: &str, count: Option<u64>| -> Result<Evidence, Stop> {
        if bitcoin {
            let at = Place {
                addresses: count,
                ..place.clone()
            };
            Ok(Evidence::bitcoin_address(text, at)?)
        } else {
            Ok(Evidence::coin_address(coin, text, place.location, count)?)
        }
    };
    // An address is read once to be refused at once, then again with its count, as the coin
    // writes it.
    let read = |answer: &str| {
        counted(answer, Some(1))
            .and_then(|_| Ok(coin.parse(answer)?.text))
            .map_err(|stop| stop.message())
    };
    let value = Value {
        prompt: &prompt,
        what: &what,
        label: "Address",
        fallback: None,
    };
    let Some(text) = asker.ask(&value, read)? else {
        return Ok(None);
    };
    let Some(count) = counted_addresses(place, asker)? else {
        return Ok(None);
    };
    let evidence = counted(&text, Some(count))?;
    let label = if bitcoin {
        option_label("address").to_owned()
    } else {
        format!("address of {}", coin.name)
    };
    let mut options = if bitcoin {
        vec!["--bitcoin-address".to_owned(), text]
    } else {
        vec![
            "--coin".to_owned(),
            coin.id.to_owned(),
            "--coin-address".to_owned(),
            text,
        ]
    };
    options.extend(["--scan-gap".to_owned(), count.to_string()]);
    Ok(Some(AskedEvidence {
        evidence,
        label,
        fingerprint: false,
        options,
    }))
}

/// Asks the master fingerprint; none when the person goes back.
fn ask_fingerprint(asker: Asker) -> Result<Option<AskedEvidence>, Stop> {
    let value = Value {
        prompt: "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one)",
        what: "the eight characters of the fingerprint",
        label: "Fingerprint",
        fallback: None,
    };
    let typed = asker.ask(&value, |answer: &str| {
        let fingerprint = parse_master_fingerprint(answer)?;
        Evidence::master_fingerprint(&fingerprint).map(|evidence| (evidence, fingerprint))
    })?;
    Ok(typed.map(|(evidence, answer)| AskedEvidence {
        evidence,
        label: option_label("master-fingerprint").to_owned(),
        fingerprint: true,
        options: vec!["--master-fingerprint".to_owned(), answer],
    }))
}

/// Asks how the wallet can be recognised; going back from a value goes back to the list.
pub(crate) fn ask_wallet_evidence(
    optional: bool,
    explanation: Option<&Explanation>,
    place: &Place,
) -> Result<WalletAnswer, Stop> {
    ask_wallet_evidence_by(Asker::Screen, optional, explanation, place)
}

/// [`ask_wallet_evidence`] as `asker` asks its typed values.
pub(crate) fn ask_wallet_evidence_by(
    asker: Asker,
    optional: bool,
    explanation: Option<&Explanation>,
    place: &Place,
) -> Result<WalletAnswer, Stop> {
    let words = address_words(place.location, place.addresses);
    let mut ways = vec![
        Choice::noted(
            "Fingerprint",
            "Encode's Original, not the Encoded",
            Way::Fingerprint,
        ),
        Choice {
            example: Some(coins_note()),
            ..Choice::noted("Address", &words.note, Way::Address)
        },
    ];
    if optional {
        ways.push(Choice::noted(
            "It cannot",
            "list every candidate instead",
            Way::None,
        ));
    }
    let asked = ListQuestion {
        question: "How can MnemoCode recognise the wallet?",
        label: "Wallet",
        quit: "goes back",
        explanation,
    };
    loop {
        let typed = match choose(&asked, None, &ways)? {
            Chosen::Cancelled => return Err(Stop::Cancelled),
            Chosen::Back => return Ok(WalletAnswer::Back),
            Chosen::One(Way::None) => return Ok(WalletAnswer::None),
            Chosen::One(Way::Fingerprint) => ask_fingerprint(asker)?,
            Chosen::One(Way::Address) => ask_address(place, &words, asker)?,
        };
        if let Some(evidence) = typed {
            return Ok(WalletAnswer::Wallet(evidence));
        }
        if asker == Asker::Menu {
            return Ok(WalletAnswer::Back);
        }
    }
}
