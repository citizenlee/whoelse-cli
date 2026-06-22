#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Detect and redact local-environment fingerprints in a whoelse profile.

Deterministic, line-by-line regex pass for the things that betray *where* a
draft was written: absolute file paths, home-relative paths, IP addresses,
internal hostnames/URLs, and usernames lifted from those paths. These are
hard signals; the SKILL.md model pass handles what regex can't (a lab server
whose name looks like an ordinary word).

Precision over coverage — a false positive that mangles public text (a DOI, a
package URL) erodes trust in the pipeline, so the patterns are deliberately
narrow: paths must embed a username or project structure, IPs are boundaried
so version strings don't match, and public hosts are allowlisted.

Usage:
  localenv.py check <file|->     report category + match per line; exit 1 if any
  localenv.py apply <file|->     print text with matches -> category placeholders
"""

import re
import sys
from pathlib import Path

# Hosts that are public by construction — never flag these as internal.
PUBLIC_HOST_RE = re.compile(
    r"(?:^|\.)(?:"
    r"github\.com|gitlab\.com|arxiv\.org|doi\.org|"
    r"pypi\.org|files\.pythonhosted\.org|huggingface\.co|"
    r"google\.com|wikipedia\.org|ncbi\.nlm\.nih\.gov|"
    r"readthedocs\.io|openai\.com|anthropic\.com"
    r")$",
    re.IGNORECASE,
)

# Each rule: (CATEGORY, placeholder, compiled regex). Order matters — earlier
# rules win a span (paths before the usernames/hosts embedded in them).
USER_PATH = re.compile(r"(?:/(?:Users|home)/)([A-Za-z0-9._-]+)(?:/[^\s\"'`,;:)\]]*)?")
WIN_PATH = re.compile(r"[A-Za-z]:\\Users\\([A-Za-z0-9._-]+)(?:\\[^\s\"'`,;:)\]]*)?")
MACHINE_PATH = re.compile(r"/(?:tmp|var|opt|mnt|srv|scratch)/[^\s\"'`,;:)\]]+")
HOME_PATH = re.compile(r"~/[^\s\"'`,;:)\]]+")

# IPv4, boundaried so dotted version strings don't match: nothing adjacent may
# extend the dotted run ((?<![.\d]) / (?!\.?\d)), and a "version"/"v" prefix
# (a 4-part version like 1.2.3.4) is excluded in code below.
IPV4 = re.compile(
    r"(?<![.\d])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\.?\d)"
)
VERSION_PREFIX = re.compile(r"(?:version|ver|v|release|rev|build)\s*$", re.IGNORECASE)
# A bare dotted-quad is ambiguous (1.2.3.4 is also a version). Redact it only when
# it is a private-range address or sits next to network context; otherwise leave it
# for the model pass rather than mangle a legitimate version string.
IP_CUE = re.compile(
    r"\b(?:ip|address|addr|host|hostname|server|worker|node|endpoint|gateway|router|"
    r"ssh|ping|curl|connect|bind|listen|subnet|dns)\b",
    re.IGNORECASE,
)


def is_private_ipv4(ip: str) -> bool:
    o = [int(x) for x in ip.split(".")]
    return (
        o[0] == 10
        or (o[0] == 172 and 16 <= o[1] <= 31)
        or (o[0] == 192 and o[1] == 168)
        or o[0] == 127
        or (o[0] == 169 and o[1] == 254)
        or (o[0] == 100 and 64 <= o[1] <= 127)
    )

# URLs first (scheme present), then bare internal hosts and host:port, then ssh.
INTERNAL_URL = re.compile(r"\b(?:https?|ftp|ssh)://[^\s\"'`,;<>)\]]+", re.IGNORECASE)
INTERNAL_HOST = re.compile(
    r"\b(?:localhost|[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*"
    r"\.(?:local|internal|corp|lan|intra))\b(?::\d{2,5})?",
    re.IGNORECASE,
)
HOST_PORT = re.compile(r"\b[A-Za-z][A-Za-z0-9-]{1,}(?::\d{2,5})\b")
SSH_TARGET = re.compile(r"\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\b")


def is_public_url(text: str) -> bool:
    m = re.match(r"[a-z]+://([^/\s:]+)", text, re.IGNORECASE)
    return bool(m and PUBLIC_HOST_RE.search(m.group(1)))


def scan(text: str) -> list[tuple[int, int, str, str, str]]:
    """Return (lineno, start, end, category, placeholder) for each match,
    plus usernames discovered in paths flagged elsewhere in the same text."""
    users: set[str] = set()
    found: list[tuple[int, int, str, str, str]] = []

    for lineno, line in enumerate(text.splitlines(), 1):
        spans: list[tuple[int, int, str, str]] = []  # start, end, cat, placeholder

        def claim(start: int, end: int, cat: str, ph: str) -> bool:
            # Don't swallow trailing sentence punctuation into the placeholder.
            while end > start and line[end - 1] in ".,;:":
                end -= 1
            # Skip if this span overlaps one already claimed on this line.
            if any(start < e and s < end for s, e, _, _ in spans):
                return False
            spans.append((start, end, cat, ph))
            return True

        for m in USER_PATH.finditer(line):
            if claim(m.start(), m.end(), "PATH", "[PATH]"):
                users.add(m.group(1))
        for m in WIN_PATH.finditer(line):
            if claim(m.start(), m.end(), "PATH", "[PATH]"):
                users.add(m.group(1))
        for m in HOME_PATH.finditer(line):
            claim(m.start(), m.end(), "PATH", "[PATH]")
        for m in MACHINE_PATH.finditer(line):
            claim(m.start(), m.end(), "PATH", "[PATH]")
        for m in IPV4.finditer(line):
            before = line[: m.start()]
            if VERSION_PREFIX.search(before):
                continue  # 1.2.3.4 after "version" is not an address
            if not (
                is_private_ipv4(m.group(0))
                or IP_CUE.search(before[-32:])
                or line[m.end():].lstrip().startswith(":")
            ):
                continue  # ambiguous public dotted-quad (likely a version) — leave to the model
            claim(m.start(), m.end(), "IP", "[IP]")
        for m in INTERNAL_URL.finditer(line):
            if not is_public_url(m.group(0)):
                claim(m.start(), m.end(), "URL", "[URL]")
        for m in INTERNAL_HOST.finditer(line):
            claim(m.start(), m.end(), "HOST", "[HOST]")
        for m in SSH_TARGET.finditer(line):
            claim(m.start(), m.end(), "HOST", "[HOST]")
        for m in HOST_PORT.finditer(line):
            claim(m.start(), m.end(), "HOST", "[HOST]")

        for start, end, cat, ph in spans:
            found.append((lineno, start, end, cat, ph))

    # Second pass: a username seen in a path is a leak anywhere in the text.
    if users:
        user_re = re.compile(
            r"\b(?:"
            + "|".join(re.escape(u) for u in sorted(users, key=len, reverse=True))
            + r")\b",
            re.IGNORECASE,
        )
        for lineno, line in enumerate(text.splitlines(), 1):
            line_spans = [(s, e) for (ln, s, e, _, _) in found if ln == lineno]
            for m in user_re.finditer(line):
                if not any(s < m.end() and m.start() < e for s, e in line_spans):
                    found.append((lineno, m.start(), m.end(), "USER", "[USER]"))

    return found


def cmd_check(text: str) -> int:
    matches = sorted(scan(text), key=lambda r: (r[0], r[1]))
    if not matches:
        print("no local-environment matches")
        return 0
    lines = text.splitlines()
    for lineno, start, end, cat, _ in matches:
        print(f"line {lineno}: {cat}: {lines[lineno - 1][start:end]!r}")
    print(f"\n{len(matches)} match(es) — this text leaks local environment details")
    return 1


def cmd_apply(text: str) -> int:
    by_line: dict[int, list[tuple[int, int, str]]] = {}
    for lineno, start, end, _, ph in scan(text):
        by_line.setdefault(lineno, []).append((start, end, ph))
    out = []
    for lineno, line in enumerate(text.splitlines(), 1):
        for start, end, ph in sorted(by_line.get(lineno, []), reverse=True):
            line = line[:start] + ph + line[end:]
        out.append(line)
    sys.stdout.write("\n".join(out) + ("\n" if text.endswith("\n") else ""))
    return 0


def read_input(arg: str) -> str:
    return sys.stdin.read() if arg == "-" else Path(arg).read_text()


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] not in ("check", "apply"):
        print(__doc__, file=sys.stderr)
        return 2
    cmd, src = argv
    text = read_input(src)
    return cmd_check(text) if cmd == "check" else cmd_apply(text)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
