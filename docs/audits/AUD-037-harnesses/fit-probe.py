"""AUD-037-UI002 probe: for share sets that do not page, are every share's title and the
result heading on the final 24-row frame? Colour terminal at 80x24, public test phrase only."""
import os, pty, re, select, struct, fcntl, termios, time, sys
sys.path.insert(0, "scripts")
from terminal_session import Screen  # noqa: E402

PROGRAM = "dist/mnemocode.js"
PHRASE = " ".join(["abandon"] * 11 + ["about"])
SGR = re.compile(r"\x1b\[[0-9;]*m")


def run(threshold, shares, share_format, mode="direct"):
    env = {k: v for k, v in os.environ.items() if k not in ("NO_COLOR", "CLICOLOR_FORCE", "CLICOLOR")}
    env["TERM"] = "xterm"
    pid, fd = pty.fork()
    if pid == 0:
        args = ["node", PROGRAM, "encode", "--sskr", "--ask-secrets", "--mode", mode, "--threshold",
                str(threshold), "--shares", str(shares), "--share-format", share_format, "--backup-check", "no"]
        os.execvpe("node", args, env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    out = b""

    def pump(until, seconds=20):
        nonlocal out
        end = time.monotonic() + seconds
        while time.monotonic() < end and not any(u in out for u in until):
            r, _, _ = select.select([fd], [], [], 0.1)
            if r:
                out += os.read(fd, 65536)

    pump([b"Seed phrase"])
    if mode != "direct":
        pass
    os.write(fd, (PHRASE + "\r").encode())
    if mode != "direct":
        pump([b"Dates ("])
        os.write(fd, b"23-09-2026\r")
    pump([b"Press Enter to clear this screen.", b"Home/End"])
    time.sleep(0.4)
    r, _, _ = select.select([fd], [], [], 0.2)
    if r:
        out += os.read(fd, 65536)
    paged = b"Home/End" in out
    text = out.decode("utf-8", "replace")
    start = text.rfind("\x1b[?1049h")
    body = SGR.sub("", text[start + len("\x1b[?1049h"):])
    frame = Screen(80, body, 24).lines()
    titles = [n for n in range(1, shares + 1) if any(f"share {n} of {shares}" in l for l in frame)]
    heading = any("SSKR export" in l for l in frame)
    for _ in range(20):
        done, _status = os.waitpid(pid, os.WNOHANG)
        if done:
            break
        os.write(fd, b"\r")
        time.sleep(0.4)
        try:
            select.select([fd], [], [], 0.1) and os.read(fd, 65536)
        except OSError:
            pass
    os.close(fd)
    print(f"{threshold}-of-{shares} {share_format} {mode}: paged={paged}; titles on frame={titles}; SSKR export heading on frame={heading}")
    return paged or len(titles) == shares


results = [run(*args) for args in [(2, 3, "words"), (3, 3, "words"), (2, 3, "ur"), (3, 5, "ur"), (2, 3, "words", "seedshift")]]
sys.exit(0 if all(results) else 1)
