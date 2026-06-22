#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Manage the user's ORCID iD for /whoelse.

The iD is stored locally (~/.whoelse/orcid by default; $WHOELSE_ORCID overrides the
location). It is OPT-IN: /whoelse includes it in the profile only if it is set, and
the user still approves it at the review gate. An ORCID iD is a PUBLIC identifier,
so it is stored in plain text (unlike the sensitive never-share list).

v1 caveat: the iD is SELF-DECLARED, not OAuth-verified — treat it as "claimed",
not "verified", until ORCID OAuth sign-in lands (roadmap Stage 1b).

Usage:
  orcid.py validate <iD>     exit 0 if a valid ORCID iD (format + checksum), else 1
  orcid.py set <iD>          validate, then save (accepts a bare iD or an orcid.org URL)
  orcid.py get               print the saved iD (nothing if unset)
  orcid.py clear             remove the saved iD
  orcid.py path              print the config path
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

# 16 digits in 4 groups; final character may be the checksum 'X'.
_ORCID_RE = re.compile(r"\d{4}-\d{4}-\d{4}-\d{3}[\dX]")


def orcid_path() -> Path:
    return Path(os.environ.get("WHOELSE_ORCID", "") or Path.home() / ".whoelse" / "orcid")


def normalize(raw: str) -> str:
    """Strip whitespace and an optional orcid.org URL prefix; upper-case the iD."""
    return raw.strip().rsplit("/", 1)[-1].strip().upper()


def is_valid(raw: str) -> bool:
    """Validate ORCID format AND the ISO 7064 MOD 11-2 check digit."""
    s = normalize(raw)
    if not _ORCID_RE.fullmatch(s):
        return False
    digits = s.replace("-", "")
    total = 0
    for ch in digits[:-1]:
        total = (total + int(ch)) * 2
    expected = (12 - total % 11) % 11
    return ("X" if expected == 10 else str(expected)) == digits[-1]


def get_id() -> str:
    p = orcid_path()
    return p.read_text().strip() if p.exists() else ""


def set_id(raw: str) -> int:
    if not is_valid(raw):
        print(f"not a valid ORCID iD: {raw!r}", file=sys.stderr)
        return 1
    p = orcid_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(normalize(raw) + "\n")
    print(f"saved ORCID {normalize(raw)} to {p}")
    return 0


def clear_id() -> int:
    p = orcid_path()
    if p.exists():
        p.unlink()
    return 0


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    cmd, *rest = argv
    if cmd == "path":
        print(orcid_path())
        return 0
    if cmd == "get":
        s = get_id()
        if s:
            print(s)
        return 0
    if cmd == "clear":
        return clear_id()
    if cmd in ("validate", "set"):
        if len(rest) != 1:
            print(f"usage: orcid.py {cmd} <iD>", file=sys.stderr)
            return 2
        if cmd == "validate":
            return 0 if is_valid(rest[0]) else 1
        return set_id(rest[0])
    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
