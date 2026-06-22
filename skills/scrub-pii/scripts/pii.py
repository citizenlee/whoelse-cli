#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Detect and redact deterministic personal identifiers in a whoelse profile.

This is the regex layer of scrub-pii: only the unambiguous cases that don't
need model judgment. Names and affiliations are handled separately (model
pass — see SKILL.md). Precision over recall: a false positive that mangles a
version number or p-value erodes trust, so the patterns are deliberately
conservative.

Categories -> placeholder:
  email addresses        -> [EMAIL]
  ORCID iDs              -> [ORCID]   (0000-0002-1825-0097, last char may be X)
  phone numbers          -> [PHONE]   (intl + US; needs real structure)
  @-handles              -> [HANDLE]  (Discord/GitHub @username; not decorators)

Usage:
  pii.py check <file|->     report findings; exit 1 if any found
  pii.py apply <file|->     print text with identifiers -> placeholders
"""

import re
import sys
from pathlib import Path

# --- Patterns -------------------------------------------------------------

# Email: standard local@domain with a real TLD. Anchored on word edges so we
# don't grab a trailing dot/paren from prose.
EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")

# ORCID: 16 digits in 4 hyphenated groups, final group may end in X (checksum).
# Optionally prefixed by an orcid.org URL, which we swallow whole.
ORCID = re.compile(r"\b(?:https?://orcid\.org/)?\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b")

# Phone: require genuine phone structure so years/versions/p-values don't hit.
#   - optional +CC country code
#   - separators limited to space, hyphen, dot, and parens around an area code
#   - at least 10 digits total in a sensible grouping
# We match a few common shapes rather than one permissive blob.
PHONE = re.compile(
    r"""
    (?<![\w.])                       # not glued to a word/number (e.g. v2.10)
    (?:
        \+\d{1,3}[ .-]?              # +1, +44, +351 ...
        (?:\(?\d{1,4}\)?[ .-]?){2,4} # groups of digits
        \d{2,4}
      |
        \(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}  # US: (415) 555-2671 / 415-555-2671
    )
    (?![\w.])                        # not glued to trailing word/number
    """,
    re.VERBOSE,
)

# @-handle: an @ that starts a username, NOT preceded by a word char (so it
# isn't an email's @ or mid-word) and NOT followed by a call/attribute (so
# @app.route( / @pytest.fixture read as code, not handles — but a sentence-
# ending period after the handle is fine: "." only counts as code when a word
# char follows it). Conservative: 2-30 chars, alphanumerics/underscore/hyphen.
HANDLE = re.compile(r"(?<![\w@./])@([A-Za-z][A-Za-z0-9_-]{1,29})(?!\w|\(|\.\w)")

# A bare decorator like @dataclass has the same shape as a handle. We can't
# tell them apart from context alone, so we skip a small set of well-known
# Python decorator / framework names. Precision over recall: better to miss a
# real handle that happens to collide with one of these than to mangle code.
DECORATOR_NAMES = frozenset(
    {
        "dataclass",
        "staticmethod",
        "classmethod",
        "property",
        "abstractmethod",
        "cached_property",
        "override",
        "wraps",
        "lru_cache",
        "cache",
        "contextmanager",
        "fixture",
        "patch",
        "app",
        "router",
        "pytest",
        "mock",
        "task",
        "njit",
        "jit",
    }
)

ORDER = [
    ("[EMAIL]", EMAIL),  # before HANDLE so the @ inside an email isn't a handle
    ("[ORCID]", ORCID),
    ("[PHONE]", PHONE),
    ("[HANDLE]", HANDLE),
]


def find_all(text: str) -> list[tuple[int, int, str, str]]:
    """Return (start, end, placeholder, matched) spans, no overlaps, in order."""
    spans: list[tuple[int, int, str, str]] = []
    claimed: list[tuple[int, int]] = []

    def overlaps(s: int, e: int) -> bool:
        return any(s < ce and cs < e for cs, ce in claimed)

    for placeholder, pattern in ORDER:
        for m in pattern.finditer(text):
            s, e = m.start(), m.end()
            if overlaps(s, e):
                continue
            if placeholder == "[HANDLE]" and m.group(1).lower() in DECORATOR_NAMES:
                continue
            spans.append((s, e, placeholder, m.group(0)))
            claimed.append((s, e))
    spans.sort()
    return spans


def read_input(arg: str) -> str:
    return sys.stdin.read() if arg == "-" else Path(arg).read_text()


def cmd_check(text: str) -> int:
    spans = find_all(text)
    if not spans:
        print("no deterministic PII identifiers found")
        return 0
    # Report by line for readability.
    offsets = []
    pos = 0
    for lineno, line in enumerate(text.splitlines(keepends=True), 1):
        offsets.append((lineno, pos, pos + len(line)))
        pos += len(line)
    for s, _e, placeholder, matched in spans:
        lineno = next((ln for ln, a, b in offsets if a <= s < b), 1)
        print(f"line {lineno}: {placeholder} <- {matched!r}")
    print(f"\n{len(spans)} identifier(s) — must be redacted before sharing")
    return 1


def cmd_apply(text: str) -> int:
    spans = find_all(text)
    out, pos = [], 0
    for s, e, placeholder, _matched in spans:
        out.append(text[pos:s])
        out.append(placeholder)
        pos = e
    out.append(text[pos:])
    sys.stdout.write("".join(out))
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] not in ("check", "apply"):
        print(__doc__, file=sys.stderr)
        return 2
    cmd, src = argv
    text = read_input(src)
    return cmd_check(text) if cmd == "check" else cmd_apply(text)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
