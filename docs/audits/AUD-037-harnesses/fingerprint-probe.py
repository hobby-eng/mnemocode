"""AUD-037-UI001 probe (from reviewer R4): is the encoded fingerprint still on the private screen when
the dates are asked? Exits 1 while it is not (the defect), 0 once it is. Run from the repository root
after pnpm build.

Public test data only (README date, abandon ... about masked as word numbers)."""

import sys

sys.path.insert(0, "scripts")
from terminal_session import (  # noqa: E402
    ENTER_ALTERNATE_SCREEN,
    TERMINAL_COLUMNS,
    TERMINAL_ROWS,
    CTRL_C,
    ENTER,
    Screen,
    Session,
)

MASKED = "2027 10 24 2027 10 24 2027 10 24 2027 10 377"


def frame(session):
    session.read_some(wait=0.3)
    start = session.output.rfind(ENTER_ALTERNATE_SCREEN)
    text = session.output[start + len(ENTER_ALTERNATE_SCREEN):]
    return Screen(TERMINAL_COLUMNS, text, TERMINAL_ROWS).lines()


def main():
    session = Session(["decode", "--ask-secrets", "--mode", "seedshift"])
    try:
        session.wait_for("Encoded seed phrase, record or text file path:")
        session.type(MASKED + ENTER)
        session.wait_for("Dates (")
        lines = frame(session)
        print("---- frame when the dates are asked ----")
        for line in lines:
            if line:
                print(repr(line))
        raw = session.output
        print("fingerprint ever written:", "fingerprint" in raw.lower())
        shown = any("fingerprint" in line.lower() for line in lines)
        print("fingerprint on the Dates frame:", shown)
        session.type(CTRL_C)
        print("exit:", session.wait_for_exit())
    finally:
        session.close()
    return 0 if shown else 1


sys.exit(main())
