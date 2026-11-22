# dev2_lane.sh -- the dev2 lane's CODE (BCS-T1, 2026-11-22): sourced by test_env_sync.sh after its section 8, so it uses that
# file's stubs and helpers (check, G, prun, units, hb, calls, preset, e8, e8reset, n8) and counts in the same total.
# Nothing here reaches a machine, a container, a database, a session or Docker: ssh, scp, docker and wsl are stubs, the copier's
# env_sync.sh is a stub, the backup is a stub that writes three small files, and every checkout is a throw-away one.

T1BASE=7d356b855                                  # the tip BCS-T1 was built on: what "main dev is unchanged" is compared with
old_t1() { git -C "$REPO" show "$T1BASE:scripts/env_sync/$1"; }
git -C "$REPO" cat-file -e "$T1BASE^{commit}" 2>/dev/null || bad "the BCS-T1 base revision $T1BASE is not in $REPO"

echo "== 9. the dev2 lane's commits always reach the laptop, or the copy says why not (P2)"
P2="$W/p2"; mkdir -p "$P2"
DK="$P2/desk"; git init -q -b main "$DK"; echo a > "$DK/a"; G "$DK" add -A; G "$DK" commit -q -m A; CA=$(G "$DK" rev-parse HEAD)
echo b > "$DK/b"; G "$DK" add -A; G "$DK" commit -q -m B; CB=$(G "$DK" rev-parse HEAD)
G "$DK" clone -q "$DK" "$P2/lap" 2>/dev/null                   # the laptop's dev2 checkout: holds A and B
G "$DK" checkout -q -b feature/d2; echo c > "$DK/c"; G "$DK" add -A; G "$DK" commit -q -m C; CC=$(G "$DK" rev-parse HEAD)
echo wip >> "$DK/a"
echo l > "$P2/lap/l"; G "$P2/lap" add -A; G "$P2/lap" commit -q -m "laptop only"; LX=$(G "$P2/lap" rev-parse HEAD)
hk() { sed -n "s/^$1=//p" "$2/head.txt"; }
bash "$CODE" "$DK" "$P2/k1" "$LX" "--held=$LX:$CB" > "$P2/o1" 2>&1
check "P2+: a dev2 base the desktop does not know (the laptop's HEAD is its own commit) falls back to a commit both hold; the branch's commits travel and head.txt says so" '
  [ "$(hk bundle "$P2/k1")" = commits.bundle ] && [ "$(hk base "$P2/k1")" = "$CB" ] && [ "$(hk commits "$P2/k1")" = "carried since ${CB:0:9} (the laptop'"'"'s HEAD ${LX:0:9} is not a usable base)" ] && git bundle list-heads "$P2/k1/commits.bundle" | grep -q "^$CC refs/heads/feature/d2$" && grep -q "^commits=carried since" "$P2/o1"'
G "$DK" clone -q --branch main "$P2/lap" "$P2/lapc" 2>/dev/null; G "$P2/lapc" checkout -q -B feature/d2 "$CB"
check "P2+: the fallback bundle rebuilds on a checkout that holds only the common commit (tree equal)" 'bash "$APPLY" apply "$P2/lapc" "$P2/k1" 2>&1 | grep -q "^applied: tree equals" && [ "$(G "$P2/lapc" rev-parse HEAD)" = "$CC" ]'
G "$DK" branch side "$CA"; G "$DK" worktree add -q "$P2/wt" side; echo s > "$P2/wt/s"; G "$P2/wt" add -A; G "$P2/wt" commit -q -m S; CS=$(G "$DK" rev-parse side)
bash "$CODE" "$DK" "$P2/k2" "$CS" "--held=$CS" > /dev/null 2>&1
check "P2+: a known base that is not an ancestor (the laptop's HEAD went another way) starts from the point the two share" '[ "$(hk bundle "$P2/k2")" = commits.bundle ] && [ "$(hk base "$P2/k2")" = "$CA" ]'
bash "$CODE" "$DK" "$P2/k3" "$LX" "--held=$LX" > "$P2/o3" 2>&1
check "P2-: no commit the laptop holds is known here -> no bundle, and head.txt SAYS the commits are NOT carried and why" '[ "$(hk bundle "$P2/k3")" = none ] && [ "$(hk commits "$P2/k3")" = "NOT carried: no commit the laptop holds is known here and shared with feature/d2" ] && [ ! -e "$P2/k3/commits.bundle" ] && grep -q "^commits=NOT carried" "$P2/o3"'
bash "$CODE" "$DK" "$P2/k4" none "--held=" > /dev/null 2>&1
check "P2-: no dev2 checkout on the laptop -> said, never silent" '[ "$(hk bundle "$P2/k4")" = none ] && [ "$(hk commits "$P2/k4")" = "NOT carried: the laptop has no dev2 checkout, so no common commit is known" ]'
bash "$CODE" "$DK" "$P2/k5" "$CC" "--held=$CC" > /dev/null 2>&1; bash "$CODE" "$DK" "$P2/k6" "$CB" "--held=$CB" > /dev/null 2>&1
check "P2: the laptop already holds the head -> nothing to carry (not a failure); a usable base is used as before" '[ "$(hk commits "$P2/k5")" = "nothing to carry: the laptop already holds ${CC:0:9}" ] && [ "$(hk commits "$P2/k6")" = "carried since ${CB:0:9}" ] && [ "$(hk bundle "$P2/k6")" = commits.bundle ]'
G "$DK" clone -q "$DK" "$P2/det" 2>/dev/null; G "$P2/det" checkout -q --detach; bash "$CODE" "$P2/det" "$P2/k7" "$LX" "--held=$LX:$CB" > /dev/null 2>&1
check "P2-: a checkout on no branch says so" '[ "$(hk commits "$P2/k7")" = "NOT carried: the checkout is on no branch (detached HEAD)" ]'
# main dev: without --held the script is what it was, byte for byte in head.txt (the made= moment aside) and in the bundle decision
old_t1 remote/ckpt_code.sh > "$P2/old_code.sh"; same=1; i=0
for base in "$CB" "$CC" "$CS" "$LX" none ""; do i=$((i + 1))
  bash "$P2/old_code.sh" "$DK" "$P2/mo$i" $base > "$P2/mo$i.out" 2>&1; bash "$CODE" "$DK" "$P2/mn$i" $base > "$P2/mn$i.out" 2>&1
  [ "$(grep -v '^made=' "$P2/mo$i/head.txt")" = "$(grep -v '^made=' "$P2/mn$i/head.txt")" ] && [ -e "$P2/mo$i/commits.bundle" ] && x=1 || x=0; [ -e "$P2/mn$i/commits.bundle" ] && y=1 || y=0
  [ "$(grep -v '^made=' "$P2/mo$i/head.txt")" = "$(grep -v '^made=' "$P2/mn$i/head.txt")" ] && [ "$x" = "$y" ] && [ "$(sed "s#mo$i#X#; /^size=/d" "$P2/mo$i.out")" = "$(sed "s#mn$i#X#; /^size=/d" "$P2/mn$i.out")" ] || { same=0; echo "    differs for base [$base]"; }
done
check "P2, MAIN UNCHANGED: for six kinds of base a main unit's head.txt, bundle decision and printed lines equal the old script's" '[ "$same" = 1 ] && ! grep -q "^commits=" "$P2"/mn*/head.txt'
cat > "$P2/hrun.txt" <<'EOF'
hrun() { echo "HRUN [$*]" >> "$E8_DIR/hrun.log"; }
ckfail() { echo "CKFAIL"; exit 3; }
DEV2_L_REPO="$P2LAP"
EOF
export P2LAP="$P2/lap"; rm -f "$E8/hrun.log"
e8reset; e8 '. "$W/p2/hrun.txt"; CK_ENV=dev2; CK_CHECKOUT=C:/d2/apps/nirmaan_stack; REPO="$P2LAP"; make_code_ckpt B1'
e8reset; e8 '. "$W/p2/hrun.txt"; REPO="$P2LAP"; make_code_ckpt B1'
check "P2: the copy command hands the laptop's held commits over for a dev2 unit, and for main dev is exactly what it was (no extra argument)" '
  sed -n 1p "$E8/hrun.log" | grep -q "^HRUN \[ckpt_code.sh C:/d2/apps/nirmaan_stack .*/ckpt_out/T8/[0-9_]* $LX  --held=$LX:.*$CB" && sed -n 2p "$E8/hrun.log" | grep -qE "^HRUN \[ckpt_code.sh C:/Users/USER/Documents/frappe_docker/development/frappe-bench/apps/nirmaan_stack [^ ]*/ckpt_out/T8/[0-9_]* $LX \]$"'
D2P=C:/Users/USER/Documents/frappe_docker_dev2/development/frappe-bench/apps/nirmaan_stack
preset; rm -rf "$PW/state"; mkdir -p "$PW/state"; units "" "unit|dev2|$D2P|feature/h|cccc|kd1|2|h1:44444444:working:HEARTBEAT"
printf 'CHECKPOINT CODE u-dev2-feature-h: /x/u-dev2-feature-h/20261122_130000\n  commits NOT carried: no commit the laptop holds is known here and shared with feature/h\n' > "$PW/ck_out_u-dev2-feature-h"; prun; cp "$PW/hb.txt" "$PW/hb_nc.txt"
preset; units "" "unit|dev2|$D2P|feature/h|cccc|kd1|2|h1:44444444:working:HEARTBEAT"; echo "checkpoint not due: x" > "$PW/es_out"; prun; cp "$PW/hb.txt" "$PW/hb_nc2.txt"
preset; units "" "unit|dev2|$D2P|feature/h|cccc|kd2|2|h1:44444444:working:HEARTBEAT"; echo "CHECKPOINT CODE u-dev2-feature-h: /x/u-dev2-feature-h/20261122_131500" > "$PW/es_out"; prun
check "P2: the heartbeat's unit line says 'commits NOT carried: <reason>' - also on the next not-due run - until a copy carries them" '
  grep -q "^unit:  *u-dev2-feature-h .* this run: B1 OK | commits NOT carried: no commit the laptop holds is known here and shared with feature/h" "$PW/hb_nc.txt" && grep -q "B1 SKIP not due | commits NOT carried: no commit" "$PW/hb_nc2.txt" && ! grep -q "NOT carried" "$PW/hb.txt"'

echo "== 10. the resume note and 'tell' use the unit's own sessions folder (P3)"
S3="$W/s3"; MS="$S3/main/envsync/sessions"; DS="$S3/dev2/envsync/sessions"; mkdir -p "$MS" "$DS"
echo "HEARTBEAT main's own line" > "$MS/s1.status.md"; echo "main's resume text" > "$MS/s1.resume.md"
echo "HEARTBEAT dev2's own line" > "$DS/s1.status.md"; echo "dev2's resume text" > "$DS/s1.resume.md"
# dps stands for the desktop's PowerShell: it answers a Get-Content with the file the command names
cat > "$S3/dps.txt" <<'EOF'
dps() { local f; f=$(grep -o "Get-Content -LiteralPath '[^']*'" <<< "$1" | head -1 | sed "s/.*'\(.*\)'/\1/"); echo "DPS $1" >> "$E8_DIR/dps.log"; [ -f "$f" ] && cat "$f"; }
SCP_STUB() { echo "SCP $*" >> "$E8_DIR/dps.log"; }; SCP=SCP_STUB
D_BENCH="$S3D/main"; SDIR="$D_BENCH/envsync/sessions"; DEV2_D_CHECKOUT="$S3D/dev2/apps/nirmaan_stack"; NAME=s1; D_HEAD=0123456789; D_BRANCH=b
EOF
export S3D="$S3"
e8reset; e8 '. "$S3D/dps.txt"; CK_ENV=dev2; CK_CHECKOUT="$S3D/dev2/apps/nirmaan_stack"; resume_note "$S3D/n_dev2.md" B1; CK_ENV=main; CK_CHECKOUT="$S3D/main/apps/nirmaan_stack"; resume_note "$S3D/n_main.md" B1; CK_ENV=""; CK_CHECKOUT=""; resume_note "$S3D/n_none.md" B1'
check "P3+: a dev2 unit's resume note holds the dev2 session's own note and status" 'grep -q "dev2.s resume text" "$S3/n_dev2.md" && grep -q "dev2.s own line" "$S3/n_dev2.md"'
check "P3-: the note of a MAIN session with the same name is NOT shown for a dev2 unit (and the other way round)" '! grep -q "main.s" "$S3/n_dev2.md" && grep -q "main.s resume text" "$S3/n_main.md" && ! grep -q "dev2.s" "$S3/n_main.md" && grep -q "main.s own line" "$S3/n_none.md"'
e8reset; rm -f "$E8/dps.log"; e8 '. "$S3D/dps.txt"; CK_ENV=dev2; CK_CHECKOUT="$S3D/dev2/apps/nirmaan_stack"; tell_session hello; CK_ENV=""; CK_CHECKOUT=""; tell_session hello'
check "P3: tell writes into the dev2 sessions folder for a dev2 unit and into main's for main, nowhere else" '
  [ "$(grep -c "^SCP .*desktop:$DS/s1.msg_append.tmp$" "$E8/dps.log")" = 1 ] && [ "$(grep -c "^SCP .*desktop:$MS/s1.msg_append.tmp$" "$E8/dps.log")" = 1 ] && [ "$(grep -c "Add-Content -LiteralPath .$DS/s1.message.md" "$E8/dps.log")" = 1 ] && [ "$(grep -c "Add-Content -LiteralPath .$MS/s1.message.md" "$E8/dps.log")" = 1 ]'
e8reset; e8 'MS="$SDIR"; for p in "$D_BENCH/apps/nirmaan_stack" C:/Users/USER/Documents/wt_b ""; do CK_ENV=main; CK_CHECKOUT="$p"; [ "$(unit_sdir)" = "$MS" ] && echo main-same; done; CK_ENV=dev2; CK_CHECKOUT=C:/Users/USER/Documents/wt_dev2; echo "wt=$(unit_sdir)"; CK_CHECKOUT="$DEV2_D_CHECKOUT"; echo "root=$(unit_sdir)"'
check "P3, MAIN UNCHANGED: main's root, any main worktree and no checkout at all resolve to the folder they use today; a dev2 worktree uses the dev2 root's bench (as detect_units.ps1 does)" '
  [ "$(grep -c "^main-same$" "$E8/out")" = 3 ] && grep -q "^wt=C:/Users/USER/Documents/frappe_docker_dev2/development/frappe-bench/envsync/sessions$" "$E8/out" && grep -q "^root=C:/Users/USER/Documents/frappe_docker_dev2/development/frappe-bench/envsync/sessions$" "$E8/out"'

echo "== 11. 'leaving' pauses a dev2 session at a safe point and always releases it (P4)"
fresh() { preset; rm -rf "$PW/state"; mkdir -p "$PW/state"; : > "$PW/ops.md"; echo "LEAVING t" > "$PW/leaving.flag"; touch "$PW/leave_ok"; }
d2line() { echo "unit|dev2|$D2P|feature/h|cccc|kd1|2|h1:44444444:working:${1-HEARTBEAT}"; }
okd2() { echo "CHECKPOINT CODE u-dev2-feature-h: /x/u-dev2-feature-h/20261122_132000" > "$PW/ck_out_u-dev2-feature-h"; echo "$OKX" > "$PW/es_out"; }
lno() { grep -n -- "$1" "$PW/calls.log" | head -1 | cut -d: -f1; }
D2TELL="^env_sync tell --name h1 --text"
fresh; units "s1:11111111:working:HEARTBEAT" "$(d2line CHECKPOINT)"; okd2; POLLER_LEAVING_WAIT=3 prun
check "P4+: a working dev2 session is sent the same CHECKPOINT message, into ITS sessions folder (--checkout, --env dev2)" '[ "$(grep -c "$D2TELL CHECKPOINT 20.* | the owner is leaving --checkout $D2P --env dev2$" "$PW/calls.log")" = 1 ]'
check "P4+: at its safe point it is code-copied, then released with 'CHECKPOINT TAKEN <time> - carry on'; the heartbeat and the relay say it paused" '
  [ "$(grep -c "$D2TELL CHECKPOINT TAKEN 20[0-9-]* [0-9:]* - carry on --checkout $D2P --env dev2$" "$PW/calls.log")" = 1 ] && [ "$(lno "checkpoint-code --slice u-dev2-feature-h")" -lt "$(lno "$D2TELL CHECKPOINT TAKEN")" ] &&
  grep -q "^unit:  *u-dev2-feature-h .* this run: B1 OK | leaving: paused at its safe point: h1" "$PW/hb.txt" && grep -q "u-dev2-feature-h (dev2, feature/h; h1(working)): READY - code copied (paused at its safe point: h1)" "$PW/ops.md"'
fresh; units "s1:11111111:working:CHECKPOINT" "$(d2line)"; okd2; POLLER_LEAVING_WAIT=2 prun
check "P4, TIMED OUT: a dev2 session that never answers is copied as it stands AND STILL RELEASED (CHECKPOINT TAKEN ... carry on after the copy); the heartbeat says so" '
  [ "$(grep -c "$D2TELL CHECKPOINT TAKEN 20[0-9-]* [0-9:]* - carry on --checkout $D2P --env dev2$" "$PW/calls.log")" = 1 ] && [ "$(lno "checkpoint-code --slice u-dev2-feature-h")" -lt "$(lno "$D2TELL CHECKPOINT TAKEN")" ] &&
  grep -q "| this run: B1 OK | leaving: asked to pause: h1; 1 not at a safe point after [0-9]* s - copied as it stands" "$PW/hb.txt" && [[ "$(hb)" == *"u-dev2-feature-h: B1 OK"* ]] && [[ "$(hb)" != *"waiting for its safe point"* ]]'
check "P4, MAIN NEVER WAITS FOR dev2: main's own copy and its database checkpoint are made before a dev2 session that has not answered is waited for" '
  [ "$(lno "^env_sync checkpoint --slice u-main-feature-x --hold --name s1$")" -lt "$(lno "checkpoint-code --slice u-dev2-feature-h")" ] && grep -q "^detected:  *2 unit" "$PW/hb.txt"'
check "P4: the ONE database checkpoint stays main's; nothing of dev2's data or containers is named" '[ "$(grep -c "^env_sync checkpoint --slice" "$PW/calls.log")" = 1 ] && ! grep "^env_sync \(checkpoint\|catch-up\) " "$PW/calls.log" | grep -q dev2 && [ "$(calls "^docker")" = 0 ]'
fresh; units "" "$(d2line "")"; okd2; POLLER_LEAVING_WAIT=2 prun
check "P4-: a dev2 session without a status file is not asked (it would not answer); it is copied as it stands, as before" '[ "$(calls "$D2TELL")" = 0 ] && grep -q "u-dev2-feature-h (dev2, feature/h; h1(working)): READY - code copied as it stands (best effort)" "$PW/ops.md"'
fresh; units "" "$(d2line)"; okd2; POLLER_LEAVING_SKIP=h1 POLLER_LEAVING_WAIT=2 prun; n1=$(calls "$D2TELL"); fresh; units "" "$(d2line)"; okd2; POLLER_LEAVING_ONLY=other POLLER_LEAVING_WAIT=2 prun
check "P4-: the rehearsal switches (skip list, allow-list) keep a dev2 session from being asked too" '[ "$n1" = 0 ] && [ "$(calls "$D2TELL")" = 0 ]'
fresh; units "s1:11111111:working:HEARTBEAT" "$(d2line)"; okd2; POLLER_FAIL_UNIT=u-dev2-feature-h POLLER_LEAVING_WAIT=1 prun
check "P4: when the dev2 copy fails its session is released all the same (CHECKPOINT FAILED ... carry on)" '[ "$(grep -c "$D2TELL CHECKPOINT FAILED 20.* | the code copy failed | - carry on --checkout" "$PW/calls.log")" = 1 ] && grep -q "u-dev2-feature-h (dev2, .*): FAILED - " "$PW/ops.md"'
fresh; units "s1:11111111:working:HEARTBEAT" "unit|dev2|$D2P|feature/h|cccc|kd1|2|s1:44444444:working:CHECKPOINT"; okd2; POLLER_LEAVING_WAIT=1 prun
check "P4: a dev2 session with a main session's name never counts as that main session's safe point" 'tail -5 "$PW/poller.log" | grep -q "asked s1 to pause; 1 not at a safe point after"'
fresh; units "" "$(d2line)"; okd2; printf '#!/usr/bin/env bash\ncase "$1 $*" in "checkpoint-code "*dev2*) sleep 4;; esac\nexec "$PW_REAL" "$@"\n' > "$PW/bin/env_sync_slow"; chmod +x "$PW/bin/env_sync_slow"
( PW_REAL="$PW/bin/env_sync" PW_DIR="$PW" PW_LOG="$PW/calls.log" POLLER_STATE="$PW/state" POLLER_HEARTBEAT="$PW/hb.txt" POLLER_LOG="$PW/poller.log" POLLER_ENV_SYNC="$PW/bin/env_sync_slow" POLLER_LOCATION=away POLLER_LEAVING_WAIT=0 POLLER_OPS_RELAY="$PW/ops.md" ENV_SYNC_LEAVING_FLAG="$PW/leaving.flag" ENV_SYNC_PULL_RECORD="$PW/pull_record" ENV_SYNC_PENDING_ROOT="$PW/pending" ENV_SYNC_TURN_FILE="$PW/turn.txt" ENV_SYNC_RELAY_ROOT="$PW/relay" exec bash "$SRC/poller_run.sh" ) > /dev/null 2>&1 &
pp=$!; for _ in 1 2 3 4 5 6 7 8 9 10; do sleep 1; [ "$(calls "$D2TELL CHECKPOINT 20")" = 1 ] && break; done; sleep 1; kill -TERM "$pp" 2>/dev/null; wait "$pp" 2>/dev/null; sleep 5      # the stub's own copy call ends before the next case
check "P4: a copier that is ended part-way releases the dev2 session it had asked (and gives its lock back)" '[ "$(grep -c "$D2TELL CHECKPOINT \(FAILED\|TAKEN\) 20.* - carry on --checkout" "$PW/calls.log")" = 1 ] && [ ! -d "$PW/state/lock" ]'
# main dev: the copier's calls, heartbeat and relay are what the old copier's were
OP="$W/oldpoll/scripts/env_sync"; mkdir -p "$OP"; old_t1 poller_run.sh > "$OP/poller_run.sh"; same=1
norm() { sed -E '/^last good B1:/d; s/20[0-9]{2}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?/T/g; s/took [0-9]+ s/took N s/g; s/after [0-9]+ s/after N s/g' "$@"; }
mcase() {   # mcase <label>: the case's files are set up by $1's function; run with the old and with the new copier
  local lab="$1" v; for v in old new; do
    "$lab"; if [ "$v" = old ]; then ( SRC="$OP"; prun ); else prun; fi
    norm "$PW/calls.log" > "$W/mc_$v.calls"; norm "$PW/hb.txt" > "$W/mc_$v.hb"; norm "$PW/ops.md" > "$W/mc_$v.ops"
  done
  for v in calls hb ops; do cmp -s "$W/mc_old.$v" "$W/mc_new.$v" || { same=0; echo "    $lab: $v differs"; diff "$W/mc_old.$v" "$W/mc_new.$v" | head -5; }; done
}
quiet() { fresh; rm -f "$PW/leaving.flag"; }
mc_idle() { quiet; units ""; }
mc_due() { quiet; units "s1:11111111:working:HEARTBEAT,misc:22222222:working:HEARTBEAT" "$W2"; echo "$OKX" > "$PW/es_out"; }
mc_leave() { fresh; units "s1:11111111:working:HEARTBEAT,other:55555555:working:" "$W2"; echo "$OKX" > "$PW/es_out"; }
mc_leave_safe() { fresh; units "s1:11111111:working:CHECKPOINT,misc:22222222:working:CHECKPOINT"; echo "$OKX" > "$PW/es_out"; }
mc_leave_dbfail() { fresh; rm -f "$PW/leave_ok"; units "s1:11111111:working:HEARTBEAT"; echo "$OKX" > "$PW/es_out"; }
mc_leave_fail() { fresh; rm -f "$PW/leave_ok"; units "s1:11111111:working:HEARTBEAT"; }
mc_dev2_due() { quiet; DEV2UP=4 units "s1:11111111:working:HEARTBEAT" "$(d2line)"; okd2; }
mc_offline() { quiet; }
POLLER_LEAVING_WAIT=2; export POLLER_LEAVING_WAIT
for c in mc_idle mc_due mc_leave mc_leave_safe mc_leave_dbfail mc_leave_fail mc_dev2_due mc_offline; do mcase "$c"; done
unset POLLER_LEAVING_WAIT
check "P4, MAIN UNCHANGED: in eight cases (idle, two units due, leaving unanswered / answered / no database copy / failed, dev2 due and not leaving, offline) the copier's calls, heartbeat and relay equal the old copier's" '[ "$same" = 1 ]'
e8reset; e8 'hrun() { printf "branch=b\ncommit=0123456789ab\nparent=1\ntree=2\n"; }; pull_backup() { PB_PREFIX=x/y; }; fp_of() { echo fp; }; make_code_ckpt() { CK_DIR="$E8_DIR/nock"; return 0; }; tell_session() { echo "TOLD $NAME: $1"; }; hold_copy() { exit 0; }; HOLD=1; NAME=s1; ALSO_TELL="misc third"; SLICE=T8; cmd_checkpoint'
check "P4, MAIN TIMED OUT: main's checkpoint releases EVERY name the copier asked, paused or not, exactly as today (TAKEN ... carry on to each)" '[ "$(grep -c "^TOLD \(s1\|misc\|third\): CHECKPOINT TAKEN 20.* | carry on$" "$E8/out")" = 3 ]'

echo "== 12. the laptop side knows two lanes (P5a - P5c)"
D2ENV='FRAPPE_C=frappe_dev2-frappe-1; ENV_NAME=dev2; LAPTOP_CONTAINERS="frappe_dev2-postgresql-1 frappe_dev2-frappe-1"'
e8reset; touch "$E8/engine_up" "$E8/containers_off"; e8 "$D2ENV"'; laptop_up; cat "$TURN_FILE"; laptop_down; cat "$TURN_FILE"'
check "P5a+: a dev2 command claims the turn file as 'dev2 <slice> <time>', starts dev2's own list and frees the file after" '
  grep -q "^dev2 T8 20" "$E8/out" && grep -q "^free 20" "$E8/out" && grep -q "^docker start frappe_dev2-postgresql-1$" "$E8/log" && grep -q "^docker start frappe_dev2-frappe-1$" "$E8/log" && ! grep -q "frappe_docker_devcontainer" "$E8/log"'
e8reset; touch "$E8/engine_up"; echo "main SR-9 MASTER 2026-11-22 10:00:00" > "$E8/turn.txt"; e8 "$D2ENV"'; laptop_up; echo not-reached'
check "P5a-: a dev2 command never overwrites main's line: it refuses, names the holder, starts nothing" '! grep -q not-reached "$E8/out" && grep -q "the laptop turn file says .main SR-9 MASTER 2026-11-22 10:00:00.; wait until it is free" "$E8/out" && [ "$(cat "$E8/turn.txt")" = "main SR-9 MASTER 2026-11-22 10:00:00" ] && [ "$(n8 "^docker start")" = 0 ]'
e8reset; touch "$E8/engine_up"; echo "dev2 BCS-1 2026-11-22 10:00:00" > "$E8/turn.txt"; e8 'laptop_up; echo not-reached'
check "P5a-: and the reverse: a main command refuses while dev2 holds it, naming the holder; the file is unchanged" '! grep -q not-reached "$E8/out" && grep -q "the laptop turn file says .dev2 BCS-1 2026-11-22 10:00:00.; wait until it is free" "$E8/out" && [ "$(cat "$E8/turn.txt")" = "dev2 BCS-1 2026-11-22 10:00:00" ] && [ "$(n8 "^docker start")" = 0 ]'
e8reset; touch "$E8/engine_up" "$E8/containers_off"; e8 'laptop_up; cat "$TURN_FILE"; laptop_down'; cp "$E8/out" "$E8/o_main"; cp "$E8/log" "$E8/l_main"
e8reset; touch "$E8/engine_up"; echo "main T8 2026-11-22 10:00:00" > "$E8/turn.txt"; e8 'laptop_up; echo "ours=$LAPTOP_TURN_OURS"; cat "$TURN_FILE"; laptop_down'
check "P5a, MAIN UNCHANGED: main still writes 'main <slice> <time>', starts its four containers, and keeps a line that is already main's" '
  grep -q "^main T8 20" "$E8/o_main" && [ "$(grep -c "^docker start frappe_docker_devcontainer-" "$E8/l_main")" = 4 ] && grep -q "^ours=0$" "$E8/out" && grep -q "^main T8 2026-11-22 10:00:00$" "$E8/turn.txt"'
e8reset; touch "$E8/engine_up"; e8 'FRAPPE_C=frappe_dev2-frappe-1; ENV_NAME=dev2; LAPTOP_CONTAINERS=""; laptop_up; echo not-reached'
check "P5b-: a dev2 command with no container list refuses, names the missing setting, starts nothing and does not touch the turn file" '
  ! grep -q not-reached "$E8/out" && grep -q "no laptop containers are configured for dev2: nothing was started" "$E8/out" && grep -q "Set ENV_SYNC_LAPTOP_CONTAINERS in the .claude/state/env.local" "$E8/out" && [ "$(n8 "^docker")" = 0 ] && grep -q "^free 2026-11-19 00:00:00$" "$E8/turn.txt"'
e8reset; touch "$E8/engine_up"; e8 'CK_ENV=dev2; laptop_up; echo not-reached'
check "P5b-: --env dev2 from MAIN's checkout never starts main's containers either" '! grep -q not-reached "$E8/out" && grep -q "no laptop containers are configured for dev2" "$E8/out" && ! grep -q "frappe_docker_devcontainer" "$E8/log" && [ "$(n8 "^docker start")" = 0 ]'
e8reset; touch "$E8/engine_up"; LOC=office e8 'ENV_NAME=dev2; LAPTOP_CONTAINERS=""; pull_backup() { echo PULL_BACKUP_CALLED; }; YES=1; cmd_db_pull; echo not-reached'
check "P5b-: a dev2 db-pull that would load refuses BEFORE the desktop makes a backup for it" '! grep -q "PULL_BACKUP_CALLED\|not-reached" "$E8/out" && grep -q "no laptop containers are configured for dev2" "$E8/out"'
# the resolution itself, from the settings a checkout carries (env.local), and what `print` shows
pr() { ( unset ENV_SYNC_LAPTOP_CONTAINERS ENV_SYNC_FRAPPE_CONTAINER ENV_SYNC_PG_CONTAINER; eval "${1:-:}"; . "$NEW"; cmd_print ) 2>&1; }
PM=$(pr); PD=$(pr 'export ENV_SYNC_FRAPPE_CONTAINER=frappe_dev2-frappe-1'); PO=$(pr 'export ENV_SYNC_FRAPPE_CONTAINER=frappe_dev2-frappe-1 ENV_SYNC_LAPTOP_CONTAINERS="frappe_dev2-postgresql-1 frappe_dev2-frappe-1"')
check "P5c: print shows the environment and the container list: main with its four, dev2 with its own override (R4), dev2 without one NOT SET" '
  grep -q "^  environment  *main$" <<< "$PM" && grep -q "^  laptop containers  *frappe_docker_devcontainer-postgresql-1 frappe_docker_devcontainer-redis-cache-1 frappe_docker_devcontainer-redis-queue-1 frappe_docker_devcontainer-frappe-1$" <<< "$PM" &&
  grep -q "^  environment  *dev2$" <<< "$PD" && grep -q "^  laptop containers  *NOT SET - a command that needs" <<< "$PD" && ! grep "laptop containers" <<< "$PD" | grep -q devcontainer && grep -q "^  laptop containers  *frappe_dev2-postgresql-1 frappe_dev2-frappe-1$" <<< "$PO"'
DD="$W/Documents/frappe_docker_dev2/development/frappe-bench/apps/nirmaan_stack/scripts/env_sync"; mkdir -p "$DD"; cp "$NEW" "$DD/env_sync.sh"
PX=$( ( unset ENV_SYNC_LAPTOP_CONTAINERS ENV_SYNC_FRAPPE_CONTAINER; . "$DD/env_sync.sh"; cmd_print ) 2>&1 )
check "P5b: a dev2 checkout whose env.local is missing still counts as dev2 (its path), so it can never start main's containers by default" 'grep -q "^  environment  *dev2$" <<< "$PX" && grep -q "^  laptop containers  *NOT SET" <<< "$PX"'
check "P5: the takeover's own line is unchanged (main <slice> MASTER)" 'grep -q "echo \"main \$SLICE MASTER \$(date .+%F %T.)\" > \"\$TURN_FILE\"" "$SRC/env_sync.sh"'

echo "== 13. a CODE-ONLY resume of a dev2 unit (P5d)"
R5="$W/r5"; mkdir -p "$R5/root/u-dev2-feature-d2" "$R5/root/u-main-x/20261122_100000"
git clone -q --branch main "$DK" "$R5/dev2" 2>/dev/null; G "$R5/dev2" checkout -q -B feature/d2 "$CB"
bash "$CODE" "$DK" "$R5/root/u-dev2-feature-d2/20261122_120000" "$CB" "--held=$CB" > /dev/null 2>&1; printf '# RESUME NOTE - dev2\n' > "$R5/root/u-dev2-feature-d2/20261122_120000/resume.md"
printf 'env=dev2\nbranch=feature/d2\n' > "$R5/root/u-dev2-feature-d2/unit.txt"; printf 'env=main\nbranch=x\n' > "$R5/root/u-main-x/unit.txt"
export R5D="$R5"; R5P='CKPT_ROOT="$R5D/root"; DEV2_L_REPO="$R5D/dev2"; SLICE=u-dev2-feature-d2; CODE_ONLY=1; HERE="$SRC"; unset STAGED'
r5state() { echo "$(G "$R5/dev2" rev-parse HEAD) $(G "$R5/dev2" status --porcelain | sha256sum)"; }
b4=$(r5state); e8reset; e8 "$R5P"'; DRY_RUN=1; cmd_resume_code; echo "rc=$?"'
check "P5d+: --dry-run rebuilds the newest copy on a throw-away clone (tree equal); the laptop's dev2 checkout is unchanged" 'grep -q "^DRY RUN OK: rebuilt on a throw-away clone, tree equals" "$E8/out" && grep -q "^rc=0$" "$E8/out" && [ "$(r5state)" = "$b4" ]'
check "P5d: no container, no data, no turn file, no staging - not one docker, wsl or scp call" '[ "$(n8 "^docker")" = 0 ] && [ "$(n8 "^wsl")" = 0 ] && [ "$(n8 "^scp")" = 0 ] && grep -q "^free 2026-11-19 00:00:00$" "$E8/turn.txt"'
e8reset; e8 "$R5P"'; cmd_resume_code; echo "rc=$?"'
check "P5d-: without --dry-run or --yes it only reports" 'grep -q "^nothing done: add --dry-run to rehearse, or --yes on the owner.s word" "$E8/out" && [ "$(r5state)" = "$b4" ]'
echo mine >> "$R5/dev2/b"; e8reset; e8 "$R5P"'; YES=1; cmd_resume_code; echo not-reached'; c1=$(grep -c "has uncommitted tracked changes; nothing changed" "$E8/out"); n1=$(grep -c not-reached "$E8/out"); m1=$(tail -1 "$R5/dev2/b"); G "$R5/dev2" checkout -q -- b
check "P5d-: refuses over uncommitted tracked changes (they stay)" '[ "$c1" = 1 ] && [ "$n1" = 0 ] && [ "$m1" = mine ] && [ "$(G "$R5/dev2" rev-parse HEAD)" = "$CB" ]'
G "$R5/dev2" checkout -q -b other; e8reset; e8 "$R5P"'; YES=1; cmd_resume_code; echo not-reached'; c1=$(grep -c "is on other, the copy is of feature/d2; nothing changed" "$E8/out"); n1=$(grep -c not-reached "$E8/out"); G "$R5/dev2" checkout -q feature/d2
check "P5d-: refuses on another branch" '[ "$c1" = 1 ] && [ "$n1" = 0 ]'
e8reset; e8 "$R5P"'; SLICE=u-main-x; YES=1; cmd_resume_code; echo not-reached'; check "P5d-: refuses for a main unit (main's takeover is its own command)" '! grep -q not-reached "$E8/out" && grep -q "code-only is for a dev2 unit; u-main-x is a main unit" "$E8/out"'
e8reset; e8 "$R5P"'; desktop_alive() { echo up; return 0; }; YES=1; cmd_resume_code; echo not-reached'
check "P5d-: --yes refuses while the desktop answers (work continues there)" '! grep -q not-reached "$E8/out" && grep -q "refusing: the desktop answers" "$E8/out" && [ "$(r5state)" = "$b4" ]'
e8reset; e8 "$R5P"'; desktop_alive() { return 1; }; YES=1; cmd_resume_code; echo "rc=$?"'
check "P5d+: --yes with the desktop down puts the dev2 checkout at the copy (its commits and its uncommitted work), code only" '
  grep -q "^RESUMED-ON-LAPTOP (CODE ONLY) u-dev2-feature-d2 " "$E8/out" && grep -q "^rc=0$" "$E8/out" && [ "$(G "$R5/dev2" rev-parse HEAD)" = "$CC" ] && [ "$(tail -1 "$R5/dev2/a")" = wip ] && [ "$(n8 "^docker")" = 0 ] && grep -q "^free 2026-11-19" "$E8/turn.txt" && [ ! -e "$W/after/master.txt" ]'
check "the help names the code-only resume" 'grep -q -- "--code-only \[--dry-run | --yes\]" <<< "$H"'

echo "== 14. one backup at a time (P6) and no password on a command line (P6b)"
BK="$W/bk"; mkdir -p "$BK/env/bin" "$BK/bin"
# the stub backup: three small files with the names Frappe gives them; slow or failing as the case asks
cat > "$BK/env/bin/python" <<'EOF'
#!/usr/bin/env bash
echo "python $*" >> "$BKD/calls.log"
all="$*"; d="${all##*--backup-path }"; site=$(sed 's/.*--site \([^ ]*\) .*/\1/' <<< "$all"); st=$(date +%Y%m%d_%H%M%S)
for _ in $(seq 1 "$(cat "$BKD/slow" 2>/dev/null || echo 0)"); do sleep 1; done
if [ -f "$BKD/fail" ]; then echo "pg_dump: error: stub failure"; exit 1; fi
for n in database.sql.gz files.tar private-files.tar; do echo "$n" > "$d/$st-$site-$n"; done
echo "Backup for Site $site has been successfully completed with files"
EOF
printf '#!/usr/bin/env bash\nexec "$BKD/env/bin/python" "$@"\n' > "$BK/bin/bench"; chmod +x "$BK/env/bin/python" "$BK/bin/bench"; export BKD="$BK"
BL="$SRC/remote/backup_local.sh"; LK="$BK/envsync/backups/.backup.lock"
bk() { ( export ENV_SYNC_BENCH="$BK" ENV_SYNC_BACKUP_LOCK_STEP=1 ENV_SYNC_BACKUP_LOCK_WAIT="${BWAIT:-30}" ENV_SYNC_BACKUP_LOCK_NAMELESS="${BNAME:-2}"; exec bash "$BL" "${1:-3}" ); }
bkreset() { rm -rf "$BK/envsync"; rm -f "$BK/slow" "$BK/fail" "$BK/calls.log"; }
lpid() { sed -n 's/^pid=\([0-9]*\) .*/\1/p' "$1" 2>/dev/null; }      # the script that holds the lock
left() { local d k=0; for d in /proc/[0-9]*; do case "$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)" in *"backup-path $BK/"*) k=$((k + 1));; esac; done; echo "$k"; }   # THIS test's backups still running
gone() { local i; for i in 1 2 3 4 5 6 7 8; do [ -e "$LK" ] || return 0; sleep 1; done; return 1; }
shape() { sed -E 's/[0-9]{8}_[0-9]{6}/S/g; s/took=[0-9]+/took=N/' "$1"; }
bkreset; bk > "$BK/o1" 2>&1; r1=$?; ( cd "$BK/envsync" && find . -type f | sed -E 's/[0-9]{8}_[0-9]{6}/S/g' | sort ) > "$BK/f1"
old_t1 remote/backup_local.sh > "$BK/old_bl.sh"; bkreset; ( cd "$BK" && PATH="$BK/bin:$PATH" bash "$BK/old_bl.sh" 3 ) > "$BK/o0" 2> "$BK/e0"; r0=$?; ( cd "$BK/envsync" && find . -type f | sed -E 's/[0-9]{8}_[0-9]{6}/S/g' | sort ) > "$BK/f0"
check "P6, MAIN UNCHANGED: with no second caller the files, their names, the printed lines and the exit code equal the old script's; the lock is gone" '
  [ "$r1" = 0 ] && [ "$r0" = 0 ] && cmp -s <(shape "$BK/o0") <(shape "$BK/o1") && cmp -s "$BK/f0" "$BK/f1" && [ "$(wc -l < "$BK/f1")" = 3 ] && [ ! -e "$LK" ] && grep -q "^prefix=../envsync/backups/S/S-localhost$" <(shape "$BK/o1")'
bkreset; for s in 20260101_000000 20260102_000000 20260103_000000; do mkdir -p "$BK/envsync/backups/$s"; done; bk 3 > "$BK/o1" 2>&1
check "P6, MAIN UNCHANGED: retention is as before - the newest 3 are kept, the oldest removed by name and said" 'grep -q "^pruned=envsync/backups/20260101_000000$" "$BK/o1" && [ ! -d "$BK/envsync/backups/20260101_000000" ] && [ -d "$BK/envsync/backups/20260102_000000" ]'
bkreset; echo 4 > "$BK/slow"; bk > "$BK/oa" 2>&1 & a=$!; sleep 1; t0=$(date +%s); bk > "$BK/ob" 2>&1; rb=$?; took=$(( $(date +%s) - t0 )); wait "$a"; ra=$?
check "P6+ TWO CALLERS: the second waits for the first, then makes its own backup; both end well and no lock is left" '[ "$ra" = 0 ] && [ "$rb" = 0 ] && [ "$took" -ge 5 ] && [ "$(ls -d "$BK/envsync/backups"/20* | wc -l)" = 2 ] && grep -q "^lock=waited [0-9]* s for another backup" "$BK/ob" && ! grep -q "^lock=" "$BK/oa" && [ ! -e "$LK" ]'
bkreset; echo 8 > "$BK/slow"; bk > "$BK/oa" 2>&1 & a=$!; sleep 1; BWAIT=2 bk > "$BK/ob" 2>&1; rb=$?; nl=$(cat "$LK" 2>/dev/null | wc -l); wait "$a"; ra=$?
check "P6-: past the limit the second caller fails with a plain line and makes nothing; the LIVE lock was never cleared and the first ends well" '[ "$rb" = 1 ] && grep -q "^error=another backup of this site is still running after 2 s (pid=[0-9]* .*); nothing was backed up" "$BK/ob" && ! grep -q "^prefix=" "$BK/ob" && [ "$nl" = 1 ] && [ "$ra" = 0 ] && [ "$(ls -d "$BK/envsync/backups"/20* | wc -l)" = 1 ]'
bkreset; mkdir -p "$BK/envsync/backups"; echo "pid=999999 start=1 host=$(hostname) site=localhost since=x" > "$LK"; t0=$(date +%s); bk > "$BK/o1" 2>&1; r1=$?; took=$(( $(date +%s) - t0 ))
check "P6 STALE LOCK (its process gone): cleared at once with a logged line - never silently, never waited on" '[ "$r1" = 0 ] && [ "$took" -lt 12 ] && grep -q "^lock=cleared a stale lock: its backup is not running any more (pid=999999 " "$BK/o1" && grep -q "cleared a stale lock" "$BK/envsync/backups/backup_lock.log" && [ ! -e "$LK" ] && grep -q "^prefix=" "$BK/o1"'
bkreset; mkdir -p "$BK/envsync/backups"; echo "pid=$$ start=1 host=$(hostname) site=localhost since=x" > "$LK"; bk > "$BK/o1" 2>&1; r1=$?; mkdir -p "$BK/envsync/backups"; echo "pid=$$ start=$(sed 's/.*) //' /proc/$$/stat | cut -d' ' -f20) host=another-container site=localhost since=x" > "$LK"; bk > "$BK/o2" 2>&1; r2=$?
check "P6 STALE LOCK: a process number that now belongs to another process, or a container made anew, counts as gone too" '[ "$r1" = 0 ] && [ "$r2" = 0 ] && grep -q "^lock=cleared a stale lock" "$BK/o1" && grep -q "^lock=cleared a stale lock" "$BK/o2"'
bkreset; mkdir -p "$BK/envsync/backups"; : > "$LK"; t0=$(date +%s); BNAME=3 bk > "$BK/o1" 2>&1; r1=$?; took=$(( $(date +%s) - t0 ))
check "P6 STALE LOCK: one that names no process is cleared after its short limit (15 s; 3 s in this test), not before" '[ "$r1" = 0 ] && [ "$took" -ge 3 ] && [ "$took" -lt 15 ] && grep -q "named no process" "$BK/o1"'
bkreset; touch "$BK/fail"; bk > "$BK/o1" 2>&1; r1=$?
check "P6: after a FAILED backup the exit code and the error text are as before and the lock is gone" '[ "$r1" = 1 ] && grep -q "pg_dump: error: stub failure" "$BK/o1" && ! grep -q "^prefix=" "$BK/o1" && [ ! -e "$LK" ]'
bkreset; echo 30 > "$BK/slow"; bk > "$BK/o1" 2>&1 & a=$!; sleep 3; h1=$([ -e "$LK" ] && echo held); kill -TERM "$(lpid "$LK")"; wait "$a" 2>/dev/null; r1=$?; gone; g1=$?; sleep 1; p1=$(left)
check "P6: after a KILLED backup (ended) the lock is gone and the backup it had started is ended with it" '[ "$h1" = held ] && [ "$r1" != 0 ] && [ "$g1" = 0 ] && [ "$p1" = 0 ]'
bkreset; echo 30 > "$BK/slow"; bk > "$BK/o1" 2>&1 & a=$!; sleep 3; h1=$([ -e "$LK" ] && echo held); kill -KILL "$(lpid "$LK")"; wait "$a" 2>/dev/null; gone; g1=$?; sleep 2; p1=$(left)
check "P6: after a KILLED backup (killed outright, no clean-up can run in it) the watcher ends the backup and removes the lock" '[ "$h1" = held ] && [ "$g1" = 0 ] && [ "$p1" = 0 ]'
check "P6: env_sync shows the lock's lines of a desktop backup" 'grep -q "grep .\^lock=. <<< \"\$out\" | sed .s/\^lock=/desktop: backup lock: /." "$SRC/env_sync.sh"'
check "P6: the parallel test runner still sees our backup running (its busy rule names envsync.*backup)" 'grep -qE "pg_dump\|envsync\.\*backup" "$REPO/scripts/run_tests_parallel.py" && grep -q "backup_site.py" "$BL"'

# P6b: the real backup_site.py against a stand-in Frappe (its postgres get_command and shell call copied), with a DUMMY secret.
PYX=$(command -v python3 || command -v python || true)
if [ -n "$PYX" ] && command -v powershell.exe > /dev/null 2>&1 && "$PYX" -c 'import sys' > /dev/null 2>&1; then
  FB="$W/fb"; mkdir -p "$FB/sites" "$FB/py/frappe/utils" "$FB/env/bin" "$FB/bin"
  cat > "$FB/py/frappe/__init__.py" <<'EOF'
class _Conf:
	db_type = "postgres"
conf = _Conf()
EOF
  cat > "$FB/py/frappe/database.py" <<'EOF'
import os
def get_command(host=None, port=None, user=None, password=None, db_name=None, extra=None, dump=False, socket=None):
	if password:
		conn_string = f"postgresql://{user}:{password}@{host}:{port}/{db_name}"
	else:
		conn_string = f"postgresql://{user}@{host}:{port}/{db_name}"
	return os.environ["STUB_PGDUMP"], [conn_string, *(extra or [])], "pg_dump"
EOF
  : > "$FB/py/frappe/utils/__init__.py"
  cat > "$FB/py/frappe/utils/bench_helper.py" <<'EOF'
import os, shlex, subprocess, sys
def main():
	from frappe.database import get_command
	a = sys.argv
	path, site = a[a.index("--backup-path") + 1], a[a.index("--site") + 1]
	print("ARGV " + " ".join(a[1:4]))
	out = os.path.join(path, "20261122_120000-" + site)
	b, args, _ = get_command(host="db", port=5432, user="u1", password=os.environ["STUB_SECRET_FILE"] and open(os.environ["STUB_SECRET_FILE"]).read().strip(), db_name="u1", extra=[], dump=True)
	cmd = " ".join(["set -o pipefail;", shlex.quote(b), shlex.join(args), "|", "gzip", ">>", shlex.quote(out + "-database.sql.gz")])
	rc = subprocess.run([os.environ["STUB_BASH"], "-c", cmd]).returncode
	if rc:
		print("Backup failed for Site " + site); sys.exit(1)
	for n in ("files.tar", "private-files.tar"):
		open(out + "-" + n, "w").write("x")
EOF
  cat > "$FB/bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
if [ "${PGPASSWORD:-}" = "$(cat "$STUB_SECRET_FILE")" ]; then echo given > "$STUB_OUT/env_seen"; else echo absent > "$STUB_OUT/env_seen"; fi
powershell.exe -NoProfile -Command "\$s = (Get-Content -LiteralPath '$(cygpath -w "$STUB_SECRET_FILE")'); \$c = @(Get-CimInstance Win32_Process | ForEach-Object { \$_.CommandLine } | Where-Object { \$_ }); 'all=' + \$c.Count; 'ours=' + @(\$c | Where-Object { \$_.Contains('db:5432/u1') }).Count; 'secret=' + @(\$c | Where-Object { \$_.Contains(\$s) }).Count" 2>/dev/null | tr -d '\r' > "$STUB_OUT/ps.txt"
[ -f "$STUB_OUT/hang" ] && sleep 12
[ -f "$STUB_OUT/fail" ] && { echo "pg_dump: error: stub" >&2; exit 1; }
echo dump
EOF
  printf '#!/usr/bin/env bash\n[ "$1" = -I ] && shift\nexport PYTHONPATH="$(cygpath -w "$FBD/py")"\nexec "$FBPY" "$@"\n' > "$FB/env/bin/python"; chmod +x "$FB/bin/pg_dump" "$FB/env/bin/python"
  SEC="dummy$RANDOM$RANDOM"; mkdir -p "$W/fbout"; printf '%s' "$SEC" > "$W/fbsecret"
  fb() { ( export FBD="$FB" FBPY="$PYX" ENV_SYNC_BENCH="$FB" STUB_OUT="$W/fbout" STUB_SECRET_FILE="$W/fbsecret" STUB_PGDUMP="$FB/bin/pg_dump" STUB_BASH="$(cygpath -w "$(command -v bash)")"; exec bash "$BL" 3 ); }
  fbreset() { rm -rf "$FB/envsync" "$W/fbout"; mkdir -p "$W/fbout"; }
  hps() { sed -n "s/^$1=//p" "$W/fbout/ps.txt"; }
  fbreset; fb > "$FB/o1" 2>&1; r1=$?
  check "P6b+: while the backup runs, no process's command line holds the (dummy) secret; pg_dump got it in its environment" '[ "$(cat "$W/fbout/env_seen")" = given ] && [ "$(hps all)" -gt 20 ] && [ "$(hps ours)" -gt 0 ] && [ "$(hps secret)" = 0 ]'
  check "P6b: the helper passes the same arguments on to Frappe; the files, their names and the exit code are a backup's" '[ "$r1" = 0 ] && [ "$(ls "$FB"/envsync/backups/20*/ | sort | tr "\n" " ")" = "20261122_120000-localhost-database.sql.gz 20261122_120000-localhost-files.tar 20261122_120000-localhost-private-files.tar " ] && grep -q "^prefix=../envsync/backups/[0-9_]*/20261122_120000-localhost$" "$FB/o1"'
  ( export PYTHONPATH="$(cygpath -w "$FB/py")" STUB_OUT="$W/fbout" STUB_SECRET_FILE="$W/fbsecret" STUB_PGDUMP="$FB/bin/pg_dump" STUB_BASH="$(cygpath -w "$(command -v bash)")"; cd "$FB/sites"; mkdir -p "$W/fbctl"; "$PYX" -c 'import sys; from frappe.utils import bench_helper; sys.argv = ["bench", "frappe", "--site", "localhost", "backup", "--with-files", "--backup-path", sys.argv[1]]; bench_helper.main()' "$(cygpath -w "$W/fbctl")" ) > /dev/null 2>&1
  check "P6b-: the same reading WITHOUT the helper does show the (dummy) secret - the check can fail" '[ "$(hps secret)" -gt 0 ] && [ "$(cat "$W/fbout/env_seen")" = absent ]'
  fbreset; touch "$W/fbout/fail"; fb > "$FB/o2" 2>&1; r2=$?; l2=$(grep -c "$SEC" "$FB/o2"); k2=$(grep -rl "$SEC" "$FB" "$W/fbout" 2>/dev/null | wc -l)
  check "P6b: a FAILED run prints no secret and leaves no file that holds it" '[ "$r2" = 1 ] && [ "$l2" = 0 ] && [ "$k2" = 0 ]'
  fbreset; touch "$W/fbout/hang"; fb > "$FB/o3" 2>&1 & a=$!; for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 1; [ -s "$W/fbout/ps.txt" ] && break; done; kill -KILL "$(lpid "$FB/envsync/backups/.backup.lock")"; wait "$a" 2>/dev/null; sleep 6; k3=$(grep -rl "$SEC" "$FB" "$W/fbout" 2>/dev/null | wc -l)
  sleep 8      # Windows only: a program python.exe started is not in Git Bash's process tree and ends by itself
  check "P6b: a KILLED run leaves no file that holds the secret, and no lock" '[ "$k3" = 0 ] && [ ! -e "$FB/envsync/backups/.backup.lock" ] && ! grep -q "$SEC" "$FB/o3"'
else
  echo "skip the P6b process-list checks: no python or powershell.exe here"
fi
check "P6b: no remote script runs 'bench ... backup' itself any more (Frappe would put the password on pg_dump's command line); both backup scripts use the helper" '
  ! grep -nE "bench .*backup" "$SRC"/remote/*.sh | grep -vE "^[^:]*:[0-9]*: *#" | grep -q . && grep -q "backup_site.py" "$SRC/remote/backup.sh" && grep -q "backup_site.py" "$SRC/remote/backup_local.sh"'
check "P6b: no env_sync script but backup_site.py reads or writes the password, and none writes a connection string" '! grep -nE "postgres(ql)?://|PGPASSWORD|db_password" "$SRC"/*.sh "$SRC"/remote/*.sh "$SRC"/desktop/* "$SRC"/laptop/* | grep -v "^[^:]*:[0-9]*: *#" | grep -q .'

echo "== 15. only a script that differs is re-copied to the desktop (F-1)"
# ensure_stage itself. The "desktop" is a folder: ssh's PowerShell command runs in the local powershell.exe against it (so the
# real command text is tested), scp is a stub that logs and copies - and, as Windows does for a script that is being run,
# refuses to overwrite a file named in held.txt.
if command -v powershell.exe > /dev/null 2>&1; then
  S15="$W/s15"; mkdir -p "$S15/lap"; cp -r "$SRC" "$S15/src"; export S15
  cat > "$S15/scp" <<'EOF'
#!/usr/bin/env bash
echo "scp $*" >> "$S15/scp.log"
while [ $# -gt 0 ]; do case "$1" in -q) shift;; -o) shift 2;; *) break;; esac; done
dst="${@: -1}"; dst="$(cygpath -u "${dst#desktop:}")"; rc=0
for f in "${@:1:$#-1}"; do
  if grep -qx "$(basename "$f")" "$S15/held.txt" 2>/dev/null; then echo "dest open \"$dst\": Failure" >&2; rc=1; else cp "$f" "$dst" || rc=1; fi
done
exit $rc
EOF
  chmod +x "$S15/scp"
  P15='D_BENCH="$(cygpath -m "$S15/desk")"; SDIR="$D_BENCH/envsync/sessions"; BENCH_HOST="$S15/lap"; HERE="$S15/src"; SCP="$S15/scp"; unset STAGED
       dps() { echo "dps" >> "$S15/dps.log"; case "$1" in *detect_units*) echo "ssh=ok";; *) [ -f "$S15/down" ] && { echo "ssh: connect to host desktop: Connection timed out"; return 255; }; [ -f "$S15/garble" ] && { echo "Get-FileHash : The term is not recognized"; return 0; }; powershell.exe -NoProfile -Command "$1" 2>&1 | tr -d "\r";; esac; }'
  st15() { : > "$S15/scp.log"; : > "$S15/dps.log"; e8reset; e8 "$P15; ensure_stage; echo \"staged=\$STAGED\"; ${1:-:}"; }
  n15() { awk '{ for (i = 1; i <= NF; i++) if ($i ~ /env_sync|s15\/src/ && $i !~ /^desktop:/) print $i }' "$S15/scp.log" | sed 's#.*/##' | sort | tr '\n' ' '; }
  tree15() { ( cd "$1/envsync" && find . -type f -exec sha256sum {} + | sort -k2 ); }
  all15=$(ls "$SRC"/remote "$SRC"/desktop/*.ps1 | grep -v ':$' | sed 's#.*/##' | grep . | sort | tr '\n' ' ')
  st15; a15=$(n15)
  check "F-1-: a script that is MISSING on the desktop is copied (an empty desktop gets every one, each in its place)" '
    [ "$a15" = "$all15" ] && grep -q "^staged=1$" "$E8/out" && [ "$(ls "$S15/desk/envsync/desktop" | wc -l)" = "$(ls "$SRC"/desktop/*.ps1 | wc -l)" ] && cmp -s "$SRC/remote/backup_local.sh" "$S15/desk/envsync/backup_local.sh"'
  st15
  check "F-1+: identical scripts are NOT re-copied: not one scp, and one call to the desktop (the one that was always made)" '[ ! -s "$S15/scp.log" ] && [ "$(wc -l < "$S15/dps.log")" = 1 ] && grep -q "^staged=1$" "$E8/out"'
  echo "# a new line" >> "$S15/src/remote/destale.sh"; echo "# a new line" >> "$S15/src/desktop/launch.ps1"; st15; b15=$(n15)
  check "F-1-: a script that DIFFERS is copied, and only that one (remote/ and desktop/ alike); the desktop then holds the new bytes" '
    [ "$b15" = "destale.sh launch.ps1 " ] && cmp -s "$S15/src/remote/destale.sh" "$S15/desk/envsync/destale.sh" && cmp -s "$S15/src/desktop/launch.ps1" "$S15/desk/envsync/desktop/launch.ps1"'
  echo "# changed on the desktop" >> "$S15/desk/envsync/ports.sh"; rm "$S15/desk/envsync/db_fingerprint.py"; st15; c15=$(n15)
  check "F-1-: a script changed or removed ON THE DESKTOP is put back" '[ "$c15" = "db_fingerprint.py ports.sh " ] && cmp -s "$SRC/remote/ports.sh" "$S15/desk/envsync/ports.sh" && cmp -s "$SRC/remote/db_fingerprint.py" "$S15/desk/envsync/db_fingerprint.py"'
  mkdir -p "$S15/desk/envsync/desktop"; cp "$S15/desk/envsync/desktop/launch.ps1" "$S15/desk/envsync/launch.ps1"; rm "$S15/desk/envsync/desktop/launch.ps1"; st15; d15=$(n15); rm "$S15/desk/envsync/launch.ps1"
  check "F-1-: the same name in the other folder does not count as staged" '[ "$d15" = "launch.ps1 " ] && [ -f "$S15/desk/envsync/desktop/launch.ps1" ]'
  echo backup_local.sh > "$S15/held.txt"; st15 'cmd_units'
  check "F-1+: a run DURING A HELD FILE (a backup runs or waits) reads as a normal run: nothing is copied, the desktop answers (ssh=ok)" '[ ! -s "$S15/scp.log" ] && grep -q "^ssh=ok$" "$E8/out"'
  echo "# a new line" >> "$S15/src/remote/backup_local.sh"; st15 'cmd_units'; e15=$(cat "$E8/out"); : > "$S15/held.txt"; st15; f15=$(n15)
  check "F-1-: a held file that DIFFERS still fails as before (said, nothing run on old scripts) and is copied on the next run once it is free" '
    grep -q "^env_sync: cannot reach the desktop over SSH" <<< "$e15" && ! grep -q "ssh=ok" <<< "$e15" && [ "$f15" = "backup_local.sh " ] && cmp -s "$S15/src/remote/backup_local.sh" "$S15/desk/envsync/backup_local.sh"'
  touch "$S15/down"; printf '%s\n' $(ls "$SRC/remote") > "$S15/held.txt"; st15; rm "$S15/down"; : > "$S15/held.txt"
  check "F-1-: a desktop that does not answer ends the command with the same message as before" 'grep -q "^env_sync: cannot reach the desktop over SSH (desktop)" "$E8/out" && ! grep -q "^staged=1" "$E8/out"'
  # "could not compare" is never "identical": the copy is made as before
  rm "$S15/held.txt"; touch "$S15/garble"; st15; g15=$(n15); rm "$S15/garble"
  check "F-1-: when the desktop's list cannot be made (the hash command fails) EVERYTHING is copied, as before" '[ "$g15" = "$all15" ] && grep -q "^staged=1$" "$E8/out"'
  mkdir -p "$S15/nosum"; printf '#!/usr/bin/env bash\nexit 1\n' > "$S15/nosum/sha256sum"; chmod +x "$S15/nosum/sha256sum"; : > "$S15/scp.log"; e8reset; e8 "$P15"'; PATH="$S15/nosum:$PATH"; ensure_stage; echo "staged=$STAGED"'; h15=$(n15)
  check "F-1-: when the laptop's own hashes cannot be made everything is copied, as before" '[ "$h15" = "$all15" ] && grep -q "^staged=1$" "$E8/out"'
  powershell.exe -NoProfile -Command "\$f = New-Object IO.FileStream('$(cygpath -w "$S15/desk/envsync/ports.sh")', [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None); Start-Sleep 12; \$f.Close()" & h=$!; sleep 4; st15; i15=$(n15); wait "$h"
  check "F-1-: one script that cannot be READ on the desktop counts as different: it, and only it, is copied as before (and, held like that, refused as before)" '[ "$i15" = "ports.sh " ] && grep -q "^env_sync: cannot reach the desktop over SSH" "$E8/out"'
  : > "$S15/held.txt"
  # main dev: an empty desktop ends up byte for byte as the old ensure_stage leaves it
  git -C "$REPO" show 6200cef22:scripts/env_sync/env_sync.sh | sed -n '/^ensure_stage()/,/^}/p' > "$S15/old_stage.sh"; mv "$S15/desk" "$S15/desk_used"; rm -rf "$S15/src"; cp -r "$SRC" "$S15/src"; st15; mv "$S15/desk" "$S15/desk_new"
  e8reset; e8 "$P15"'; . "$S15/old_stage.sh"; ensure_stage'; mv "$S15/desk" "$S15/desk_old"
  check "F-1, MAIN UNCHANGED: what the desktop holds afterwards equals, byte for byte and place for place, what the old staging left" '[ -s "$S15/old_stage.sh" ] && [ "$(tree15 "$S15/desk_old")" = "$(tree15 "$S15/desk_new")" ] && [ "$(tree15 "$S15/desk_new" | wc -l)" -gt 20 ]'
else
  echo "skip the staging checks: no powershell.exe here"
fi
