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
check "the help names catch-up (B4 back home)" 'grep -q "catch-up --slice" <<< "$H"'
check "backups leave private/backups: backup_local.sh writes to envsync/backups and db-push / db-pull use it" '
  grep -q -- "--backup-path \"\$PWD/\$D\"" "$SRC/remote/backup_local.sh" && [ "$(grep -c "bash backup_local.sh" "$SRC/env_sync.sh")" = 3 ] && ! grep -q "bash backup.sh" "$SRC/env_sync.sh"'

echo "== $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
