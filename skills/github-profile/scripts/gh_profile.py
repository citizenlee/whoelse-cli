#!/usr/bin/env python3
"""Derive a GitHub "substance" signal for /whoelse from the local `gh` CLI.

The user is already authenticated in `gh`, so the login this returns is *their*
verified handle — no OAuth flow needed (server-side OAuth verification is a later
hardening step). This script only does the mechanical part: call the GitHub API
via `gh api` and aggregate repo metadata into candidate match signal. It NEVER
reads code — only repo metadata (language, topics, description).

Privacy model (mirrors the rest of /whoelse):
  - `public`  : signal derived from PUBLIC repos. Safe by default; still shown at
                the review gate like any other keyword.
  - `private` : OPT-IN only. Signal derived from PRIVATE repos, emitted as
                CANDIDATE phrases the user must approve item-by-item. Private repo
                *names* are treated as potentially sensitive (codenames) and are
                NOT surfaced as candidates — only topics + description words +
                languages are.

Usage:
  python3 gh_profile.py public            # verified identity + public signal
  python3 gh_profile.py private           # candidate phrases from private repos (opt-in)

Both print a JSON object to stdout. On a recoverable problem (gh missing, not
authenticated) it prints {"ok": false, "error": "...", "hint": "..."} and exits 0
so /whoelse can degrade gracefully (GitHub enrichment is optional).
"""

import json
import re
import shutil
import subprocess
import sys
from collections import Counter

# Generic words we don't want polluting the match key when mined from prose.
STOPWORDS = {
    "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "my",
    "this", "that", "is", "are", "it", "its", "as", "by", "at", "from", "be",
    "app", "tool", "tools", "lib", "library", "project", "repo", "code", "test",
    "tests", "demo", "wip", "misc", "stuff", "personal", "private", "new", "old",
}


def _fail(error, hint=""):
    print(json.dumps({"ok": False, "error": error, "hint": hint}))
    sys.exit(0)


def _gh(args):
    """Run `gh <args>` and return parsed JSON stdout, or raise on failure."""
    if shutil.which("gh") is None:
        _fail("gh CLI not found", "Install GitHub CLI and run `gh auth login`.")
    try:
        out = subprocess.run(
            ["gh", *args],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout
    except subprocess.CalledProcessError as e:
        msg = (e.stderr or "").strip().splitlines()
        first = msg[0] if msg else f"gh exited {e.returncode}"
        if "auth" in (e.stderr or "").lower() or "logged" in (e.stderr or "").lower():
            _fail("gh is not authenticated", "Run `gh auth login`.")
        _fail(f"gh api failed: {first}")
    except subprocess.TimeoutExpired:
        _fail("gh api timed out")
    return json.loads(out) if out.strip() else None


def _phrases_from_text(text):
    """Pull candidate multi-word-ish phrases / meaningful tokens from prose."""
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9+.#-]{2,}", (text or "").lower())
    return [w for w in words if w not in STOPWORDS]


def _fetch_repos(visibility):
    """Repos the user OWNS, filtered by visibility, most-recently-pushed first.

    Uses `gh api` pagination over /user/repos. Metadata only (topics, language,
    description) — never contents.
    """
    repos = _gh([
        "api", "--paginate",
        f"/user/repos?per_page=100&affiliation=owner&visibility={visibility}&sort=pushed",
        "-H", "Accept: application/vnd.github+json",
    ])
    # --paginate concatenates pages; gh returns a single JSON array here.
    return repos or []


def summarize_public(login, html_url, repos):
    """Aggregate PUBLIC repos into languages + topics + recent repo names.

    Pure(ish) given `repos`, so it's unit-testable without the network.
    """
    langs = Counter()
    topics = Counter()
    recent = []
    for r in repos:
        if r.get("fork"):
            continue  # forks aren't signal about what *you* build
        if r.get("language"):
            langs[r["language"].lower()] += 1
        for t in r.get("topics", []) or []:
            topics[t.lower()] += 1
        if len(recent) < 8:
            recent.append(r.get("name"))
    return {
        "ok": True,
        "github_login": login,
        "github_url": html_url,
        "languages": [l for l, _ in langs.most_common(8)],
        "topics": [t for t, _ in topics.most_common(15)],
        "recent_repos": recent,
    }


def candidates_from_private(repos):
    """Candidate phrases from PRIVATE repos — for opt-in, per-item approval.

    Deliberately excludes repo NAMES (often codenames). Only topics, description
    words, and languages are surfaced, each tagged with where it came from so the
    user can judge before approving.
    """
    topics = Counter()
    desc_words = Counter()
    langs = Counter()
    for r in repos:
        if r.get("fork"):
            continue
        if r.get("language"):
            langs[r["language"].lower()] += 1
        for t in r.get("topics", []) or []:
            topics[t.lower()] += 1
        for w in _phrases_from_text(r.get("description")):
            desc_words[w] += 1
    candidates = []
    for t, n in topics.most_common(15):
        candidates.append({"phrase": t, "source": "private repo topic", "count": n})
    for w, n in desc_words.most_common(15):
        if n >= 2:  # a one-off description word is weak signal; require repetition
            candidates.append({"phrase": w, "source": "private repo description", "count": n})
    for l, n in langs.most_common(5):
        candidates.append({"phrase": l, "source": "private repo language", "count": n})
    return {
        "ok": True,
        "private_repo_count": sum(1 for r in repos if not r.get("fork")),
        "candidates": candidates,
        "note": "OPT-IN. Each phrase needs the user's explicit approval before it joins the public keywords. Repo names are intentionally omitted (possible codenames).",
    }


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "public"
    if mode not in ("public", "private"):
        _fail(f"unknown mode {mode!r}", "Use 'public' or 'private'.")

    me = _gh(["api", "/user"])
    login = me.get("login")
    html_url = me.get("html_url")
    if not login:
        _fail("could not resolve GitHub identity from gh")

    if mode == "public":
        repos = _fetch_repos("public")
        print(json.dumps(summarize_public(login, html_url, repos), indent=2))
    else:
        repos = _fetch_repos("private")
        out = candidates_from_private(repos)
        out["github_login"] = login
        print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
