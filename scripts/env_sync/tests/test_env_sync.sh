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
SRC=$(cd "$HERE/.." && pwd)                      # scripts/env_sync (or a scratch copy of it: the file under test)
# A vacuity check switches a rule off in a SCRATCH COPY of scripts/env_sync and runs that copy's tests with
# ENV_SYNC_TEST_REPO=<the real checkout> (for the base revision). NEVER edit the live folder for it: the scheduled copier
# runs the live poller_run.sh (2026-11-18 20:27: a real "leaving" was clicked while a vacuity edit was in the live file).
REPO=${ENV_SYNC_TEST_REPO:-$(cd "$SRC/../.." && pwd)}
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
# CKP-4 added two ssh keep-alive options to every ssh / scp (a stalled connection is given up after a minute). They are the
# ONE intended difference from the base's commands: checked by name, then set aside for the byte-for-byte comparison.
check "every ssh carries the keep-alive options (a stalled connection gives up after 4 x 15 s)" '
  [ "$(grep -c "^ssh" "$W/log_after")" = "$(grep -c "^ssh .*\[-o\] \[ServerAliveInterval=15\] \[-o\] \[ServerAliveCountMax=4\]" "$W/log_after")" ]'
sed -i 's/ \[-o\] \[ServerAliveInterval=15\] \[-o\] \[ServerAliveCountMax=4\]//' "$W/log_after"
if cmp -s "$W/log_before" "$W/log_after"; then ok "before == after, byte for byte (keep-alive options aside)"; else bad "before != after"; diff "$W/log_before" "$W/log_after" | head -20; fi
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

echo "== 6. checkpoints (CKP-1): code snapshots rebuild exactly, never touch the source checkout, refuse conflicts"
R6="$W/ck"; mkdir -p "$R6"
# the throw-away repos have no .gitattributes (the real one sets eol=lf): keep line endings as written
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=false
CODE="$SRC/remote/ckpt_code.sh"; APPLY="$SRC/remote/ckpt_apply.sh"; BRANCH="$SRC/remote/ckpt_branch.sh"
G() { git -C "$1" -c user.name=t -c user.email=t@t "${@:2}"; }
src="$R6/src"; mkdir -p "$src"; G "$src" init -q -b work
printf 'one\n' > "$src/f1"; printf 'two\n' > "$src/f2"; printf 'keep\n' > "$src/f3"; printf '*.log\n' > "$src/.gitignore"
G "$src" add -A; G "$src" commit -q -m A; A=$(G "$src" rev-parse HEAD)
G "$src" clone -q "$src" "$R6/clone_a"                       # a second machine at A
printf 'three\n' > "$src/f4"; G "$src" add f4; G "$src" commit -q -m B; B=$(G "$src" rev-parse HEAD)
printf 'one changed\n' > "$src/f1"; rm "$src/f2"; printf 'staged\n' > "$src/f5"; G "$src" add f5
mkdir -p "$src/new dir"; printf 'new\n' > "$src/new dir/n.txt"; printf 'x\n' > "$src/debug.log"
printf 'noise\n' > "$src/tendering-won.patch"; mkdir -p "$src/_classification_review"; printf 'n\n' > "$src/_classification_review/r.txt"
st_before=$(G "$src" status --porcelain); idx_before=$(sha256sum < "$src/.git/index")

out=$(bash "$CODE" "$src" "$R6/ck1" "$A"); rc=$?
check "ckpt_code: a live snapshot is made (rc 0, tree= printed)" '[ $rc = 0 ] && grep -q "^tree=[0-9a-f]\{40\}$" <<< "$out"'
check "ckpt_code: the source checkout is untouched (status and index byte-equal)" '[ "$(G "$src" status --porcelain)" = "$st_before" ] && [ "$(sha256sum < "$src/.git/index")" = "$idx_before" ]'
check "ckpt_code: new files are packed, the declared noise and ignored files are not" '
  l=$(tar -tf "$R6/ck1/untracked.tar"); grep -qx "new dir/n.txt" <<< "$l" && ! grep -q "tendering-won.patch\|_classification_review\|debug.log" <<< "$l"'
check "ckpt_code: tracked.diff holds the edit, the deletion and the staged new file" 'grep -q "^+++ b/f1" "$R6/ck1/tracked.diff" && grep -q "^deleted file" "$R6/ck1/tracked.diff" && grep -q "^+++ b/f5" "$R6/ck1/tracked.diff"'
check "ckpt_code: commits after the base travel in a bundle" 'grep -qx "bundle=commits.bundle" "$R6/ck1/head.txt" && git bundle list-heads "$R6/ck1/commits.bundle" | grep -q "$B"'
mkdir -p "$W/h"; ( export HOME="$W/h" USERPROFILE="$W/h"; bash "$CODE" "$src" "$R6/ck_home" "$A" > /dev/null; bash "$BRANCH" "$src" H-1 20261117-0000 > /dev/null; bash "$APPLY" tree "$src" > /dev/null )
check "on a host the checkpoint scripts leave the user's global git config alone (no ~/.gitconfig written)" '[ ! -e "$W/h/.gitconfig" ]'
check "ckpt_code: an existing out dir is refused" '! bash "$CODE" "$src" "$R6/ck1" "$A" > /dev/null'

out=$(bash "$APPLY" apply "$R6/clone_a" "$R6/ck1" 2>&1); rc=$?
check "ckpt_apply: the clone at A is fast-forwarded to B and rebuilt to the snapshot's tree" '[ $rc = 0 ] && grep -q "applied: tree equals" <<< "$out" && [ "$(G "$R6/clone_a" rev-parse HEAD)" = "$B" ]'
check "ckpt_apply: the rebuilt files are the source's (edit, deletion, new file in a folder with a space)" '
  [ "$(cat "$R6/clone_a/f1")" = "one changed" ] && [ ! -e "$R6/clone_a/f2" ] && [ "$(cat "$R6/clone_a/new dir/n.txt")" = new ] && [ ! -e "$R6/clone_a/tendering-won.patch" ]'
out=$(bash "$APPLY" undo "$R6/clone_a" "$R6/ck1" 2>&1)
check "ckpt_apply undo: the snapshot's work comes off (tracked back to HEAD, its new files removed by name)" '
  [ -z "$(G "$R6/clone_a" status --porcelain)" ] && [ "$(G "$R6/clone_a" rev-parse HEAD)" = "$B" ]'

G "$src" clone -q "$src" "$R6/clone_dirty"; G "$R6/clone_dirty" reset -q --hard "$A"; printf 'local edit\n' > "$R6/clone_dirty/f3"
out=$(bash "$APPLY" apply "$R6/clone_dirty" "$R6/ck1" 2>&1); rc=$?
check "ckpt_apply: a checkout with its own uncommitted change is refused as a CONFLICT and left as it was" '
  [ $rc = 1 ] && grep -q "CONFLICT" <<< "$out" && [ "$(cat "$R6/clone_dirty/f3")" = "local edit" ] && [ "$(G "$R6/clone_dirty" rev-parse HEAD)" = "$A" ]'
G "$src" clone -q "$src" "$R6/clone_clash"; G "$R6/clone_clash" reset -q --hard "$A"; mkdir -p "$R6/clone_clash/new dir"; printf 'other\n' > "$R6/clone_clash/new dir/n.txt"
out=$(bash "$APPLY" apply "$R6/clone_clash" "$R6/ck1" 2>&1); rc=$?
check "ckpt_apply: a new file that already exists on the target is a CONFLICT; nothing overwritten" '[ $rc = 1 ] && grep -q CONFLICT <<< "$out" && [ "$(cat "$R6/clone_clash/new dir/n.txt")" = other ]'

out=$(bash "$BRANCH" "$src" T-1 20261117-1500); rc=$?
check "ckpt_branch: a local ckpt/ branch is made; the checkout's status, index and branch are untouched" '
  [ $rc = 0 ] && G "$src" show-ref -q --verify refs/heads/ckpt/T-1-20261117-1500 && [ "$(G "$src" status --porcelain)" = "$st_before" ] &&
  [ "$(sha256sum < "$src/.git/index")" = "$idx_before" ] && [ "$(G "$src" rev-parse --abbrev-ref HEAD)" = work ]'
CK=$(sed -n "s/^commit=//p" <<< "$out")
check "ckpt_branch: its tree equals the live snapshot's tree (same construction, noise left out)" '[ "$(G "$src" rev-parse "$CK^{tree}")" = "$(sed -n "s/^tree=//p" "$R6/ck1/head.txt")" ]'
check "ckpt_branch: the commit carries the neutral identity, no personal detail" '[ "$(G "$src" log -1 --format="%an <%ae>" "$CK")" = "envsync checkpoint <envsync@localhost>" ]'
check "ckpt_branch: the same name twice is refused" '! bash "$BRANCH" "$src" T-1 20261117-1500 > /dev/null'

out=$(bash "$CODE" "$src" "$R6/ck3" "$A" "$CK"); rc=$?
check "ckpt_code from a checkpoint commit: tree = the commit's, bundle carries the ckpt/ branch" '
  [ $rc = 0 ] && [ "$(sed -n "s/^tree=//p" "$R6/ck3/head.txt")" = "$(G "$src" rev-parse "$CK^{tree}")" ] && git bundle list-heads "$R6/ck3/commits.bundle" | grep -q "refs/heads/ckpt/T-1-20261117-1500"'
G "$src" clone -q "$src" "$R6/clone_b"; G "$R6/clone_b" checkout -q -B work "$A"
out=$(bash "$APPLY" apply "$R6/clone_b" "$R6/ck3" 2>&1); rc=$?
check "ckpt_apply of the B3 form on a machine at A: fast-forward + rebuild = the checkpoint commit's tree" '[ $rc = 0 ] && grep -q "applied: tree equals" <<< "$out"'
printf 'later\n' > "$src/f3"; out=$(bash "$CODE" "$src" "$R6/ck4" "$A")
bash "$APPLY" undo "$R6/clone_b" "$R6/ck3" > /dev/null; out=$(bash "$APPLY" apply "$R6/clone_b" "$R6/ck4" 2>&1); rc=$?
check "in order: undo the B3 snapshot, apply a later snapshot -> its tree (the takeover sequence)" '[ $rc = 0 ] && [ "$(cat "$R6/clone_b/f3")" = later ] && grep -q "applied: tree equals" <<< "$out"'

cc() { ( PATH="$BIN:$PATH"; . "$NEW"; counts_check "$@" ) > /dev/null 2>&1; }
check "counts_check: a copy whose counts lie between the desktop's before / after counts passes" 'cc "$(printf "count_a=10\ncount_b=5")" "$(printf "count_a=12\ncount_b=5")" "$(printf "count_a=11\ncount_b=5")"'
check "counts_check: a copy outside them fails" '! cc "$(printf "count_a=10")" "$(printf "count_a=12")" "$(printf "count_a=9")"'
check "counts_check: a copy with no counts fails" '! cc "count_a=1" "count_a=1" ""'
H=$( ( cd "$W" && bash "$SRC/env_sync.sh" no-such-command 2>&1 ) )
check "the help names checkpoint-code, checkpoint and resume-on-laptop" 'grep -q "checkpoint-code --slice" <<< "$H" && grep -q "checkpoint --slice S" <<< "$H" && grep -q "resume-on-laptop --slice" <<< "$H"'
check "a checkpoint command without --slice is refused" '! ( cd "$W" && PATH="$BIN:$PATH" STUB_LOG="$W/x" bash "$SRC/env_sync.sh" resume-on-laptop > /dev/null 2>&1 )'
check "scratch_counts.sh strips pg_dump's restrict lines exactly as restore_db.sh does (a missing backslash made AC2's first proof refuse the dump)" '
  [ "$(grep -o "sed -e .*unrestrict /d.\?" "$SRC/remote/scratch_counts.sh" | head -1)" = "$(grep -o "sed -e .*unrestrict /d.\?" "$SRC/remote/restore_db.sh" | head -1)" ]'
lp() { ( PATH="$BIN:$PATH"; . "$NEW"; is_lan_path "$1" ) > /dev/null 2>&1; }
check "office-LAN test: a direct path over a private address is the LAN" 'lp "pong from nitesh-desktop (100.84.255.77) via 192.168.0.210:41641 in 6ms" && lp "pong from d (100.1.1.1) via 10.0.0.5:41641 in 3ms" && lp "pong from d (100.1.1.1) via 172.20.1.9:41641 in 3ms"'
check "office-LAN test: the DERP relay or a public address is not the LAN" '! lp "pong from d (100.84.255.77) via DERP(blr) in 90ms" && ! lp "pong from d (100.84.255.77) via 49.37.10.20:41641 in 40ms" && ! lp ""'
head -c 3500000 /dev/urandom > "$W/blob.bin"
out=$(bash "$SRC/remote/chunk_split.sh" "$W/blob.bin" "$W/chunks" 1); rc=$?
check "chunk_split: a file splits into 1 MB parts with a sha256 per part" '[ $rc = 0 ] && [ "$(sed -n "s/^parts=//p" <<< "$out")" = 4 ] && [ "$(grep -c "^part=part_00[0-3] size=[0-9]* sha256=[0-9a-f]\{64\}$" <<< "$out")" = 4 ]'
cat "$W/chunks"/part_* > "$W/blob.re"
check "chunk_split: the parts reassemble byte-for-byte (whole-file sha256 equal)" '[ "$(sha256sum < "$W/blob.bin")" = "$(sha256sum < "$W/blob.re")" ]'
check "chunk_split: an existing out dir is refused" '! bash "$SRC/remote/chunk_split.sh" "$W/blob.bin" "$W/chunks" 1 > /dev/null'
route() {   # route <normal rc> <force>: which copy route pull_copy_prove_restore takes (copies stubbed, stops before the restore)
  ( RC_NORMAL=$1; PATH="$BIN:$PATH"; . "$NEW"; on_lan() { LAN_PATH="pong via 192.168.0.210:41641"; return 0; }
    copy_normal() { COPY_WHY="stub cut"; return "$RC_NORMAL"; }; copy_chunked() { echo "CHUNKED"; }
    FORCE_CHUNKED=$2; PB_PREFIX=x/y; BENCH_HOST="$W/bh"; kv() { :; }; rrun() { :; }
    die() { echo "DIE"; exit 9; }; pull_copy_prove_restore "t" 2>&1 ) | grep -E "^copy:|CHUNKED" | head -3
}
check "B2: the normal copy is tried first; when it works, no chunked copy" '! grep -q CHUNKED <<< "$(route 0 0)"'
check "B2: a failed normal copy switches ONCE to the chunked route (no second normal try)" 'r=$(route 1 0); grep -q "switching to the chunked route" <<< "$r" && grep -q CHUNKED <<< "$r"'
check "B2: --chunked forces the chunked route (AC2's second measurement)" 'r=$(route 0 1); grep -q "forced with --chunked" <<< "$r" && grep -q CHUNKED <<< "$r"'
check "checkpoints live on the laptop's local disk (envsync/checkpoints), not in a cloud-synced folder" '[ "$( ( . "$NEW"; SLICE=T-1; ckpt_dir ) )" = "$( ( . "$NEW"; echo "$BENCH_HOST" ) )/envsync/checkpoints/T-1" ]'
check "no cloud-drive route is left: the OneDrive checkpoint script is gone and no checkpoint path names OneDrive" '
  [ ! -e "$SRC/desktop/ckpt_onedrive.sh" ] && ! grep -n "CKPT_ROOT=.*OneDrive\|ckpt_dir.*OneDrive" "$SRC/env_sync.sh" && ! grep -qi "ckpt_onedrive" "$SRC/desktop/brief_footer.md" "$SRC/README.md"'
mkdir -p "$W/relay/T-1"; : > "$W/relay/T-1/to_chat.md"
out=$( ( PATH="$BIN:$PATH"; . "$NEW"; CKPT_ROOT="$W/ckroot"; RELAY_ROOT="$W/relay"; SLICE=T-1; ENV_SYNC_TEST_FAIL=b1; laptop_down() { :; }; test_fail b1; echo "NOT REACHED" ) 2>&1 ); rc=$?
check "F1: a forced B1 failure exits 3 at once, logged ONCE in failures.log and ONCE in the relay, nothing after it runs" '
  [ $rc = 3 ] && ! grep -q "NOT REACHED" <<< "$out" && [ "$(grep -c "CHECKPOINT FAILED" "$W/ckroot/T-1/failures.log")" = 1 ] && [ "$(grep -c "T-1-CKPFAIL" "$W/relay/T-1/to_chat.md")" = 1 ] && grep -q "the slice carries on" "$W/relay/T-1/to_chat.md"'
out=$( ( PATH="$BIN:$PATH"; . "$NEW"; CKPT_ROOT="$W/ckroot"; RELAY_ROOT="$W/relay"; SLICE=T-1; NAME=s; CK_RELEASE_ON_FAIL=1; laptop_down() { :; }
         tell_session() { echo "TOLD: $1"; }; ENV_SYNC_TEST_FAIL=b3-capture; test_fail b3-capture ) 2>&1 )
check "F2: a B3 failure before CHECKPOINT TAKEN releases the waiting session at once (CHECKPOINT FAILED ... carry on)" 'grep -q "TOLD: CHECKPOINT FAILED .* carry on" <<< "$out"'
out=$( ( PATH="$BIN:$PATH"; . "$NEW"; SLICE=T-1; NAME=s; laptop_down() { :; }; tell_session() { echo "TOLD: $1"; }; ENV_SYNC_TEST_FAIL=b3-silent; test_fail b3-silent ) 2>&1 ); rc=$?
check "F2: the b3-silent test point stands for a dead laptop: exit 5 and the session is NOT told (its own 20-minute ceiling must bring it back)" '[ $rc = 5 ] && ! grep -q TOLD <<< "$out"'
check "F2: the session protocol caps the checkpoint wait at 20 minutes and resumes on its own" 'grep -q "wait at most 20 minutes" "$SRC/desktop/brief_footer.md" && grep -q "ceiling: no answer in 20 min - resumed" "$SRC/desktop/brief_footer.md"'
out=$( ( PATH="$BIN:$PATH"; . "$NEW"; SSH="$BIN/ssh"; SLICE=T-1; cmd_catch_up ) 2>&1 ); rc=$?
check "B4: with the desktop silent, catch-up says NOT CAUGHT UP (exit 3) - it checks the desktop before staging anything" '[ $rc = 3 ] && grep -q "NOT CAUGHT UP" <<< "$out"'
check "B4: catch-up is not in the eager staging list (staging needs the desktop)" '! grep -q "checkpoint-code|checkpoint|catch-up) ensure_stage" "$SRC/env_sync.sh"'
check "B5 dry run starts its clone at the laptop's head recorded when B3 was taken; the real takeover keeps the strict ancestor check" 'grep -q "the rehearsal starts from the laptop as it was when the B3 checkpoint was taken" "$SRC/env_sync.sh" && grep -q "is not an ancestor of the checkpoint" "$SRC/remote/ckpt_apply.sh"'
check "R2: the laptop poller runs catch-up by itself when the desktop answers again, and skips B1 while offline" 'grep -q "env_sync.sh\" catch-up --slice" "$SRC/slice_poll.sh" && grep -q "OFFLINE" "$SRC/slice_poll.sh" && grep -q "checkpoint-code --slice \"\$SLICE\" --name \"\$NAME\" --if-older 15" "$SRC/slice_poll.sh" && bash -n "$SRC/slice_poll.sh"'
check "the help names catch-up (B4 back home)" 'grep -q "catch-up --slice" <<< "$H"'
check "backups leave private/backups: backup_local.sh writes to envsync/backups and db-push / db-pull use it" '
  grep -q -- "--backup-path \"\$PWD/\$D\"" "$SRC/remote/backup_local.sh" && [ "$(grep -c "bash backup_local.sh" "$SRC/env_sync.sh")" = 3 ] && ! grep -q "bash backup.sh" "$SRC/env_sync.sh"'
check "db-push makes the laptop backup's envsync/backups/<stamp> folder on the desktop before copying into it (SYNC-D4)" '
  awk "/^cmd_db_push\\(\\)/,/^}/" "$SRC/env_sync.sh" | grep -B1 -A3 "New-Item -ItemType Directory -Force -Path .\$D_BENCH/sites/\$(dirname \"\$lprefix\")" | grep -q "for suf in -database.sql.gz"'

echo "== 7. the checkpoint copier (CKP-3 scheduled task; CKP-4 any Stack dev work, several units at once, 'leaving')"
# poller_run.sh with every outside call replaced: env_sync.sh (units, checkpoint-code, catch-up, checkpoint, tell), docker,
# the Docker Desktop start, tailscale and the memory reading are stubs that log their arguments and answer what the case
# sets. Nothing reaches a machine, a container, a session or a scheduled task.
PW="$W/poller"; mkdir -p "$PW/state" "$PW/bin" "$PW/sites/localhost/locks"
MR="C:/Users/USER/Documents/frappe_docker/development/frappe-bench/apps/nirmaan_stack"
cat > "$PW/bin/env_sync" <<'EOF'
#!/usr/bin/env bash
echo "env_sync $*" >> "$PW_LOG"
cat > /dev/null     # like ssh, the real one reads its stdin: the copier must never hand it the unit list it is looping over
slice=""; a=("$@"); for i in "${!a[@]}"; do [ "${a[$i]}" = --slice ] && slice="${a[$((i + 1))]}"; done
case "$1" in
  units) n=$(cat "$PW_DIR/units_fail" 2>/dev/null || echo 0)
         if [ "$n" -gt 0 ]; then echo $((n - 1)) > "$PW_DIR/units_fail"; exit 2; fi     # the first n calls fail, like a clash
         [ -f "$PW_DIR/units_out" ] || exit 2; cat "$PW_DIR/units_out"; exit 0;;
  tell) exit 0;;
  checkpoint) if [ -f "$PW_DIR/leave_ok" ]; then echo "CHECKPOINT READY $slice 2026-11-18 19:00: code + database HELD on the laptop (not loaded); took 100 s"; exit 0; fi; echo "env_sync: the desktop backup failed"; exit 2;;
  # CKP-5: the away copy is HELD - the stub leaves a held copy made at the moment the case names (b2_held)
  catch-up) case "$*" in *"--yes --hold"*) if [ -f "$PW_DIR/b2_held" ]; then h=$(cat "$PW_DIR/b2_held"); d="$PW_DIR/pending/$(tr -d ':-' <<< "$h" | tr ' ' '_')"; mkdir -p "$d"; printf 'held=%s\nrestored=\n' "$h" > "$d/held.txt"; fi;; esac;;
esac
if [ -f "$PW_DIR/ck_out_$slice" ]; then cat "$PW_DIR/ck_out_$slice"; else cat "$PW_DIR/es_out" 2>/dev/null; fi
exit "$(cat "$PW_DIR/es_rc" 2>/dev/null || echo 0)"
EOF
cat > "$PW/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$PW_LOG"
case "$1" in
  info) [ -f "$PW_DIR/docker_hang" ] && sleep 30; [ -f "$PW_DIR/engine_up" ];;
  inspect) echo false;;
  desktop) rm -f "$PW_DIR/engine_up";;
esac
EOF
cat > "$PW/bin/engine_start" <<'EOF'
#!/usr/bin/env bash
echo "engine_start" >> "$PW_LOG"; touch "$PW_DIR/engine_up"
EOF
cat > "$PW/bin/tailscale" <<'EOF'
#!/usr/bin/env bash
cat "$PW_DIR/ts_out" 2>/dev/null
EOF
# CKP-5: the copier must never start Docker. A docker on the PATH that only records that it was called, for the whole section.
mkdir -p "$PW/pathbin"; printf '#!/usr/bin/env bash\necho "docker $*" >> "$PW_DIR/docker_ever.log"; echo "docker $*" >> "$PW_LOG"\n' > "$PW/pathbin/docker"
chmod +x "$PW/bin/"* "$PW/pathbin/docker"
prun() {   # one copier run against the stubs (the real Docker Desktop, tailscale and desktop are never touched by a test)
  PW_DIR="$PW" PW_LOG="$PW/calls.log" POLLER_STATE="$PW/state" POLLER_HEARTBEAT="$PW/hb.txt" POLLER_LOG="$PW/poller.log" \
  POLLER_ENV_SYNC="$PW/bin/env_sync" POLLER_DOCKER="$PW/bin/docker" POLLER_ENGINE_WAIT=1 POLLER_ENGINE_SETTLE=0 \
  POLLER_FREE_MB="${POLLER_FREE_MB:-8000}" POLLER_LOCATION="${POLLER_LOCATION-away}" POLLER_TAILSCALE="${POLLER_TAILSCALE:-}" \
  POLLER_ENGINE_START="$PW/bin/engine_start" POLLER_LEAVING_WAIT="${POLLER_LEAVING_WAIT:-0}" POLLER_LEAVING_STEP=1 \
  POLLER_OPS_RELAY="$PW/ops.md" ENV_SYNC_LEAVING_FLAG="$PW/leaving.flag" \
  POLLER_DETECT_SLEEP=0 POLLER_DETECT_TRIES_LEAVING=4 POLLER_ENGINE_MAX="${POLLER_ENGINE_MAX:-3}" POLLER_ENGINE_STEP=1 \
  POLLER_DOCKER_TIMEOUT="${POLLER_DOCKER_TIMEOUT:-5}" POLLER_ENGINE_START="${ENGINE_START_STUB:-$PW/bin/engine_start}" \
  ENV_SYNC_PULL_RECORD="$PW/pull_record" ENV_SYNC_TURN_FILE="$PW/turn.txt" ENV_SYNC_RELAY_ROOT="$PW/relay" \
  ENV_SYNC_PENDING_ROOT="$PW/pending" PATH="$PW/pathbin:$PATH" \
  bash "$SRC/poller_run.sh" > "$PW/out.txt" 2>&1
}
hb() { sed -n 's/^result: *//p' "$PW/hb.txt"; }
calls() { grep -c "$1" "$PW/calls.log" 2>/dev/null || true; }
preset() { rm -f "$PW/calls.log" "$PW/units_out" "$PW/es_out" "$PW/es_rc" "$PW/b2_record" "$PW/b2_held" "$PW/engine_up" "$PW/hb.txt" "$PW/leave_ok" "$PW/units_fail" "$PW/docker_hang" "$PW"/ck_out_*; : > "$PW/calls.log"; }
# units <sessions of main dev's checkout> [<extra unit lines>]: what `env_sync.sh units` answers. KEY changes the tree key.
units() { { echo "ssh=ok"; echo "unit|main|$MR|feature/x|aaaa|${KEY:-k1}|0|$1"; [ -n "${2:-}" ] && printf '%s\n' "$2"; echo "dev2_containers=${DEV2UP:-0}"; } > "$PW/units_out"; }
OKX='CHECKPOINT CODE u-main-feature-x: /x/checkpoints/u-main-feature-x/20261118_190000'
echo "free 2026-11-18 14:05:00" > "$PW/turn.txt"; : > "$PW/ops.md"
echo "# desktop fingerprint after the laptop's db-push (2026-11-18 13:57:40, backup x)" > "$PW/pull_record"

preset; units ""; prun
check "IDLE: nothing running -> detected 0, heartbeat IDLE, nothing copied (the desktop is asked once, read-only)" '
  [[ "$(hb)" == "IDLE (detected 0"* ]] && [ "$(calls "^env_sync units")" = 1 ] && [ "$(calls "checkpoint")" = 0 ] && grep -q "^detected:  *0 unit" "$PW/hb.txt"'
check "the heartbeat names the run time, detected units, reachability, the location, the last good B1, the HELD and the RESTORED database copy separately, and the off switch" '
  grep -q "^run:  *20[0-9-]* [0-9:]*$" "$PW/hb.txt" && grep -q "^desktop reachable: y" "$PW/hb.txt" && grep -q "^location:  *away" "$PW/hb.txt" &&
  grep -q "^last good B1: " "$PW/hb.txt" && grep -q "^last held db copy:  *none" "$PW/hb.txt" && grep -q "^last restored db copy:  *2026-11-18 13:57:40" "$PW/hb.txt" && grep -q "Copier - Pause / Resume / Status" "$PW/hb.txt"'

preset; prun
check "OFFLINE: the desktop does not answer -> heartbeat OFFLINE, nothing copied, no failure" '[[ "$(hb)" == OFFLINE* ]] && [ "$(calls "checkpoint")" = 0 ] && [ -f "$PW/state/offline" ] && grep -q "^desktop reachable: n" "$PW/hb.txt" && [ ! -s "$PW/ops.md" ]'
n1=$(grep -c OFFLINE "$PW/poller.log"); preset; prun
check "OFFLINE is logged once, not at every run" '[ "$(grep -c OFFLINE "$PW/poller.log")" = "$n1" ] && [[ "$(hb)" == OFFLINE* ]]'
check "OFFLINE is declared only after 3 tries inside the run, never after one failed call" '[ "$(calls "^env_sync units")" = 3 ]'
rm -f "$PW/state/offline"
preset; units "s1:11111111:working:HEARTBEAT"; echo 2 > "$PW/units_fail"; echo "$OKX" > "$PW/es_out"; prun
check "RETRY: two failed first calls (a clash, a blip) and the third answers -> the run carries on and copies; no OFFLINE is written" '
  [ "$(calls "^env_sync units")" = 3 ] && [ "$(hb)" = "u-main-feature-x: B1 OK" ] && [ ! -f "$PW/state/offline" ]'
: > "$PW/ops.md"
preset; echo "LEAVING w" > "$PW/leaving.flag"; prun
check "LEAVING while the desktop does not answer: MORE tries, then it says LEAVING NOT DONE, keeps the flag up and tells the relay ONCE" '
  [ "$(calls "^env_sync units")" = 4 ] && [[ "$(hb)" == "OFFLINE - LEAVING NOT DONE"* ]] && [ -f "$PW/leaving.flag" ] && [ "$(grep -c "id LEAVING-WAITING" "$PW/ops.md")" = 1 ]'
preset; prun
check "and it is not told to the relay a second time; the flag is still up for the next run" '[ "$(grep -c "id LEAVING-WAITING" "$PW/ops.md")" = 1 ] && [ -f "$PW/leaving.flag" ]'
rm -f "$PW/leaving.flag" "$PW/state/leaving_offline_told"; : > "$PW/ops.md"      # state/offline stays: the next run is the reconnect

preset; units "s1:11111111:working:HEARTBEAT"; echo "$OKX" > "$PW/es_out"; prun
check "RECONNECT: the desktop answers again -> the working unit is copied at once (not gated), CAUGHT-UP in the heartbeat and ONE relay entry" '
  [[ "$(hb)" == "CAUGHT-UP (the desktop answers again"* ]] && grep -q "^env_sync checkpoint-code --slice u-main-feature-x --checkout $MR --env main --name s1$" "$PW/calls.log" && [ ! -f "$PW/state/offline" ] && [ "$(grep -c "id CAUGHTUP" "$PW/ops.md")" = 1 ]'

preset; units "s1:11111111:working:HEARTBEAT"; echo "$OKX" > "$PW/es_out"; prun
check "DETECTION + B1 OK: a working session is found with NO follow step; its checkout is copied (--if-older) and the heartbeat has a unit line" '
  [ "$(hb)" = "u-main-feature-x: B1 OK" ] && grep -q "^env_sync checkpoint-code --slice u-main-feature-x --checkout $MR --env main --name s1 --if-older 13$" "$PW/calls.log" &&
  grep -q "^detected:  *1 unit" "$PW/hb.txt" && grep -q "^unit:  *u-main-feature-x | main | feature/x | sessions: s1(working) | last code copy: 20[0-9-]* [0-9:]* 20261118_190000 | this run: B1 OK" "$PW/hb.txt" && [ ! -f "$PW/state/active.txt" ]'
preset; units "s1:11111111:working:HEARTBEAT"; echo "checkpoint not due: the newest (x) is 3 min old (< 13)" > "$PW/es_out"; prun
check "B1 SKIP: not due -> said so, the last good copy kept, no database copy without a DBCOPY-POINT" '[ "$(hb)" = "u-main-feature-x: B1 SKIP not due" ] && grep -q "20261118_190000" "$PW/hb.txt" && [ "$(calls "catch-up")" = 0 ] && [ "$(calls "^docker")" = 0 ]'

preset; units "s1:11111111:working:HEARTBEAT,misc:22222222:working:HEARTBEAT"; echo "$OKX" > "$PW/es_out"; prun
check "TWO SESSIONS IN ONE CHECKOUT share ONE code copy; both are named in the unit line" '
  [ "$(calls "^env_sync checkpoint-code")" = 1 ] && grep -q "sessions: s1(working), misc(working)" "$PW/hb.txt" && grep -q "^detected:  *1 unit" "$PW/hb.txt"'

W2="unit|main|C:/Users/USER/Documents/wt_b|scratch/b|bbbb|kb1|1|d4b:33333333:working:HEARTBEAT"
preset; units "s1:11111111:working:HEARTBEAT" "$W2"; echo "$OKX" > "$PW/es_out"; echo "CHECKPOINT CODE u-main-scratch-b: /x/checkpoints/u-main-scratch-b/20261118_190100" > "$PW/ck_out_u-main-scratch-b"; prun
check "A SECOND BRANCH (its own worktree) is its own unit: two copies, two unit lines, detected 2" '
  grep -q "^env_sync checkpoint-code --slice u-main-scratch-b --checkout C:/Users/USER/Documents/wt_b --env main --name d4b --if-older 13$" "$PW/calls.log" && [ "$(calls "^env_sync checkpoint-code")" = 2 ] &&
  grep -q "^detected:  *2 unit" "$PW/hb.txt" && [ "$(grep -c "^unit: " "$PW/hb.txt")" = 2 ] && [[ "$(hb)" == "u-main-feature-x: B1 OK; u-main-scratch-b: B1 OK" ]]'

: > "$PW/ops.md"
preset; units "s1:11111111:working:HEARTBEAT" "$W2"; echo "$OKX" > "$PW/es_out"; POLLER_FAIL_UNIT=u-main-scratch-b prun
check "FAILURE ON ONE UNIT: it is FAILED in the heartbeat and ONE relay entry; the OTHER unit is still copied; exit 0" '
  [[ "$(hb)" == "u-main-feature-x: B1 OK; u-main-scratch-b: FAILED B1 (rc 3)"* ]] && [ "$(grep -c "id CKPFAIL-u-main-scratch-b" "$PW/ops.md")" = 1 ] && grep -q "No session is stopped or blocked" "$PW/ops.md"'
preset; units "s1:11111111:working:HEARTBEAT" "$W2"; echo "$OKX" > "$PW/es_out"; POLLER_FAIL_UNIT=u-main-scratch-b prun
check "the same unit failing again is NOT reported to the relay a second time (logged once)" '[ "$(grep -c "id CKPFAIL-u-main-scratch-b" "$PW/ops.md")" = 1 ] && [[ "$(hb)" == *"FAILED B1"* ]]'

preset; KEY=k2 units ""; echo "$OKX" > "$PW/es_out"; prun
check "LAST STATE: nobody works there any more but the tree moved since the last copy -> one more copy, not gated" '
  [[ "$(hb)" == "u-main-feature-x: B1 OK (last state; no session working)"* ]] && grep -q "^env_sync checkpoint-code --slice u-main-feature-x --checkout $MR --env main$" "$PW/calls.log" && grep -q "^detected:  *0 unit" "$PW/hb.txt"'
preset; KEY=k2 units ""; prun
check "and then nothing more is copied while it stays as it is" '[[ "$(hb)" == "IDLE (detected 0"* ]] && [ "$(calls "checkpoint")" = 0 ]'

P1="point|main|s1|DBCOPY-POINT 2026-11-18 15:30:00 a paid run"
preset; KEY=k2 units "s1:11111111:working:HEARTBEAT" "$P1"; echo "checkpoint not due: x" > "$PW/es_out"; echo "2026-11-18 15:31:10" > "$PW/b2_held"; prun
check "AWAY + a DBCOPY-POINT newer than the last copy -> the database FILE is copied and HELD (catch-up --yes --hold); Docker is never started" '
  [[ "$(hb)" == *"+ B2 HELD (database file copied, not loaded"* ]] && grep -q "^env_sync catch-up --slice u-main-feature-x --name s1 --checkout $MR --env main --yes --hold$" "$PW/calls.log" &&
  [ "$(calls "^docker")" = 0 ] && [ "$(calls engine_start)" = 0 ] && ! grep -q "dev2" "$PW/calls.log" && grep -q "^free" "$PW/turn.txt"'
check "the heartbeat says held (not loaded) plainly, and keeps the RESTORED copy apart from it" '
  grep -q "^last held db copy:  *2026-11-18 15:31:10 (20261118_153110; held, NOT loaded" "$PW/hb.txt" && grep -q "^last restored db copy:  *2026-11-18 13:57:40" "$PW/hb.txt"'
preset; KEY=k2 units "s1:11111111:working:HEARTBEAT" "$P1"; echo "checkpoint not due: x" > "$PW/es_out"; prun
check "B2 is not repeated once a HELD copy is newer than the DBCOPY-POINT" '[ "$(hb)" = "u-main-feature-x: B1 SKIP not due" ] && [ "$(calls "catch-up")" = 0 ]'

P2="point|main|s1|DBCOPY-POINT 2026-11-18 16:40:00 another paid run"
preset; KEY=k2 units "s1:11111111:working:HEARTBEAT" "$P2"; echo "checkpoint not due: x" > "$PW/es_out"; echo 2 > "$PW/es_rc"; prun
check "B2 FAILURE: a failed copy is one heartbeat + log line; nothing was started that would need putting back" '
  [[ "$(hb)" == *"+ FAILED B2 (rc 2)"* ]] && [ "$(grep -c "FAILED B2" "$PW/poller.log")" = 1 ] && [ "$(calls "^docker")" = 0 ] && grep -q "another paid run" "$PW/state/b2_failed.txt"'
preset; KEY=k2 units "s1:11111111:working:HEARTBEAT" "$P2"; echo "checkpoint not due: x" > "$PW/es_out"; prun
check "NO TIGHT RETRY: the next run does not try the same failed copy again (B2 PENDING), and starts nothing" '
  [[ "$(hb)" == *"B2 PENDING (the copy failed"* ]] && [ "$(calls "catch-up")" = 0 ] && [ "$(calls "^docker")" = 0 ] && [ "$(calls engine_start)" = 0 ]'
rm -f "$PW/state/b2_failed.txt"
preset; KEY=k2 units "s1:11111111:working:HEARTBEAT" "$P2"; echo "checkpoint not due: x" > "$PW/es_out"; echo "2026-11-18 16:41:00" > "$PW/b2_held"; POLLER_FREE_MB=1500 prun
check "LOW MEMORY is no obstacle any more: the file copy needs no Docker, so it is made and held with 1,500 MB free" '
  [[ "$(hb)" == *"+ B2 HELD"* ]] && [ "$(calls "catch-up")" = 1 ] && [ "$(calls "^docker")" = 0 ] && [ ! -f "$PW/state/b2_failed.txt" ]'
P3="point|main|s1|DBCOPY-POINT 2026-11-18 17:00:00 a third paid run"
preset; KEY=k2 units "s1:11111111:working:HEARTBEAT" "$P3"; echo "$OKX" > "$PW/es_out"; POLLER_LOCATION=office prun
check "OFFICE: code only - B1 is taken, the due database copy is NOT made, and it is not a failure" '
  [[ "$(hb)" == "u-main-feature-x: B1 OK + B2 not in office"* ]] && [ "$(calls "catch-up")" = 0 ] && [ "$(calls "^docker")" = 0 ] && [ ! -f "$PW/state/b2_failed.txt" ] && grep -q "^location:  *office" "$PW/hb.txt"'
preset; KEY=k2 units "s1:11111111:working:HEARTBEAT" "$P3"; echo "checkpoint not due: x" > "$PW/es_out"; echo "2026-11-18 17:05:00" > "$PW/b2_held"; POLLER_LOCATION=away prun
check "AWAY: the copy that was held back in the office is made at the first run away (code + the database file, held)" '
  [[ "$(hb)" == *"+ B2 HELD"* ]] && [ "$(calls "catch-up")" = 1 ] && grep -q "^location:  *away" "$PW/hb.txt" && grep -q "^last held db copy:  *2026-11-18 17:05:00" "$PW/hb.txt"'
loc() { echo "$1" > "$PW/ts_out"; preset; KEY=k2 units ""; POLLER_LOCATION="" POLLER_TAILSCALE="$PW/bin/tailscale" prun; sed -n 's/^location: *\([a-z]*\) .*/\1/p' "$PW/hb.txt"; }
check "LOCATION: a direct private-LAN path to the desktop is the office; the relay, a public address or no answer is away (also when idle)" '
  [ "$(loc "pong from nitesh-desktop (100.84.255.77) via 192.168.0.22:41641 in 9ms")" = office ] && [ "$(loc "pong from nitesh-desktop (100.84.255.77) via 10.0.0.7:41641 in 3ms")" = office ] &&
  [ "$(loc "pong from nitesh-desktop (100.84.255.77) via DERP(sin) in 120ms")" = away ] && [ "$(loc "pong from nitesh-desktop (100.84.255.77) via 122.171.18.123:16983 in 40ms")" = away ] && [ "$(loc "no reply")" = away ]'

# dev2: code only; its containers are never started; a database copy needs the owner's word
D2="unit|dev2|C:/Users/USER/Documents/frappe_docker_dev2/development/frappe-bench/apps/nirmaan_stack|feature/h|cccc|kd1|2|h1:44444444:working:HEARTBEAT"
: > "$PW/ops.md"
preset; KEY=k2 units "" "$D2"; echo "CHECKPOINT CODE u-dev2-feature-h: /x/checkpoints/u-dev2-feature-h/20261118_191000" > "$PW/es_out"; prun
check "DEV2 stopped (no dev2 container runs): its CODE is copied like any unit, no question, no container touched" '
  grep -q "^env_sync checkpoint-code --slice u-dev2-feature-h --checkout C:/Users/USER/Documents/frappe_docker_dev2/development/frappe-bench/apps/nirmaan_stack --env dev2 --name h1 --if-older 13$" "$PW/calls.log" &&
  [ "$(calls "^docker")" = 0 ] && [ ! -s "$PW/ops.md" ] && [[ "$(hb)" != *"owner"* ]]'
preset; DEV2UP=4 KEY=k2 units "" "$D2
point|dev2|h1|DBCOPY-POINT 2026-11-18 19:20:00 a dev2 load"; echo "checkpoint not due: x" > "$PW/es_out"; prun
check "DEV2 running with work: ONE question for the owner, no dev2 database copy, no container started on either machine" '
  [[ "$(hb)" == *"dev2: code copied, its database copy needs the owner"* ]] && [ "$(grep -c "id DEV2-QUESTION" "$PW/ops.md")" = 1 ] && [ "$(calls "catch-up")" = 0 ] && [ "$(calls "^docker")" = 0 ] && [ "$(calls engine_start)" = 0 ]'
preset; DEV2UP=4 KEY=k2 units "" "$D2"; echo "checkpoint not due: x" > "$PW/es_out"; prun
check "the dev2 question is asked once, not at every run" '[ "$(grep -c "id DEV2-QUESTION" "$PW/ops.md")" = 1 ]'

# "leaving": the shared flag
: > "$PW/ops.md"
preset; KEY=k2 units "s1:11111111:working:HEARTBEAT,other:55555555:working:" "$W2"; echo "CHECKPOINT CODE u-main-scratch-b: /x/checkpoints/u-main-scratch-b/20261118_192000" > "$PW/es_out"; touch "$PW/leave_ok"
echo "LEAVING 2026-11-18 19:19:00 raised by a test" > "$PW/leaving.flag"; POLLER_LOCATION=office prun
check "LEAVING: a session with a status file is asked to pause (CHECKPOINT); one WITHOUT is not asked - it is copied as it stands" '
  [ "$(grep -c "^env_sync tell --name s1 --text CHECKPOINT 20" "$PW/calls.log")" = 1 ] && [ "$(calls "tell --name other")" = 0 ]'
check "LEAVING: the CODE of main dev is copied FIRST, before the database checkpoint (it never depends on the database copy)" '
  a=$(grep -n "^env_sync checkpoint-code --slice u-main-feature-x --checkout $MR --env main --name s1$" "$PW/calls.log" | head -1 | cut -d: -f1) && b=$(grep -n "^env_sync checkpoint --slice" "$PW/calls.log" | head -1 | cut -d: -f1) && [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]'
check "LEAVING: main dev gets ONE checkpoint whose database copy is HELD (--hold), office or away; Docker is NEVER started" '
  [ "$(grep -c "^env_sync checkpoint --slice u-main-feature-x --hold --name s1 --also-tell d4b$" "$PW/calls.log")" = 1 ] && [ "$(calls "tell --name d4b --text CHECKPOINT TAKEN")" = 0 ] && [ "$(calls "^docker")" = 0 ] && [ "$(calls engine_start)" = 0 ] && [[ "$(hb)" == "LEAVING READY: main dev code + database copy held (not loaded)"* ]]'
check "LEAVING: every other unit is copied as it stands; READY per unit in ONE relay entry; the flag is cleared; the heartbeat says so" '
  grep -q "^env_sync checkpoint-code --slice u-main-scratch-b --checkout C:/Users/USER/Documents/wt_b --env main --name d4b$" "$PW/calls.log" && [ "$(grep -c "id LEAVING" "$PW/ops.md")" = 1 ] &&
  grep -q "u-main-feature-x (main dev.s checkout; paused at a safe point: s1 d4b; every other session there copied as it stands): READY" "$PW/ops.md" && grep -q "u-main-scratch-b (main, scratch/b; d4b(working)): READY - code copied as it stands" "$PW/ops.md" &&
  grep -q "READY - code + the database file HELD on the laptop (not loaded; it is loaded only if you take over)" "$PW/ops.md" && grep -q "^CHECKPOINT READY (code + database copy held, not loaded) 20" "$PW/ops.md" &&
  [ ! -f "$PW/leaving.flag" ] && [ -f "$PW/leaving.last" ] && grep -q "^leaving:  *READY (code + database copy held, not loaded) at " "$PW/hb.txt"'
preset; KEY=k2 units "s1:11111111:working:HEARTBEAT,misc:22222222:working:HEARTBEAT"; touch "$PW/leave_ok"; echo "LEAVING x" > "$PW/leaving.flag"; POLLER_LEAVING_SKIP="misc" prun
check "LEAVING rehearsal switch: a named session is left alone (never told to pause), the others are" '[ "$(calls "tell --name misc")" = 0 ] && [ "$(grep -c "^env_sync tell --name s1 --text CHECKPOINT 20" "$PW/calls.log")" = 1 ]'
preset; KEY=k2 units "s1:11111111:working:HEARTBEAT,misc:22222222:working:HEARTBEAT,new1:77777777:working:HEARTBEAT"; touch "$PW/leave_ok"; echo "LEAVING x2" > "$PW/leaving.flag"; POLLER_LEAVING_ONLY="s1" prun
check "LEAVING rehearsal ALLOW-list: only the named sessions are ever told to pause - a session nobody listed is never reached" '
  [ "$(calls "tell --name misc")" = 0 ] && [ "$(calls "tell --name new1")" = 0 ] && [ "$(grep -c "^env_sync tell --name s1 --text CHECKPOINT 20" "$PW/calls.log")" = 1 ] && ! grep -q "also-tell" "$PW/calls.log"'
: > "$PW/ops.md"
preset; KEY=k2 units "s1:11111111:working:HEARTBEAT"; echo "LEAVING y" > "$PW/leaving.flag"; prun
check "LEAVING FAILURE: the paused session is released at once (CHECKPOINT FAILED ... carry on), FAILED in the relay entry, the flag still cleared" '
  [[ "$(hb)" == "LEAVING FAILED for main dev"* ]] && grep -q "^env_sync tell --name s1 --text CHECKPOINT FAILED 20.* | carry on$" "$PW/calls.log" && grep -q "FAILED" "$PW/ops.md" && [ ! -f "$PW/leaving.flag" ]'
preset; KEY=k9 units ""; echo "LEAVING z" > "$PW/leaving.flag"; echo "CHECKPOINT CODE u-main-feature-x: /x/checkpoints/u-main-feature-x/20261118_193000" > "$PW/es_out"; touch "$PW/leave_ok"; prun
check "LEAVING with nothing running still answers and clears the flag" '[ ! -f "$PW/leaving.flag" ] && grep -q "^leaving:  *READY" "$PW/hb.txt"'
# the database copy cannot be made -> READY (CODE ONLY), by itself, every paused session released (the real leaving of 2026-11-18)
: > "$PW/ops.md"
preset; KEY=k10 units "s1:11111111:working:HEARTBEAT,misc:22222222:working:HEARTBEAT"; echo "$OKX" > "$PW/es_out"; echo "LEAVING c1" > "$PW/leaving.flag"; prun
check "LEAVING, the database file copy fails after the code copy worked: it still ends by itself, READY (CODE ONLY)" '
  [[ "$(hb)" == "LEAVING READY (CODE ONLY - database copy NOT taken: the database copy failed"* ]] && [ "$(calls "^env_sync checkpoint --slice")" = 1 ] && [ ! -f "$PW/leaving.flag" ] && grep -q "^leaving:  *READY (CODE ONLY" "$PW/hb.txt" && [ ! -d "$PW/state/lock" ]'
check "and EVERY paused session is told to carry on, with the plain reason; the relay entry says CODE ONLY and names the last held and loaded copies" '
  [ "$(grep -c "^env_sync tell --name s1 --text CHECKPOINT TAKEN 20.* | CODE ONLY (the database copy was NOT taken: the database copy failed.*) | carry on$" "$PW/calls.log")" = 1 ] &&
  [ "$(grep -c "^env_sync tell --name misc --text CHECKPOINT TAKEN 20.* CODE ONLY" "$PW/calls.log")" = 1 ] && grep -q "READY (CODE ONLY) - the database copy was NOT taken" "$PW/ops.md" && grep -q "last database copies: held 2026-11-18 17:05:00, loaded 2026-11-18 13:57:40" "$PW/ops.md"'
preset; KEY=k11 units "s1:11111111:working:HEARTBEAT"; echo "$OKX" > "$PW/es_out"; echo "LEAVING c2" > "$PW/leaving.flag"; touch "$PW/leave_ok"; POLLER_FREE_MB=900 prun
check "LEAVING with the laptop short of memory: the database file is still copied and held (no Docker is needed for it)" '
  [[ "$(hb)" == "LEAVING READY: main dev code + database copy held (not loaded)"* ]] && [ "$(calls "^docker")" = 0 ] && [ "$(calls engine_start)" = 0 ]'
check "THE COPIER NEVER STARTS DOCKER: in every case of this section no docker command and no Docker Desktop start was ever run" '
  [ ! -s "$PW/docker_ever.log" ] && ! grep -q "engine_start\|docker desktop\|wsl" "$PW/poller.log" && ! grep -n "docker\b.*\(info\|desktop\|start\|stop\)" "$SRC/poller_run.sh" | grep -v "^[0-9]*:#" | grep -q .'

# `poller follow` is optional now: it only names main dev's unit after a slice while that session works
echo "T-1 s1 since 2026-11-18 15:00:00" > "$PW/state/active.txt"
preset; KEY=k9 units "s1:11111111:working:HEARTBEAT"; echo "CHECKPOINT CODE T-1: /x/checkpoints/T-1/20261118_194000" > "$PW/es_out"; prun
check "OPTIONAL FOLLOW: main dev's unit carries the slice's name while that session works" 'grep -q "^env_sync checkpoint-code --slice T-1 --checkout $MR --env main --name s1 --if-older 13$" "$PW/calls.log" && [[ "$(hb)" == "T-1: B1 OK" ]]'
preset; KEY=k9 units "zz:66666666:working:HEARTBEAT"; echo "$OKX" > "$PW/es_out"; prun
check "and the name is dropped by itself when that session no longer works; detection carries on with the session that does" '[ ! -f "$PW/state/active.txt" ] && grep -q "^env_sync checkpoint-code --slice u-main-feature-x --checkout $MR --env main --name zz" "$PW/calls.log"'

preset; KEY=k9 units "s1:11111111:working:HEARTBEAT"
cat > "$PW/bin/env_sync_peek" <<'EOF'
#!/usr/bin/env bash
case "$1" in units) cat "$PW_DIR/units_out";; *) cp "$POLLER_HEARTBEAT" "$PW_DIR/hb_during.txt"; echo "checkpoint not due: x";; esac
EOF
chmod +x "$PW/bin/env_sync_peek"
PW_DIR="$PW" PW_LOG="$PW/calls.log" POLLER_STATE="$PW/state" POLLER_HEARTBEAT="$PW/hb.txt" POLLER_LOG="$PW/poller.log" \
  POLLER_ENV_SYNC="$PW/bin/env_sync_peek" POLLER_DOCKER="$PW/bin/docker" ENV_SYNC_PULL_RECORD="$PW/pull_record" ENV_SYNC_TURN_FILE="$PW/turn.txt" \
  ENV_SYNC_RELAY_ROOT="$PW/relay" POLLER_OPS_RELAY="$PW/ops.md" ENV_SYNC_LEAVING_FLAG="$PW/leaving.flag" POLLER_FREE_MB=8000 POLLER_LOCATION=away bash "$SRC/poller_run.sh" > /dev/null 2>&1
check "EVERY run writes the heartbeat FIRST: while a step runs it says RUNNING since <start>, then the result replaces it" '
  grep -q "^result:  *RUNNING since 20[0-9-]* [0-9:]* " "$PW/hb_during.txt" && [ "$(hb)" = "u-main-feature-x: B1 SKIP not due" ]'

preset; date '+%F %T' > "$PW/state/paused"; prun
check "PAUSE: the off switch -> heartbeat PAUSED, nothing asked, nothing copied" '[[ "$(hb)" == PAUSED* ]] && [ "$(calls .)" = 0 ]'
rm -f "$PW/state/paused"
preset; mkdir "$PW/state/lock"; prun
check "ONE AT A TIME: a second run while one holds the lock does nothing" '[ ! -f "$PW/hb.txt" ] && grep -q "SKIP another run holds the lock" "$PW/poller.log" && [ -d "$PW/state/lock" ]'
rmdir "$PW/state/lock"
preset; KEY=k9 units ""; prun
check "the lock is released after every run" '[ ! -d "$PW/state/lock" ]'

X=$(powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$SRC/laptop/poller_task.ps1")" -PrintOnly 2>/dev/null | tr -d '\r')
if [ -n "$X" ]; then
  check "the task: every 15 minutes, at log-on, on network connect, on resume from sleep" '
    grep -q "<Interval>PT15M</Interval>" <<< "$X" && grep -q "<LogonTrigger>" <<< "$X" && grep -q "NetworkProfile/Operational" <<< "$X" && grep -q "EventID=10000" <<< "$X" && grep -q "Power-Troubleshooter" <<< "$X"'
  check "the task: the logged-on user only (no stored password), least privilege, one instance, hidden start through wscript" '
    grep -q "<LogonType>InteractiveToken</LogonType>" <<< "$X" && grep -q "<RunLevel>LeastPrivilege</RunLevel>" <<< "$X" && grep -q "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>" <<< "$X" &&
    grep -q "<Command>wscript.exe</Command>" <<< "$X" && grep -q "poller_hidden.vbs" <<< "$X" && ! grep -qi "password" <<< "$X"'
else
  echo "skip the task XML checks (no powershell.exe here)"
fi
check "poller_hidden.vbs runs poller_run.sh hidden (window style 0) and waits for it" 'grep -q "poller_run.sh" "$SRC/laptop/poller_hidden.vbs" && grep -q ", 0, True)" "$SRC/laptop/poller_hidden.vbs"'
H=$(bash "$SRC/env_sync.sh" 2>/dev/null)
check "the help names the poller commands, the off switch, units, leaving and the multi-unit takeover; follow is OPTIONAL" '
  grep -q "poller install" <<< "$H" && grep -q "poller pause | resume" <<< "$H" && grep -q "poller remove" <<< "$H" && grep -q "OPTIONAL since CKP-4" <<< "$H" &&
  grep -q "env_sync.sh units" <<< "$H" && grep -q "env_sync.sh leaving" <<< "$H" && grep -q "resume-on-laptop --units" <<< "$H"'
check "P6: db-push's run record and the copied loose report files go to BoQ main lane/_run_records, never the Desktop root" '
  grep -q "RUN_RECORDS=\"\${ENV_SYNC_RUN_RECORDS:-\$L_REPORTS/BoQ main lane/_run_records}\"" "$SRC/env_sync.sh" && grep -q "run=\"\$RUN_RECORDS/" "$SRC/env_sync.sh" && ! grep -q "run=\"\$L_REPORTS/" "$SRC/env_sync.sh" && grep -q "lp=\"\$RUN_RECORDS/\$name\"" "$SRC/env_sync.sh"'
FS="$W/follow"; mkdir -p "$FS"
( POLLER_STATE="$FS" bash "$SRC/env_sync.sh" poller follow --slice T-9 --name t9 ) > /dev/null 2>&1
check "poller follow / unfollow / pause / resume still work as switches" '
  grep -q "^T-9 t9 since " "$FS/active.txt" && ( POLLER_STATE="$FS" bash "$SRC/env_sync.sh" poller pause > /dev/null 2>&1 ) && [ -f "$FS/paused" ] &&
  ( POLLER_STATE="$FS" bash "$SRC/env_sync.sh" poller resume > /dev/null 2>&1 ) && [ ! -f "$FS/paused" ] &&
  ( POLLER_STATE="$FS" bash "$SRC/env_sync.sh" poller unfollow > /dev/null 2>&1 ) && [ ! -f "$FS/active.txt" ]'
check "catch-up reads the last copy's moment from a db-pull record AND a db-push record" '
  a=$(echo "# desktop fingerprint at the laptop'"'"'s last db-pull (2026-11-17 20:20:56, backup b)" | sed -n "$(grep -o "1s/\.\*(.*p" "$SRC/env_sync.sh" | head -1)") &&
  b=$(echo "# desktop fingerprint after the laptop'"'"'s db-push (2026-11-18 13:57:40, backup b)" | sed -n "$(grep -o "1s/\.\*(.*p" "$SRC/env_sync.sh" | head -1)") &&
  [ "$a" = "2026-11-17 20:20:56" ] && [ "$b" = "2026-11-18 13:57:40" ]'
check "the owner's Desktop shortcuts: Pause / Resume / Status / Leaving, hidden start, the scripts stay in the repo" '
  grep -q "Copier - Pause" "$SRC/laptop/copier_shortcuts.ps1" && grep -q "Copier - Resume" "$SRC/laptop/copier_shortcuts.ps1" && grep -q "Copier - Status" "$SRC/laptop/copier_shortcuts.ps1" && grep -q "Leaving" "$SRC/laptop/copier_shortcuts.ps1" &&
  grep -q "wscript.exe" "$SRC/laptop/copier_shortcuts.ps1" && grep -q "poller pause" "$SRC/laptop/copier_shortcut.vbs" && grep -q "poller resume" "$SRC/laptop/copier_shortcut.vbs" && grep -q " leaving" "$SRC/laptop/copier_shortcut.vbs" &&
  grep -q "The checkpoint copier is PAUSED" "$SRC/laptop/copier_shortcut.vbs" && grep -q "Checkpoint started - wait for READY in the chat" "$SRC/laptop/copier_shortcut.vbs" && grep -q "poller shortcuts" <<< "$H" &&
  [ "$(grep -c "$(printf "\r")" "$SRC/env_sync.sh")" = 0 ]'
LF="$W/lflag"; mkdir -p "$LF"
check "env_sync.sh leaving raises the shared flag once (a second call leaves the first in place)" '
  ( ENV_SYNC_RUN_RECORDS="$LF" bash "$SRC/env_sync.sh" leaving > /dev/null 2>&1 ) && grep -q "^LEAVING 20" "$LF/ckp_leaving.flag" && a=$(cat "$LF/ckp_leaving.flag") &&
  ( ENV_SYNC_RUN_RECORDS="$LF" bash "$SRC/env_sync.sh" leaving 2>&1 | grep -q "already up" ) && [ "$a" = "$(cat "$LF/ckp_leaving.flag")" ]'
check "detect_units.ps1 is read-only: it starts, stops and writes nothing" '
  ! grep -qiE "Stop-Process|Start-Process|Remove-Item|Set-Content|Add-Content|Out-File|docker (start|stop|exec|run)|git (checkout|commit|stash|reset|clean|add)" "$SRC/desktop/detect_units.ps1" && grep -q "git -C" "$SRC/desktop/detect_units.ps1"'
# a unit that is NOT main dev's own checkout: a throw-away checkout on another branch, snapshotted and rebuilt on a clone
UR="$W/unit_repo"; git init -q -b main "$UR" && ( cd "$UR" && git config user.email t@t && git config user.name t && echo a > a.txt && git add a.txt && git commit -qm base &&
  git checkout -q -b scratch/b && echo b > b.txt && git add b.txt && git commit -qm "local only" && echo c >> a.txt && echo n > new.txt )
BASE_U=$(git -C "$UR" rev-parse main); UO="$W/unit_ck"
bash "$SRC/remote/ckpt_code.sh" "$UR" "$UO" "$BASE_U" > "$W/unit_ck.out" 2>&1
UC="$W/unit_clone"; git clone -q "$UR" "$UC" 2>/dev/null; git -C "$UC" checkout -q -B main "$BASE_U"; git -C "$UC" branch -D scratch/b > /dev/null 2>&1
git -C "$UC" fetch -q "$UO/commits.bundle" "+refs/heads/*:refs/ckpt-incoming/*" 2>/dev/null; git -C "$UC" checkout -q -B scratch/b "$BASE_U"
check "ANY BRANCH: a local-only branch's snapshot carries its commits in a bundle and rebuilds on a clone that never had it (tree equal)" '
  grep -q "^bundle=commits.bundle" "$UO/head.txt" && grep -q "^branch=scratch/b" "$UO/head.txt" && bash "$SRC/remote/ckpt_apply.sh" apply "$UC" "$UO" 2>&1 | grep -q "^applied: tree equals" &&
  [ "$(git -C "$UR" status --porcelain | wc -l)" = 2 ] && [ "$(git -C "$UR" rev-parse --abbrev-ref HEAD)" = scratch/b ]'

echo "== 8. CKP-5: a database copy that is HELD (no Docker), the restore later, the wake delay, the hung-start recovery"
# env_sync.sh's own functions with docker, wsl, the force-close, scp and ssh replaced by stubs. Nothing real is started,
# stopped, copied or restored: the real Docker Desktop and the real WSL are never touched by a test.
E8="$W/e8"; mkdir -p "$E8/bin" "$E8/desk"
cat > "$E8/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$E8_LOG"
case "$1 ${2:-}" in
  "info "*) [ -f "$E8_DIR/engine_up" ];;
  "inspect "*) echo true;;
  "desktop start") n=$(cat "$E8_DIR/start_ok_at" 2>/dev/null || echo 0); c=$(( $(cat "$E8_DIR/start_n" 2>/dev/null || echo 0) + 1 )); echo "$c" > "$E8_DIR/start_n"
                   [ "$n" -gt 0 ] && [ "$c" -ge "$n" ] && touch "$E8_DIR/engine_up"; exit 0;;
  "desktop stop") [ -f "$E8_DIR/stop_hang" ] && sleep 6; rm -f "$E8_DIR/engine_up"; exit 0;;
esac
EOF
cat > "$E8/bin/wsl" <<'EOF'
#!/usr/bin/env bash
echo "wsl $*" >> "$E8_LOG"
case "$*" in "-l -v") printf '  NAME                   STATE           VERSION\n* docker-desktop-data    Stopped         2\n  docker-desktop         %s         2\n' "$( [ -f "$E8_DIR/wsl_running" ] && echo Running || echo Stopped )";;
  "--shutdown") rm -f "$E8_DIR/wsl_running";; esac
EOF
printf '#!/usr/bin/env bash\necho "force_close" >> "$E8_LOG"\n' > "$E8/bin/kill_docker"
# scp: the "desktop" is a folder; a file named in corrupt.txt arrives with one byte changed
cat > "$E8/bin/scp" <<'EOF'
#!/usr/bin/env bash
echo "scp $*" >> "$E8_LOG"
dst="${@: -1}"; src="${@: -2:1}"; name=$(basename "$src")
[ -f "$E8_DIR/desk/$name" ] || exit 1
cp "$E8_DIR/desk/$name" "$dst"
if grep -qx "$name" "$E8_DIR/corrupt.txt" 2>/dev/null; then printf 'X' >> "$dst"; fi
EOF
printf '#!/usr/bin/env bash\necho "ssh $*" >> "$E8_LOG"\nexit 0\n' > "$E8/bin/ssh"
chmod +x "$E8/bin/"*
e8reset() { rm -f "$E8/engine_up" "$E8/start_ok_at" "$E8/start_n" "$E8/stop_hang" "$E8/wsl_running" "$E8/corrupt.txt"; : > "$E8/log"; echo "free 2026-11-19 00:00:00" > "$E8/turn.txt"; }
# e8 <shell text>: run it inside env_sync.sh (everything before its dispatch), with the stubs. PRE holds lines run first.
e8() {
  ( export E8_LOG="$E8/log" E8_DIR="$E8" STUB_LOG="$E8/log" ENV_SYNC_DOCKER="$E8/bin/docker" ENV_SYNC_WSL="$E8/bin/wsl" ENV_SYNC_ENGINE_KILL="$E8/bin/kill_docker" \
      ENV_SYNC_ENGINE_WAIT="${EW:-2}" ENV_SYNC_ENGINE_STEP=1 ENV_SYNC_ENGINE_SETTLE=0 ENV_SYNC_WSL_PAUSE=0 ENV_SYNC_ENGINE_STOP_T=2 ENV_SYNC_DOCKER_TIMEOUT=5 \
      ENV_SYNC_FREE_MB="${FREE:-8000}" ENV_SYNC_WAKE_AGE="${WAKE:-9999}" ENV_SYNC_WAKE_DELAY="${WDELAY:-180}" ENV_SYNC_TURN_FILE="$E8/turn.txt" \
      ENV_SYNC_PENDING_ROOT="$E8/pending" ENV_SYNC_PULL_RECORD="$E8/pull_record" ENV_SYNC_TAILSCALE="$E8/bin/no-tailscale" ENV_SYNC_LOCATION="${LOC:-}"
    PATH="$E8/bin:$PATH"
    . "$NEW"
    SSH="$E8/bin/ssh"; SCP="$E8/bin/scp"; STAGED=1; SLICE=T8
    eval "$1"
  ) > "$E8/out" 2>&1
}
n8() { grep -c "$1" "$E8/log" 2>/dev/null || true; }

e8reset; touch "$E8/engine_up"; e8 'engine_ensure; echo "rc=$? started=$ENGINE_STARTED"'
check "ENGINE already up: nothing is started, nothing is stopped later" 'grep -q "^rc=0 started=0$" "$E8/out" && [ "$(n8 "desktop start")" = 0 ] && [ "$(n8 "^wsl")" = 0 ]'
e8reset; echo 1 > "$E8/start_ok_at"; e8 'engine_ensure; echo "rc=$? started=$ENGINE_STARTED"; engine_down'
check "A NORMAL START: one start, the engine answers, and engine_down switches Docker off again (it was off before)" '
  grep -q "^rc=0 started=1$" "$E8/out" && [ "$(n8 "desktop start")" = 1 ] && [ "$(n8 "desktop stop")" = 1 ] && [ "$(n8 "^wsl")" = 0 ] && grep -q "Docker Desktop is off again" "$E8/out"'

# K2 / AC4: the wake delay (a test clock: the "wake" was 1 s ago and the delay is 4 s)
e8reset; echo 1 > "$E8/start_ok_at"; t0=$(date +%s); WAKE=1 WDELAY=4 e8 'engine_ensure; echo "rc=$?"'; took=$(( $(date +%s) - t0 ))
check "WAKE DELAY: just after a wake no Docker start is made until the delay has passed (waited out, then started)" '
  grep -q "woke 1 s ago - no Docker start within 4 s of a wake; waiting 3 s" "$E8/out" && [ "$took" -ge 3 ] && grep -q "^rc=0$" "$E8/out" && [ "$(n8 "desktop start")" = 1 ]'
e8reset; echo 1 > "$E8/start_ok_at"; WAKE=500 WDELAY=180 e8 'engine_ensure; echo "rc=$?"'
check "WAKE DELAY: long after a wake there is no wait" '! grep -q "woke" "$E8/out" && grep -q "^rc=0$" "$E8/out"'
check "the real wake reading asks Windows for a resume from sleep / hibernate and for leaving Modern Standby" '
  grep -q "Power-Troubleshooter" "$SRC/env_sync.sh" && grep -q "Id=107,507" "$SRC/env_sync.sh"'
e8reset; FREE=900 e8 'engine_ensure; echo "rc=$? why=$ENGINE_WHY"'
check "MEMORY GATE (3 GB, unchanged): with too little free memory Docker is not started at all" 'grep -q "^rc=1 why=the laptop has only 900 MB" "$E8/out" && [ "$(n8 "desktop start")" = 0 ]'

# K3 / AC5: the hung start
e8reset; touch "$E8/wsl_running"; t0=$(date +%s); e8 'engine_ensure; echo "rc=$? started=$ENGINE_STARTED"; echo "why=$ENGINE_WHY"'; took=$(( $(date +%s) - t0 ))
check "HUNG START: no answer in the limit -> stop Docker Desktop -> wsl --shutdown -> ONE more start -> stop -> a clean end" '
  [ "$(grep -v " info$\|-l -v" "$E8/log" | tr "\n" ";")" = "docker desktop start;docker desktop stop;wsl --shutdown;docker desktop start;docker desktop stop;" ] && grep -q "^rc=1 started=0$" "$E8/out"'
check "HUNG START: exactly two starts (never a third, never a second Docker Desktop on top), one report line, nothing left running, bounded time" '
  [ "$(n8 "desktop start")" = 2 ] && ! grep -q "Docker Desktop.exe\|cmd.exe" "$SRC/env_sync.sh" && grep -q "^why=Docker on the laptop did not start (2 tries of 2 s, WSL shut down in between); nothing was left running (both docker distros read Stopped)$" "$E8/out" && grep -q "both docker distros read Stopped" "$E8/out" && [ "$took" -lt 40 ]'
e8reset; echo 2 > "$E8/start_ok_at"; e8 'engine_ensure; echo "rc=$? started=$ENGINE_STARTED"'
check "HUNG START that recovers: the second start (after wsl --shutdown) answers -> carried on, one wsl --shutdown" 'grep -q "^rc=0 started=1$" "$E8/out" && [ "$(n8 "wsl --shutdown")" = 1 ] && [ "$(n8 "desktop start")" = 2 ]'
e8reset; touch "$E8/stop_hang"; e8 'engine_ensure; echo "rc=$?"'
check "A Docker Desktop whose own stop hangs is force-closed (time-limited stop), and the run still ends" 'grep -q "^rc=1$" "$E8/out" && [ "$(n8 "^force_close")" = 2 ] && grep -q "did not stop by itself" "$E8/out"'
e8reset; e8 'LAPTOP_UP_SOFT=1 laptop_up; echo "rc=$?"; cat "$TURN_FILE"'
check "laptop_up with a Docker that will not start: returns the reason and frees the turn file it had claimed" 'grep -q "^rc=1$" "$E8/out" && grep -q "^free 20" "$E8/out"'
e8reset; e8 'laptop_up; echo "not reached"'
check "without the soft switch the command ends there with the reason (nothing half done)" '! grep -q "not reached" "$E8/out" && grep -q "env_sync: Docker on the laptop did not start" "$E8/out" && grep -q "^free 20" "$E8/turn.txt"'

# K1: the held copy. A fake desktop backup of three files, with the desktop's proof lines.
mk_backup() {   # mk_backup <stamp>
  local st="$1" n
  for n in database.sql.gz files.tar private-files.tar; do printf 'content of %s %s\n' "$st" "$n" > "$E8/desk/$st-localhost-$n"; done
  PBP="../envsync/backups/$st/$st-localhost"
  PBS=$(for n in database.sql.gz files.tar private-files.tar; do f="$E8/desk/$st-localhost-$n"; echo "file=$st-localhost-$n size=$(stat -c %s "$f") sha256=$(sha256sum < "$f" | cut -c1-64)"; done)
}
SETPB='PB_PREFIX="$PBP"; PB_SHA="$PBS"; PB_DB=_db1; PB_BEFORE="count_tables=10"; PB_AFTER="count_tables=10"; HOLD_DFP="fp_rm_items=5 (newest 2026-11-18 14:32:45.600237)"'
export PBP PBS
e8reset; mk_backup 20261119_010000; e8 "$SETPB; hold_copy 'a paid run'"
H1="$E8/pending/20261119_010000"
check "HOLD: the three backup files land in pending\<stamp>\ on the laptop's own disk, each with the desktop's size and sha256" '
  [ "$(ls "$H1" | grep -c "localhost-")" = 3 ] && cmp -s "$H1/20261119_010000-localhost-database.sql.gz" "$E8/desk/20261119_010000-localhost-database.sql.gz" && grep -q "^DB COPY HELD (not restored) 20261119_010000: .* size + sha256 equals the desktop.s; Docker was not started; covers: a paid run$" "$E8/out"'
check "HOLD: held.txt records what a later restore needs (covers, the desktop counts, the file hashes, the desktop fingerprint, not restored)" '
  grep -q "^held=20[0-9-]* [0-9:]*$" "$H1/held.txt" && grep -q "^covers=a paid run$" "$H1/held.txt" && grep -q "^restored=$" "$H1/held.txt" && grep -q "^before_count_tables=10$" "$H1/held.txt" &&
  [ "$(grep -c "^sha_file=" "$H1/held.txt")" = 3 ] && grep -q "^desktop_fp_rm_items=5 (newest 2026-11-18 14:32:45.600237)$" "$H1/held.txt"'
check "HOLD: no docker command at all, and the laptop turn file is not even claimed" '[ "$(n8 "^docker")" = 0 ] && [ "$(n8 "^wsl")" = 0 ] && grep -q "^free 2026-11-19 00:00:00$" "$E8/turn.txt"'
check "HOLD: never OneDrive, never private/backups (the folder is frappe-bench\envsync\backups\pending)" '
  grep -q "PENDING_ROOT=\"\${ENV_SYNC_PENDING_ROOT:-\$BENCH_HOST/\$STAGE/backups/pending}\"" "$SRC/env_sync.sh" && ! grep -n "PENDING_ROOT=" "$SRC/env_sync.sh" "$SRC/poller_run.sh" | grep -qi "onedrive\|private"'
e8reset; mk_backup 20261119_020000; e8 "$SETPB; hold_copy two"; e8reset; mk_backup 20261119_030000; e8 "$SETPB; hold_copy three"
check "HOLD: the newest 2 held copies are kept, the older one is removed" '[ ! -d "$H1" ] && [ -d "$E8/pending/20261119_020000" ] && [ -d "$E8/pending/20261119_030000" ]'
e8reset; mk_backup 20261119_040000; echo "20261119_040000-localhost-files.tar" > "$E8/corrupt.txt"; e8 "$SETPB; hold_copy four; echo not-reached"
check "HOLD: a file that arrives different (sha256) is NOT accepted - no held record is written for that copy" '
  [ ! -f "$E8/pending/20261119_040000/held.txt" ] && ! grep -q "not-reached\|DB COPY HELD" "$E8/out" && grep -q "normal copy failed\|differs" "$E8/out"'
e8reset; e8 'echo "newest=$(basename "$(held_newest)") unrestored=$(basename "$(held_newest unrestored)")"; sed -i "s/^restored=.*/restored=2026-11-19 03:30:00/" "$PENDING_ROOT/20261119_030000/held.txt"; echo "after=$(basename "$(held_newest unrestored)")"'
check "the newest held copy is found; one already loaded is passed over when a takeover looks for a copy to load" 'grep -q "^newest=20261119_030000 unrestored=20261119_030000$" "$E8/out" && grep -q "^after=20261119_020000$" "$E8/out"'
e8reset; e8 'held_load "$PENDING_ROOT/20261119_020000"; echo "prefix=$PB_PREFIX db=$PB_DB dfp=$HELD_DFP file=$(lfile -database.sql.gz) c=$(cprefix)"'
check "a held copy loads back exactly (prefix, database, counts, hashes, fingerprint) and its files are checked again" '
  grep -q "files checked again (size + sha256)" "$E8/out" && grep -q "^prefix=../envsync/backups/20261119_020000/20261119_020000-localhost db=_db1 dfp=fp_rm_items=5 (newest 2026-11-18 14:32:45.600237) file=$E8/pending/20261119_020000/20261119_020000-localhost-database.sql.gz c=" "$E8/out"'
e8reset; printf 'tampered' >> "$E8/pending/20261119_020000/20261119_020000-localhost-files.tar"; e8 'held_load "$PENDING_ROOT/20261119_020000"; echo not-reached'
check "a held copy whose file changed on disk since it was checked is REFUSED before anything is restored" '! grep -q "not-reached" "$E8/out" && grep -q "no longer matches its recorded sha256; the laptop database is unchanged" "$E8/out"'
rm -rf "$E8/pending/20261119_020000"

# where a database copy goes: held when away, loaded in the office (owner 2026-11-19 00:19)
e8reset; LOC=away e8 'echo "a=$(where_db_goes)"; HOLD=1; echo "b=$(where_db_goes)"'; cp "$E8/out" "$E8/o1"; LOC=office e8 'echo "c=$(where_db_goes)"; HOLD=1; echo "d=$(where_db_goes)"; HOLD=0; RESTORE=1; ENV_SYNC_LOCATION=away; echo "e=$(where_db_goes)"'
check "AWAY a database copy is held, in the OFFICE it is loaded; --hold and --restore force one or the other" '
  grep -q "^a=hold$" "$E8/o1" && grep -q "^b=hold$" "$E8/o1" && grep -q "^c=restore$" "$E8/out" && grep -q "^d=hold$" "$E8/out" && grep -q "^e=restore$" "$E8/out"'
e8reset; e8 'echo "x=$(where_db_goes)"'
check "with no direct office path to the desktop (no tailscale answer) the laptop counts as away: held" 'grep -q "^x=hold$" "$E8/out"'

# the slice-end db-pull (owner 2026-11-19 00:19: away it is only held; in the office it restores as before)
FAKES='pull_backup() { PB_PREFIX="$PBP"; PB_SHA="$PBS"; PB_DB=_db1; PB_BEFORE="count_tables=10"; PB_AFTER="count_tables=10"; PB_TOOK=1; echo "desktop: backup proved (fake)"; }; fp_of() { echo "fp_rm_items=5 (newest 2026-11-18 14:32:45.600237)"; }; prove_restore() { echo "PROVE_RESTORE_CALLED covers=$1 from=$(lfile -database.sql.gz)"; }; cmd_status() { echo "data"; echo "  verdict SAME"; }'
e8reset; mk_backup 20261119_050000; LOC=away e8 "$FAKES; YES=1; cmd_db_pull"
check "SLICE-END db-pull AWAY: the copy is HELD - fetched and sha-checked, nothing loaded, no Docker started" '
  grep -q "away from the office (or --hold) - the copy is HELD, not loaded: no Docker is started" "$E8/out" && grep -q "^DB COPY HELD (not restored) 20261119_050000" "$E8/out" && grep -q "result: held (not loaded)$" "$E8/out" &&
  ! grep -q PROVE_RESTORE_CALLED "$E8/out" && [ "$(n8 "^docker")" = 0 ] && [ -f "$E8/pending/20261119_050000/held.txt" ]'
e8reset; touch "$E8/engine_up"; mk_backup 20261119_060000; LOC=office e8 "$FAKES; YES=1; cmd_db_pull"
check "SLICE-END db-pull in the OFFICE: restored as before (the copy goes beside sites, not into pending)" '
  grep -q "^PROVE_RESTORE_CALLED covers= from=.*/sites/../envsync/backups/20261119_060000/20261119_060000-localhost-database.sql.gz$" "$E8/out" && [ ! -d "$E8/pending/20261119_060000" ] && ! grep -q "DB COPY HELD" "$E8/out"'
e8reset; mk_backup 20261119_070000; LOC=office e8 "$FAKES; YES=1; cmd_db_pull"
check "SLICE-END db-pull in the office with a Docker that will not start: the copy is HELD instead, the database untouched" '
  grep -q "Docker on the laptop did not start .* - the copy is HELD instead of loaded" "$E8/out" && grep -q "^DB COPY HELD (not restored) 20261119_070000" "$E8/out" && ! grep -q PROVE_RESTORE_CALLED "$E8/out" && grep -q "^free 20" "$E8/turn.txt"'

# the restore later
e8reset; e8 "$FAKES; cmd_db_restore_held"
check "db-restore-held refuses without --yes (it replaces the laptop's database)" 'grep -q "db-restore-held REPLACES the laptop.s database with the held copy 20261119_070000" "$E8/out" && ! grep -q PROVE_RESTORE_CALLED "$E8/out"'
e8reset; e8 "$FAKES; YES=1; cmd_db_restore_held; echo rc=\$?"
check "db-restore-held with a Docker that will not start: ONE clear line, the held copy is kept, the database unchanged" '
  grep -q "^DATABASE RESTORE NOT DONE: Docker on the laptop did not start .* The held copy is kept (.*20261119_070000); the laptop.s database is unchanged.$" "$E8/out" && grep -q "^rc=3$" "$E8/out" && [ -f "$E8/pending/20261119_070000/held.txt" ] && ! grep -q PROVE_RESTORE_CALLED "$E8/out"'
e8reset; echo 1 > "$E8/start_ok_at"; e8 "$FAKES; YES=1; cmd_db_restore_held; echo rc=\$?"
check "db-restore-held: Docker is started for it, the NEWEST held copy is loaded from its own folder, marked restored, and Docker is switched off again" '
  grep -q "^PROVE_RESTORE_CALLED covers=.*(held 20.*, loaded 20.*) from=$E8/pending/20261119_070000/20261119_070000-localhost-database.sql.gz$" "$E8/out" && grep -q "^restored=20[0-9-]* [0-9:]*$" "$E8/pending/20261119_070000/held.txt" &&
  grep -q "^DB RESTORED from the held copy 20261119_070000" "$E8/out" && [ "$(n8 "desktop start")" = 1 ] && [ "$(n8 "desktop stop")" = 1 ] && grep -q "^free 20" "$E8/turn.txt"'
check "the pull record of a restored HELD copy carries the moment the copy was MADE, not the moment it was loaded" 'grep -q "last db-pull (\${HELD_MADE:-\$(date" "$SRC/env_sync.sh"'
e8reset; touch "$E8/engine_up"; e8 "$FAKES; held_scratch_check() { echo SCRATCH_CHECK_CALLED; return 0; }; DRY_RUN=1; cmd_db_restore_held; echo rc=\$?"
check "db-restore-held --dry-run only loads the copy into a scratch database: nothing is restored, nothing marked" '
  grep -q SCRATCH_CHECK_CALLED "$E8/out" && ! grep -q PROVE_RESTORE_CALLED "$E8/out" && grep -q "^DRY RUN done: the held copy loads, counts and fingerprint equal the desktop.s; nothing real changed$" "$E8/out" && grep -q "^rc=0$" "$E8/out"'
check "the scratch fingerprint is written in db_fingerprint.py's exact words, so the two can be compared as text" '
  grep -q "fp_rm_items=.*(newest " "$SRC/remote/scratch_counts.sh" && grep -q "fp_rm_snapshot=" "$SRC/remote/scratch_counts.sh" && grep -q "fp_versions=.*(newest " "$SRC/remote/scratch_counts.sh" && grep -q "\"\${3:-}\" = fp" "$SRC/remote/scratch_counts.sh"'
check "a takeover loads the newest held copy FIRST; its dry run only rehearses it on a scratch database" '
  grep -q "hd=\$(held_newest unrestored)" "$SRC/env_sync.sh" && grep -q "data: loading the held copy" "$SRC/env_sync.sh" && grep -q "rehearsing it on a scratch database" "$SRC/env_sync.sh"'
check "the leaving checkpoint holds its database copy by default (--restore asks for the old behaviour and needs --yes)" '
  grep -q "local hold=1; \[ \"\${RESTORE:-0}\" = 1 \] && hold=0" "$SRC/env_sync.sh" && grep -q "HELD on the laptop (not loaded" "$SRC/env_sync.sh"'
H=$(bash "$SRC/env_sync.sh" 2>/dev/null)
check "the help names db-restore-held and the held / restore switch" 'grep -q "db-restore-held --yes" <<< "$H" && grep -q "db-pull --yes --hold | --restore" <<< "$H"'

echo "== $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
