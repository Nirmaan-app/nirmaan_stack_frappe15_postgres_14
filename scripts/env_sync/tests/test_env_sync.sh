#!/usr/bin/env bash
# test_env_sync.sh -- env_sync's commands for main dev are unchanged by the second-environment settings (DEV2-1), and a
# dev2 env.local's settings reach every command that needs them.
#
#   bash scripts/env_sync/tests/test_env_sync.sh [BASE_REV]
#
# Needs bash and git only: docker, ssh and scp are stubs that log their arguments, so nothing is run against any
# machine, container or database. BASE_REV (default 2ea4b10f9, the commit before the settings) supplies the "before"
# copies. The start_task.ps1 checks need powershell.exe (Windows) and are skipped elsewhere.
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SRC=$(cd "$HERE/.." && pwd)                      # scripts/env_sync
REPO=$(cd "$SRC/../.." && pwd)
BASE=${1:-2ea4b10f9}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
old() { git -C "$REPO" show "$BASE:scripts/env_sync/$1"; }
git -C "$REPO" cat-file -e "$BASE^{commit}" 2>/dev/null || { echo "FAIL base revision $BASE not found"; exit 1; }

# ---- stubs: log every argument in brackets (argument boundaries count), answer the probes as a healthy machine would
BIN="$W/bin"; mkdir -p "$BIN"
cat > "$BIN/stub" <<'EOF'
#!/usr/bin/env bash
name=$(basename "$0"); { printf '%s' "$name"; for a in "$@"; do printf ' [%s]' "$a"; done; echo; } >> "$STUB_LOG"
case "$*" in
  *ports.sh*) printf '8000 open\n%s open\n' "${STUB_VITE_PORT:-8080}";;
  *destale.sh*) printf 'stopping 0 processes\n8000 closed\n%s closed\nmigrate ok\ndestaled\n' "${STUB_VITE_PORT:-8080}";;
  *api/method/ping*) echo '{"message":"pong"}';;
esac
exit 0
EOF
chmod +x "$BIN/stub"; for n in docker ssh scp; do cp "$BIN/stub" "$BIN/$n"; done

# A copy of a script in its own fake checkout, so REPO (and so .claude/state/env.local) resolves inside the temp tree.
plant() {   # plant <label> <script text file>
  local d="$W/$1/repo/scripts/env_sync"; mkdir -p "$d"
  # Everything before the dispatch: the old file's dispatch starts at CMD=, the new one's at the "{" that wraps it.
  awk '$0 == "{" || /^CMD="\$\{1:-\}"/ { exit } { print }' "$2" > "$d/env_sync.sh"
  echo "$d/env_sync.sh"
}

# The calls whose commands are compared: every remote script on both machines, start, ping, destale, a postgres copy.
drive() {   # drive <planted script> <log>  (runs in a subshell; env_sync's own settings come from the environment)
  ( export STUB_LOG="$2"; PATH="$BIN:$PATH"
    . "$1"
    SSH="$BIN/ssh"; SCP="$BIN/scp"; STAGED=1
    for m in laptop desktop; do
      rrun "$m" py db_fingerprint.py; rrun "$m" bash get_db_name.sh; rrun "$m" bash backup.sh
      rrun "$m" bash prove_backup.sh PREFIX; rrun "$m" bash restore_files.sh PREFIX; rrun "$m" bash stop_bench.sh
      rrun "$m" bash ports.sh; rrun "$m" bash git_state.sh HEADSHA
      start_services "$m"; wait_ping "$m"; NO_RESTART=0 after_transfer "$m" "nirmaan_stack/hooks.py"
    done
    d_cp_to_pg "C:/x/sites" dump.sql.gz /tmp/envsync_restore.sql.gz
  ) >> "$2" 2>&1
}

clear_env() { unset ENV_SYNC_SITE ENV_SYNC_VITE_PORT ENV_SYNC_START_BENCH ENV_SYNC_START_VITE ENV_SYNC_STOP_PATTERN \
  ENV_SYNC_FRAPPE_CONTAINER ENV_SYNC_PG_CONTAINER ENV_SYNC_DESKTOP_BENCH STUB_VITE_PORT; }
dev2_env() {
  export ENV_SYNC_DESKTOP_BENCH=C:/Users/USER/Documents/frappe_docker_dev2/development/frappe-bench
  export ENV_SYNC_FRAPPE_CONTAINER=frappe_dev2-frappe-1 ENV_SYNC_PG_CONTAINER=frappe_dev2-postgresql-1
  export ENV_SYNC_SITE=dev2.localhost ENV_SYNC_VITE_PORT=8180 STUB_VITE_PORT=8180
  export ENV_SYNC_START_BENCH=/workspace/dev2_scripts/start_bench.sh ENV_SYNC_START_VITE=/workspace/dev2_scripts/start_vite.sh
}

old env_sync.sh > "$W/old.sh"
OLD=$(plant before "$W/old.sh"); NEW=$(plant after "$SRC/env_sync.sh")

echo "== 1. main dev (no env.local): every command byte-identical to $BASE"
clear_env
drive "$OLD" "$W/log_before"; drive "$NEW" "$W/log_after"
# laptop: 8 scripts + start + ports + ping + destale + start + ports = 14 docker calls; desktop: the same 14 + the copy.
check "the drive ran to the end (14 docker / 15 ssh commands)" '[ "$(grep -c "^docker" "$W/log_before")" = 14 ] && [ "$(grep -c "^ssh" "$W/log_before")" = 15 ]'
if cmp -s "$W/log_before" "$W/log_after"; then ok "before == after, byte for byte"; else bad "before != after"; diff "$W/log_before" "$W/log_after" | head -20; fi
check "no setting leaks into main's commands" '! grep -q "ENV_SYNC_\|Host: " "$W/log_after"'
cp "$W/log_after" "${KEEP_LOGS:-$W}/main_commands.log" 2>/dev/null

echo "== 2. dev2 settings reach the commands"
clear_env; dev2_env
drive "$NEW" "$W/log_dev2"
L="$W/log_dev2"
check "laptop commands carry -e ENV_SYNC_SITE=dev2.localhost" 'grep -qF "[-e] [ENV_SYNC_SITE=dev2.localhost]" "$L"'
check "desktop commands carry -e '"'"'ENV_SYNC_SITE=dev2.localhost'"'"'" 'grep -qF "docker exec -u frappe -w /workspace/development/frappe-bench -e '"'"'ENV_SYNC_SITE=dev2.localhost'"'"'" "$L"'
check "vite port 8180 reaches the container" 'grep -qF "[ENV_SYNC_VITE_PORT=8180]" "$L" && grep -qF "'"'"'ENV_SYNC_VITE_PORT=8180'"'"'" "$L"'
check "every docker exec names dev2's container, never main's" 'grep -qF "[frappe_dev2-frappe-1]" "$L" && ! grep -q "frappe_docker_devcontainer" "$L"'
check "ping sends Host: dev2.localhost (laptop and desktop)" 'grep -qF "[-H] [Host: dev2.localhost]" "$L" && grep -qF "curl -s -m 5 -H '"'"'Host: dev2.localhost'"'"'" "$L"'
check "start runs dev2_scripts/start_bench.sh, then start_vite.sh" '
  b=$(grep -n "\[/workspace/dev2_scripts/start_bench.sh\]" "$L" | head -1 | cut -d: -f1)
  v=$(grep -n "\[/workspace/dev2_scripts/start_vite.sh\]" "$L" | head -1 | cut -d: -f1)
  [ -n "$b" ] && [ -n "$v" ] && [ "$b" -lt "$v" ] && grep -qF "bash /workspace/dev2_scripts/start_vite.sh" "$L"'
check "the servers are reported up on :8180" 'grep -qF "bench :8000 and vite :8180 are up" "$L"'
check "postgres copies go to dev2's postgres container" 'grep -qF "frappe_dev2-postgresql-1:/tmp/envsync_restore.sql.gz" "$L"'
P=$(. "$NEW"; cmd_print)
check "print shows dev2's site, port, start scripts and launcher task" '
  grep -q "site  *dev2.localhost" <<< "$P" && grep -q "vite port  *8180" <<< "$P" &&
  grep -qF "then (once :8000 is open) /workspace/dev2_scripts/start_vite.sh" <<< "$P" &&
  grep -q "launcher task  *envsync-claude-launch-frappe_docker_dev2$" <<< "$P"'
clear_env
P=$(. "$NEW"; cmd_print)
check "print with no env.local shows main's defaults" 'grep -q "site  *localhost$" <<< "$P" && grep -q "container env  *none" <<< "$P" && grep -q "launcher task  *envsync-claude-launch-frappe_docker$" <<< "$P"'
cp "$L" "${KEEP_LOGS:-$W}/dev2_commands.log" 2>/dev/null

echo "== 3. remote scripts: with the site set back to localhost (and the port to 8080) each is the old script"
for f in backup.sh destale.sh restore_files.sh; do
  t=$(grep -v '^SITE="${ENV_SYNC_SITE:-localhost}" ' "$SRC/remote/$f"); t=${t//'"$SITE"'/localhost}
  check "$f" '[ "$t" = "$(old "remote/$f")" ]'
done
for f in ports.sh stop_bench.sh; do
  t=$(grep -v '^#' "$SRC/remote/$f"); t=${t//'"${ENV_SYNC_VITE_PORT:-8080}"'/8080}
  t=${t/'PAT="${ENV_SYNC_STOP_PATTERN:-'/"PAT='"}; t=${t/'vite --host}"'/"vite --host'"}
  check "$f" '[ "$t" = "$(old "remote/$f" | grep -v "^#")" ]'
done
check "no remote script hard-codes the site any more" '! grep -n "site localhost\|\"localhost/\|^for d in localhost" "$SRC"/remote/*'
check "get_db_name.sh and db_fingerprint.py read ENV_SYNC_SITE, default localhost" '
  grep -qF "os.environ.get(\"ENV_SYNC_SITE\", \"localhost\")" "$SRC/remote/get_db_name.sh" &&
  grep -qF "frappe.init(site=os.environ.get(\"ENV_SYNC_SITE\", \"localhost\"))" "$SRC/remote/db_fingerprint.py"'

echo "== 4. the dispatch is one block ending in exit"
check "the file ends with exit / }" '[ "$(tail -2 "$SRC/env_sync.sh" | tr "\n" " ")" = "exit } " ]'
check "the block opens on the line before CMD=" '[ "$(grep -B1 "^CMD=\"\${1:-}\"" "$SRC/env_sync.sh" | head -1)" = "{" ]'
check "an unknown command still prints the help and exits 1" '( cd "$W" && bash "$SRC/env_sync.sh" no-such-command > "$W/help" 2>&1 ); [ $? = 1 ] && grep -q "env_sync.sh print" "$W/help"'

echo "== 5. start_task.ps1: one task per environment"
line=$(old desktop/start_task.ps1 | grep '^\$argList = ')
check "the task's argument string is the old one" 'grep -qxF "$line" "$SRC/desktop/start_task.ps1"'
check "no fixed task name is left" '! grep -q "TaskName .envsync-claude-launch.\b\|TaskName envsync-claude-launch\b" "$SRC/desktop/start_task.ps1"'
if command -v powershell.exe > /dev/null 2>&1; then
  for env in frappe_docker frappe_docker_dev2; do
    d="$W/ps/$env/development/frappe-bench/envsync/desktop"; mkdir -p "$d"; cp "$SRC/desktop/start_task.ps1" "$d/"
    out=$(powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$d/start_task.ps1")" -Name probe -Mode start -PrintOnly | tr -d '\r')
    check "-PrintOnly under $env names envsync-claude-launch-$env" '[ "$(sed -n "s/^task=//p" <<< "$out")" = "envsync-claude-launch-$env" ]'
    check "-PrintOnly under $env passes launch.ps1 from its own folder" 'grep -qF "args=-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"$(cygpath -w "$d")\\launch.ps1\" -Name probe -Mode start -SessionId \"\"" <<< "$out"'
  done
else
  echo "skip -PrintOnly checks: no powershell.exe here"
fi

echo "== $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
