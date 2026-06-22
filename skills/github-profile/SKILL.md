---
name: github-profile
description: Use within /whoelse to derive a verified GitHub identity + "substance" match signal (languages, repo topics) from the user's local `gh` CLI. Public repos are used by default; private-repo signal is strictly opt-in and approved phrase-by-phrase. Produces draft signal only; /whoelse owns review and send.
---

# github-profile  (slice A — identity + substance)

> **What this is for.** whoelse is "a social network for GitHub — substance over
> performance." Your profile should reflect what you *actually build*, not what you
> claim. This skill reads your real repo metadata (languages, topics) and your
> verified handle, and folds them into the match signal.

> **v1: identity is derived locally from the authenticated `gh` CLI.** The login is
> *your* verified handle because `gh` is signed in as you — but the whoelse server
> trusts the handle the client sends (same trust model as the scrubbed keywords).
> Cryptographic server-side verification (GitHub OAuth callback) is a later
> hardening step, the same way ORCID stages paste→OAuth. Treat the handle as
> "verified locally," not "server-verified," until then.

It reads **metadata only** — language, topics, description. It never reads code.

## The script (deterministic — calls `gh api`, aggregates)

```bash
python3 skills/github-profile/scripts/gh_profile.py public    # verified login + PUBLIC signal
python3 skills/github-profile/scripts/gh_profile.py private    # CANDIDATE phrases from PRIVATE repos (opt-in)
```

Both print JSON. If `gh` is missing or not authenticated, they print
`{"ok": false, "error": ..., "hint": ...}` and exit 0 — GitHub enrichment is
optional, so `/whoelse` should just skip it and continue (mention it to the user).

`public` output:
```json
{ "ok": true, "github_login": "octocat", "github_url": "https://github.com/octocat",
  "languages": ["python","rust"], "topics": ["llm","genomics"], "recent_repos": ["..."] }
```

`private` output (only when the user opts in):
```json
{ "ok": true, "github_login": "octocat", "private_repo_count": 7,
  "candidates": [ {"phrase":"protein-design","source":"private repo topic","count":3}, ... ] }
```

## How /whoelse uses it

### Public — on by default
1. Run `gh_profile.py public`.
2. Fold the result into the draft whoelse profile:
   - set `github_login` and `github_url` (the verified-substance identity);
   - merge `languages` + `topics` into `keywords` (deduped, lowercase). These are
     the GitHub-derived part of the match key.
3. Everything still passes through scrub and the **review gate** like any other
   field — public ≠ unreviewed. The user sees the final keywords before anything
   is sent.

### Private — strictly opt-in, approved phrase-by-phrase
The user asked for this explicitly: *"people can opt in for private with approval
for key ideas or phrases."* So:

1. **Ask first.** Only run `gh_profile.py private` if the user opts in this run.
   Never read private repos by default.
2. **Present candidates for approval.** Show the `candidates` list (with each
   phrase's `source`, e.g. "private repo description") and let the user pick which
   ones may join the public `keywords`. This is an **allow-list** action — nothing
   private-derived is included unless the user ticks it.
3. Repo **names are deliberately excluded** by the script (they're often
   codenames). If the user wants a private project's name in, they type it
   themselves.
4. Approved private phrases merge into `keywords` and then ride through the normal
   review gate with everything else.

## Interaction with the scrub skills (important)

- The user's **own** `github_login` / `github_url` is consented self-identity — it
  is NOT a leak. Exempt it from `scrub-pii` redaction (same exemption pattern as
  the `orcid` field). Third-party handles in prose are still scrubbed.
- Private-derived candidates are raw repo metadata — still run them past
  `scrub-secrets` / `scrub-unpublished` before offering them, in case a topic or
  description leaks something embargoed.

## TODO
- [ ] Hardening: server-side GitHub OAuth callback so the handle is *server*-verified, not just locally-derived.
- [ ] Per-repo language bytes (GitHub `/languages` API) for finer-grained signal than primary-language counts.
- [ ] Optional: GitHub handle as a join credential (gate rooms to verified accounts).
