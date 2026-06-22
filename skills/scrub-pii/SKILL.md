---
name: scrub-pii
description: Use within /whoelse to remove personal information from a draft whoelse profile — emails, ORCID iDs, phone numbers, @-handles (deterministic), plus third-party names, affiliations, and lab/PI references (model judgment). The user may name themselves (they approve at the review gate); other people appear only with explicit consent.
---

# scrub-pii  (slice B)

> Identifier script: **implemented**. Model-judgment pass: **validated** (RED/GREEN).

Remove personal information about people who haven't consented to be shared.
The guiding principle is **consent**: the user is free to name *themselves*
(they own that choice at the review gate), but any other person appears only if
the user explicitly confirms that person has consented. Default to generalizing
third parties away. Two layers, run in this order:

1. **Deterministic identifiers (the script).** Emails, ORCID iDs, phone
   numbers, @-handles — patterns, no judgment needed.
2. **Model judgment.** Third-party names, affiliations, lab/PI references —
   the contextual cases the regex can't see.

## Layer 1: deterministic identifiers

A stable identifier is PII regardless of whose it is, so this layer is blunt:
it redacts every match to a placeholder. (Self vs. third-party is a Layer 2 /
review-gate distinction; an email or phone number is almost never something the
user wants in a profile that becomes public `keywords`, so redact first and let
the user re-add their own at the gate if they truly want it.)

Run through the script (with `uv`):

```bash
uv run skills/scrub-pii/scripts/pii.py check <file|->   # report matches, exit 1 if any
uv run skills/scrub-pii/scripts/pii.py apply <file|->   # emit text with matches -> placeholders
```

Categories and placeholders:

| Category    | Placeholder | Notes |
|-------------|-------------|-------|
| email       | `[EMAIL]`   | `local@domain.tld` |
| ORCID iD    | `[ORCID]`   | `0000-0002-1825-0097`, checksum may be `X`; bare or `orcid.org/...` |
| phone       | `[PHONE]`   | intl (`+44 20 7946 0958`) and US (`(415) 555-2671`) |
| @-handle    | `[HANDLE]`  | Discord/GitHub `@username`, not email-internal, not decorators |

**Precision over recall.** The patterns are deliberately conservative — a
false positive that mangles a version number, year range, p-value, DOI, or
`@dataclass` erodes trust more than a rare miss. Years (`2024-2026`),
versions (`2.10.3`), p-values (`0.0001`), DOIs (`10.5281/zenodo.123456`), and
common Python decorators are intentionally *not* matched. The contextual cases
that need judgment are Layer 2's job, not the regex's.

## Layer 2: model judgment

### Targets
Third-party **names** (people, not the user), their **affiliations**
(institutions, companies, labs), and **lab/PI references** ("Smith's group at
MIT", "my advisor", "the team at $COMPANY"). Also informal identifiers a regex
won't catch — a person referred to by full name in prose, a uniquely
identifying role ("the only crystallographer at $TINY_INSTITUTE").

### Approach
**Model judgment**, not regex. The core question for every person mentioned:

- **Is this the user themselves?** Keep it as a *candidate* and surface it at
  the review gate — the user owns their own identity and may want it in the
  profile (cf. the ORCID stretch goal in the README). Do not silently strip the
  user's name; flag it so they decide. Run this pass over the **original** draft,
  not Layer 1's placeholder output — once the user's own and a third party's ORCID
  both become `[ORCID]`, you can no longer tell them apart.
- **Is this a third party?** Generalize unless the user has explicitly
  confirmed that person consented. Default is to *drop the identity and keep the
  relevance*: "Dr. Lena Hoffmann at the ESRF synchrotron" → "a collaborator".
  Even "a collaborator at a European synchrotron facility" usually
  over-specifies — for *matching*, "a collaborator" is enough, and the bare role
  carries the signal whoelse needs without fingerprinting anyone. Generalize
  further the smaller the community (a field with three labs worldwide makes
  "a European synchrotron" as identifying as a name).

When uncertain whether a mention is the user or a third party, ask — don't
guess. Better to under-share than to expose someone who didn't opt in.

### Don't leave a tell
As in scrub-unpublished: a redaction that announces itself invites guessing.
After Layer 1 redacts to placeholders and Layer 2 generalizes, **rewrite the
surrounding text so the result reads naturally** — "co-authored with [HANDLE]
on the benchmark" → "co-authored with a collaborator on the benchmark"; "thanks
to Dr. Smith's lab" → "building on prior work in the field". A naked `[EMAIL]`
or `[HANDLE]` in a profile signals that something was hidden.

Run over the **entire** profile, `keywords` included — `PROFILE.md` marks
`keywords` as the public surface (matched on and posted as the room seed), so a
name or handle surviving there is the most direct leak. A matched keyword is
dropped or broadened (a person's name → the topic they work on), never left as a
placeholder.

## Propose, don't dispose

Return to the caller (/whoelse): the scrubbed draft, a short change log
(`removed/generalized X because Y` per edit — and for self-references,
`kept X (appears to be you) — confirm at review`), and status (`clean` only if
the final text passes `pii.py check` with exit 0 *and* the model pass found no
unresolved third-party identities). The user reviews and approves at the gate;
this skill never sends anything anywhere.

If the user keeps their own name/handle at the gate, that's their consented
choice. If they confirm a collaborator consented, that name may stay too — but
that confirmation comes from the user, never from this skill's inference.

## TODO
- [ ] Examples library: self-reference vs. third-party phrasings the model pass
      should and shouldn't generalize
- [ ] Small-community heuristic — how aggressively to generalize affiliations
      when the field is tiny (README open Q6)
- [ ] Should a confirmed-consented third party be offered to a shared allowlist
      so re-runs don't re-flag them (mirror of scrub-unpublished's filter list)?
