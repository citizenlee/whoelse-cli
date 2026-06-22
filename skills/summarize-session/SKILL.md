---
name: summarize-session
description: Use within /whoelse to distill the current Claude session into a "whoelse profile" (see PROFILE.md) — a one-line problem statement, field, methods, what the user is looking for and can offer, and match keywords. Produces the pre-scrub draft only; /whoelse owns review and send.
---

# summarize-session  (slice A)

Turn the **current session** into a whoelse profile matching `PROFILE.md`. This is
model judgment — no scripts. You output the draft profile and hand it back to
`/whoelse`; you never send it anywhere and never run the review gate yourself.

## Source

Summarize from your **current in-context view** of the session — the conversation
as you can see it right now. That's the v0 default: simplest, no extra tooling, and
it's the same window the user has been working in. Don't try to read the raw
transcript `.jsonl` (see TODO).

## What to capture

You're describing what the user is *wondering about*, not logging what they did.
Look past the individual actions (files edited, commands run) to the **live question
driving the session**. "How do I reduce hallucination in extraction from lab
notebooks" — not "user edited parser.py."

Field by field, derived from what the user has actually been doing:

- **`wondering_about`** (required) — one line, the core open question or problem.
  The thing they'd most want a peer's help thinking about. Phrase it as a problem,
  not a status update.
- **`field`** (required) — the domain a peer would name, e.g. "structural biology",
  "climate modeling", "machine learning for chemistry". Infer it from the science,
  not from the programming language.
- **`methods`** (optional) — techniques, models, instruments, or approaches actually
  in play this session. Skip if the session doesn't reveal any.
- **`looking_for`** (optional) — what kind of connection would help: collaborators,
  data, a technique, feedback, someone who's hit the same wall. Infer from the
  shape of the problem; leave empty rather than guess wildly.
- **`can_offer`** (optional) — what the user brings (a dataset, a method, hard-won
  experience). Only if it's evident; don't invent it.
- **`keywords`** (required) — see below.

## Keywords

4–8 terms, **lowercase, deduped, most-specific-first**. These are both the match
key *and* the public room seed posted in Discord, so choose terms **another
scientist would actually search for**: techniques, problems, organisms, model
families, instruments. Generic terms ("python", "science", "research", "data") are
useless for matching — drop them. A good list reads like the tags on a paper, not
like a tech stack. Order so the sharpest, most distinctive term comes first.

## Least disclosure starts here

This skill produces the **pre-scrub draft**, but least disclosure starts at
summarization — don't gratuitously pull sensitive specifics into the draft when a
general phrasing matches just as well. Scrubbing (slice B) is defense in depth, not
the only line. Concretely:

- Don't copy secrets, file paths, hostnames, or usernames into any field.
- Don't name people or affiliations who haven't consented.
- Prefer the general form over the proprietary one when it matches equally well:
  "kinase inhibitor screening", not the internal compound ID; "a 200-page labeled
  benchmark", not the raw result values.
- The point of matching is the *topic*, not the *findings* — describe the question,
  not the unpublished answer.

(You don't run the scrub skills — that's `/whoelse`. You just don't make their job
harder than it needs to be.)

## Thin-session case

If the session has too little signal to produce a meaningful profile — early setup,
unrelated chit-chat, or work too generic to match on — **say so and ask the user to
describe what they're wondering about in a sentence or two.** Do not fabricate a
question, field, or keywords to fill the schema. A guessed profile matches the user
into the wrong room.

## Output

Return the JSON profile object **exactly** per `PROFILE.md` schema v0
(`schema_version: "0"`, all required fields present, `keywords` lowercase + deduped).
Nothing else — no prose wrapper, no send. Hand it back to `/whoelse`, which runs the
scrub pipeline and the review gate.

## TODO
- [ ] In-context view vs. raw transcript `.jsonl` (README open Q1): the transcript
      is more complete (catches earlier, compacted-out context) but needs file access
      and parsing — revisit if in-context summaries miss the real question.
