---
name: scrub-local-env
description: Use within /whoelse to strip local environment details from a draft whoelse profile — absolute file paths, home-relative paths, usernames, internal hostnames/URLs, IPs, ports. Deterministic script pass plus a brief model pass for the names regex can't catch.
---

# scrub-local-env  (slice B)

> Script: **implemented**. Model-judgment pass: **validated** (RED/GREEN).

Remove machine / local-environment fingerprints — the things that betray
*where* the draft was written. Two layers, run in this order:

1. **Deterministic script (hard signal).** Paths, IPs, internal hosts/URLs,
   and the usernames embedded in them. Regex; no judgment.
2. **Model judgment.** What the patterns can't see — an internal server or
   cluster name that looks like an ordinary word (`della`, `tiger`, `bridges`),
   a project codename, a lab-internal acronym.

## Layer 1: the script

Deterministic, line-by-line. Run with `uv`:

```bash
uv run skills/scrub-local-env/scripts/localenv.py check <file|->   # report matches, exit 1 if any
uv run skills/scrub-local-env/scripts/localenv.py apply <file|->   # emit text with matches -> placeholders
```

It detects and, on `apply`, replaces with a category placeholder:

| Category | Placeholder | Examples |
|----------|-------------|----------|
| Absolute / home / machine paths | `[PATH]` | `/Users/<name>/...`, `~/...`, `C:\Users\<name>\...`, `/tmp`, `/mnt`, `/scratch` |
| IPv4 addresses | `[IP]` | private ranges (`10.x`, `192.168.x`, …) always; a public quad only with network context (`server`, `ssh`, `:port`). A bare ambiguous quad (`1.2.3.4`) is left for the model — it may be a version string, not an address. |
| Internal hosts / URLs / ports | `[HOST]` / `[URL]` | `localhost`, `*.local/.internal/.corp/.lan`, `host:8080`, `user@host`, `https://dashboard.internal/...` |
| Usernames | `[USER]` | a login in a `/Users/` or `/home/` path is redacted everywhere it recurs. Logins in *other* paths (`/scratch/<user>`) or recurring in a public URL (`github.com/<user>/…`) are the **model pass's** job — deterministic harvest there would redact common words (`/scratch/shared`). |

It deliberately does **not** flag clearly-public URLs (arxiv, doi.org, github,
pypi, huggingface, …) or bare common binaries (`/usr/bin/python`), and uses
boundaries so a version string like `1.2.3.4` isn't mistaken for an IP. Precision
over coverage: a false positive that mangles a public DOI erodes trust in the
whole pipeline.

### Procedure (called by /whoelse)

Run over the **entire** profile, `keywords` included — `PROFILE.md` marks
`keywords` as the public surface (matched on and posted as the room seed).

1. Write the full draft to a temp file (or pipe on stdin) and run `check`.
   Any match is a hard block.
2. Run `apply` to insert placeholders, then **rewrite** each affected
   sentence so the placeholder isn't itself a tell. A profile shouldn't read
   "my data lives in `[PATH]`" — it should just not mention where the data
   lives. `[HOST]`/`[IP]` usually mean a sentence about infrastructure that the
   match key doesn't need at all; drop it or generalize ("on a university
   cluster"). A `[USER]` is a person — handle as PII, never a placeholder.
3. Re-run `check` on the rewritten draft — it must pass clean (exit 0) before
   the profile may proceed to the review gate.

## Layer 2: model judgment

### Targets
Internal host/cluster/project names that pass for ordinary words and so slip
past the regex (`della`, `tiger`, a lab's `gpu-box`, an internal codename), and
local paths in an unusual shape the patterns don't cover.

### Approach
**Model judgment**, lightweight — this layer only mops up what Layer 1 can't
pattern-match. When a token reads like it might name a specific machine,
cluster, or internal service, generalize it ("our cluster") or ask the user.
When unsure, ask — don't guess a proper noun into the profile.

If the user confirms a stable internal name should never leak (a cluster name,
a server), offer to `add` it to the never-share filter list owned by
`scrub-unpublished` so it's caught deterministically next time.

## Propose, don't dispose

Return to the caller (/whoelse): the scrubbed draft, a short change log
(`removed/generalized X because Y` per edit), and status (`clean` only if the
final text passes `check` with exit 0). The user reviews and approves; this
skill never sends anything anywhere.

## TODO
- [ ] Decide whether IPv6 is worth covering (rare in these profiles)
- [ ] Confirm `[USER]` hand-off to scrub-pii vs. handling names here
