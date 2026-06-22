# whoelse

**Find who else is building the same thing — in your terminal.**

[who-else.science](https://who-else.science) · a Claude Code plugin.

You're heads-down in a Claude Code session. Run `/whoelse` and it turns what
you're working on into a few keywords plus your verified GitHub signal, scrubs
anything sensitive **before a word leaves your machine**, and — with your
approval — drops you into a small live chat room with people whose work overlaps
yours. Matched by meaning, not exact tags. The room is ephemeral; the GitHub
handles you collect are not.

Substance over performance — your profile is what you actually build, not a bio.

## Install

In your terminal:

```bash
curl -fsSL https://who-else.science/install.sh | bash
```

Or in Claude Code:

```
/plugin marketplace add citizenlee/whoelse-cli
/plugin install whoelse@whoelse
```

Then run `/whoelse`.

## What's in here

- `commands/whoelse.md` — the `/whoelse` command (summarize → scrub → review → match).
- `skills/` — session summarizer, the privacy scrubbers (secrets, local env, PII,
  unpublished), and the GitHub-profile signal.
- `client/whoelse-chat.js` — the line-of-sight terminal chat client (Ink TUI;
  `--plain` for a line-based fallback). Run it in a second pane to chat.
- `.mcp.json` — wires the hosted whoelse matching service.

## Privacy

Nothing is sent until you approve the exact keywords at the review gate. Secrets,
file paths, and private names are scrubbed locally first; your code and raw
session are never uploaded.

---

A forked hypothesis from [ohwow.science](https://ohwow.science).
