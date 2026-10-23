#!/usr/bin/env bash
# env_sync.sh -- the LAPTOP side of the owner's two-machine loop (docs/agents/environments.md).
# Runs on the laptop in Git Bash. Every transfer goes through the desktop's SSH server (scp + git bundles);
# nothing here talks to GitHub, and nothing here ever pushes to origin.
#
#   env_sync.sh status [--no-data]     code and data on both machines, and a verdict
#   env_sync.sh to-desktop             fast-forward the desktop to the laptop's commits, then destale it
#   env_sync.sh from-desktop           fast-forward the laptop to the desktop's commits, then destale it
#   env_sync.sh db-pull --yes          replace the laptop's database with a fresh backup of the desktop's (the master)
#   env_sync.sh reports                copy new or newer files from the desktop's Desktop to the laptop's Desktop
#   env_sync.sh watch [--logs NAME]    one monitoring snapshot: desktop commits, changes, servers, Claude sessions
#
# Flags: --allow-dirty (transfer although uncommitted tracked changes stay behind), --no-restart (skip the destale).
# Overrides: .claude/state/env.local (git-ignored) may set the ENV_SYNC_* variables below.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BENCH_HOST="$(cd "$REPO/../.." && pwd)"            # the laptop's frappe-bench, bind-mounted into its container
[ -f "$REPO/.claude/state/env.local" ] && . "$REPO/.claude/state/env.local"

DESKTOP="${ENV_SYNC_DESKTOP:-desktop}"                 # an alias in ~/.ssh/config (key login)
D_BENCH="${ENV_SYNC_DESKTOP_BENCH:-C:/Users/USER/Documents/frappe_docker/development/frappe-bench}"
D_REPORTS="${ENV_SYNC_DESKTOP_REPORTS:-C:/Users/USER/Desktop}"
L_REPORTS="${ENV_SYNC_LAPTOP_REPORTS:-$(cygpath -u "$USERPROFILE")/OneDrive/Desktop}"
FRAPPE_C="${ENV_SYNC_FRAPPE_CONTAINER:-frappe_docker_devcontainer-frappe-1}"
PG_C="${ENV_SYNC_PG_CONTAINER:-frappe_docker_devcontainer-postgresql-1}"
C_BENCH=/workspace/development/frappe-bench           # the same path inside both machines' containers
STAGE=envsync                                          # frappe-bench/envsync: seen by the host and the container
SSH=/c/Windows/System32/OpenSSH/ssh.exe
SCP=/c/Windows/System32/OpenSSH/scp.exe
SSHO=(-o BatchMode=yes -o ConnectTimeout=20)

die() { printf 'env_sync: %b\n' "$*" >&2; exit 2; }
kv() { printf '%s\n' "$2" | sed -n "s/^$1=//p" | head -1; }
lgit() { git -C "$REPO" "$@"; }
dps() { "$SSH" "${SSHO[@]}" "$DESKTOP" "$@" 2>&1 | tr -d '\r'; }   # a PowerShell command on the desktop
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

# Copy remote/ into frappe-bench/envsync on both machines, once per run.
ensure_stage() {
  [ -n "${STAGED:-}" ] && return 0
  mkdir -p "$BENCH_HOST/$STAGE" && cp "$HERE"/remote/* "$BENCH_HOST/$STAGE/" || die "cannot stage scripts on the laptop"
  dps "New-Item -ItemType Directory -Force -Path '$D_BENCH/$STAGE' | Out-Null" > /dev/null
  "$SCP" -q "${SSHO[@]}" "$HERE"/remote/* "$DESKTOP:$D_BENCH/$STAGE/" || die "cannot reach the desktop over SSH ($DESKTOP)"
  STAGED=1
}

# rrun <laptop|desktop> <bash|py> <script> [plain-token args...]: run a staged script in that machine's frappe container.
rrun() {
  local m="$1" kind="$2" s="$3"; shift 3
  local interp=bash; [ "$kind" = py ] && interp=env/bin/python
  ensure_stage
  if [ "$m" = laptop ]; then
    MSYS_NO_PATHCONV=1 docker exec -u frappe -w "$C_BENCH" "$FRAPPE_C" $interp "$C_BENCH/$STAGE/$s" "$@" 2>&1
  else
    dps "docker exec -u frappe -w $C_BENCH $FRAPPE_C $interp $C_BENCH/$STAGE/$s $*"
  fi
}

start_services() {
  local m="$1" out
  if [ "$m" = laptop ]; then
    MSYS_NO_PATHCONV=1 docker exec -d -u frappe "$FRAPPE_C" bash "$C_BENCH/$STAGE/start_bench.sh"
  else
    dps "docker exec -d -u frappe $FRAPPE_C bash $C_BENCH/$STAGE/start_bench.sh" > /dev/null
  fi
  for _ in $(seq 1 60); do
    out=$(rrun "$m" bash ports.sh)
    if echo "$out" | grep -q '8000 open' && echo "$out" | grep -q '8080 open'; then echo "$m: bench :8000 and vite :8080 are up"; return 0; fi
    sleep 5
  done
  echo "$m: WARNING the servers are not up after 5 minutes; see /tmp/envsync_logs/ in its container"
}

# After new code lands on a machine: migrate when schema-shaped files changed, destale unless only docs changed.
after_transfer() {
  local m="$1" changed="$2" mig=""
  echo "$changed" | grep -qE '(/doctype/.*\.json|patches\.txt|hooks\.py|/fixtures/.*\.json)$' && mig="--migrate"
  if ! echo "$changed" | grep -qvE '(\.md$|^\.claude/|^docs/|^scripts/)'; then echo "$m: nothing served changed (docs / scripts only), no restart needed"; return 0; fi
  if [ "${NO_RESTART:-0}" = 1 ]; then echo "$m: --no-restart given; destale it yourself before trusting what it serves"; return 0; fi
  echo "$m: destaling${mig:+ with migrate} ..."
  rrun "$m" bash destale.sh $mig | grep -vE '^(8000|8080) closed$' || die "$m: destale failed"
  start_services "$m"
}

# Fills L_* / D_* and VERDICT.
collect() {
  L_BRANCH=$(lgit rev-parse --abbrev-ref HEAD); L_HEAD=$(lgit rev-parse HEAD)
  L_DIRTY=$(lgit status --porcelain --untracked-files=no)
  local out; out=$(rrun desktop bash git_state.sh "$L_HEAD")
  D_BRANCH=$(kv branch "$out"); D_HEAD=$(kv head "$out")
  [ -n "$D_HEAD" ] || die "could not read the desktop's git state:\n$out"
  D_DIRTY=$(printf '%s\n' "$out" | sed -n 's/^dirtyfile=//p')
  D_AHEAD=$(kv ahead "$out"); D_LOG=$(printf '%s\n' "$out" | sed -n 's/^log=//p')
  if [ "$L_BRANCH" != "$D_BRANCH" ]; then VERDICT=BRANCH_MISMATCH
  elif [ "$L_HEAD" = "$D_HEAD" ]; then VERDICT=IN_SYNC
  elif lgit cat-file -e "$D_HEAD^{commit}" 2>/dev/null && lgit merge-base --is-ancestor "$D_HEAD" "$L_HEAD"; then VERDICT=LAPTOP_AHEAD
  elif [ "$(kv has_other "$out")" = 1 ] && [ "$(kv other_is_ancestor "$out")" = 1 ]; then VERDICT=DESKTOP_AHEAD
  else VERDICT=DIVERGED; fi
}

print_code() {
  local ln dn; ln=$(printf '%s' "$L_DIRTY" | grep -c .); dn=$(printf '%s' "$D_DIRTY" | grep -c .)
  echo "code"
  echo "  laptop   $L_BRANCH @ ${L_HEAD:0:9}   uncommitted tracked changes: $ln"
  [ "$ln" -gt 0 ] && printf '%s\n' "$L_DIRTY" | sed 's/^/             /'
  echo "  desktop  $D_BRANCH @ ${D_HEAD:0:9}   uncommitted tracked changes: $dn"
  [ "$dn" -gt 0 ] && printf '%s\n' "$D_DIRTY" | sed 's/^/             /'
  case $VERDICT in
    IN_SYNC)         echo "  verdict  IN_SYNC";;
    LAPTOP_AHEAD)    echo "  verdict  LAPTOP_AHEAD by $(lgit rev-list --count "$D_HEAD..$L_HEAD") commit(s)   next: env_sync.sh to-desktop";;
    DESKTOP_AHEAD)   echo "  verdict  DESKTOP_AHEAD by $D_AHEAD commit(s)   next: env_sync.sh from-desktop"
                     printf '%s\n' "$D_LOG" | sed 's/^/             /';;
    BRANCH_MISMATCH) echo "  verdict  BRANCH_MISMATCH: the machines are on different branches. STOP and ask the owner.";;
    DIVERGED)        echo "  verdict  DIVERGED: each machine has commits the other lacks. STOP and ask the owner; never auto-merge.";;
  esac
}

cmd_status() {
  collect; print_code
  if [ "${NO_DATA:-0}" != 1 ]; then
    local lf df; lf=$(rrun laptop py db_fingerprint.py | grep '^fp_'); df=$(rrun desktop py db_fingerprint.py | grep '^fp_')
    echo "data"
    printf '%s\n' "$lf" | sed 's/^fp_/  laptop   /'
    printf '%s\n' "$df" | sed 's/^fp_/  desktop  /; 1s/$/   (master)/'
    if [ "$lf" = "$df" ]; then echo "  verdict  SAME"
    else echo "  verdict  DIFFERENT: the laptop's copy is not the master's. Run env_sync.sh db-pull --yes before laptop work that needs live data."; fi
  fi
  case $VERDICT in IN_SYNC) return 0;; LAPTOP_AHEAD) return 10;; DESKTOP_AHEAD) return 11;; *) return 20;; esac
}

cmd_to_desktop() {
  collect; print_code
  case $VERDICT in IN_SYNC) echo "nothing to send"; return 0;; LAPTOP_AHEAD) ;; *) die "refusing: the verdict is $VERDICT, to-desktop needs LAPTOP_AHEAD";; esac
  [ -z "$L_DIRTY" ] || [ "${ALLOW_DIRTY:-0}" = 1 ] || die "the laptop has uncommitted tracked changes, which would NOT travel.\nCommit or stash them, or pass --allow-dirty."
  local b="to-desktop-${L_HEAD:0:9}.bundle" out
  lgit bundle create -q "$TMPD/$b" "^$D_HEAD" "refs/heads/$L_BRANCH" || die "git bundle failed"
  "$SCP" -q "${SSHO[@]}" "$TMPD/$b" "$DESKTOP:$D_BENCH/$STAGE/$b" || die "copying the bundle to the desktop failed"
  out=$(rrun desktop bash apply_bundle.sh "$C_BENCH/$STAGE/$b" "$L_BRANCH" laptop)
  [ "$(kv after "$out")" = "$L_HEAD" ] || die "the desktop did not reach ${L_HEAD:0:9}; it is unchanged.\n$out"
  echo "desktop: fast-forwarded ${D_HEAD:0:9} -> ${L_HEAD:0:9}"
  after_transfer desktop "$(printf '%s\n' "$out" | sed -n 's/^changed=//p')"
}

cmd_from_desktop() {
  collect; print_code
  case $VERDICT in IN_SYNC) echo "nothing to fetch"; return 0;; DESKTOP_AHEAD) ;; *) die "refusing: the verdict is $VERDICT, from-desktop needs DESKTOP_AHEAD";; esac
  [ -z "$L_DIRTY" ] || die "the laptop has uncommitted tracked changes; commit or stash them before taking the desktop's commits."
  [ -z "$D_DIRTY" ] || [ "${ALLOW_DIRTY:-0}" = 1 ] || die "the desktop has uncommitted changes that would stay behind.\nCommit them on the desktop first, or pass --allow-dirty to bring only the commits."
  local b="from-desktop-${D_HEAD:0:9}.bundle" out before="$L_HEAD"
  out=$(rrun desktop bash make_bundle.sh "$L_HEAD" "$D_BRANCH" "$C_BENCH/$STAGE/$b")
  [ -n "$(kv bundle "$out")" ] || die "the desktop could not make the bundle:\n$out"
  "$SCP" -q "${SSHO[@]}" "$DESKTOP:$D_BENCH/$STAGE/$b" "$TMPD/$b" || die "copying the bundle back failed"
  dps "Remove-Item -LiteralPath '$D_BENCH/$STAGE/$b'" > /dev/null
  lgit fetch -q "$TMPD/$b" "+refs/heads/$D_BRANCH:refs/remotes/desktop/$D_BRANCH" || die "fetching the bundle failed"
  lgit merge --ff-only -q "desktop/$D_BRANCH" || die "the laptop refused the fast-forward; it is unchanged."
  echo "laptop: fast-forwarded ${before:0:9} -> $(lgit rev-parse --short=9 HEAD)"
  lgit log --oneline "$before..HEAD" | sed 's/^/  /'
  after_transfer laptop "$(lgit diff --name-only "$before" HEAD)"
  local ahead; ahead=$(lgit rev-list --count "origin/$L_BRANCH..HEAD" 2>/dev/null || echo "?")
  echo "the laptop is $ahead commit(s) ahead of origin/$L_BRANCH. The owner pushes to GitHub by hand."
}

cmd_db_pull() {
  [ "${YES:-0}" = 1 ] || die "db-pull REPLACES the laptop's database with a fresh backup of the desktop's (the master).\nRe-run with --yes."
  local out prefix db
  echo "desktop: backing up ..."
  out=$(rrun desktop bash backup.sh); prefix=$(kv prefix "$out")
  [ -n "$prefix" ] || die "the desktop backup failed:\n$out"
  mkdir -p "$BENCH_HOST/sites/$(dirname "$prefix")"
  for suf in -database.sql.gz -files.tar -private-files.tar; do
    "$SCP" -q "${SSHO[@]}" "$DESKTOP:$D_BENCH/sites/$prefix$suf" "$BENCH_HOST/sites/$prefix$suf" || die "copying $prefix$suf failed"
  done
  echo "laptop: copied $(basename "$prefix") ($(du -h "$BENCH_HOST/sites/$prefix-database.sql.gz" | cut -f1) database)"
  db=$(kv db_name "$(rrun laptop bash get_db_name.sh)"); [ -n "$db" ] || die "cannot read the laptop's database name"
  rrun laptop bash stop_bench.sh > /dev/null
  MSYS_NO_PATHCONV=1 docker cp "$(cygpath -w "$BENCH_HOST/sites/$prefix-database.sql.gz")" "$PG_C:/tmp/envsync_restore.sql.gz" || die "docker cp of the dump failed"
  MSYS_NO_PATHCONV=1 docker cp "$(cygpath -w "$HERE/remote/restore_db.sh")" "$PG_C:/tmp/envsync_restore_db.sh" || die "docker cp of restore_db.sh failed"
  echo "laptop: restoring the database ..."
  MSYS_NO_PATHCONV=1 docker exec "$PG_C" bash /tmp/envsync_restore_db.sh "$db" /tmp/envsync_restore.sql.gz || die "the database restore failed (bench is stopped)"
  rrun laptop bash restore_files.sh "$prefix" || die "files or migrate failed (bench is stopped)"
  start_services laptop
  NO_DATA=0; cmd_status > "$TMPD/st" 2>&1; sed -n '/^data/,$p' "$TMPD/st"
}

cmd_reports() {
  local list name epoch lp copied=0
  list=$(dps "Get-ChildItem -LiteralPath '$D_REPORTS' | Where-Object { \$_.Extension -ne '.lnk' } | ForEach-Object { if (\$_.PSIsContainer) { \$t = Get-ChildItem -LiteralPath \$_.FullName -Recurse -File | Sort-Object LastWriteTimeUtc | Select-Object -Last 1 -ExpandProperty LastWriteTimeUtc; if (-not \$t) { \$t = \$_.LastWriteTimeUtc }; 'D|' + \$_.Name + '|' + ([DateTimeOffset]\$t).ToUnixTimeSeconds() } else { 'F|' + \$_.Name + '|' + ([DateTimeOffset]\$_.LastWriteTimeUtc).ToUnixTimeSeconds() + '|' + \$_.Length } }")
  while IFS='|' read -r kind name epoch size; do
    [ -n "$name" ] || continue
    lp="$L_REPORTS/$name"
    if [ "$kind" = F ]; then
      [ -f "$lp" ] && [ "$(stat -c %Y "$lp")" -ge "$epoch" ] && continue
      if [ -f "$lp" ] && [ "$(stat -c %s "$lp")" = "$size" ] && [ "$(sha256sum < "$lp" | cut -c1-64)" = \
          "$(dps "(Get-FileHash -Algorithm SHA256 -LiteralPath '$D_REPORTS/$name').Hash.ToLower()")" ]; then
        continue                                     # same bytes, only a newer timestamp on the desktop
      fi
      "$SCP" -q "${SSHO[@]}" "$DESKTOP:$D_REPORTS/$name" "$lp" && touch -d "@$epoch" "$lp" && echo "  copied   $name" && copied=$((copied + 1))
    elif [ "$kind" = D ]; then
      [ -d "$lp" ] && [ "$(find "$lp" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)" -ge "$epoch" ] 2>/dev/null && continue
      "$SCP" -q -r "${SSHO[@]}" "$DESKTOP:$D_REPORTS/$name" "$L_REPORTS/" && echo "  copied   $name/" && copied=$((copied + 1))
    fi
  done <<< "$list"
  echo "reports: $copied item(s) copied from the desktop to $L_REPORTS"
}

cmd_watch() {
  collect; print_code
  echo "desktop servers: $(rrun desktop bash ports.sh | tr '\n' ' ')"
  echo "desktop Claude sessions:"
  dps "claude agents --json" | python3 -c '
import json, sys, datetime
try: rows = json.load(sys.stdin)
except Exception: print("  (could not read claude agents --json)"); sys.exit()
for r in rows or []:
    t = r.get("startedAt"); t = datetime.datetime.fromtimestamp(t / 1000).strftime("%m-%d %H:%M") if t else "?"
    print("  %-18s %-12s %-8s started %s  %s" % (r.get("name", "?"), r.get("kind", "?"), r.get("status", "?"), t, r.get("cwd", "")))
if not rows: print("  none")'
  if [ -n "${LOGS:-}" ]; then
    echo "--- claude logs $LOGS (last ${LINES_N:-40} lines)"
    dps "claude logs '$LOGS'" | sed -e 's/\x1b\[[0-9;?]*[A-Za-z]//g' -e 's/\x1b\][^\x07]*\x07//g' | grep -v '^\s*$' | tail -n "${LINES_N:-40}"
  fi
}

CMD="${1:-}"; [ $# -gt 0 ] && shift
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1;; --allow-dirty) ALLOW_DIRTY=1;; --no-restart) NO_RESTART=1;; --no-data) NO_DATA=1;;
    --logs) LOGS="${2:-}"; shift;; --lines) LINES_N="${2:-40}"; shift;;
    *) die "unknown flag $1";;
  esac
  shift
done
case "$CMD" in status|to-desktop|from-desktop|db-pull|watch) ensure_stage;; esac   # once, outside any $(...) subshell
case "$CMD" in
  status) cmd_status;; to-desktop) cmd_to_desktop;; from-desktop) cmd_from_desktop;;
  db-pull) cmd_db_pull;; reports) cmd_reports;; watch) cmd_watch;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 1;;
esac
