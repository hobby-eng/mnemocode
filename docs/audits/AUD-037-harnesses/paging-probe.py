"""AUD-037 probe: do long Unicode share sets page on a colour terminal at 80x24 (the 7facfcc fix of
the AUD-028-UI001 variant)? Public test phrase; no files written. Exits 1 if a Unicode set is not
paged. Run from the repository root after pnpm build."""
import sys
import os, pty, select, struct, fcntl, termios, time

PROGRAM = "dist/mnemocode.js"
PHRASE = " ".join(["abandon"] * 11 + ["about"])


def run(threshold, shares, share_format):
    env = {k: v for k, v in os.environ.items() if k not in ("NO_COLOR", "CLICOLOR_FORCE", "CLICOLOR")}
    env["TERM"] = "xterm"
    pid, fd = pty.fork()
    if pid == 0:
        os.execvpe("node", ["node", PROGRAM, "encode", "--sskr", "--ask-secrets", "--mode", "direct",
                             "--threshold", str(threshold), "--shares", str(shares), "--share-format",
                             share_format, "--backup-check", "no"], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    out = b""

    def pump(seconds):
        nonlocal out
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            r, _, _ = select.select([fd], [], [], 0.1)
            if r:
                try:
                    out += os.read(fd, 65536)
                except OSError:
                    return

    while b"Seed phrase" not in out:
        pump(0.3)
    os.write(fd, (PHRASE + "\r").encode())
    pump(3)
    paged = b"Home/End" in out
    status = None
    for _ in range(20):
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            break
        os.write(fd, b"\r")
        pump(0.5)
    os.close(fd)
    print(f"{threshold}-of-{shares} {share_format}: paged={paged}; exit={os.waitstatus_to_exitcode(status) if status is not None else None}")
    return paged or share_format == "words"


results = [run(2, 3, "unicode"), run(2, 3, "colors-unicode"), run(3, 3, "unicode"), run(4, 4, "unicode"), run(2, 3, "words")]
sys.exit(0 if all(results) else 1)
