#!/usr/bin/env bash
#
# whoelse — installer
# Adds the `citizenlee/whoelse-cli` marketplace and installs the `whoelse` plugin
# (the /whoelse command, the scrub + summarize skills, and the whoelse MCP server).
#
#   curl -fsSL https://whoelse.science/install.sh | bash
#
# This is exactly the two commands on https://whoelse.science/install, scripted.

set -euo pipefail

MARKETPLACE="citizenlee/whoelse-cli"
PLUGIN="whoelse@whoelse"

say()  { printf '\033[1;36m▸\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || die "Claude Code CLI not found. Install it first: https://docs.claude.com/claude-code"

say "Adding the whoelse marketplace ($MARKETPLACE)…"
claude plugin marketplace add "$MARKETPLACE"

say "Installing the whoelse plugin ($PLUGIN)…"
claude plugin install "$PLUGIN" --scope user

ok "Installed. Open Claude Code and run /whoelse to get matched."
