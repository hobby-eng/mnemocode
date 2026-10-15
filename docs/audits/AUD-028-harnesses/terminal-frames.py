"""AUD-028: three bounded text-only native PTY cases; no PDF or image output."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts'))
import terminal_session as terminal

terminal.TERMINAL_ROWS, terminal.TERMINAL_COLUMNS = 24, 80
PHRASE = 'abandon ' * 11 + 'about'
CLEAR = 'Press Enter to clear this screen.'
rows = []


def cleanup(session):
    session.close()
    # The driver leak is itself reviewed: close this probe's descriptor explicitly too.
    try:
        os.close(session.fd)
    except OSError:
        pass


def frame(session):
    session.read_some(0.1)
    start = session.output.rfind(terminal.ENTER_ALTERNATE_SCREEN)
    assert start >= 0
    text = session.output[start + len(terminal.ENTER_ALTERNATE_SCREEN):]
    return '\n'.join(terminal.Screen(80, text, 24).lines())


session = terminal.Session(('table', '--word', 'abandon'))
try:
    assert session.wait_for_exit(10) == 0
    session.close()
    try:
        os.fstat(session.fd)
        descriptor_closed = False
    except OSError:
        descriptor_closed = True
    rows.append({'case': 'closed PTY master', 'descriptorClosed': descriptor_closed})
finally:
    cleanup(session)

session = terminal.Session(('encode', '--sskr', '--ask-secrets', '--mode', 'direct',
                            '--threshold', '16', '--shares', '16', '--share-format', 'words',
                            '--backup-check', 'no'))
try:
    session.wait_for('Seed phrase (English BIP39 words):', 15)
    session.type(PHRASE + terminal.ENTER)
    session.wait_for(CLEAR, 15)
    before = frame(session)
    session.type(terminal.UP + '\x1b[5~')
    after = frame(session)
    rows.append({'case': 'sixteen screen-only shares',
                 'transcriptShareTitles': len(re.findall(r'SSKR share \d+ of 16', session.output)),
                 'visibleShareTitles': re.findall(r'SSKR share (\d+) of 16', before),
                 'firstShareVisible': 'SSKR share 1 of 16' in before,
                 'firstShareVisibleAfterUpPageUp': 'SSKR share 1 of 16' in after,
                 'frameRows': 24, 'frameColumns': 80})
    session.type(terminal.ENTER)
    assert session.wait_for_exit(10) == 0
finally:
    cleanup(session)

scratch = ROOT.parent / 'tmp/mnemocode/aud-028'
with tempfile.TemporaryDirectory(prefix='public-frame-', dir=scratch) as directory:
    path = Path(directory) / 'public-codes.txt'
    path.write_text('abandon ' * 23 + '?', encoding='utf8')
    session = terminal.Session(('decode', '--ask-secrets', '--mode', 'direct', '--format', 'english',
                                '--input-kind', 'codes', '--list-candidates', '--words', '24',
                                '--input-file', str(path)))
    try:
        session.wait_for(CLEAR, 15)
        visible = frame(session)
        session.type(terminal.UP + '\x1b[5~')
        after = frame(session)
        # Tabs are emitted by this presenter; native PTY output expands them as terminal stops.
        transcript = session.output
        rows.append({'case': 'eight long missing-code candidates',
                     'transcriptHasFirstCandidate': re.search(r'(?:^|\n)1\s+abandon', transcript) is not None,
                     'frameHasFirstCandidate': re.search(r'(?:^|\n)1\s+abandon', visible) is not None,
                     'frameHasFirstCandidateAfterUpPageUp': re.search(r'(?:^|\n)1\s+abandon', after) is not None,
                     'frameRows': 24, 'frameColumns': 80})
        session.type(terminal.ENTER)
        assert session.wait_for_exit(10) == 0
    finally:
        cleanup(session)

print(json.dumps({'program': Path(terminal.FULL_PATH).name, 'observations': rows}, indent=2))
raise SystemExit(0 if all(row.get('descriptorClosed', row.get('firstShareVisible',
                 row.get('frameHasFirstCandidate', False))) for row in rows) else 1)
