"""Observe one actual private question transition; public phrase, no export."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts'))
from terminal_session import Session, ENTER, CTRL_C  # noqa: E402

session = Session(arguments=['encode', '--ask-secrets', '--mode', 'seedshift', '--format', '1'])
try:
    session.wait_for('Seed phrase (English BIP39 words):')
    before = len(session.output)
    session.type('abandon ' * 11 + 'about' + ENTER)
    session.wait_for('Dates (up to 4, DD-MM-YYYY, separated by spaces):')
    transition = session.output[before:]
    cleared = '\x1b[2J' in transition or '\x1b[3J' in transition
    session.type(CTRL_C)
    code = session.wait_for_exit()
    print({'newStepCleared': cleared, 'cancelExit': code, 'expected': 'fresh step screen and exit 130'})
    raise SystemExit(0 if cleared and code == 130 else 1)
finally:
    session.close()
