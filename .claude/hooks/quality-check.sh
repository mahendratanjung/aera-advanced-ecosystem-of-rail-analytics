#!/usr/bin/env bash
# Stop hook: if code changed since the last passing check, run `npm run check` (lint, backend and
# edge tests, frontend tests, typecheck). On failure, block once with the output so the problem is
# fixed before the chat ends. A passing run is remembered in .claude/.quality-ok.
set -uo pipefail

input="$(cat)"
# Already continuing because of a Stop hook: let Claude stop, never loop.
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ]; then
  exit 0
fi

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
stamp="$root/.claude/.quality-ok"
cd "$root" || exit 0

newer=()
[ -f "$stamp" ] && newer=(-newer "$stamp")
changed="$(find backend frontend edge package.json -type f ${newer[@]+"${newer[@]}"} \
  \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name 'pyproject.toml' -o -name 'package.json' \) \
  -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/.venv/*' -not -path '*/__pycache__/*' \
  -not -path 'frontend/_parked/*' -not -name 'next-env.d.ts' 2>/dev/null | head -n 1)"
[ -z "$changed" ] && exit 0

log="$(mktemp)"
if npm run --silent check >"$log" 2>&1; then
  touch "$stamp"
  rm -f "$log"
  jq -n '{systemMessage: "Quality checks passed (lint, tests, typecheck)."}'
  exit 0
fi

tail_out="$(grep -v 'ExperimentalWarning\|trace-warnings' "$log" | tail -n 40)"
rm -f "$log"
reason="Quality checks failed (npm run check: ruff lint, backend and edge pytest, frontend tests, tsc). Fix the cause, rerun npm run check, and report the result honestly. Last output:
$tail_out"
jq -n --arg r "$reason" '{decision: "block", reason: $r}'
