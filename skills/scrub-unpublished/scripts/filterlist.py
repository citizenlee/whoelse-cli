#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Manage and apply the user's never-share filter list.

The filter list is a plain-text file of words and phrases that must never
appear in a whoelse profile (compound names, project codenames, collaborator
names, gene IDs, ...). One entry per line; blank lines and `#` comments are
ignored. Matching is case-insensitive and whole-word.

The list itself is sensitive, so it lives OUTSIDE the repo:
default ~/.whoelse/never-share.txt, overridable via $WHOELSE_FILTER_LIST.

Usage:
  filterlist.py check <file|->     report matches; exit 1 if any found
  filterlist.py apply <file|->     print text with matches -> [REDACTED]
  filterlist.py add <entry>...     append entries to the list
  filterlist.py list               print current entries
  filterlist.py path               print the filter list path
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

REDACTION = "[REDACTED]"


def filterlist_path() -> Path:
    return Path(
        os.environ.get("WHOELSE_FILTER_LIST", "")
        or Path.home() / ".whoelse" / "never-share.txt"
    )


def load_entries(path: Path) -> list[str]:
    if not path.exists():
        return []
    entries = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            entries.append(line)
    return entries


def compile_pattern(entries: list[str]) -> re.Pattern | None:
    if not entries:
        return None
    # Longest first so phrases win over their substrings; \b only where the
    # entry edge is a word character (entries may start/end with symbols).
    parts = []
    for entry in sorted(entries, key=len, reverse=True):
        escaped = re.escape(entry)
        prefix = r"\b" if entry[0].isalnum() or entry[0] == "_" else ""
        suffix = r"\b" if entry[-1].isalnum() or entry[-1] == "_" else ""
        parts.append(f"{prefix}{escaped}{suffix}")
    return re.compile("|".join(parts), re.IGNORECASE)


def read_input(arg: str) -> str:
    return sys.stdin.read() if arg == "-" else Path(arg).read_text()


def cmd_check(text: str, pattern: re.Pattern | None) -> int:
    if pattern is None:
        print("filter list is empty; nothing to check")
        return 0
    hits = 0
    for lineno, line in enumerate(text.splitlines(), 1):
        for m in pattern.finditer(line):
            hits += 1
            print(f"line {lineno}: matched filter entry {m.group(0)!r}")
    if hits:
        print(f"\n{hits} match(es) — this text must not be shared as-is")
        return 1
    print("no filter-list matches")
    return 0


def cmd_apply(text: str, pattern: re.Pattern | None) -> int:
    sys.stdout.write(pattern.sub(REDACTION, text) if pattern else text)
    return 0


def cmd_add(path: Path, new_entries: list[str]) -> int:
    existing = {e.lower() for e in load_entries(path)}
    to_add = [e for e in new_entries if e.strip() and e.strip().lower() not in existing]
    if not to_add:
        print("nothing to add (already present or empty)")
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        for entry in to_add:
            f.write(entry.strip() + "\n")
    print(f"added {len(to_add)} entr(ies) to {path}")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 1:
        print(__doc__, file=sys.stderr)
        return 2
    cmd, *rest = argv
    path = filterlist_path()
    if cmd == "path":
        print(path)
        return 0
    if cmd == "list":
        for entry in load_entries(path):
            print(entry)
        return 0
    if cmd == "add":
        if not rest:
            print("usage: filterlist.py add <entry>...", file=sys.stderr)
            return 2
        return cmd_add(path, rest)
    if cmd in ("check", "apply"):
        if len(rest) != 1:
            print(f"usage: filterlist.py {cmd} <file|->", file=sys.stderr)
            return 2
        text = read_input(rest[0])
        pattern = compile_pattern(load_entries(path))
        return cmd_check(text, pattern) if cmd == "check" else cmd_apply(text, pattern)
    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
