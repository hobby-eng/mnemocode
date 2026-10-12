"""AUD-010 cli reviewer: flows of the MnemoCode command line in a pseudo-terminal.

    node docs/audits/AUD-010-harnesses/run-command.mjs cli-pty-flows \
        python3 docs/audits/AUD-010-harnesses/cli-pty-flows.py [scenario ...]

Runs src/mnemocode.ts through Node.js with the tsx loader of this checkout, in a Unix
pseudo-terminal of 40 x 120, in a scratch folder under bip_tools/tmp/mnemocode/aud010/cli/.
Only public fixtures: the BIP39 test phrase "abandon ... about" (fingerprint 73c5da0a), that phrase
masked with the README date 23-09-2026, and shares 1 and 3 of its 2-of-3 split that
scripts/verify-terminal-input.py also uses. Each scenario prints what it checked and the values it
compared; the probe exits 1 when any check fails.

Scenarios:
- sskr-argv-dates: sskr-combine --ask-secrets with --dates on the command line. encode, decode and
  recover-date refuse --ask-secrets with command-line dates; this records what sskr-combine does.
- term-dumb: TERM=dumb on a real terminal: the --ask-secrets refusal text, and no menu.
- decode-qr-share: decode --ask-secrets --qr-file <share 1 as QR> --mode seedshift, the next share
  read from another QR image, the dates typed; the restored phrase, and nothing secret left on the
  main screen after the private screen is left.
- decode-marked: decode --ask-secrets with a code typed as ? and --encoded-fingerprint, direct and
  MnemoCode Seedshift.
- menu-coin: menu entry 5, a date digit, typed codes, MnemoCode Seedshift, an Ethereum address with
  Enter for the count; the command the menu shows and the result of running it.
"""

import os
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import sys
import termios
import fcntl
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "src" / "mnemocode.ts"
TSX = (ROOT / "node_modules" / "tsx" / "dist" / "loader.mjs").resolve().as_uri()
NODE = shutil.which("node") or "node"
WORK = ROOT.parent / "tmp/mnemocode/aud010/cli/pty"

TEST_PHRASE = " ".join(["abandon"] * 11 + ["about"])
FINGERPRINT = "73c5da0a"
# encode --mode seedshift --dates 23-09-2026 of the test phrase prints this encoded fingerprint.
ENCODED_FINGERPRINT = "0d05289e"
MASK_DATE = "23-09-2026"
MASKED_WORDS = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress"
MASKED_NUMBERS_MARKED = "2027 10 24 2027 10 24 2027 10 24 2027 10 ?"
DIRECT_NUMBERS_MARKED = " ".join(["1"] * 11 + ["?"])
# Shares 1 and 3 of a 2-of-3 split of the masked test phrase (scripts/verify-terminal-input.py).
FIRST_SHARE = "ur:sskr/gomuttaeadaernclmdemdtlftsswsospsrjnjpwzuetlfhdltahh"
THIRD_SHARE = "ur:sskr/gomuttaeadaojytnhyvtpaqdmobwreoyykutjtkofedicanladwm"
# The first Ethereum address of the test phrase, m/44'/60'/0'/0/0 (README; checked independently by
# cli-oracles.ts with @scure/bip32 and @noble/hashes keccak).
ETH_ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"

ENTER, ESCAPE = "\r", "\x1b"
LEAVE_ALTERNATE_SCREEN = "\x1b[?1049l"
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][A-Za-z0-9]|\r")

failures = []
SGR = re.compile(rb"\x1b\[([0-9;]*)m")
# The sixteen-colour palette of src/cli/terminal.ts STYLE and its reset (AGENTS.md "Terminal output").
ALLOWED_SGR = {b"", b"0", b"1", b"36", b"90", b"1;36", b"1;32", b"1;33", b"1;31"}


def check_palette(label, raw):
    codes = set(SGR.findall(raw))
    check(f"{label}: only the sixteen-colour palette", codes <= ALLOWED_SGR,
          sorted(code.decode() for code in codes))


def check(label, condition, observed):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}: {observed}")
    if not condition:
        failures.append(label)


class Session:
    def __init__(self, args, env_extra=None, cwd=WORK):
        env = {k: v for k, v in os.environ.items() if k not in ("NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE")}
        env["TERM"] = "xterm-256color"
        env.update(env_extra or {})
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        self.process = subprocess.Popen(
            [NODE, "--import", TSX, str(SOURCE), *args],
            stdin=slave, stdout=slave, stderr=slave, cwd=cwd, env=env, start_new_session=True,
        )
        os.close(slave)
        self.raw = b""
        self.mark = 0

    def _read(self, timeout):
        ready, _, _ = select.select([self.master], [], [], timeout)
        if not ready:
            return False
        try:
            data = os.read(self.master, 65536)
        except OSError:
            return False
        if not data:
            return False
        self.raw += data
        return True

    def text(self, start=0):
        return ANSI.sub("", self.raw[start:].decode("utf8", "replace"))

    def expect(self, needle, timeout=30):
        """Waits for `needle` in the plain output after the last expect; returns whether it came."""
        end = time.time() + timeout
        while time.time() < end:
            plain = self.text(self.mark)
            if needle in plain:
                self.mark = len(self.raw)
                return True
            if not self._read(0.2) and self.process.poll() is not None:
                # Drain what is left.
                while self._read(0.1):
                    pass
                if needle in self.text(self.mark):
                    self.mark = len(self.raw)
                    return True
                return False
        return False

    def send(self, text):
        time.sleep(0.25)
        os.write(self.master, text.encode())

    def finish(self, timeout=30):
        end = time.time() + timeout
        while self.process.poll() is None and time.time() < end:
            self._read(0.2)
        while self._read(0.1):
            pass
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGKILL)
            self.process.wait()
        os.close(self.master)
        return self.process.returncode


def after_leaving(raw):
    """What the main screen shows after the private screen was left the last time."""
    index = raw.rfind(LEAVE_ALTERNATE_SCREEN.encode())
    return ANSI.sub("", raw[index:].decode("utf8", "replace")) if index >= 0 else None


def make_qr(text, name):
    path = WORK / name
    script = (
        "const q=require('qrcode');"
        f"q.toFile({str(path)!r},{text!r},{{errorCorrectionLevel:'M'}}).then(()=>process.exit(0))"
    )
    subprocess.run([NODE, "-e", script], cwd=ROOT, check=True)
    return path


def scenario_sskr_argv_dates():
    print("sskr-argv-dates: sskr-combine --ask-secrets --mode seedshift --dates 23-09-2026")
    s = Session(["sskr-combine", "--ask-secrets", "--mode", "seedshift", "--dates", MASK_DATE])
    # Expected, as encode, decode and recover-date answer the same combination (cli-argv.mjs):
    # "--ask-secrets cannot be combined with ... command-line dates", exit 1, before any question.
    refused = "cannot be combined"
    asked = s.expect("Shamir shares (", 40)
    print(f"  observed: shares prompt shown={asked}; refusal text present={refused in s.text()}")
    if asked:
        s.send(f"{FIRST_SHARE};{THIRD_SHARE}{ENTER}")
        restored = s.expect(TEST_PHRASE, 60)
        dates_asked = "Dates (" in s.text()
        print(f"  observed: phrase restored with the command-line date={restored}; "
              f"dates question shown={dates_asked}")
        s.expect("Press Enter to clear this screen.", 10)
        s.send(ENTER)
    code = s.finish()
    check("--ask-secrets with command-line dates refused before any question",
          not asked and refused in s.text() and code == 1,
          f"exit={code}; shares asked={asked}; refused={refused in s.text()}")


def scenario_term_dumb():
    print("term-dumb: TERM=dumb on a pseudo-terminal (stdin and stderr are terminals)")
    s = Session(["decode", "--ask-secrets"], {"TERM": "dumb"})
    code = s.finish(40)
    plain = s.text()
    message = next((line for line in plain.splitlines() if "mnemocode:" in line), "")
    check("decode --ask-secrets refused", code == 1, f"exit={code}")
    print(f"  observed message: {message!r}")
    # Expected: the reason is the terminal type, which the message should name; stdin and stderr
    # are terminals here, so "needs a terminal" sends the person to the wrong fix.
    check("refusal names TERM=dumb rather than a missing terminal",
          "dumb" in message.lower() or "terminal type" in message.lower(), message)
    s = Session([], {"TERM": "dumb"})
    code = s.finish(40)
    print(f"  observed without arguments: exit={code}; help printed={'Usage: mnemocode' in s.text()}; "
          f"menu shown={'What do you want to do?' in s.text()}")


def scenario_decode_qr_share():
    print("decode-qr-share: decode --ask-secrets --mode seedshift --qr-file share1.png")
    make_qr(FIRST_SHARE, "share1.png")
    make_qr(THIRD_SHARE, "share3.png")
    s = Session(["decode", "--ask-secrets", "--mode", "seedshift", "--qr-file", "share1.png"])
    went = s.expect("Shamir share", 40)
    check("share in the QR image recognised and handed to the restore", went, went)
    s._read(1)
    notice = next((line.strip() for line in s.text().splitlines() if "codes of a Shamir share" in line), "")
    asked_kind = "These may be the codes of a Shamir share" in s.text()
    # decode --help says of --input-kind: "Without it, MnemoCode asks when the text is or may be a
    # share"; README says it asks only when the text could be either. Recorded for AUD-010 DOC.
    print(f"  observed: notice {notice!r}; share-or-codes question asked={asked_kind}")
    shown = s.expect(f"Share 1, from its QR code: {FIRST_SHARE}", 20)
    check("first share shown as text", shown, shown)
    asked = s.expect("The next share?", 20)
    check("next share offered from another QR image", asked, asked)
    s.send("1")
    s.expect("QR code file name:", 10)
    s.send(f"share3.png{ENTER}")
    second = s.expect(f"Share 2, from its QR code: {THIRD_SHARE}", 20)
    check("second share read from its QR image and shown", second, second)
    fingerprint = s.expect(ENCODED_FINGERPRINT, 20)
    check("encoded fingerprint shown before the dates", fingerprint, ENCODED_FINGERPRINT)
    s.expect("Dates (", 20)
    s.send(f"{MASK_DATE}{ENTER}")
    restored = s.expect(TEST_PHRASE, 40)
    print_fp = s.expect(FINGERPRINT, 10)
    check("restored phrase and original fingerprint", restored and print_fp,
          f"phrase={restored}; fingerprint {FINGERPRINT}={print_fp}")
    s.expect("Press Enter to clear this screen.", 10)
    s.send(ENTER)
    code = s.finish()
    check("exit code", code == 0, code)
    check_palette("decode and restore screens", s.raw)
    main = after_leaving(s.raw)
    leaked = main is None or "abandon" in main or "ur:sskr" in main or "gomutt" in main
    check("nothing secret on the main screen after the private screen", not leaked,
          "no leave sequence" if main is None else f"main screen after leaving: {main[:200]!r}")


def scenario_decode_marked():
    for mode, typed, fingerprint, needs_dates in (
        ("direct", DIRECT_NUMBERS_MARKED, FINGERPRINT, False),
        ("seedshift", MASKED_NUMBERS_MARKED, ENCODED_FINGERPRINT, True),
    ):
        print(f"decode-marked: decode --ask-secrets --mode {mode} --format 2 "
              f"--encoded-fingerprint {fingerprint}; codes {typed!r}")
        s = Session(["decode", "--ask-secrets", "--mode", mode, "--format", "2",
                     "--encoded-fingerprint", fingerprint])
        s.expect("Encoded seed phrase or record:", 40)
        s.send(f"{typed}{ENTER}")
        if needs_dates:
            dates = s.expect("Dates (", 40)
            check("dates asked after the codes were found", dates, dates)
            s.send(f"{MASK_DATE}{ENTER}")
        restored = s.expect(TEST_PHRASE, 60)
        plain = s.text()
        found = re.search(r"Word 12 found: ([^\n]*)", plain) or re.search(r"found: ([^\n]*)", plain)
        check(f"{mode}: phrase restored", restored, restored)
        print(f"  found line: {found.group(0) if found else None!r}")
        s.expect("Press Enter to clear this screen.", 10)
        s.send(ENTER)
        code = s.finish()
        check(f"{mode}: exit code", code == 0, code)


def scenario_menu_coin():
    print("menu-coin: entry 5 > date digit > typed > MnemoCode Seedshift > Ethereum address > Enter")
    s = Session([])
    s.expect("What do you want to do?", 40)
    s.send("5")
    s.expect("What is forgotten?", 10)
    s.send("2")
    s.expect("Where is the encoded seed phrase?", 10)
    s.send("1")
    s.expect("Which Seedshift was used?", 10)
    s.send("1")
    s.expect("How can MnemoCode recognise the wallet?", 10)
    s.send("3")
    s.expect("Which coin?", 10)
    s.send("5")
    s.expect("Address (Ethereum", 10)
    s.send(f"{ETH_ADDRESS}{ENTER}")
    s.expect("Compare with how many addresses", 10)
    s.send(ENTER)
    shown = s.expect("The same as:", 10)
    command_start = s.mark
    s._read(1)
    line = next((l.strip() for l in s.text(s.mark).splitlines() if l.strip().startswith("mnemocode ")), "")
    expected = (f"mnemocode recover-date --ask-secrets --mode seedshift --coin ethereum "
                f"--coin-address {ETH_ADDRESS} --scan-gap 20")
    check("menu shows the command with every answer as an option", shown and line == expected,
          f"shown={line!r}; expected={expected!r}")
    s.expect("Encoded seed phrase or record:", 40)
    s.send(f"{MASKED_WORDS}{ENTER}")
    s.expect("Dates with ?", 20)
    s.send(f"??-09-2026{ENTER}")
    found = s.expect(MASK_DATE, 120)
    # Only what the command wrote after the menu showed it counts.
    wallet_asked_again = "How can MnemoCode recognise the wallet?" in s.text(command_start)
    check("search with the menu's wallet finds 23-09-2026 without asking the wallet again",
          found and not wallet_asked_again, f"found={found}; wallet asked again={wallet_asked_again}")
    tail = s.text()
    at = re.search(r"m/44'/60'/0'/0/\d+", tail)
    print(f"  matched path: {at.group(0) if at else None}")
    s.expect("Press Enter to clear this screen.", 20)
    s.send(ENTER)
    s.expect("Press Enter to return to the menu", 20)
    s.send(ESCAPE)
    code = s.finish()
    check("menu exit code after Escape", code == 0, code)
    check_palette("menu and recover-date screens", s.raw)


# A public test recipient (test/menu.test.ts); the list is never decrypted here.
TEST_RECIPIENT = "age12d86zp9uj65df2snvl656uewdl82zrdfya8a2zgxu5rauaw7fsaqrr6w3x"
CTRL_C = "\x03"


def scenario_cancel():
    """Ctrl+C at a secret prompt, Ctrl+C as a key during a long date search, and SIGINT sent to the
    process during the search: exit 130, the private screen left, nothing secret on the main
    screen, and no candidate list written."""
    print("cancel: Ctrl+C at the codes prompt")
    s = Session(["decode", "--ask-secrets", "--mode", "seedshift"])
    s.expect("Encoded seed phrase or record:", 40)
    s.send(MASKED_WORDS[:20])
    s.send(CTRL_C)
    code = s.finish(15)
    main = after_leaving(s.raw)
    check("exit 130", code == 130, code)
    check("main screen after leaving: Cancelled., no typed text",
          main is not None and "Cancelled." in main and "wool" not in main,
          "no leave sequence" if main is None else repr(main.strip()[:120]))
    for how in ("key", "signal"):
        folder = WORK / f"cancel-{how}"
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir(parents=True)
        print(f"cancel: Ctrl+C as a {how} during recover-date --ask-secrets with a candidate list")
        s = Session(["recover-date", "--ask-secrets", "--mode", "seedshift", "--master-fingerprint",
                     "00000000", "--candidates-file", "c.age", "--candidates-key", TEST_RECIPIENT],
                    cwd=folder)
        s.expect("Encoded seed phrase or record:", 40)
        s.send(f"{MASKED_WORDS}{ENTER}")
        s.expect("Dates with ?", 20)
        s.send(f"?{ENTER}")
        deadline = time.time() + 20
        started = False
        while time.time() < deadline and not started:
            s._read(0.5)
            plain = s.text()
            if "Search " in plain and "Yes" in plain and "Ctrl+C stops it" in plain:
                s.send("1")
            started = "Checked" in plain or "combinations" in plain
        check(f"{how}: the search started", started, started)
        time.sleep(3)
        stopped_at = time.time()
        if how == "key":
            s.send(CTRL_C)
        else:
            os.killpg(s.process.pid, signal.SIGINT)
        code = s.finish(20)
        took = round(time.time() - stopped_at, 1)
        main = after_leaving(s.raw)
        check(f"{how}: exit 130 within 10 s", code == 130 and took <= 10, f"exit={code}; seconds={took}")
        check(f"{how}: private screen left, nothing secret on the main screen",
              main is not None and "wool" not in main and "abandon" not in main,
              "no leave sequence" if main is None else repr(main.strip()[:160]))
        files = sorted(path.name for path in folder.iterdir())
        check(f"{how}: no candidate list written", files == [], files)


SCENARIOS = {
    "sskr-argv-dates": scenario_sskr_argv_dates,
    "term-dumb": scenario_term_dumb,
    "decode-qr-share": scenario_decode_qr_share,
    "decode-marked": scenario_decode_marked,
    "menu-coin": scenario_menu_coin,
    "cancel": scenario_cancel,
}


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    names = sys.argv[1:] or list(SCENARIOS)
    for name in names:
        try:
            SCENARIOS[name]()
        except Exception as error:  # a scenario that breaks is a failed check, not a crash
            check(f"{name} ran", False, repr(error))
    print(f"\n{len(failures)} failed check(s): {failures}" if failures else "\nAll checks passed.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
