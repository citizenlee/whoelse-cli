# The whoelse profile (the contract)

This is the interface between slices. `/whoelse` (slice A) **produces** it, the
scrubbing skills (slice B) **sanitize** it, and whoelse (slice C) **matches** on its
`keywords`. Treat changes here as breaking — agree them as a group.

## What it is

A small JSON object summarizing what one person is wondering about right now. It is
built locally from the user's Claude session, sanitized, shown to the user, and
sent to whoelse **only after explicit approval**.

## Schema (v0)

| Field             | Type       | Required | Notes |
|-------------------|------------|----------|-------|
| `schema_version`  | string     | yes      | `"0"` for now |
| `wondering_about` | string     | yes      | One line: the core question/problem |
| `field`           | string     | yes      | Domain, e.g. "structural biology" |
| `methods`         | string[]   | no       | Techniques, models, instruments in play |
| `looking_for`     | string     | no       | collaborators? data? a technique? feedback? |
| `can_offer`       | string     | no       | what this person brings |
| `keywords`        | string[]   | yes      | **the match key.** Lowercase, deduped. whoelse matches and seeds the room on these |
| `github_login`    | string     | no       | The user's **verified** GitHub handle (locally-derived via the `gh` CLI). The "substance" identity — what they actually build. Opt-out, but always shown at the review gate |
| `github_url`      | string     | no       | The user's GitHub profile URL (e.g. `https://github.com/octocat`) |

> **Identity = GitHub, by substance.** whoelse is "a social network for GitHub" — the
> profile reflects what you actually build. The `github-profile` skill folds your
> verified handle + repo-derived signal (languages, topics) into this object:
> `github_login`/`github_url` carry identity, and GitHub-derived topics/languages
> merge into `keywords` (the match key). **Public repos by default; private-repo
> signal is opt-in and approved phrase-by-phrase** at the review gate.
>
> The handle is *locally* verified (the `gh` CLI is signed in as the user); the
> server trusts what the client sends, same as the keywords. Server-side OAuth
> verification is a later hardening step.
>
> An opt-in `orcid` field (the `orcid` skill, built but not wired) remains a later
> niche add-on for the academic slice — GitHub is the primary identity.

### Example

```json
{
  "schema_version": "0",
  "wondering_about": "Reducing hallucinations when extracting structured data from lab notebooks",
  "field": "machine learning for chemistry",
  "methods": ["LLM tool use", "OCR", "schema-constrained decoding"],
  "looking_for": "others who've evaluated extraction accuracy on messy scientific PDFs",
  "can_offer": "a labeled benchmark of 200 annotated notebook pages",
  "keywords": ["information extraction", "llm hallucination", "lab notebooks", "chemistry", "structured output"],
  "github_login": "octocat",
  "github_url": "https://github.com/octocat"
}
```

## Boundaries

- **Outbound only after approval.** Nothing here reaches whoelse until the user
  approves the exact text. See the privacy model in the README.
- **`keywords` is the public surface.** Assume everything in `keywords` is visible
  to other matched people and posted as the room seed. Scrub accordingly.
- **Local-only inputs are NOT part of this object.** The user's "never leak this
  word / this IP" pre-declarations are inputs to the scrub skills, not fields sent
  to whoelse.

## Open (see README open questions)

- How much structured vs. freeform? (v0: structured, `keywords` as the match key)
- Identity: **GitHub.** `github_login`/`github_url` carry a locally-verified handle; GitHub-derived topics/languages enrich `keywords`. Server-side OAuth verification and ORCID (academic add-on) are later steps.
