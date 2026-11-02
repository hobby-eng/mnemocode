//! Reads one typed line in raw mode, as MnemoCode TS 0.1.0's `readLine` (`terminal-input.ts`) and
//! mhfe's hidden input: every byte is kept as data except Backspace and Ctrl+U, which delete, Enter,
//! which ends the line, Ctrl+D on an empty line, which ends the input, and Ctrl+C, which cancels. A
//! visible answer is edited as in a shell (the arrows, Home and End, Ctrl with an arrow, Delete,
//! Ctrl+K, Ctrl+W), with hints below it and Tab completing a word where a question takes words of
//! a list. A line break inside a paste may become one separator, so that a paste of several lines
//! is one answer.

#![expect(
    clippy::disallowed_methods,
    reason = "the time since an ignored Escape tells the rest of its key's sequence from text"
)]

use std::time::Instant;

use mnemocode::secret::SecretBytes;

use super::answer::{Hints, TypedAnswer, Unusable};
use super::keys::{
    ESCAPE_DELAY_MS, Interrupted, Keys, PASTE_GAP_MS, edit_after_escape, key, may_be_late_sequence,
    read_late_sequence,
};

/// How a line is read.
pub(crate) struct LineOptions<'h> {
    /// Shows the answer as it is typed and lets the editing keys edit it; otherwise nothing shows.
    pub(crate) echo: bool,
    /// The longest answer in bytes: the question's own limit (the owner's per-question limits).
    pub(crate) limit: usize,
    /// Escape alone goes back, as in the menu; otherwise it does nothing.
    pub(crate) escape_goes_back: bool,
    /// The width of the prompt before the answer, which starts at the left edge.
    pub(crate) prompt_width: usize,
    /// What a line break inside a paste becomes: a space or ";"; without it the line ends there.
    pub(crate) pasted_line_break: Option<u8>,
    /// Hints for the word being typed, shown below a visible answer.
    pub(crate) hints: Option<&'h dyn Hints>,
}

/// What reading a line gave.
pub(crate) enum LineOutcome {
    /// The answer, valid UTF-8, in a locked buffer.
    Answer(SecretBytes),
    /// The input ended before anything was typed.
    Ended,
    /// Escape went back; the row of the cursor after the abandoned answer, counted from the
    /// prompt's first row, so that the caller erases what it wrapped onto.
    Back {
        /// The row of the cursor after it.
        row: usize,
    },
    /// Ctrl+C.
    Cancelled,
    /// The answer cannot be used, and its rest was dropped: asked again with this refusal; the row
    /// of the cursor after what was shown of it.
    Refused {
        /// Why it cannot be used.
        reason: Unusable,
        /// The row of the cursor after it.
        row: usize,
    },
}

/// Reads one line from `keys` as described at the top. A visible answer leaves the cursor just
/// after its end.
pub(crate) fn read_line(
    keys: &mut Keys,
    options: &LineOptions<'_>,
) -> Result<LineOutcome, Interrupted> {
    let mut answer = TypedAnswer::new(
        options.limit,
        options.echo,
        options.prompt_width,
        options.hints,
    );
    match edit(keys, options, &mut answer)? {
        Ok(Some(outcome)) => Ok(outcome),
        Ok(None) => match answer.take() {
            Ok(text) => Ok(LineOutcome::Answer(text)),
            Err(reason) => Ok(LineOutcome::Refused {
                reason,
                row: answer.row_from_prompt(),
            }),
        },
        Err(reason) => {
            if keys.drop_rest_of_paste() {
                return Ok(LineOutcome::Cancelled);
            }
            answer.move_to_end();
            Ok(LineOutcome::Refused {
                reason,
                row: answer.row_from_prompt(),
            })
        }
    }
}

/// Edits `answer` until Enter (`None`), another end of the question, or a refusal while it arrives.
fn edit(
    keys: &mut Keys,
    options: &LineOptions<'_>,
    answer: &mut TypedAnswer<'_>,
) -> Result<Result<Option<LineOutcome>, Unusable>, Interrupted> {
    let echo = options.echo;
    let mut escape_ignored: Option<Instant> = None;
    loop {
        // Drawn once no key follows at once, so that a paste is hinted once, at its end.
        answer.hint_when(|| !keys.more_within(PASTE_GAP_MS));
        let Some(byte) = keys.next()? else {
            if answer.len() == 0 {
                return Ok(Ok(Some(LineOutcome::Ended)));
            }
            break;
        };
        let since = escape_ignored
            .take()
            .map(|at| u32::try_from(at.elapsed().as_millis()).unwrap_or(u32::MAX));
        let late = may_be_late_sequence(byte, since);
        let step = match byte {
            key::CARRIAGE_RETURN | key::LINE_FEED => {
                let Some(separator) = options.pasted_line_break else {
                    break;
                };
                if !keys.more_within(PASTE_GAP_MS) {
                    break;
                }
                // One separator for a run of line breaks, and none at the start or after one typed.
                if answer.cursor() > 0 && answer.before() != Some(separator) {
                    answer.insert(separator)
                } else {
                    Ok(())
                }
            }
            key::CTRL_C => return Ok(Ok(Some(LineOutcome::Cancelled))),
            key::CTRL_D if answer.len() == 0 => return Ok(Ok(Some(LineOutcome::Ended))),
            key::BACKSPACE | key::DELETE | key::CTRL_U => {
                answer.control(byte);
                Ok(())
            }
            key::ESCAPE if echo || options.escape_goes_back => {
                if !keys.more_within(ESCAPE_DELAY_MS) {
                    if options.escape_goes_back {
                        answer.move_to_end();
                        return Ok(Ok(Some(LineOutcome::Back {
                            row: answer.row_from_prompt(),
                        })));
                    }
                    escape_ignored = Some(Instant::now());
                    continue;
                }
                if let Some(edit) = edit_after_escape(keys)? {
                    answer.edit(edit);
                }
                Ok(())
            }
            _ if !echo => answer.insert(byte),
            _ if late => match read_late_sequence(keys, byte)? {
                Ok(edit) => {
                    answer.edit(edit);
                    Ok(())
                }
                Err(mut again) => {
                    let inserted = answer.insert(byte);
                    keys.give_back(&mut again);
                    inserted
                }
            },
            _ if answer.control(byte) => Ok(()),
            key::TAB => match answer.hints() {
                // Tab completes a word where words are hinted; a pasted Tab separates as a space.
                Some(hints) if !keys.more_within(PASTE_GAP_MS) => answer.complete(hints),
                _ => answer.insert(key::SPACE),
            },
            _ if byte >= key::SPACE => answer.insert(byte),
            // Any other control character is left out: shown, it would move the cursor.
            _ => Ok(()),
        };
        if let Err(reason) = step {
            return Ok(Err(reason));
        }
    }
    answer.move_to_end();
    Ok(Ok(None))
}
