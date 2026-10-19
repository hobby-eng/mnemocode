"""Ctrl+C while an export draws card images on the private screen (AUD-037-SEC002): the command
ends as cancelled, with one "Cancelled." line and exit code 130, and leaves none of the temporary
folders that hold private copies. A stub pdftocairo, first in PATH, waits until it is stopped.
Public test phrase only. Not on Windows, where Ctrl+C is read as a key after the export."""
import os
import signal
import subprocess
import tempfile
import time
from pathlib import Path

import terminal_session as terminal
from terminal_answers import (
    CANCELLED,
    CLEAR_PROMPT,
    HIDDEN_RECORD,
    SEED_PHRASE,
    TEST_PHRASE,
    WORD_NUMBERS,
)

# The stub: answers for its version, draws the first page asked for unless it has drawn one
# before ("drawn"), and waits for any other until it is stopped.
STUB = """#!/bin/sh
echo "$*" >> '{log}'
[ "$1" = "-v" ] && exit 0
if [ ! -e '{drawn}' ]; then
  : > '{drawn}'
  for last; do :; done
  printf 'png' > "$last.png"
  exit 0
fi
exec sleep 60
"""
# The folders that hold private copies while an export is made.
TEMPORARY = (
    "mnemocode-raster-",
    ".mnemocode-images-",
    ".card-collection-",
    ".sskr-cards-",
    ".mnemocode-export-",
)


def temporary_folders(*folders):
    """The temporary folders of exports in `folders`."""
    return {
        entry
        for folder in folders
        if folder.is_dir()
        for entry in folder.iterdir()
        if entry.name.startswith(TEMPORARY)
    }


def check_ctrl_c_during_image_export():
    """A single sheet of images, stopped at its first page, and separate card images and the
    cards of shares, stopped after the first card was staged."""
    if terminal.WINDOWS:
        return
    shares = ("--sskr", "--threshold", "2", "--shares", "2", "--share-format", "colors")
    cases = (
        (("--images-dir", "images"), True),
        (("--template", "business-it", "--cards-dir", "cards"), False),
        ((*shares, "--card-layout", "collection", "--cards-dir", "shares"), False),
    )
    for output, at_first in cases:
        with tempfile.TemporaryDirectory() as folder:
            stopped_while_drawing(Path(folder), output, at_first)
    print("Ctrl+C while card images are drawn: cancelled, exit 130, no temporary folder left")


def stub_renderer(folder, at_first):
    """Puts the stub renderer into `folder`/bin, waiting at the first page when `at_first`;
    returns that folder and the log of its runs."""
    programs, log, drawn = folder / "bin", folder / "renders.log", folder / "drawn"
    programs.mkdir()
    stub = programs / "pdftocairo"
    stub.write_text(STUB.format(log=log, drawn=drawn))
    stub.chmod(0o755)
    if at_first:
        drawn.touch()
    return programs, log


def wait_for_renders(log, renders, read=lambda: time.sleep(0.1)):
    """Waits until the renderer was run `renders` times: its version, then the pages."""
    end = time.monotonic() + 60
    while not (log.exists() and len(log.read_text().splitlines()) >= renders):
        assert time.monotonic() < end, "the renderer was not asked for the page"
        read()


def stopped_while_drawing(folder, output, at_first):
    """Encodes the test phrase with `output` in `folder` and types Ctrl+C while a page is drawn:
    the first one when `at_first`, else the second, once the first card is staged."""
    programs, log = stub_renderer(folder, at_first)
    memory = (Path("/dev/shm"), Path(tempfile.gettempdir()))
    before = temporary_folders(*memory)
    path = os.environ["PATH"]
    os.environ["PATH"] = f"{programs}{os.pathsep}{path}"
    try:
        arguments = ("encode", "--ask-secrets", "--mode", "direct", "--format", "5")
        session = terminal.Session((*arguments, *output, "--image-format", "png"), folder=folder)
    finally:
        os.environ["PATH"] = path
    try:
        session.wait_for(SEED_PHRASE)
        session.type(TEST_PHRASE + terminal.ENTER)
        # The version, then the pages: the one that waits is the last.
        wait_for_renders(log, 2 if at_first else 3, lambda: session.read_some(wait=0.1))
        session.type(terminal.CTRL_C)
        assert session.wait_for_exit() == CANCELLED
        shown = terminal.main_screen_text(terminal.read_to_end(session))
        assert shown.count("Cancelled.") == 1, shown
    finally:
        session.close()
    assert temporary_folders(folder) == set(), "a staging folder was left beside the output"
    assert temporary_folders(*memory) == before, "a raster folder was left"



def check_interrupt_without_terminal():
    """Ctrl+C sent to a command that a script runs, with no private screen, while a card image is
    drawn: the same end, and no temporary folder left."""
    if terminal.WINDOWS:
        return
    with tempfile.TemporaryDirectory() as name:
        folder = Path(name)
        programs, log = stub_renderer(folder, True)
        (folder / "phrase.txt").write_text(TEST_PHRASE)
        memory = (Path("/dev/shm"), Path(tempfile.gettempdir()))
        before = temporary_folders(*memory)
        arguments = (
            *("encode", "--mode", "direct", "--mnemonic-file", "phrase.txt", "--format", "5"),
            *("--images-dir", "images", "--image-format", "png"),
        )
        environment = dict(os.environ, PATH=f"{programs}{os.pathsep}{os.environ['PATH']}")
        process = subprocess.Popen(
            [*terminal.COMMAND, *arguments],
            cwd=folder,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        try:
            wait_for_renders(log, 2)
            # As a terminal sends Ctrl+C: to the whole group, the renderer included.
            os.killpg(process.pid, signal.SIGINT)
            _, errors = process.communicate(timeout=30)
        finally:
            if process.poll() is None:
                process.kill()
        assert process.returncode == CANCELLED, process.returncode
        assert errors.count("Cancelled.") == 1, errors
        assert temporary_folders(folder) == set(), "a staging folder was left beside the output"
        assert temporary_folders(*memory) == before, "a raster folder was left"
    print("Ctrl+C while a script's command draws card images: cancelled, no temporary folder left")


def check_interrupt_at_clear_prompt():
    """A SIGINT while the result waits for Enter to clear the private screen, sent as a terminal
    sends Ctrl+C: the screen is left before "Cancelled.", with exit code 130."""
    if terminal.WINDOWS:
        return
    session = terminal.Session(("decode", "--ask-secrets", "--mode", "direct"))
    try:
        session.wait_for(HIDDEN_RECORD)
        session.type(WORD_NUMBERS + terminal.ENTER)
        session.wait_for(CLEAR_PROMPT)
        mark = len(session.output)
        os.killpg(os.getpgid(session.pid), signal.SIGINT)
        assert session.wait_for_exit() == CANCELLED
        after = session.output[mark:]
        leave = after.find(terminal.LEAVE_ALTERNATE_SCREEN)
        assert -1 < leave < after.find("Cancelled."), f"the private screen stayed: {after!r}"
    finally:
        session.close()
    print("SIGINT at the prompt after a result: the private screen is left, then cancelled")
