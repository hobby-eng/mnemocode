//! The questions of a command after a failure and for a value (MnemoCode TS 0.1.0's `cli/ask.ts`):
//! what to do next after something that no new answer to the same question mends, chosen from a
//! list whose last entry must stop or change nothing, since Escape picks it.

use crate::gate::Stop;
use crate::input::{Ask, Left, ask_until, assert_terminal, value_ask};
use crate::terminal::{Choice, Chosen, Explanation, ListQuestion, choose};

/// The question after a failure, where nothing more particular is asked.
pub(crate) const WHAT_NOW: &str = "What now?";

/// What a question after a failure shows besides its choices.
#[derive(Clone, Copy, Debug)]
pub(crate) struct AfterFailure<'a> {
    /// Its line in the record of answers.
    pub(crate) label: &'a str,
    /// What Escape does, in the key hint.
    pub(crate) escape: &'a str,
    pub(crate) explanation: Option<&'a Explanation>,
}

impl Default for AfterFailure<'_> {
    fn default() -> Self {
        Self {
            label: "Next",
            escape: "stops",
            explanation: None,
        }
    }
}

/// Asks what to do after a failure; Escape picks the last choice.
pub(crate) fn after_failure<T: Clone>(
    question: &str,
    choices: &[Choice<T>],
    how: AfterFailure<'_>,
) -> Result<T, Stop> {
    assert_terminal()?;
    let asked = ListQuestion {
        question,
        label: how.label,
        quit: how.escape,
        explanation: how.explanation,
    };
    match choose(&asked, None, choices)? {
        Chosen::One(value) => Ok(value),
        Chosen::Back => Ok(choices[choices.len() - 1].value.clone()),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// What a question asks of a list, Escape going back.
pub(crate) fn ask_list<T: Clone>(
    question: &str,
    label: &str,
    choices: &[Choice<T>],
    explanation: Option<&Explanation>,
) -> Result<Option<T>, Stop> {
    ask_warned(question, label, choices, explanation, None)
}

/// As [`ask_list`], with `warning` above the question.
pub(crate) fn ask_warned<T: Clone>(
    question: &str,
    label: &str,
    choices: &[Choice<T>],
    explanation: Option<&Explanation>,
    warning: Option<&str>,
) -> Result<Option<T>, Stop> {
    let asked = ListQuestion {
        question,
        label,
        quit: "goes back",
        explanation,
    };
    match choose(&asked, warning, choices)? {
        Chosen::One(value) => Ok(Some(value)),
        Chosen::Back => Ok(None),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// `choices`, each value in `Some`, with "Stop" after them.
fn with_stop<T: Clone>(choices: &[Choice<T>]) -> Vec<Choice<Option<T>>> {
    let mut all: Vec<Choice<Option<T>>> = choices
        .iter()
        .map(|choice| Choice {
            label: choice.label.clone(),
            note: choice.note.clone(),
            example: choice.example.clone(),
            digit: choice.digit,
            value: Some(choice.value.clone()),
        })
        .collect();
    all.push(Choice::new("Stop", None));
    all
}

/// Asks what to do with "Stop" as the last entry, which cancels; with `back`, Escape goes back
/// (none) instead of picking Stop.
pub(crate) fn or_back_or_cancel<T: Clone>(
    question: &str,
    choices: &[Choice<T>],
    back: bool,
) -> Result<Option<T>, Stop> {
    assert_terminal()?;
    let asked = ListQuestion {
        question,
        label: "Next",
        quit: if back { "goes back" } else { "stops" },
        explanation: None,
    };
    match choose(&asked, None, &with_stop(choices))? {
        Chosen::One(Some(value)) => Ok(Some(value)),
        Chosen::Back if back => Ok(None),
        Chosen::One(None) | Chosen::Back | Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// Asks with "Stop" as the last entry, which cancels, as Escape does.
pub(crate) fn ask_or_stop<T: Clone>(
    question: &str,
    label: &str,
    choices: &[Choice<T>],
    explanation: Option<&Explanation>,
) -> Result<T, Stop> {
    assert_terminal()?;
    let asked = ListQuestion {
        question,
        label,
        quit: "stops",
        explanation,
    };
    match choose(&asked, None, &with_stop(choices))? {
        Chosen::One(Some(value)) => Ok(value),
        Chosen::One(None) | Chosen::Back | Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// Asks for a secret until `parse` accepts the answer.
pub(crate) fn secret_until<T, E: std::fmt::Display>(
    ask: &Ask<'_>,
    parse: impl FnMut(&str) -> Result<T, E>,
) -> Result<T, Stop> {
    ask_until(ask, true, parse)?.map_err(|_| Stop::Cancelled)
}

/// Asks for a visible value until `parse` accepts it; Enter alone gives `fallback`, where there is
/// one; none when the person goes back with Escape.
pub(crate) fn value_until<T, E: std::fmt::Display>(
    prompt: &str,
    what: &str,
    limit: usize,
    fallback: Option<&str>,
    parse: impl FnMut(&str) -> Result<T, E>,
) -> Result<Option<T>, Stop> {
    let ask = Ask {
        fallback: fallback.map(str::to_owned),
        ..value_ask(prompt, what, limit)
    };
    match ask_until(&ask, false, parse)? {
        Ok(value) => Ok(Some(value)),
        Err(Left::Back) => Ok(None),
        Err(Left::Cancelled) => Err(Stop::Cancelled),
    }
}
