"""Public PTY-helper regressions with OS calls faked at their seams.

No process or PTY runs.
"""

import errno
import unittest
from contextlib import ExitStack
from unittest.mock import patch

import terminal_session as terminal
from terminal_result_checks import assert_closed_descriptor


@unittest.skipIf(terminal.WINDOWS, "POSIX descriptor and PTY errors only.")
class TerminalErrorTests(unittest.TestCase):
    """Unexpected OS errors propagate; expected PTY races end a read."""

    def session(self, stack):
        """A session of the public constructor, its OS effects faked."""
        for name, answer in (
            ("pty.fork", (123, 7)),
            ("fcntl.ioctl", 0),
            ("os.set_blocking", None),
            ("os.waitpid", (123, 0)),
            ("os.close", None),
            ("select.select", ([7], [], [])),
        ):
            stack.enter_context(patch(name, return_value=answer))
        session = terminal.Session()
        stack.callback(session.close)
        return session

    def test_read_propagates_unexpected_os_failures(self):
        """Keep the original unexpected error from an OS read."""
        for code in (errno.EPERM, errno.EBADF, errno.EINVAL):
            with self.subTest(errno=code), ExitStack() as stack:
                session = self.session(stack)
                error = OSError(code, "Synthetic OS read failure.")
                stack.enter_context(patch("os.read", side_effect=error))
                with self.assertRaises(OSError) as caught:
                    session.read_some(wait=0)
                self.assertIs(caught.exception, error)

    def test_read_accepts_pty_eof_and_nonblocking_races(self):
        """Treat PTY EOF and nonblocking races as an empty read."""
        for code in {errno.EIO, errno.EAGAIN, errno.EWOULDBLOCK}:
            with self.subTest(errno=code), ExitStack() as stack:
                session = self.session(stack)
                race = OSError(code, "Expected race.")
                stack.enter_context(patch("os.read", side_effect=race))
                session.read_some(wait=0)
                self.assertEqual(session.output, "")

    def test_read_keeps_normal_bytes_and_empty_eof(self):
        """Keep read bytes when the next read reports EOF."""
        with ExitStack() as stack:
            session = self.session(stack)
            reads = [b"public terminal fragment", b""]
            stack.enter_context(patch("os.read", side_effect=reads))
            session.read_some(wait=0)
            session.read_some(wait=0)
            self.assertEqual(session.output, "public terminal fragment")

    def test_descriptor_check_accepts_only_bad_descriptor_as_closure(self):
        """Accept EBADF alone as proof that a descriptor is closed."""
        closed = OSError(errno.EBADF, "Closed descriptor.")
        with patch("os.fstat", side_effect=closed):
            assert_closed_descriptor(7)
        for code in (errno.EPERM, errno.EIO, errno.EINVAL):
            with self.subTest(errno=code):
                error = OSError(code, "Synthetic descriptor failure.")
                with patch("os.fstat", side_effect=error):
                    with self.assertRaises(OSError) as caught:
                        assert_closed_descriptor(7)
                    self.assertIs(caught.exception, error)

    def test_descriptor_check_refuses_a_still_open_descriptor(self):
        """An open descriptor fails the closure check."""
        with patch("os.fstat", return_value=object()):
            with self.assertRaisesRegex(AssertionError, "still open"):
                assert_closed_descriptor(7)


if __name__ == "__main__":
    unittest.main()
