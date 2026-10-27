//! The keys typed at the terminal on standard input, read in raw mode while a question or a long
//! search reads them (MnemoCode TS 0.1.0's `terminal-keys.ts`, `key-sequences.ts` and
//! `TerminalKeys` of `terminal-input.ts`). Entering raw mode drops what was typed ahead, so that a
//! question is answered only by keys pressed after it shows. A signal wakes a read: an ending signal
//! is returned as such, and SIGTSTP from outside gives the terminal back, stops, takes it again and
//! asks the screen to redraw.

use std::io;

use zeroize::Zeroize;

use crate::os::{self, RawMode, Signal};

/// Raw bytes that the questions act on.
pub(crate) mod key {
    pub(crate) const CTRL_A: u8 = 0x01;
    pub(crate) const CTRL_C: u8 = 0x03;
    pub(crate) const CTRL_D: u8 = 0x04;
    pub(crate) const CTRL_E: u8 = 0x05;
    pub(crate) const BACKSPACE: u8 = 0x08;
    pub(crate) const TAB: u8 = 0x09;
    pub(crate) const LINE_FEED: u8 = 0x0a;
    pub(crate) const CTRL_K: u8 = 0x0b;
    pub(crate) const CARRIAGE_RETURN: u8 = 0x0d;
    pub(crate) const CTRL_U: u8 = 0x15;
    pub(crate) const CTRL_W: u8 = 0x17;
    pub(crate) const CTRL_Z: u8 = 0x1a;
    pub(crate) const ESCAPE: u8 = 0x1b;
    pub(crate) const CTRL_BACKSLASH: u8 = 0x1c;
    pub(crate) const SPACE: u8 = 0x20;
    pub(crate) const DELETE: u8 = 0x7f;
    /// The final bytes of the arrows and of Home and End, after CSI or SS3 (xterm's ctlseqs).
    pub(crate) const ARROW_UP: u8 = b'A';
    pub(crate) const ARROW_DOWN: u8 = b'B';
    pub(crate) const ARROW_RIGHT: u8 = b'C';
    pub(crate) const ARROW_LEFT: u8 = b'D';
    pub(crate) const HOME: u8 = b'H';
    pub(crate) const END: u8 = b'F';
    pub(crate) const SEQUENCE_TILDE: u8 = b'~';
}

/// How long a lone Escape waits for the rest of an escape sequence (ncurses waits up to a second,
/// vim 100 ms).
pub(crate) const ESCAPE_DELAY_MS: u32 = 100;
/// How long the rest of a paste may take after one of its bytes: a line break followed this soon
/// is inside a paste.
pub(crate) const PASTE_GAP_MS: u32 = 20;
/// How long after an ignored Escape a [ or O may still start the rest of its sequence, which a slow
/// remote link delivered apart.
const LATE_SEQUENCE_MS: u32 = 1000;
/// The bytes after ESC that start a control sequence (CSI) or a single shift (SS3).
const CSI: u8 = b'[';
const SS3: u8 = b'O';
/// Longer than any key's sequence, such as ESC [ 2 4 ; 5 ~ (Ctrl+F12).
const MAX_KEY_SEQUENCE_BYTES: usize = 8;
/// The bytes read from the terminal at once.
const CHUNK: usize = 256;

/// Why a read of keys stopped: the input ended, a signal ended the command, or the terminal failed.
#[derive(Debug)]
pub(crate) enum Interrupted {
    /// An ending signal arrived.
    Signal(Signal),
    /// Reading the terminal failed.
    Failed(io::Error),
}

/// A session of raw mode on standard input: the keys read, those read but not yet used, and the
/// bytes to read again first. Every byte is wiped once used and when the session ends.
pub(crate) struct Keys {
    raw: Option<RawMode>,
    chunk: [u8; CHUNK],
    start: usize,
    end: usize,
    again: Vec<u8>,
    ended: bool,
}

impl Keys {
    /// Raw mode on standard input, dropping what was typed ahead.
    pub(crate) fn open() -> Self {
        Self {
            raw: RawMode::enter(),
            chunk: [0; CHUNK],
            start: 0,
            end: 0,
            again: Vec::with_capacity(MAX_KEY_SEQUENCE_BYTES * 2),
            ended: false,
        }
    }

    /// Whether raw mode is on: standard input is a terminal.
    pub(crate) fn is_raw(&self) -> bool {
        self.raw.is_some()
    }

    /// The next byte typed: a byte given back first, then one read; `None` at the end of the input.
    pub(crate) fn next(&mut self) -> Result<Option<u8>, Interrupted> {
        if !self.again.is_empty() {
            let byte = self.again.remove(0);
            return Ok(Some(byte));
        }
        if self.start == self.end {
            if self.ended {
                return Ok(None);
            }
            self.fill()?;
            if self.start == self.end {
                return Ok(None);
            }
        }
        let byte = self.chunk.get(self.start).copied();
        if let Some(slot) = self.chunk.get_mut(self.start) {
            *slot = 0;
        }
        self.start += 1;
        Ok(byte)
    }

    /// Reads more of the terminal into the chunk, waking for signals.
    fn fill(&mut self) -> Result<(), Interrupted> {
        self.chunk.zeroize();
        self.start = 0;
        self.end = 0;
        loop {
            if let Some(signal) = os::pending_signal() {
                return Err(Interrupted::Signal(signal));
            }
            match os::read_input(&mut self.chunk) {
                Ok(0) => {
                    self.ended = true;
                    return Ok(());
                }
                Ok(count) => {
                    self.end = count;
                    return Ok(());
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => self.suspend_if_asked(),
                Err(error) => return Err(Interrupted::Failed(error)),
            }
        }
    }

    /// Stops for SIGTSTP when it arrived: the terminal as the shell expects it, then raw mode again
    /// and a redraw once continued.
    fn suspend_if_asked(&self) {
        if !os::suspend_requested() {
            return;
        }
        if let Some(raw) = &self.raw {
            raw.pause();
        }
        os::suspend_now();
        if let Some(raw) = &self.raw {
            raw.resume();
        }
        super::request_redraw();
    }

    /// Whether another byte arrives within `milliseconds`, without taking it.
    pub(crate) fn more_within(&mut self, milliseconds: u32) -> bool {
        if !self.again.is_empty() || self.start < self.end {
            return true;
        }
        if self.ended {
            return false;
        }
        os::input_within(milliseconds).unwrap_or(false)
    }

    /// Gives `bytes` back, to be read before any byte typed after them; then wipes them.
    pub(crate) fn give_back(&mut self, bytes: &mut Vec<u8>) {
        let mut joined = std::mem::take(bytes);
        joined.append(&mut self.again);
        self.again = joined;
        bytes.zeroize();
    }

    /// Drops the rest of an answer refused while it still arrived, such as a paste longer than any
    /// answer: everything until no byte has come for PASTE_GAP_MS. Whether Ctrl+C was among it.
    pub(crate) fn drop_rest_of_paste(&mut self) -> Result<bool, Interrupted> {
        let mut cancelled = false;
        while self.more_within(PASTE_GAP_MS) {
            match self.next()? {
                Some(key::CTRL_C) => cancelled = true,
                Some(_) => {}
                None => break,
            }
        }
        Ok(cancelled)
    }
}

impl Drop for Keys {
    fn drop(&mut self) {
        self.chunk.zeroize();
        self.again.zeroize();
    }
}

/// What followed an ESC that more bytes followed at once.
enum Escape {
    /// A whole sequence: its introducer, its parameter bytes and its final byte.
    Sequence {
        introducer: u8,
        parameters: String,
        last: u8,
    },
    /// A printable character, as Alt with that key sends it: no key of MnemoCode's.
    Alt,
    /// No key's sequence: the bytes to read again as typed, in order.
    None(Vec<u8>),
}

/// Reads what follows an ESC that more bytes followed at once: a key's sequence as ECMA-48 shapes
/// it, [ or O, parameter bytes and one final byte. One that stops short is no key, and its bytes
/// are given back so that each keeps its meaning.
fn read_escape(keys: &mut Keys) -> Result<Escape, Interrupted> {
    let Some(introducer) = keys.next()? else {
        return Ok(Escape::None(Vec::new()));
    };
    if introducer != CSI && introducer != SS3 {
        return Ok(if (0x20..=0x7e).contains(&introducer) {
            Escape::Alt
        } else {
            Escape::None(vec![introducer])
        });
    }
    let mut read = Vec::with_capacity(MAX_KEY_SEQUENCE_BYTES);
    while read.len() < MAX_KEY_SEQUENCE_BYTES {
        if !keys.more_within(ESCAPE_DELAY_MS) {
            break;
        }
        let Some(byte) = keys.next()? else {
            break;
        };
        read.push(byte);
        if (0x40..=0x7e).contains(&byte) {
            read.pop();
            let parameters = String::from_utf8_lossy(&read).into_owned();
            read.zeroize();
            return Ok(Escape::Sequence {
                introducer,
                parameters,
                last: byte,
            });
        }
        if !(0x30..=0x3f).contains(&byte) {
            break;
        }
    }
    Ok(Escape::None(read))
}

/// The keys of a visible answer that move the cursor or delete, read from their escape sequence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EditKey {
    Left,
    Right,
    WordLeft,
    WordRight,
    Home,
    End,
    Delete,
    Other,
}

/// Which editing key sent the sequence of `introducer`, `parameters` and `last`.
pub(crate) fn edit_key_of(introducer: u8, parameters: &str, last: u8) -> EditKey {
    if introducer == SS3 {
        return match last {
            key::ARROW_RIGHT => EditKey::Right,
            key::ARROW_LEFT => EditKey::Left,
            key::HOME => EditKey::Home,
            key::END => EditKey::End,
            _ => EditKey::Other,
        };
    }
    let mut parts = parameters.split(';');
    let code = parts.next().unwrap_or_default();
    // The xterm modifier numbers of Alt and Ctrl, as in ESC [ 1 ; 5 D for Ctrl+Left.
    let word = parts
        .next()
        .is_some_and(|modifier| modifier == "3" || modifier == "5");
    match last {
        key::ARROW_RIGHT if word => EditKey::WordRight,
        key::ARROW_RIGHT => EditKey::Right,
        key::ARROW_LEFT if word => EditKey::WordLeft,
        key::ARROW_LEFT => EditKey::Left,
        key::HOME => EditKey::Home,
        key::END => EditKey::End,
        key::SEQUENCE_TILDE => match code {
            "1" | "7" => EditKey::Home,
            "4" | "8" => EditKey::End,
            "3" => EditKey::Delete,
            _ => EditKey::Other,
        },
        _ => EditKey::Other,
    }
}

/// The edit key of an escape sequence typed in an answer, or the bytes to read again.
pub(crate) fn edit_after_escape(keys: &mut Keys) -> Result<Option<EditKey>, Interrupted> {
    match read_escape(keys)? {
        Escape::Sequence {
            introducer,
            parameters,
            last,
        } => Ok(Some(edit_key_of(introducer, &parameters, last))),
        Escape::Alt => Ok(None),
        Escape::None(mut again) => {
            keys.give_back(&mut again);
            Ok(None)
        }
    }
}

/// Whether `byte`, read `since_ignored` ms after an ignored Escape, may start the rest of its
/// sequence.
pub(crate) fn may_be_late_sequence(byte: u8, since_ignored: Option<u32>) -> bool {
    (byte == CSI || byte == SS3) && since_ignored.is_some_and(|ms| ms <= LATE_SEQUENCE_MS)
}

/// Reads the bytes after `introducer`, a [ or O typed soon after an ignored Escape: a key's whole
/// sequence, which nothing follows at once, gives the key; anything else gives back the bytes read
/// after the introducer, to be read as typed.
pub(crate) fn read_late_sequence(
    keys: &mut Keys,
    introducer: u8,
) -> Result<Result<EditKey, Vec<u8>>, Interrupted> {
    let finals: &[u8] = if introducer == CSI {
        b"ABCDEFGHPQRSZ~"
    } else {
        b"ABCDFHPQRS"
    };
    let mut rest = Vec::with_capacity(MAX_KEY_SEQUENCE_BYTES);
    while rest.len() < MAX_KEY_SEQUENCE_BYTES && keys.more_within(PASTE_GAP_MS) {
        let Some(byte) = keys.next()? else {
            break;
        };
        rest.push(byte);
        if finals.contains(&byte) {
            if keys.more_within(PASTE_GAP_MS) {
                break;
            }
            rest.pop();
            let parameters = String::from_utf8_lossy(&rest).into_owned();
            rest.zeroize();
            return Ok(Ok(edit_key_of(introducer, &parameters, byte)));
        }
        if introducer != CSI || !(0x30..=0x3f).contains(&byte) {
            break;
        }
    }
    Ok(Err(rest))
}

/// A key as the questions read it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Key {
    Up,
    Down,
    PageUp,
    PageDown,
    Home,
    End,
    Enter,
    /// Escape, q, Q, Ctrl+D or the end of the input: back.
    Back,
    /// Ctrl+C.
    Cancel,
    Digit(u8),
    Other,
}

/// Reads one key: the arrows, Page Up and Down, Home and End however a terminal sends them, Enter,
/// a digit, Escape alone (and q, Q, Ctrl+D or the end of the input) back, Ctrl+C cancel. Every
/// other key's sequence is read to its end and ignored; bytes after an ESC that are no key's
/// sequence are read again as keys.
pub(crate) fn read_key(keys: &mut Keys) -> Result<Key, Interrupted> {
    let Some(byte) = keys.next()? else {
        return Ok(Key::Back);
    };
    Ok(match byte {
        key::CTRL_C => Key::Cancel,
        key::CARRIAGE_RETURN | key::LINE_FEED => Key::Enter,
        b'0'..=b'9' => Key::Digit(byte - b'0'),
        b'q' | b'Q' | key::CTRL_D => Key::Back,
        key::ESCAPE => {
            if !keys.more_within(ESCAPE_DELAY_MS) {
                return Ok(Key::Back);
            }
            match read_escape(keys)? {
                Escape::None(mut again) => {
                    keys.give_back(&mut again);
                    Key::Other
                }
                Escape::Alt => Key::Other,
                Escape::Sequence {
                    introducer,
                    parameters,
                    last,
                } => sequence_key(introducer, &parameters, last),
            }
        }
        _ => Key::Other,
    })
}

/// The key of a whole escape sequence, for read_key.
fn sequence_key(introducer: u8, parameters: &str, last: u8) -> Key {
    if last == key::SEQUENCE_TILDE {
        match parameters {
            "5" => return Key::PageUp,
            "6" => return Key::PageDown,
            _ => {}
        }
    }
    match edit_key_of(introducer, parameters, last) {
        EditKey::Home => return Key::Home,
        EditKey::End => return Key::End,
        _ => {}
    }
    // Only an arrow key without parameters counts.
    if !parameters.is_empty() {
        return Key::Other;
    }
    match last {
        key::ARROW_UP => Key::Up,
        key::ARROW_DOWN => Key::Down,
        _ => Key::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edit_keys_are_read_as_terminals_send_them() {
        assert_eq!(edit_key_of(CSI, "1;5", key::ARROW_LEFT), EditKey::WordLeft);
        assert_eq!(edit_key_of(CSI, "", key::ARROW_RIGHT), EditKey::Right);
        assert_eq!(edit_key_of(CSI, "3", key::SEQUENCE_TILDE), EditKey::Delete);
        assert_eq!(edit_key_of(CSI, "7", key::SEQUENCE_TILDE), EditKey::Home);
        assert_eq!(edit_key_of(SS3, "", key::END), EditKey::End);
        assert_eq!(sequence_key(CSI, "5", key::SEQUENCE_TILDE), Key::PageUp);
        assert_eq!(sequence_key(CSI, "1;5", key::ARROW_UP), Key::Other);
        assert_eq!(sequence_key(SS3, "", key::ARROW_DOWN), Key::Down);
    }

    #[test]
    fn a_late_sequence_starts_only_with_its_introducer_soon_after() {
        assert!(may_be_late_sequence(b'[', Some(10)));
        assert!(!may_be_late_sequence(b'[', Some(2000)));
        assert!(!may_be_late_sequence(b'x', Some(10)));
        assert!(!may_be_late_sequence(b'O', None));
    }
}
