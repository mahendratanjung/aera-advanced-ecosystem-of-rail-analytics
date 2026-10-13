#!/usr/bin/env bash
# Stop hook: if project files changed after CLAUDE.md, ask Claude (once) to update CLAUDE.md
# before finishing, so the next chat starts with current context.
set -euo pipefail

input="$(cat)"
# Already continuing because of this hook: let Claude stop, never loop.
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ]; then
  exit 0
fi

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
ctx="$root/CLAUDE.md"
[ -f "$ctx" ] || exit 0

changed="$(cd "$root" && find . -type f -newer CLAUDE.md \
  -not -path './node_modules/*' -not -path '*/node_modules/*' -not -path './.git/*' -not -path './.github/*' \
  -not -path '*/.next/*' -not -path '*/.venv/*' -not -path '*/__pycache__/*' \
  -not -path '*/.pytest_cache/*' -not -path './backend/var/*' -not -path './.claude/*' \
  -not -path './frontend/public/maplibre/*' -not -name '.DS_Store' -not -name '*.tsbuildinfo' \
  -not -name 'next-env.d.ts' -not -path './frontend/AGENTS.md' -not -path './frontend/CLAUDE.md' \
  2>/dev/null | sed 's#^\./##' | head -n 15)"

[ -z "$changed" ] && exit 0

list="$(printf '%s' "$changed" | tr '\n' ',' | sed 's/,$//; s/,/, /g')"
reason="Project files changed since CLAUDE.md was last updated ($list). Before finishing, update CLAUDE.md: correct anything in 'Current state' or the code map that is no longer true, and add one short dated entry at the top of 'Session log' (what changed, anything unfinished). Keep it concise. No Claude attribution."
jq -n --arg r "$reason" '{decision: "block", reason: $r}'
