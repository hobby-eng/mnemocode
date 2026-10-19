"""Ctrl+C while an export draws card images on the private screen (AUD-037-SEC002): the command
ends as cancelled, with one "Cancelled." line and exit code 130, and leaves none of the temporary
folders that hold private copies. A stub pdftocairo, first in PATH, waits until it is stopped.
Public test phrase only. Not on Windows, where Ctrl+C is read as a key after the export."""
import os
import tempfile
import time
from pathlib import Path

import terminal_session as terminal
from terminal_answers import CANCELLED, SEED_PHRASE, TEST_PHRASE

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
TEMPORARY = ("mnemocode-raster-", ".mnemocode-images-", ".card-collection-", ".mnemocode-export-")


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
    """A single sheet of images, stopped at its first page, and separate card images, stopped
    after the first card was staged."""
    if terminal.WINDOWS:
        return
    cases = (
        (("--images-dir", "images"), True),
        (("--template", "business-it", "--cards-dir", "cards"), False),
    )
    for output, at_first in cases:
        with tempfile.TemporaryDirectory() as folder:
            stopped_while_drawing(Path(folder), output, at_first)
    print("Ctrl+C while card images are drawn: cancelled, exit 130, no temporary folder left")


def stopped_while_drawing(folder, output, at_first):
    """Encodes the test phrase with `output` in `folder` and types Ctrl+C while a page is drawn:
    the first one when `at_first`, else the second, once the first card is staged."""
    programs, log, drawn = folder / "bin", folder / "renders.log", folder / "drawn"
    programs.mkdir()
    stub = programs / "pdftocairo"
    stub.write_text(STUB.format(log=log, drawn=drawn))
    stub.chmod(0o755)
    if at_first:
        drawn.touch()
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
        renders = 2 if at_first else 3
        end = time.monotonic() + 60
        while not (log.exists() and len(log.read_text().splitlines()) >= renders):
            assert time.monotonic() < end, "the renderer was not asked for the page"
            session.read_some(wait=0.1)
        session.type(terminal.CTRL_C)
        assert session.wait_for_exit() == CANCELLED
        shown = terminal.main_screen_text(terminal.read_to_end(session))
        assert shown.count("Cancelled.") == 1, shown
    finally:
        session.close()
    assert temporary_folders(folder) == set(), "a staging folder was left beside the output"
    assert temporary_folders(*memory) == before, "a raster folder was left"
