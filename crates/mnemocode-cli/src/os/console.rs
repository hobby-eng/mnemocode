//! The standard descriptors, read and written without std's static buffers, which are never freed
//! and so never wiped (clippy.toml, ARCHITECTURE.md §6), and the terminal's raw mode and size.
//!
//! Raw mode is libuv's, which TS 0.1.0 used through Node.js: no echo, no line editing, no signals
//! from keys (Ctrl+C arrives as a byte, which the line editor reads), output still translating line
//! breaks. Entering it drops what was typed ahead (TCSAFLUSH; FlushConsoleInputBuffer), so that a
//! key pressed before a question is never taken as its answer (CAP-CLI-TYPED-AHEAD-DROP).

#![allow(
    unsafe_code,
    reason = "the descriptors and the terminal's modes are reached through system calls that Rust \
              offers only through unsafe foreign functions (RUST-07: the CLI's os module only)"
)]

use std::io;

use super::signals::suspend_by_default;

/// One of the three standard streams.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Stream {
    /// Standard input.
    Input,
    /// Standard output: results.
    Output,
    /// Standard error: questions, progress and messages.
    Error,
}

/// Writes all of `bytes` to standard output.
pub(crate) fn write_output(bytes: &[u8]) -> io::Result<()> {
    write_all(Stream::Output, bytes)
}

/// Writes all of `bytes` to standard error.
pub(crate) fn write_error(bytes: &[u8]) -> io::Result<()> {
    write_all(Stream::Error, bytes)
}

#[cfg(unix)]
mod system {
    use super::{Stream, io};
    use std::io::IsTerminal;
    use std::os::fd::{BorrowedFd, RawFd};

    /// The descriptor of `stream`.
    const fn descriptor(stream: Stream) -> RawFd {
        match stream {
            Stream::Input => 0,
            Stream::Output => 1,
            Stream::Error => 2,
        }
    }

    /// Whether `stream` is a terminal.
    pub(crate) fn is_terminal(stream: Stream) -> bool {
        // SAFETY: the standard descriptors stay open for the life of the process.
        unsafe { BorrowedFd::borrow_raw(descriptor(stream)) }.is_terminal()
    }

    /// Writes all of `bytes` to `stream`, again after an interruption by a signal.
    pub(crate) fn write_all(stream: Stream, mut bytes: &[u8]) -> io::Result<()> {
        while !bytes.is_empty() {
            // SAFETY: write reads at most `bytes.len()` bytes of the slice, which lives for the call.
            let written =
                unsafe { libc::write(descriptor(stream), bytes.as_ptr().cast(), bytes.len()) };
            match usize::try_from(written) {
                Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
                Ok(count) => bytes = bytes.get(count..).unwrap_or_default(),
                Err(_) => {
                    let error = io::Error::last_os_error();
                    if error.kind() != io::ErrorKind::Interrupted {
                        return Err(error);
                    }
                }
            }
        }
        Ok(())
    }

    /// Reads what standard input has, up to `buffer`'s length; 0 at its end. A signal interrupts
    /// the read (`ErrorKind::Interrupted`), which is not tried again: the caller looks at the signal
    /// (ARCHITECTURE.md §5).
    pub(crate) fn read_input(buffer: &mut [u8]) -> io::Result<usize> {
        // SAFETY: read writes at most `buffer.len()` bytes into the slice, which lives for the call.
        let read = unsafe { libc::read(0, buffer.as_mut_ptr().cast(), buffer.len()) };
        usize::try_from(read).map_err(|_| io::Error::last_os_error())
    }

    /// Whether a byte arrives on standard input within `milliseconds`. select, not poll: macOS's
    /// poll does not support terminals (mhfe, hidden_input.rs).
    pub(crate) fn input_within(milliseconds: u32) -> io::Result<bool> {
        // suseconds_t is i64 on Linux and i32 on macOS; the microseconds, below a million, fit both.
        let micros = i32::try_from(milliseconds % 1000 * 1000).unwrap_or(0);
        let tv_usec = libc::suseconds_t::from(micros);
        // SAFETY: an fd_set and a timeval on the stack that select may change, for standard
        // input only; all zero bytes are a valid fd_set.
        let ready = unsafe {
            let mut readable = std::mem::MaybeUninit::<libc::fd_set>::zeroed().assume_init();
            libc::FD_ZERO(&raw mut readable);
            libc::FD_SET(0, &raw mut readable);
            let mut timeout = libc::timeval {
                tv_sec: libc::time_t::from(milliseconds / 1000),
                tv_usec,
            };
            libc::select(
                1,
                &raw mut readable,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &raw mut timeout,
            )
        };
        match ready {
            -1 => {
                // A signal ends the wait without a byte; the caller reads its flags.
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    Ok(false)
                } else {
                    Err(error)
                }
            }
            count => Ok(count > 0),
        }
    }

    /// The terminal's columns and rows, from the first standard stream that is a terminal.
    pub(crate) fn terminal_size() -> Option<(u16, u16)> {
        [2, 1, 0].into_iter().find_map(|descriptor| {
            let mut size = libc::winsize {
                ws_row: 0,
                ws_col: 0,
                ws_xpixel: 0,
                ws_ypixel: 0,
            };
            // SAFETY: TIOCGWINSZ writes the struct, which lives for the call.
            let read = unsafe { libc::ioctl(descriptor, libc::TIOCGWINSZ, &raw mut size) } == 0;
            (read && size.ws_col > 0 && size.ws_row > 0).then_some((size.ws_col, size.ws_row))
        })
    }

    /// The terminal's modes before raw mode, restored on drop.
    pub(crate) struct Saved(libc::termios);

    /// The modes of the terminal on standard input; `None` when it is no terminal.
    fn modes_now() -> Option<libc::termios> {
        // SAFETY: a zeroed termios is a valid value that tcgetattr overwrites.
        let mut modes: libc::termios = unsafe { std::mem::zeroed() };
        // SAFETY: tcgetattr writes the struct, which lives for the call.
        (unsafe { libc::tcgetattr(0, &raw mut modes) } == 0).then_some(modes)
    }

    /// Raw mode on standard input, dropping what was typed ahead; `None` when it is no terminal.
    pub(crate) fn enter_raw() -> Option<Saved> {
        let mut modes = modes_now()?;
        let saved = Saved(modes);
        modes.c_iflag &= !(libc::BRKINT | libc::ICRNL | libc::INPCK | libc::ISTRIP | libc::IXON);
        modes.c_oflag |= libc::ONLCR;
        modes.c_cflag |= libc::CS8;
        modes.c_lflag &= !(libc::ECHO | libc::ICANON | libc::IEXTEN | libc::ISIG);
        modes.c_cc[libc::VMIN] = 1;
        modes.c_cc[libc::VTIME] = 0;
        // SAFETY: tcsetattr reads the struct, which lives for the call.
        (unsafe { libc::tcsetattr(0, libc::TCSAFLUSH, &raw const modes) } == 0).then_some(saved)
    }

    /// Restores the modes saved.
    pub(crate) fn leave_raw(saved: &Saved) {
        // SAFETY: tcsetattr reads the struct, which lives for the call.
        unsafe { libc::tcsetattr(0, libc::TCSANOW, &raw const saved.0) };
    }

    /// Echo off on standard input, the rest as it was; the modes before, `None` when it is no
    /// terminal.
    pub(crate) fn enter_no_echo() -> Option<Saved> {
        let mut modes = modes_now()?;
        let saved = Saved(modes);
        modes.c_lflag &= !libc::ECHO;
        // SAFETY: tcsetattr reads the struct, which lives for the call.
        (unsafe { libc::tcsetattr(0, libc::TCSANOW, &raw const modes) } == 0).then_some(saved)
    }

    /// Drops what was typed and not read.
    pub(crate) fn drop_typed_ahead() {
        // SAFETY: tcflush takes a descriptor and a queue selector.
        unsafe { libc::tcflush(0, libc::TCIFLUSH) };
    }

    /// Nothing to prepare on Unix: terminals read UTF-8 and escape sequences.
    pub(crate) fn prepare() {}

    /// Nothing to give back on Unix.
    pub(crate) fn restore() {}
}

#[cfg(windows)]
mod system {
    use super::{Stream, io};
    use std::io::IsTerminal;
    use std::os::windows::io::BorrowedHandle;
    use std::ptr;
    use std::sync::atomic::{AtomicU32, Ordering};
    use windows_sys::Win32::Foundation::{ERROR_BROKEN_PIPE, HANDLE};
    use windows_sys::Win32::Storage::FileSystem::{ReadFile, WriteFile};
    use windows_sys::Win32::System::Console::{
        CONSOLE_MODE, CONSOLE_SCREEN_BUFFER_INFO, ENABLE_VIRTUAL_TERMINAL_INPUT,
        ENABLE_VIRTUAL_TERMINAL_PROCESSING, FlushConsoleInputBuffer, GetConsoleCP, GetConsoleMode,
        GetConsoleOutputCP, GetConsoleScreenBufferInfo, GetStdHandle, ReadConsoleW,
        STD_ERROR_HANDLE, STD_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, SetConsoleCP,
        SetConsoleMode, SetConsoleOutputCP,
    };

    /// UTF-8's code page.
    const UTF8: u32 = 65001;

    fn handle(stream: Stream) -> HANDLE {
        let which: STD_HANDLE = match stream {
            Stream::Input => STD_INPUT_HANDLE,
            Stream::Output => STD_OUTPUT_HANDLE,
            Stream::Error => STD_ERROR_HANDLE,
        };
        // SAFETY: GetStdHandle takes a constant and returns the process's own handle.
        unsafe { GetStdHandle(which) }
    }

    /// Whether `stream` is a console.
    pub(crate) fn is_terminal(stream: Stream) -> bool {
        let handle = handle(stream);
        // SAFETY: the standard handles stay open for the life of the process.
        !handle.is_null() && unsafe { BorrowedHandle::borrow_raw(handle) }.is_terminal()
    }

    /// Writes all of `bytes` to `stream`, as UTF-8 (`prepare` set the console's code page).
    pub(crate) fn write_all(stream: Stream, mut bytes: &[u8]) -> io::Result<()> {
        let handle = handle(stream);
        while !bytes.is_empty() {
            let chunk = u32::try_from(bytes.len()).unwrap_or(u32::MAX);
            let mut written = 0;
            // SAFETY: WriteFile reads at most `chunk` bytes of the slice, which lives for the call.
            if unsafe { WriteFile(handle, bytes.as_ptr(), chunk, &mut written, ptr::null_mut()) }
                == 0
            {
                return Err(io::Error::last_os_error());
            }
            let count = usize::try_from(written).unwrap_or(0);
            if count == 0 {
                return Err(io::ErrorKind::WriteZero.into());
            }
            bytes = bytes.get(count..).unwrap_or_default();
        }
        Ok(())
    }

    /// Reads what standard input has as UTF-8, up to `buffer`'s length; 0 at its end. A console is
    /// read in UTF-16 (ReadConsoleW) and converted, a surrogate pair always whole.
    pub(crate) fn read_input(buffer: &mut [u8]) -> io::Result<usize> {
        let input = handle(Stream::Input);
        if !is_terminal(Stream::Input) {
            let mut read = 0;
            let length = u32::try_from(buffer.len()).unwrap_or(u32::MAX);
            // SAFETY: ReadFile writes at most `length` bytes into the slice, which lives for the call.
            if unsafe {
                ReadFile(
                    input,
                    buffer.as_mut_ptr(),
                    length,
                    &mut read,
                    ptr::null_mut(),
                )
            } == 0
            {
                let error = io::Error::last_os_error();
                // The writer of a pipe closed it: the end of the input.
                if error.raw_os_error() == i32::try_from(ERROR_BROKEN_PIPE).ok() {
                    return Ok(0);
                }
                return Err(error);
            }
            return Ok(usize::try_from(read).unwrap_or(0));
        }
        // Each UTF-16 unit takes at most three bytes; one more unit completes a pair.
        let mut units = [0_u16; 64];
        let wanted = (buffer.len() / 3).clamp(2, units.len() - 1);
        let mut read = 0;
        // SAFETY: ReadConsoleW writes at most `wanted` units into the array, which lives for the
        // call.
        if unsafe {
            ReadConsoleW(
                input,
                units.as_mut_ptr().cast(),
                u32::try_from(wanted).unwrap_or(2),
                &mut read,
                ptr::null(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let mut count = usize::try_from(read).unwrap_or(0);
        if count > 0
            && units
                .get(count - 1)
                .is_some_and(|unit| (0xD800..0xDC00).contains(unit))
            && count < units.len()
        {
            let mut more = 0;
            // SAFETY: one more unit, written into the array past the units read.
            if unsafe {
                ReadConsoleW(
                    input,
                    units.as_mut_ptr().add(count).cast(),
                    1,
                    &mut more,
                    ptr::null(),
                )
            } != 0
            {
                count += usize::try_from(more).unwrap_or(0);
            }
        }
        let mut written = 0;
        for character in char::decode_utf16(units.iter().take(count).copied()) {
            let character = character.unwrap_or(char::REPLACEMENT_CHARACTER);
            let mut encoded = [0; 4];
            let bytes = character.encode_utf8(&mut encoded).as_bytes();
            let Some(target) = buffer.get_mut(written..written + bytes.len()) else {
                break;
            };
            target.copy_from_slice(bytes);
            written += bytes.len();
            encoded.fill(0);
        }
        units.fill(0);
        Ok(written)
    }

    /// Whether a typed character arrives within `milliseconds`. The console has no wait for that
    /// alone: its queue also holds events that give no character, such as a key's release, so the
    /// queue is looked at every few milliseconds until the time is up (mhfe, hidden_input.rs).
    pub(crate) fn input_within(milliseconds: u32) -> io::Result<bool> {
        use windows_sys::Win32::System::Console::{INPUT_RECORD, KEY_EVENT, PeekConsoleInputW};
        use windows_sys::Win32::System::Threading::Sleep;
        const STEP_MS: u32 = 5;
        const EVENTS: usize = 32;
        if !is_terminal(Stream::Input) {
            return Ok(true);
        }
        let mut waited = 0;
        loop {
            // SAFETY: an all-zero INPUT_RECORD is a valid value that the call overwrites.
            let mut events: [INPUT_RECORD; EVENTS] = unsafe { std::mem::zeroed() };
            let mut count = 0_u32;
            // SAFETY: room for EVENTS records; peeking leaves the events in the queue.
            if unsafe {
                PeekConsoleInputW(
                    handle(Stream::Input),
                    events.as_mut_ptr(),
                    EVENTS as u32,
                    &mut count,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            let typed = events
                .iter()
                .take(usize::try_from(count).unwrap_or(0))
                .any(|event| {
                    // SAFETY: the union holds a key event when EventType says so.
                    u32::from(event.EventType) == KEY_EVENT
                        && unsafe {
                            event.Event.KeyEvent.bKeyDown != 0
                                && event.Event.KeyEvent.uChar.UnicodeChar != 0
                        }
                });
            if typed {
                return Ok(true);
            }
            if waited >= milliseconds {
                return Ok(false);
            }
            // SAFETY: Sleep takes a duration only.
            unsafe { Sleep(STEP_MS) };
            waited += STEP_MS;
        }
    }

    /// The console window's columns and rows.
    pub(crate) fn terminal_size() -> Option<(u16, u16)> {
        [Stream::Error, Stream::Output]
            .into_iter()
            .find_map(|stream| {
                // SAFETY: a zeroed structure is a valid value that the call overwrites.
                let mut info: CONSOLE_SCREEN_BUFFER_INFO = unsafe { std::mem::zeroed() };
                // SAFETY: the call writes the structure, which lives for it.
                if unsafe { GetConsoleScreenBufferInfo(handle(stream), &mut info) } == 0 {
                    return None;
                }
                let columns = u16::try_from(info.srWindow.Right - info.srWindow.Left + 1).ok()?;
                let rows = u16::try_from(info.srWindow.Bottom - info.srWindow.Top + 1).ok()?;
                (columns > 0 && rows > 0).then_some((columns, rows))
            })
    }

    /// The console's input mode before raw mode, restored on drop.
    pub(crate) struct Saved(CONSOLE_MODE);

    /// Raw mode: keys as virtual-terminal input, no line editing, echo or Ctrl+C handling, and
    /// what was typed ahead dropped.
    pub(crate) fn enter_raw() -> Option<Saved> {
        let input = handle(Stream::Input);
        let mut mode = 0;
        // SAFETY: the calls read and write the mode, which lives for them.
        unsafe {
            if GetConsoleMode(input, &mut mode) == 0 {
                return None;
            }
            if SetConsoleMode(input, ENABLE_VIRTUAL_TERMINAL_INPUT) == 0 {
                return None;
            }
            FlushConsoleInputBuffer(input);
        }
        Some(Saved(mode))
    }

    /// Restores the mode saved.
    pub(crate) fn leave_raw(saved: &Saved) {
        // SAFETY: the call takes the handle and a mode.
        unsafe { SetConsoleMode(handle(Stream::Input), saved.0) };
    }

    /// A Windows console shows no key before a program reads it: the mode is only kept, for a
    /// command that a signal stopped in raw mode.
    pub(crate) fn enter_no_echo() -> Option<Saved> {
        let mut mode = 0;
        // SAFETY: the call writes the mode, which lives for it.
        (unsafe { GetConsoleMode(handle(Stream::Input), &mut mode) } != 0).then_some(Saved(mode))
    }

    /// Drops what was typed and not read.
    pub(crate) fn drop_typed_ahead() {
        // SAFETY: the call takes the handle of the console's input.
        unsafe { FlushConsoleInputBuffer(handle(Stream::Input)) };
    }

    /// The console's code pages before this program, which belong to the console.
    static CODE_PAGES: [AtomicU32; 2] = [AtomicU32::new(0), AtomicU32::new(0)];

    /// Gives the console its code pages back.
    pub(crate) fn restore() {
        let [input, output] = &CODE_PAGES;
        // SAFETY: the calls take code pages only; 0, none read, is refused and changes nothing.
        unsafe {
            SetConsoleCP(input.load(Ordering::SeqCst));
            SetConsoleOutputCP(output.load(Ordering::SeqCst));
        }
    }

    /// UTF-8 in and out of the console, and escape sequences on its output.
    pub(crate) fn prepare() {
        let [input, output] = &CODE_PAGES;
        // SAFETY: the calls take code pages, handles and modes only.
        unsafe {
            input.store(GetConsoleCP(), Ordering::SeqCst);
            output.store(GetConsoleOutputCP(), Ordering::SeqCst);
            SetConsoleCP(UTF8);
            SetConsoleOutputCP(UTF8);
            for stream in [Stream::Output, Stream::Error] {
                let mut mode = 0;
                if GetConsoleMode(handle(stream), &mut mode) != 0 {
                    SetConsoleMode(handle(stream), mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
                }
            }
        }
    }
}

pub(crate) use system::{input_within, is_terminal, read_input, terminal_size, write_all};

/// Prepares the console for UTF-8 and escape sequences, on Windows; nothing elsewhere.
pub(crate) fn prepare() {
    system::prepare();
}

/// Gives the console what [`prepare`] changed back.
pub(crate) fn restore() {
    system::restore();
}

/// Runs `body` with the terminal's echo off, and gives the terminal back exactly as it was, also
/// after a command that a signal stopped while it read keys in raw mode. Without it the terminal
/// would show the keys typed for a command before its first question.
pub(crate) fn without_echo<T>(body: impl FnOnce() -> T) -> T {
    let saved = system::enter_no_echo();
    let result = body();
    if let Some(saved) = &saved {
        system::leave_raw(saved);
    }
    result
}

/// Drops what was typed and not read: it answers no question.
pub(crate) fn drop_typed_ahead() {
    system::drop_typed_ahead();
}

/// Raw mode on standard input while this lives: the modes before it come back on drop.
pub(crate) struct RawMode {
    saved: system::Saved,
}

impl RawMode {
    /// Raw mode, dropping what was typed ahead; `None` when standard input is no terminal.
    pub(crate) fn enter() -> Option<Self> {
        let saved = system::enter_raw()?;
        suspend_by_default(false);
        Some(Self { saved })
    }

    /// Restores the modes for a while, as before a suspension; [`RawMode::resume`] takes raw mode
    /// again.
    pub(crate) fn pause(&self) {
        system::leave_raw(&self.saved);
    }

    /// Takes raw mode again after [`RawMode::pause`].
    pub(crate) fn resume(&self) {
        // The modes saved first stay the ones restored on drop; those read now are not kept.
        let _now = system::enter_raw();
    }
}

impl Drop for RawMode {
    fn drop(&mut self) {
        suspend_by_default(true);
        system::leave_raw(&self.saved);
    }
}
