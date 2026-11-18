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
check "R2: the laptop poller runs catch-up by itself when the desktop answers again, and skips B1 while offline" 'grep -q "env_sync.sh\" catch-up --slice" "$SRC/slice_poll.sh" && grep -q "OFFLINE" "$SRC/slice_poll.sh" && grep -q "checkpoint-code --slice \"\$SLICE\" --name \"\$NAME\" --if-older 15" "$SRC/slice_poll.sh" && bash -n "$SRC/slice_poll.sh"'
check "the help names catch-up (B4 back home)" 'grep -q "catch-up --slice" <<< "$H"'
check "backups leave private/backups: backup_local.sh writes to envsync/backups and db-push / db-pull use it" '
  grep -q -- "--backup-path \"\$PWD/\$D\"" "$SRC/remote/backup_local.sh" && [ "$(grep -c "bash backup_local.sh" "$SRC/env_sync.sh")" = 3 ] && ! grep -q "bash backup.sh" "$SRC/env_sync.sh"'
check "db-push makes the laptop backup's envsync/backups/<stamp> folder on the desktop before copying into it (SYNC-D4)" '
  awk "/^cmd_db_push\\(\\)/,/^}/" "$SRC/env_sync.sh" | grep -B1 -A3 "New-Item -ItemType Directory -Force -Path .\$D_BENCH/sites/\$(dirname \"\$lprefix\")" | grep -q "for suf in -database.sql.gz"'

echo "== 7. the checkpoint poller as a scheduled task (CKP-3): one run at a time, heartbeat, B1 / B2 / offline / failure"
# poller_run.sh with every outside call replaced: the desktop probe (ssh), env_sync.sh and docker are stubs that log their
# arguments and answer what the case sets. Nothing reaches a machine, a container or a scheduled task.
PW="$W/poller"; mkdir -p "$PW/state" "$PW/bin" "$PW/sites/localhost/locks"
cat > "$PW/bin/ssh" <<'EOF'
#!/usr/bin/env bash
echo "ssh $*" >> "$PW_LOG"
[ -f "$PW_DIR/ssh_out" ] || exit 255
cat "$PW_DIR/ssh_out"
EOF
cat > "$PW/bin/env_sync" <<'EOF'
#!/usr/bin/env bash
echo "env_sync $*" >> "$PW_LOG"
case "$*" in *"--yes"*) [ -f "$PW_DIR/b2_record" ] && cp "$PW_DIR/b2_record" "$PW_DIR/pull_record";; esac
cat "$PW_DIR/es_out" 2>/dev/null
exit "$(cat "$PW_DIR/es_rc" 2>/dev/null || echo 0)"
EOF
cat > "$PW/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$PW_LOG"
case "$1" in
  info) [ -f "$PW_DIR/engine_up" ];;
  inspect) echo false;;
  desktop) rm -f "$PW_DIR/engine_up";;
esac
EOF
cat > "$PW/bin/engine_start" <<'EOF'
#!/usr/bin/env bash
echo "engine_start" >> "$PW_LOG"; touch "$PW_DIR/engine_up"
EOF
chmod +x "$PW/bin/"*
prun() {   # one poller run against the stubs (POLLER_ENGINE_START: the real Docker Desktop is never started by a test)
  PW_DIR="$PW" PW_LOG="$PW/calls.log" POLLER_STATE="$PW/state" POLLER_HEARTBEAT="$PW/hb.txt" POLLER_LOG="$PW/poller.log" \
  POLLER_SSH="$PW/bin/ssh" POLLER_ENV_SYNC="$PW/bin/env_sync" POLLER_DOCKER="$PW/bin/docker" POLLER_ENGINE_WAIT=1 POLLER_ENGINE_SETTLE=0 POLLER_FREE_MB="${POLLER_FREE_MB:-8000}" POLLER_LOCATION="${POLLER_LOCATION-away}" POLLER_TAILSCALE="${POLLER_TAILSCALE:-}" POLLER_ENGINE_START="$PW/bin/engine_start" \
  ENV_SYNC_PULL_RECORD="$PW/pull_record" ENV_SYNC_TURN_FILE="$PW/turn.txt" ENV_SYNC_RELAY_ROOT="$PW/relay" \
  bash "$SRC/poller_run.sh" > "$PW/out.txt" 2>&1
}
hb() { sed -n 's/^result: *//p' "$PW/hb.txt"; }
calls() { grep -c "$1" "$PW/calls.log" 2>/dev/null || true; }
preset() { rm -f "$PW/calls.log" "$PW/ssh_out" "$PW/es_out" "$PW/es_rc" "$PW/b2_record" "$PW/engine_up" "$PW/hb.txt"; : > "$PW/calls.log"; }
echo "free 2026-11-18 14:05:00" > "$PW/turn.txt"
echo "# desktop fingerprint after the laptop's db-push (2026-11-18 13:57:40, backup x)" > "$PW/pull_record"

preset; prun
check "IDLE: no slice followed -> heartbeat IDLE, the desktop is not asked, nothing copied" '[[ "$(hb)" == IDLE* ]] && [ "$(calls .)" = 0 ]'
check "the heartbeat names the run time, the slice, reachability, the last good B1 and B2, and the off switch" '
  grep -q "^run:  *20[0-9-]* [0-9:]*$" "$PW/hb.txt" && grep -q "^active slice:  *none" "$PW/hb.txt" && grep -q "^desktop reachable: not asked" "$PW/hb.txt" &&
  grep -q "^last good B1: " "$PW/hb.txt" && grep -q "^last good B2:  *2026-11-18 13:57:40" "$PW/hb.txt" && grep -q "poller pause | resume | remove" "$PW/hb.txt"'

echo "T-1 t1 since 2026-11-18 15:00:00" > "$PW/state/active.txt"
preset; prun
check "OFFLINE: the desktop does not answer -> heartbeat OFFLINE, B1 skipped, no failure" '[[ "$(hb)" == OFFLINE* ]] && [ "$(calls "^env_sync")" = 0 ] && [ -f "$PW/state/offline" ] && grep -q "^desktop reachable: n" "$PW/hb.txt"'
n1=$(grep -c OFFLINE "$PW/poller.log"); preset; prun
check "OFFLINE is logged once, not at every run" '[ "$(grep -c OFFLINE "$PW/poller.log")" = "$n1" ] && [[ "$(hb)" == OFFLINE* ]]'

preset; printf 'ssh=ok\nF=HEARTBEAT 2026-11-18 15:10:00 M1\nP=\n' > "$PW/ssh_out"
printf 'desktop answers\nCHECKPOINT CODE T-1: /x/checkpoints/T-1/20261118_151000\nCAUGHT-UP T-1 2026-11-18 15:10: code = the checkpoint above\n' > "$PW/es_out"
mkdir -p "$PW/relay/T-1"; : > "$PW/relay/T-1/to_chat.md"; prun
check "RECONNECT: the desktop answers again -> the catch-up runs by itself, CAUGHT-UP in the heartbeat, the log and ONE relay entry" '
  [[ "$(hb)" == CAUGHT-UP* ]] && grep -q "^env_sync catch-up --slice T-1 --name t1$" "$PW/calls.log" && [ ! -f "$PW/state/offline" ] &&
  [ "$(grep -c "id T-1-CAUGHTUP" "$PW/relay/T-1/to_chat.md")" = 1 ] && grep -q "CAUGHT-UP" "$PW/poller.log" && grep -q "20261118_151000" "$PW/state/last_b1.txt"'

preset; printf 'ssh=ok\nF=HEARTBEAT x\nP=\n' > "$PW/ssh_out"; printf 'CHECKPOINT CODE T-1: /x/checkpoints/T-1/20261118_152500\n  desktop abc\n' > "$PW/es_out"; prun
check "B1 OK: checkpoint-code --if-older is called, the heartbeat says B1 OK and records the checkpoint" '
  [ "$(hb)" = "B1 OK" ] && grep -q "^env_sync checkpoint-code --slice T-1 --name t1 --if-older 13$" "$PW/calls.log" && grep -q "T-1 20261118_152500" "$PW/state/last_b1.txt" && grep -q "^desktop reachable: y" "$PW/hb.txt"'
preset; printf 'ssh=ok\nF=HEARTBEAT x\nP=\n' > "$PW/ssh_out"; echo "checkpoint not due: the newest (x) is 3 min old (< 13)" > "$PW/es_out"; prun
check "B1 SKIP: not due -> said so, the last good B1 kept, no B2 without a DBCOPY-POINT" '[ "$(hb)" = "B1 SKIP not due" ] && grep -q "20261118_152500" "$PW/hb.txt" && [ "$(calls "catch-up")" = 0 ] && [ "$(calls "^docker")" = 0 ]'

preset; printf 'ssh=ok\nF=HEARTBEAT x\nP=\n' > "$PW/ssh_out"; echo "CHECKPOINT FAILED (T-1, now): TEST failure forced at b1" > "$PW/es_out"; echo 3 > "$PW/es_rc"; prun
check "FAILURE: a failed B1 is ONE heartbeat line and ONE log line, exit 0, the slice stays followed, no retry" '
  [[ "$(hb)" == "FAILED B1 (rc 3)"* ]] && [ "$(grep -c "FAILED B1" "$PW/poller.log")" = 1 ] && [ "$(calls "^env_sync")" = 1 ] && [ -f "$PW/state/active.txt" ]'

preset; printf 'ssh=ok\nF=HEARTBEAT x\nP=DBCOPY-POINT 2026-11-18 15:30:00 a paid run\n' > "$PW/ssh_out"; echo "checkpoint not due: x" > "$PW/es_out"
echo "# desktop fingerprint at the laptop's last db-pull (2026-11-18 15:31:10, backup y)" > "$PW/b2_record"; prun
check "B2 WITH STANDBY: a DBCOPY-POINT newer than the last copy -> Docker Desktop started, catch-up --yes, containers and Docker put back" '
  [[ "$(hb)" == *"+ B2 OK"* ]] && grep -q "^env_sync catch-up --slice T-1 --name t1 --yes$" "$PW/calls.log" && grep -q "^engine_start" "$PW/calls.log" && grep -q "^docker desktop stop" "$PW/calls.log" &&
  grep -q "^last good B2:  *2026-11-18 15:31:10" "$PW/hb.txt" && ! grep -q "dev2" "$PW/calls.log" && grep -q "^free" "$PW/turn.txt"'
preset; printf 'ssh=ok\nF=HEARTBEAT x\nP=DBCOPY-POINT 2026-11-18 15:30:00 a paid run\n' > "$PW/ssh_out"; echo "checkpoint not due: x" > "$PW/es_out"; prun
check "B2 is not repeated once the copy is newer than the DBCOPY-POINT" '[ "$(hb)" = "B1 SKIP not due" ] && [ "$(calls "catch-up")" = 0 ]'

preset; printf 'ssh=ok\nF=HEARTBEAT x\nP=DBCOPY-POINT 2026-11-18 16:40:00 another paid run\n' > "$PW/ssh_out"; echo "checkpoint not due: x" > "$PW/es_out"; echo 2 > "$PW/es_rc"; prun
check "B2 FAILURE: a failed copy is one heartbeat + log line, the containers and Docker are still put back" '
  [[ "$(hb)" == *"+ FAILED B2 (rc 2)"* ]] && [ "$(grep -c "FAILED B2" "$PW/poller.log")" = 1 ] && grep -q "^docker desktop stop" "$PW/calls.log" && grep -q "another paid run" "$PW/state/b2_failed.txt"'
preset; printf 'ssh=ok\nF=HEARTBEAT x\nP=DBCOPY-POINT 2026-11-18 16:40:00 another paid run\n' > "$PW/ssh_out"; echo "checkpoint not due: x" > "$PW/es_out"; prun
check "NO TIGHT RETRY: the next run does not try the same failed copy again (B2 PENDING), and starts nothing" '
  [[ "$(hb)" == *"B2 PENDING (the copy failed"* ]] && [ "$(calls "catch-up")" = 0 ] && [ "$(calls "^docker")" = 0 ] && [ "$(calls engine_start)" = 0 ]'
rm -f "$PW/state/b2_failed.txt"
preset; printf 'ssh=ok\nF=HEARTBEAT x\nP=DBCOPY-POINT 2026-11-18 16:40:00 another paid run\n' > "$PW/ssh_out"; echo "checkpoint not due: x" > "$PW/es_out"; POLLER_FREE_MB=1500 prun
check "LOW MEMORY: with too little free memory on the laptop no copy is started (B2 PENDING), and it is not counted as a failure" '
  [[ "$(hb)" == *"B2 PENDING (the laptop has only 1500 MB"* ]] && [ "$(calls "catch-up")" = 0 ] && [ "$(calls engine_start)" = 0 ] && [ ! -f "$PW/state/b2_failed.txt" ]'
echo "# desktop fingerprint at the laptop's last db-pull (2026-11-18 16:45:00, backup z)" > "$PW/pull_record"

preset; printf 'ssh=ok\nF=HEARTBEAT x\nP=\n' > "$PW/ssh_out"
cat > "$PW/bin/env_sync_peek" <<'EOF'
#!/usr/bin/env bash
cp "$POLLER_HEARTBEAT" "$PW_DIR/hb_during.txt"; echo "checkpoint not due: x"
EOF
chmod +x "$PW/bin/env_sync_peek"
PW_DIR="$PW" PW_LOG="$PW/calls.log" POLLER_STATE="$PW/state" POLLER_HEARTBEAT="$PW/hb.txt" POLLER_LOG="$PW/poller.log" POLLER_SSH="$PW/bin/ssh" \
  POLLER_ENV_SYNC="$PW/bin/env_sync_peek" POLLER_DOCKER="$PW/bin/docker" ENV_SYNC_PULL_RECORD="$PW/pull_record" ENV_SYNC_TURN_FILE="$PW/turn.txt" \
  ENV_SYNC_RELAY_ROOT="$PW/relay" POLLER_FREE_MB=8000 POLLER_LOCATION=away bash "$SRC/poller_run.sh" > /dev/null 2>&1
check "EVERY run writes the heartbeat FIRST: while a step runs it says RUNNING since <start>, then the result replaces it" '
  grep -q "^result:  *RUNNING since 20[0-9-]* [0-9:]* " "$PW/hb_during.txt" && grep -q "^active slice:  *T-1" "$PW/hb_during.txt" && [ "$(hb)" = "B1 SKIP not due" ]'

# Office vs away (owner 2026-11-18 "ok option a"). prun's default location is "away"; these runs set it, or let the
# poller read it from a stub tailscale. No Wi-Fi, adapter or Tailscale setting is touched.
echo "# desktop fingerprint at the laptop's last db-pull (2026-11-18 16:45:00, backup z)" > "$PW/pull_record"
preset; printf 'ssh=ok\nF=HEARTBEAT x\nP=DBCOPY-POINT 2026-11-18 17:30:00 a load in the office\n' > "$PW/ssh_out"; printf 'CHECKPOINT CODE T-1: /x/checkpoints/T-1/20261118_173100\n' > "$PW/es_out"; POLLER_LOCATION=office prun
check "OFFICE: code only - B1 is taken, the due database copy is NOT made, Docker is never started, and it is not a failure" '
  [[ "$(hb)" == "B1 OK + B2 not in office"* ]] && [ "$(calls "catch-up")" = 0 ] && [ "$(calls "^docker")" = 0 ] && [ "$(calls engine_start)" = 0 ] && [ ! -f "$PW/state/b2_failed.txt" ] && grep -q "^location:  *office" "$PW/hb.txt"'
preset; printf 'ssh=ok\nF=HEARTBEAT x\nP=DBCOPY-POINT 2026-11-18 17:30:00 a load in the office\n' > "$PW/ssh_out"; echo "checkpoint not due: x" > "$PW/es_out"
echo "# desktop fingerprint at the laptop's last db-pull (2026-11-18 17:40:00, backup w)" > "$PW/b2_record"; POLLER_LOCATION=away prun
check "AWAY: the copy that was held back in the office is made at the first run away (code + database)" '
  [[ "$(hb)" == *"+ B2 OK"* ]] && grep -q "^env_sync catch-up --slice T-1 --name t1 --yes$" "$PW/calls.log" && grep -q "^location:  *away" "$PW/hb.txt"'
cat > "$PW/bin/tailscale" <<'EOF'
#!/usr/bin/env bash
cat "$PW_DIR/ts_out" 2>/dev/null
EOF
chmod +x "$PW/bin/tailscale"
loc() { echo "$1" > "$PW/ts_out"; preset; printf 'ssh=ok\nF=HEARTBEAT x\nP=\n' > "$PW/ssh_out"; echo "checkpoint not due: x" > "$PW/es_out"; POLLER_LOCATION="" POLLER_TAILSCALE="$PW/bin/tailscale" prun; sed -n 's/^location: *\([a-z]*\) .*/\1/p' "$PW/hb.txt"; }
check "LOCATION: a direct private-LAN path to the desktop is the office; the relay, a public address or no answer is away" '
  [ "$(loc "pong from nitesh-desktop (100.84.255.77) via 192.168.0.22:41641 in 9ms")" = office ] && [ "$(loc "pong from nitesh-desktop (100.84.255.77) via 10.0.0.7:41641 in 3ms")" = office ] &&
  [ "$(loc "pong from nitesh-desktop (100.84.255.77) via DERP(sin) in 120ms")" = away ] && [ "$(loc "pong from nitesh-desktop (100.84.255.77) via 122.171.18.123:16983 in 40ms")" = away ] && [ "$(loc "no reply")" = away ]'

preset; date '+%F %T' > "$PW/state/paused"; prun
check "PAUSE: the off switch -> heartbeat PAUSED, nothing asked, nothing copied" '[[ "$(hb)" == PAUSED* ]] && [ "$(calls .)" = 0 ]'
rm -f "$PW/state/paused"

preset; mkdir "$PW/state/lock"; prun
check "ONE AT A TIME: a second run while one holds the lock does nothing" '[ ! -f "$PW/hb.txt" ] && grep -q "SKIP another run holds the lock" "$PW/poller.log" && [ -d "$PW/state/lock" ]'
rmdir "$PW/state/lock"

preset; printf 'ssh=ok\nF=DONE 2026-11-18 16:00:00 all done\nP=\n' > "$PW/ssh_out"; printf 'CHECKPOINT CODE T-1: /x/checkpoints/T-1/20261118_160100\n' > "$PW/es_out"; prun
check "SLICE END: status DONE -> one last B1 (not gated by --if-older), then the slice is no longer followed" '
  grep -q "^env_sync checkpoint-code --slice T-1 --name t1$" "$PW/calls.log" && [ ! -f "$PW/state/active.txt" ] && [ -f "$PW/state/last_active.txt" ] && [[ "$(hb)" == "B1 OK; "*"no longer followed"* ]]'
preset; prun
check "after the slice ended the next run is IDLE" '[[ "$(hb)" == IDLE* ]] && [ "$(calls .)" = 0 ]'
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
check "the help names the poller commands and the off switch" 'grep -q "poller install" <<< "$H" && grep -q "poller pause | resume" <<< "$H" && grep -q "poller remove" <<< "$H" && grep -q "poller follow --slice S --name N" <<< "$H"'
check "P6: db-push's run record and the copied loose report files go to BoQ main lane/_run_records, never the Desktop root" '
  grep -q "RUN_RECORDS=\"\${ENV_SYNC_RUN_RECORDS:-\$L_REPORTS/BoQ main lane/_run_records}\"" "$SRC/env_sync.sh" && grep -q "run=\"\$RUN_RECORDS/" "$SRC/env_sync.sh" && ! grep -q "run=\"\$L_REPORTS/" "$SRC/env_sync.sh" && grep -q "lp=\"\$RUN_RECORDS/\$name\"" "$SRC/env_sync.sh"'
FS="$W/follow"; mkdir -p "$FS"
( POLLER_STATE="$FS" bash "$SRC/env_sync.sh" poller follow --slice T-9 --name t9 ) > /dev/null 2>&1
check "poller follow writes the followed slice; unfollow, pause and resume are the off switches" '
  grep -q "^T-9 t9 since " "$FS/active.txt" && ( POLLER_STATE="$FS" bash "$SRC/env_sync.sh" poller pause > /dev/null 2>&1 ) && [ -f "$FS/paused" ] &&
  ( POLLER_STATE="$FS" bash "$SRC/env_sync.sh" poller resume > /dev/null 2>&1 ) && [ ! -f "$FS/paused" ] &&
  ( POLLER_STATE="$FS" bash "$SRC/env_sync.sh" poller unfollow > /dev/null 2>&1 ) && [ ! -f "$FS/active.txt" ]'
check "catch-up reads the last copy's moment from a db-pull record AND a db-push record" '
  a=$(echo "# desktop fingerprint at the laptop'"'"'s last db-pull (2026-11-17 20:20:56, backup b)" | sed -n "$(grep -o "1s/\.\*(.*p" "$SRC/env_sync.sh" | head -1)") &&
  b=$(echo "# desktop fingerprint after the laptop'"'"'s db-push (2026-11-18 13:57:40, backup b)" | sed -n "$(grep -o "1s/\.\*(.*p" "$SRC/env_sync.sh" | head -1)") &&
  [ "$a" = "2026-11-17 20:20:56" ] && [ "$b" = "2026-11-18 13:57:40" ]'
check "IDLE runs still say where the laptop is (the owner's Status shortcut shows it)" '
  preset; POLLER_LOCATION=office prun; [[ "$(hb)" == IDLE* ]] && grep -q "^location:  *office" "$PW/hb.txt" && [ "$(calls .)" = 0 ]'
check "the owner's Desktop shortcuts: Pause / Resume / Status, hidden start, the scripts stay in the repo, the off switch is undoable" '
  grep -q "Copier - Pause" "$SRC/laptop/copier_shortcuts.ps1" && grep -q "Copier - Resume" "$SRC/laptop/copier_shortcuts.ps1" && grep -q "Copier - Status" "$SRC/laptop/copier_shortcuts.ps1" &&
  grep -q "wscript.exe" "$SRC/laptop/copier_shortcuts.ps1" && grep -q "poller pause" "$SRC/laptop/copier_shortcut.vbs" && grep -q "poller resume" "$SRC/laptop/copier_shortcut.vbs" &&
  grep -q "The checkpoint copier is PAUSED" "$SRC/laptop/copier_shortcut.vbs" && grep -q "The checkpoint copier is ON" "$SRC/laptop/copier_shortcut.vbs" && grep -q "poller shortcuts" <<< "$H" &&
  [ "$(grep -c "$(printf "\r")" "$SRC/env_sync.sh")" = 0 ]'

echo "== $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
