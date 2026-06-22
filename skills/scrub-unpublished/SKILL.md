---
name: scrub-unpublished
description: Use within /whoelse to remove pre-publication and proprietary scientific content from a draft whoelse profile — unpublished results, raw data values, sequences, compound structures, grant numbers, anything under embargo, IP, or NDA. Also manages the user's never-share filter list (the pre-declared "never leak this word" input). Use when the user wants to add to, review, or check text against that list.
---

# scrub-unpublished  (slice B)

> Filter list: **implemented**. Model-judgment pass: **validated** (RED/GREEN).

Remove anything that would burn priority or breach IP/NDA if shared. Two layers,
run in this order:

1. **Never-share filter list (deterministic).** The user's pre-declared
   words/phrases that must never leave the machine — the "never leak this
   word / this IP" input from the README and `PROFILE.md`.
2. **Model judgment.** Everything the list can't anticipate.

## Layer 1: the never-share filter list

A plain-text file, one word or phrase per line (`#` comments and blank lines
ignored). Matching is case-insensitive and whole-word.

**Location:** `~/.whoelse/never-share.txt` by default; override with the
`WHOELSE_FILTER_LIST` env var. Per `PROFILE.md`, this is a **local-only input**
— and the list itself is sensitive (it names the very things the user is
protecting), so it must NEVER be committed to a repo, pasted into a profile,
or sent anywhere. When discussing the list with the user, refer to entries by
line number or count where possible rather than echoing them back.

All operations go through the script (run with `uv`):

```bash
uv run skills/scrub-unpublished/scripts/filterlist.py check <file|->   # report matches, exit 1 if any
uv run skills/scrub-unpublished/scripts/filterlist.py apply <file|->   # emit text with matches -> [REDACTED]
uv run skills/scrub-unpublished/scripts/filterlist.py add "<entry>"    # append entries
uv run skills/scrub-unpublished/scripts/filterlist.py list             # show entries
uv run skills/scrub-unpublished/scripts/filterlist.py path             # show list location
```

When the user says something like "never share the compound name AX-201", use
`add`. Suggest obvious variants as *separate candidate entries* and let the
user confirm them (e.g. `AX-201` and `AX201`) — never invent entries the user
didn't sanction.

### Procedure (called by /whoelse)

Run over the **entire** profile, `keywords` included — `PROFILE.md` marks
`keywords` as the public surface (matched on and posted as the room seed), so
a never-share term surviving there is the most direct leak of all.

1. Write the full draft — prose fields and keywords — to a temp file (or pipe
   on stdin) and run `check`. Any match is a hard block: run `apply` to
   redact, then rewrite each redacted sentence so the `[REDACTED]` placeholder
   isn't itself a tell ("working on [REDACTED] inhibitors" leaks that
   something is hidden and invites guessing). A matched *keyword* is dropped
   or replaced with a broader term (`AX-201` → `kinase inhibitors`) — never
   left as a placeholder.
2. Re-run `check` on the rewritten draft — it must pass clean before the
   profile may proceed to the review gate.

## Layer 2: model judgment

### Targets
Unpublished results and conclusions, raw data values, genetic sequences, compound
structures, specific grant/award numbers, embargoed findings.

### Approach
**Model judgment**, not regex — this is about scientific sensitivity, not patterns.
Bias toward generalizing ("a kinase inhibitor", not the structure) and toward asking
the user when uncertain. Better to under-share than to scoop someone.

## Propose, don't dispose

Return to the caller (/whoelse): the scrubbed draft, a short change log
(`removed/generalized X because Y` per edit), and filter-list status (`clean`
only if the final text passes `check` with exit 0). The user reviews and
approves; this skill never sends anything anywhere.

If the user manually removes something the passes missed and it is a stable
term (a name, an identifier), offer to `add` it to the filter list so it's
caught next time.

## TODO
- [ ] Guidance/examples for "specific result" vs. "general topic"
- [ ] How aggressive by default (README open Q6)
- [ ] Decide whether the filter list should be shared by all scrub skills
      (it's category-agnostic) rather than living only here
