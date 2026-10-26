#!/usr/bin/env bash
# Read-only: is this env worth driving? Run from the worktree whose env you drive, or pass the task name.
#   .claude/skills/verify/bin/doctor.sh [task]
# Checks: the env exists, its code is THIS checkout, it is served, the SPA and the backend answer through its URL,
# and the logged-out boot works. Prints one line per check and exits 1 on the first failure.
set -euo pipefail

BENCHES=/Users/abhishek/work/nirmaan/deploy_setup/frappe_docker/development/benches
TOP="$(git rev-parse --show-toplevel)"
TASK="${1:-$(basename "$TOP")}"
B="$BENCHES/$TASK"
fail() { echo "FAIL  $*"; exit 1; }
ok() { echo "ok    $*"; }

[ -d "$B" ] || fail "no env '$TASK' (run devenv.sh up from the worktree)"
ok "env $TASK at $B"

code="$(cd "$B/apps" && cd "$(readlink nirmaan_stack)" && pwd -P)"
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
