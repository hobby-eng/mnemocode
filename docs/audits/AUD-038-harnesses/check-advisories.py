"""Distinguish live network checks from explicit cached advisory replay."""
import importlib.util
import tempfile
from pathlib import Path
from unittest.mock import patch

if not __debug__:
    raise SystemExit("Run this check without Python optimization.")

SPEC = importlib.util.spec_from_file_location(
    "checker", Path(__file__).with_name("advisories.py")
)
CHECKER = importlib.util.module_from_spec(SPEC)
with patch("sys.argv", ["advisories.py"]):
    SPEC.loader.exec_module(CHECKER)


def main():
    """Fake only the network edge; refuse silently reused live results."""
    with tempfile.TemporaryDirectory(dir=CHECKER.EVIDENCE) as folder:
        with patch.object(CHECKER, "OUT", Path(folder)):
            with patch.object(CHECKER.subprocess, "check_output",
                              return_value="[]") as network:
                CHECKER.request("npm", ["example@1.0.0"], "reviewed", "case")
                assert network.call_count == 1
            with patch.object(CHECKER.subprocess, "check_output") as network:
                try:
                    CHECKER.request("npm", ["example@1.0.0"], "reviewed",
                                    "case")
                except SystemExit:
                    pass
                else:
                    raise AssertionError("Live check reused retained data.")
                assert network.call_count == 0
            with patch.object(CHECKER, "CACHED_ONLY", True):
                with patch.object(CHECKER.subprocess,
                                  "check_output") as network:
                    result = CHECKER.request(
                        "npm", ["example@1.0.0"], "reviewed", "case"
                    )
                    assert result["count"] == 0
                    assert network.call_count == 0
    print("PASS: live checks fetch or refuse; cached replay is explicit.")


if __name__ == "__main__":
    main()
