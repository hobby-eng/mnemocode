"""Public PTY-helper regressions with synthetic OS boundaries; no process or PTY is started."""

import errno
import unittest
from contextlib import ExitStack
from unittest.mock import patch

import terminal_session as terminal
from terminal_result_checks import assert_closed_descriptor


@unittest.skipIf(terminal.WINDOWS, "POSIX descriptor and PTY errors only.")
class TerminalErrorTests(unittest.TestCase):
    def session(self, stack):
        """Uses the public constructor with every process/descriptor effect replaced."""
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
        for code in (errno.EPERM, errno.EBADF, errno.EINVAL):
            with self.subTest(errno=code), ExitStack() as stack:
                session = self.session(stack)
                error = OSError(code, "Synthetic OS read failure.")
                stack.enter_context(patch("os.read", side_effect=error))
                with self.assertRaises(OSError) as caught:
                    session.read_some(wait=0)
                self.assertIs(caught.exception, error)

    def test_read_accepts_pty_eof_and_nonblocking_races(self):
        for code in {errno.EIO, errno.EAGAIN, errno.EWOULDBLOCK}:
            with self.subTest(errno=code), ExitStack() as stack:
                session = self.session(stack)
                stack.enter_context(
                    patch("os.read", side_effect=OSError(code, "Expected race."))
                )
                session.read_some(wait=0)
                self.assertEqual(session.output, "")

    def test_read_keeps_normal_bytes_and_empty_eof(self):
        with ExitStack() as stack:
            session = self.session(stack)
            stack.enter_context(
                patch("os.read", side_effect=[b"public terminal fragment", b""])
            )
            session.read_some(wait=0)
            session.read_some(wait=0)
            self.assertEqual(session.output, "public terminal fragment")

    def test_descriptor_check_accepts_only_bad_descriptor_as_closure(self):
        with patch("os.fstat", side_effect=OSError(errno.EBADF, "Closed descriptor.")):
            assert_closed_descriptor(7)
        for code in (errno.EPERM, errno.EIO, errno.EINVAL):
            with self.subTest(errno=code):
                error = OSError(code, "Synthetic descriptor failure.")
                with patch("os.fstat", side_effect=error):
                    with self.assertRaises(OSError) as caught:
                        assert_closed_descriptor(7)
                    self.assertIs(caught.exception, error)

    def test_descriptor_check_refuses_a_still_open_descriptor(self):
        with patch("os.fstat", return_value=object()):
            with self.assertRaisesRegex(AssertionError, "still open"):
                assert_closed_descriptor(7)


if __name__ == "__main__":
    unittest.main()
