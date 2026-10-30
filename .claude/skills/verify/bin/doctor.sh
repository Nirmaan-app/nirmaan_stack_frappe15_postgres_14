#!/usr/bin/env bash
# Read-only: is this env worth driving? Run from the worktree whose env you drive, or pass the task name.
#   .claude/skills/verify/bin/doctor.sh [task]
# Checks: Playwright is installed, the feature map's age (a WARN, never a failure), the env exists, its code is THIS
# checkout, it is served, the SPA and the backend answer through its URL, and the logged-out boot works. Prints one
# line per check and exits 1 on the first failure.
set -euo pipefail

TOP="$(git rev-parse --show-toplevel)"
fail() { echo "FAIL  $*"; exit 1; }
ok() { echo "ok    $*"; }

# The dev root holds frappe-bench/ and benches/ (as in scripts/devenv/devenv.sh): $DEVENV_ROOT, else the first
# folder above this checkout that holds the main bench.
ROOT="${DEVENV_ROOT:-}"; d="$(cd "$TOP" && pwd -P)"
while [ -z "$ROOT" ] && [ "$d" != / ]; do [ -d "$d/frappe-bench/apps/frappe" ] && ROOT="$d"; d="$(dirname "$d")"; done
[ -n "$ROOT" ] || fail "no frappe-bench/ above $TOP: run from a checkout under frappe_docker/development, or set DEVENV_ROOT"
BENCHES="$ROOT/benches"
# The env whose apps/nirmaan_stack is this checkout (made by `devenv.sh up` or `create`), as devenv.sh finds it.
find_task() {
  local d; for d in "$BENCHES"/*/apps/nirmaan_stack; do
    [ -e "$d" ] && [ "$(cd "$d" && pwd -P)" = "$(cd "$TOP" && pwd -P)" ] && { basename "$(dirname "$(dirname "$d")")"; return; }
  done
  basename "$TOP"
}
TASK="${1:-$(find_task)}"
B="$BENCHES/$TASK"

python3 -c 'import playwright' 2>/dev/null \
  || fail "no Python Playwright on this host: pip install playwright && python3 -m playwright install chromium"
ok "Playwright installed"

# The feature map rots as the app changes: past 30 days, ask the user for /pstack:maintain-verification-skill.
map="$TOP/.claude/skills/verify/features/README.md"
last="$(sed -n 's/^Last maintained: \([0-9-]\{10\}\).*/\1/p' "$map" 2>/dev/null | head -1)"
if [ -n "$last" ]; then
  age=$(( ( $(date +%s) - $(python3 -c 'import sys,datetime;print(int(datetime.datetime.fromisoformat(sys.argv[1]).timestamp()))' "$last") ) / 86400 ))
  if [ "$age" -gt 30 ]; then
    echo "WARN  feature map last maintained $age days ago ($last): ask the user to run /pstack:maintain-verification-skill"
  else
    ok "feature map last maintained $age days ago"
  fi
else
  echo "WARN  no 'Last maintained:' date in $map"
fi

[ -d "$B" ] || fail "no env '$TASK' (run devenv.sh up from the worktree)"
ok "env $TASK at $B"

code="$(cd "$B/apps/nirmaan_stack" && pwd -P)"   # a link (`up`) or the worktree itself (`create`)
[ "$code" = "$(cd "$TOP" && pwd -P)" ] || fail "env code is $code, not this checkout $TOP"
ok "code is this checkout ($(git -C "$TOP" rev-parse --short HEAD) on $(git -C "$TOP" branch --show-current))"

ports="$(sed -n 's/^ports=//p' "$B/.serve" 2>/dev/null || true)"
[ -n "$ports" ] || fail "not served (run devenv.sh serve $TASK --wait)"
VITE="${ports#* }"
URL="http://t-$TASK.localhost:$VITE"
ok "served: backend :${ports% *}, vite :$VITE"

[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/")" = 200 ] || fail "SPA does not answer at $URL/"
ok "SPA answers at $URL/"

[ "$(curl -s "$URL/api/method/ping")" = '{"message":"pong"}' ] || fail "backend does not answer through $URL/api"
ok "backend answers through the vite proxy"

site="$(curl -s "$URL/api/method/frappe.client.get_value?doctype=System%20Settings&fieldname=country" -o /dev/null -w '%{http_code}')"
[ "$site" = 403 ] || [ "$site" = 200 ] || fail "site check returned HTTP $site"
ok "site t-$TASK.localhost responds (logged out: HTTP $site)"
echo "URL   $URL/"
