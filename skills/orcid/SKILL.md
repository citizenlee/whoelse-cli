---
name: orcid
description: Use to set, check, or read the user's ORCID iD for /whoelse — a public researcher identifier stored locally and added (opt-in) to the whoelse profile. Invoke when the user wants to set/change/clear their ORCID, or when /whoelse needs the user's identity.
---

# orcid  (slice A — identity)

> **v1: the iD is self-declared (paste it in), not OAuth-verified.** Treat it as
> "claimed," not "verified." Verified ORCID sign-in is roadmap Stage 1b.

Manage the user's ORCID iD and hand it to `/whoelse`. An ORCID iD is a **public**
identifier (e.g. `0000-0002-1825-0097`), so — unlike the never-share list — it is
stored in plain text at `~/.whoelse/orcid` (override with `$WHOELSE_ORCID`).

## The script (deterministic — validates format + checksum)

```bash
python3 skills/orcid/scripts/orcid.py validate <iD>   # exit 0 if valid (format + ISO 7064 check digit)
python3 skills/orcid/scripts/orcid.py set <iD>        # validate, then save (bare iD or an orcid.org URL)
python3 skills/orcid/scripts/orcid.py get             # print saved iD (nothing if unset)
python3 skills/orcid/scripts/orcid.py clear           # remove it
python3 skills/orcid/scripts/orcid.py path            # show the config path
```

Always `validate`/`set` rather than trusting raw input — the checksum catches the
common typo (a transposed or mistyped digit).

## How /whoelse uses it

1. **First run / on request:** if no iD is set, offer to set one ("paste your ORCID
   so people know who you are"). It's **opt-in** — `/whoelse` works fine without it.
2. **In the profile:** if an iD is set, include it as the optional `orcid` field
   (see `PROFILE.md`); it rides along with the approved keywords.
3. **Review gate:** shown with everything else; the user approves it like any field.

## Interaction with scrub-pii (important)

`scrub-pii`'s `pii.py` redacts **any** ORCID iD to `[ORCID]` — but the user's **own**
`orcid` field is *consented self-identity*, not a leak. So `/whoelse` must treat the
`orcid` field as exempt: don't run PII redaction on it (it's the user naming
themselves, which they approve at the gate). Third-party ORCIDs that appear in the
prose fields are still redacted as normal.

## TODO
- [ ] Stage 1b: OAuth sign-in so the iD is **verified**, not just claimed.
- [ ] Wire into `commands/whoelse.md` + `summarize-session` (read config → set `orcid` field, exempt it from scrub-pii).
- [ ] Send `orcid` to the whoelse server (`connect`) so it can attribute the room intro.
