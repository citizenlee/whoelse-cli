---
description: Turn your current Claude session into a sanitized "what I'm wondering about" + keywords, then (with your approval) get matched into a terminal chat room of people on the same topic via whoelse.
---

# /whoelse

You are running the `whoelse` flow for the user. Goal: take them from "heads-down
in a session" to "in a live terminal chat room with people wondering about the
same thing" — **without leaking anything sensitive** and **without sending
anything until they explicitly approve it**. *You are not working alone.*

The default delivery surface is now the **terminal chat client** (a line-based
chat that runs in a second terminal pane, talking to the same hosted whoelse
server over `/chat/*`). The **Discord** path is still fully supported as a
legacy/alternate surface — see step 5b.

The hard safety rule, above everything else: **nothing leaves this machine until
the user has seen the exact keywords and said yes.** You are the one who enforces
that gate.

## Steps

### 0. Demo check — do this FIRST
Call the `whoelse` MCP tool **`join_demo()`** before anything else.

- If it returns **`active: true`**, the server is in demo mode. **Skip steps 1–4
  entirely** — no summarize, no scrub, no review gate, no keyword upload. Give the
  user the two returned links — **`serverInviteUrl`** (join the server if you're not
  already in it) and **`roomUrl`** (open your room) — and stop. (Nothing about their
  session is read or sent in this path.)
- If it returns **`active: false`**, ignore it and run the normal flow below.

### 1. Summarize the session → a whoelse profile
Use the **`summarize-session`** skill to distill what the user has actually been
working on *this session* into a whoelse profile (schema in `PROFILE.md`). Opus
does the distillation: pull out the **distinctive subjects** — the specific
question/problem, field, methods, what they're looking for, what they can offer —
and a tight `keywords` array (lowercase, deduped). Keywords are the match key; aim
for the handful of phrases that best distinguish this work from everyone else's,
not generic terms.

### 1b. Enrich with GitHub (match signal only — NOT identity)
Use the **`github-profile`** skill to fold the user's real GitHub work into the
match **signal**. whoelse is "a social network for GitHub" — the keywords should
reflect what they actually build.

> **Identity is no longer set here.** The displayed GitHub handle is established by
> a **server-verified device login** in the terminal chat client (see step 5) —
> never a self-asserted `--github`/`github_login`. This skill only contributes
> *keywords* (languages, repo topics); it does not claim who you are.

- **Public — on by default.** Run `gh_profile.py public` and merge the returned
  `languages` + `topics` into `keywords`. If the script returns `{"ok": false}`
  (no `gh`, or not authenticated), skip enrichment and continue — it's optional.
- **Private — opt-in only.** Ask whether they want signal from their *private*
  repos. Only if yes, run `gh_profile.py private`, show the candidate phrases (with
  each phrase's source), and let them **approve phrase-by-phrase** which may join
  `keywords`. Nothing private-derived is included unless they tick it. Repo names
  are intentionally excluded.

### 2. Scrub
Run the scrubbing skills over the draft profile **in this order**, each removing
one category of sensitive content. Treat `keywords` and every other field as
about-to-be-public.

The user's **own** `github_login` / `github_url` is consented self-identity —
exempt it from `scrub-pii` (same as the `orcid` field). Still scrub third-party
handles in prose, and still run private-derived candidates past `scrub-secrets` /
`scrub-unpublished`.

1. **`scrub-secrets`** — API keys, tokens, passwords, connection strings
2. **`scrub-local-env`** — file paths, usernames, hostnames, internal URLs/IPs
3. **`scrub-pii`** — names/emails/affiliations of third parties who haven't consented
4. **`scrub-unpublished`** — pre-publication results, IP/NDA/embargoed material,
   **and** the user's pre-declared never-share filter list

Scrubbing *proposes*; the user *disposes* (next step). When a scrubber is unsure,
it should redact and flag rather than let something through.

### 3. Review gate — REQUIRED, never skip
Show the user the **exact** profile that would be sent — especially the final
`keywords` (which seed the public room and are the match key) and `github_login`
(their public identity in the room, and the handle others keep afterward). Call
out which keywords came from **private** repos so they get one last look. Then
let them:

- **approve** ("yes" / "send it"),
- **edit** specific keywords/fields (including dropping `github_login`), or
- **redo / cancel.**

Do **not** call any whoelse tool until the user gives an explicit yes. If they edit,
show the revised version and ask again. This gate is the whole product promise.

### 4. Match + preview (via the whoelse MCP server)
Only after explicit approval, you may use the **`whoelse`** MCP tools:

1. **`suggest_rooms({ keywords })`** — read-only, and useful for **either**
   surface. Preview the existing rooms the user could land in, ranked by overlap.
   Each room includes a **`matched`** array (the user's keywords that overlap it,
   by meaning) — show those so they can see *why* a room fits, and whether they're
   joining a live conversation or starting fresh.
2. **`connect({ keywords, wondering_about, github_login })`** — the Discord-only
   side effect. Creates or joins a Discord room and returns
   `{ channelName, roomUrl, serverInviteUrl, reused, matched }`. **Call this only
   for the legacy Discord hand-off (step 5b).** The default terminal hand-off
   (step 5) does NOT need it — the terminal client joins its own room directly
   from the approved keywords. Send only the approved keywords (the scrubbed
   public surface) and, if the user kept it, their `github_login` so the room
   intro can credit them.

### 5. Hand off → the terminal chat (default surface)
The approved keywords are everything the terminal client needs — it does its own
`/chat/join` against the hosted whoelse server, so you do **not** need to have
called the MCP `connect` tool for this path. Tell the user to open a **second
terminal pane** and run the client with the approved keywords:

```
node client/whoelse-chat.js --keywords "approved,keywords,here"
```

- Use the **exact** keywords from the review gate (comma-separated).
- **Identity is verified, not claimed.** On first run the client does a one-time
  GitHub **device login** (open the URL, enter the code); after that you appear as
  your verified `@handle`. Pass `--anon` to skip and join anonymously. There's no
  flag to assert a handle you haven't verified.
- For local development add `--server http://localhost:8080`; with no `--server`
  the client talks to the live deploy.

Explain the model so they know what they're walking into:
- It's a **live, ephemeral room**: the client joins (or creates) a room whose
  keywords semantically overlap theirs, prints the room name and the **matched**
  keywords (the reason they landed there), replays recent backlog, then streams
  messages live. Each line they type is sent to everyone in the room.
- **Ephemeral rooms, permanent handshakes.** The room itself is disposable —
  it lives in memory and is reaped after an idle period (default 60 min), and
  nothing is persisted. The value you keep is the **GitHub handles** of the
  people you meet: jot down who you talked to, since that's the durable
  connection that outlives the room.
- Ctrl-C closes the client cleanly and leaves the room (their presence drops for
  everyone else).

### 5b. Hand off → Discord (legacy / alternate surface)
The original Discord path still works end-to-end. If the user prefers it (or you
already ran the MCP `connect` tool in step 4), hand off the two links and the
room name instead:

- **`serverInviteUrl`** — "Join the whoelse server (if you're not already in it)."
- **`roomUrl`** — "Then open your room: #<channelName>."

Tell them:
- if they're already in the server, they can just use `roomUrl` directly;
- if `reused` was true, others are already there — name the **`matched`** keywords
  you connected on (e.g. "you overlap on `cryo-em`, `llm`"), since that's the reason
  to start talking. (On a fresh room, `matched` is just your own seed keywords.)
- the Discord room is disposable and **auto-closes after 24h of no activity**.

## Notes
- **Matching is semantic, enriched by GitHub.** People are matched on the keywords
  distilled from this session — compared by *meaning, not exact tags* (punctuation
  variants, acronyms like ml/machine learning, and stem/token similarity all
  count; see `discord/src/match.js`) — and enriched with their real GitHub signal
  (languages, repo topics). The verified `github_login` rides along as the
  "substance" identity. Embeddings-based matching and server-side GitHub OAuth
  verification are documented upgrade paths, not part of this flow yet.
- **`keywords` and `github_login` are the public surface.** Everything in `keywords`
  is visible to matched people and seeds the room (terminal or Discord);
  `github_login` is the handle others keep after the room is gone — the "permanent
  handshake". Scrub accordingly; private-repo signal is opt-in and approved
  phrase-by-phrase.
- The whoelse MCP server only ever receives the approved profile — never the raw
  session or transcript.
