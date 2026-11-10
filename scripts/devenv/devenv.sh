#!/usr/bin/env bash
# Per-task dev environments: one thin bench + one git worktree + one cloned database per task,
# all sharing the main bench's frappe app, Python env, Postgres and Redis.
#
#   ./devenv.sh template-build        copy the dev DB into template "nirmaan_tpl" (online, no restart)
#   ./devenv.sh template-drop         delete the template
#   ./devenv.sh create <task> [ref] [--branch <name> | --on <branch>]
#                                     worktree at benches/<task>/apps/nirmaan_stack at ref (default: HEAD of the
#                                     checkout you run it from), detached, on new branch <name>, or on existing
#                                     branch <branch> (e.g. one handoff.sh brought); site t-<task>.localhost, DB t_<task>
#   ./devenv.sh up                    run inside any existing worktree under development/ (e.g. one
#                                     Claude Code made in .claude/worktrees/): give it its own env
#   ./devenv.sh unit <module> [...]   pure tests with plain unittest: no env, no site, no DB. Run it inside any
#                                     checkout or worktree under development/; the code is that folder's.
#                                     A test that needs frappe.db or a doctype fails here: use `up` + `test`.
#   ./devenv.sh vitest [file ...]     frontend tests (vitest run) of the checkout you stand in, inside the container.
#                                     A worktree with no node_modules gets a relative link to the master checkout's.
#   ./devenv.sh typecheck [--update-baseline]  tsc of the checkout you stand in, inside the container, printing only
#                                     errors NEW against frontend/tsc-baseline.json (exit 1 if any). Incremental: the
#                                     first run in a worktree seeds from the last run's cache. One tsc at a time.
#   ./devenv.sh test [task] <args>    bench run-tests on the task site, e.g. --module nirmaan_stack.x.test_y; give
#                                     --module several times to run each one in turn (exits 1 if any fails);
#                                     --affected <base-ref> adds every module the repo CLAUDE.md calls affected by the
#                                     changes since <base-ref> (committed, staged, unstaged, untracked);
#                                     --skips runs verbose and prints only skipped tests (with reasons), failures and
#                                     the verdict (the full verbose output stays in the log).
#                                     It first migrates the env when the worktree's doctype JSON, patches.txt or
#                                     hooks.py differ from what the env's last migrate saw (each migrate records them
#                                     in benches/<task>/.migrated-schema; an env with no record migrates once), and
#                                     prints that it did, or that none was needed. --no-migrate skips this and runs on
#                                     the DB as it is
#   ./devenv.sh affected <base-ref>   print those affected modules, one per line, without running them
#   ./devenv.sh run [task] <args>     any frappe command on the task site, e.g. migrate, console,
#                                     set-admin-password <pw>, set-password <email> <pw>
#   ./devenv.sh script [task] <file.py> [args...]  run a Python file with the task site connected: copied to
#                                     benches/<task>/tmp/, run under `python -I` (no stray /tmp module can shadow the
#                                     stdlib) with the task's code first; sys.argv = [file, args...]. Do not call
#                                     frappe.init/connect. Nothing is committed unless the file calls frappe.db.commit(),
#                                     and a commit lands in the task DB only.
#   ./devenv.sh serve [task] [--wait] serve the env for a browser walk: takes a free walk lane (backend + vite port
#                                     pair; one lane per published vite port 8081-8083), starts both in the background,
#                                     prints the URL http://t-<task>.localhost:<vite>/ (its own host, so its own login
#                                     cookie), what the env lacks (e.g. no Gemini key), and one working login per role
#                                     profile. --wait queues for a lane (9 min, inside one tool call's limit; run it
#                                     again to keep waiting).
#   ./devenv.sh restart [task] [web|vite]  restart what `serve` started (default web): the backend runs without
#                                     reload, so restart web after a Python change
#   ./devenv.sh stop [task]           stop what `serve` started (inside the container: stopping a shell job is not enough)
#   ./devenv.sh reset [task]          re-clone the task DB from the template, then migrate
#   ./devenv.sh destroy [task] [--shared]  drop DB + role + redis keys, remove bench dir; removes the worktree
#                                     only if `create` made it (an `up` worktree is left alone). reset and destroy
#                                     refuse a task name with no env; destroy refuses dev/master/lab without --shared
#   ./devenv.sh list                  show task benches, which one is serving, their DBs and Postgres disk free
#   ./devenv.sh gc [--yes]            find envs whose worktree is gone and DBs with no bench; --yes removes them
#   ./devenv.sh prune [--yes] [--quiet]  every env and worktree of this machine, one line each: PRUNE when a ref
#                                     already holds its work (landed.sh: master, upstream/ or origin/ develop and main)
#                                     and nothing holds it, else KEEP with the holds: shared (dev, master, lab, the
#                                     main worktree), here (your cwd), missing, no-worktree, locked, serving, agent
#                                     (a process works in it), new (its worktree is under a day old and has no
#                                     commit of its own), bench-files (files destroy would not remove),
#                                     tracked-changes, untracked. --yes destroys each PRUNE env and removes each PRUNE
#                                     worktree (git worktree remove, never forced); branches stay. --quiet, for the
#                                     post-merge hook: only the PRUNE lines (nothing when there are none), and landed by
#                                     ancestry only, which is fast
#
# [task] may be left out when you run the command from inside the task's worktree.
#
# Every migrate (so create, up, reset, `run migrate` and a test that needs one) cuts the cloned DB off from real
# people and real storage: phone push tokens cleared, outgoing mail off, uploads kept on local disk instead of the
# production bucket. It also gives every enabled user with a Nirmaan Users row a Notification Settings row (without
# one the SPA goes blank).
#
# Runs on the host (Mac or Linux VM). Git steps run there; everything else re-runs this file inside the container.
# The main bench (frappe-bench/, site localhost, its DB) is only ever read, never written.
# Undo everything: see benches/REVERT.md.
# The whole body sits in { ... } so bash parses it before running: editing this file mid-run is safe.
{
set -euo pipefail

CONTAINER="${DEVENV_CONTAINER:-frappe_docker_devcontainer-frappe-1}"
TPL_DB="nirmaan_tpl"
SHARED_APPS="frappe frappe_gcp_attachment"
export PGHOST=postgresql PGUSER=postgres PGPASSWORD=123

die() { echo "ERROR: $*" >&2; exit 1; }
# Record a test/unit/typecheck run as a Definition-of-Done proof for its worktree (scripts/devenv/dod.py stamp).
# $1 worktree, $2 kind, $3 exit code, $4 extra JSON. A failed stamp never fails the command it records.
proof() {
  local extra="${4:-}"; [ -n "$extra" ] || extra='{}'
  python3 "$SELF_DIR/dod.py" stamp "$1" "$2" "$([ "$3" = 0 ] && echo PASS || echo FAIL)" "$extra" 2>/dev/null \
    || echo "  (could not stamp the $2 proof)"
}

# This file lives in the app repo (scripts/devenv/), so any checkout under the dev root carries it. The dev root is
# frappe_docker/development: the first folder above this file that holds the main bench, or $DEVENV_ROOT.
SELF_DIR="$(cd "$(dirname "$0")" && pwd -P)"
find_dev_root() {
  local d="$SELF_DIR"
  while [ "$d" != / ]; do [ -d "$d/frappe-bench/apps/frappe" ] && { echo "$d"; return 0; }; d="$(dirname "$d")"; done
  return 1
}
HERE="${DEVENV_ROOT:-$(find_dev_root)}" || die "no frappe-bench/ above $SELF_DIR: run this from a checkout under frappe_docker/development, or set DEVENV_ROOT"
SELF_REL="${SELF_DIR#"$(cd "$HERE" && pwd -P)"/}/$(basename "$0")"   # this file's path under the dev root
M="$HERE/frappe-bench"                          # main bench
BENCHES="$HERE/benches"
MAIN_GIT="$HERE/nirmaan_stack_variants/master"  # any worktree of the repo works for `git worktree`

t0=$(date +%s); took() { echo "  [$(( $(date +%s) - t0 ))s] $*"; }

check_task() {
  [[ "${1:-}" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || die "task name must be lowercase letters, digits, dashes"
  TASK="$1"; B="$BENCHES/$TASK"; SITE="t-$TASK.localhost"; DB="t_${TASK//-/_}"
}

in_container() { [ -f /.dockerenv ]; }

# Re-run this script inside the container with the same arguments, prefixed by "_in".
inside() {
  docker exec -i -e WALK_VITE_PORTS="${WALK_VITE_PORTS:-}" "$CONTAINER" bash "/workspace/development/$SELF_REL" _in "$@"
}

# The vite ports Docker publishes to the host (8081-8089). Each one is a walk lane. The container cannot see the
# host's port map, so the host side reads it and passes it in.
published_vite_ports() {
  docker port "$CONTAINER" 2>/dev/null | grep -oE '^808[1-9]' | sort -un | tr '\n' ' '
}

src_db() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["db_name"])' "$M/sites/localhost/site_config.json"; }

# Run a frappe CLI command inside the task bench, with the task's code first on sys.path.
frappe_cmd() {
  cd "$B/sites"
  FRAPPE_BENCH_ROOT="$B" PYTHONPATH="$B/apps/nirmaan_stack" \
    "$B/env/bin/python" -m frappe.utils.bench_helper frappe --site "$SITE" "$@"
}

# Refuse to run unless the code under test is the task's worktree and the DB is the task's DB.
guard() {
  cd "$B/sites"
  FRAPPE_BENCH_ROOT="$B" PYTHONPATH="$B/apps/nirmaan_stack" "$B/env/bin/python" - "$B" "$SITE" "$DB" <<'PY'
import sys, json, nirmaan_stack, frappe
from frappe.utils import get_bench_path
b, site, db = sys.argv[1:]
code = nirmaan_stack.__file__
conf = json.load(open(f"{b}/sites/{site}/site_config.json"))
ok = code.startswith(f"{b}/apps/nirmaan_stack/") and conf["db_name"] == db and get_bench_path() == b
print(f"  code  : {code}\n  db    : {conf['db_name']}\n  bench : {get_bench_path()}")
sys.exit(0 if ok else "guard failed: wrong code, DB or bench path. Not running.")
PY
}

# Before a test run: the two states of an env's DB that turn a whole run red whatever the code does.
# 1. The DB was last migrated on another Frappe than the code (the bench moved on): new Frappe tables are missing,
#    so most modules fail at import. Refused, naming the fix.
# 2. Rows an older test run left behind (names "TEST-…"): a test that counts or matches rows sees them and fails.
#    Only said, with the tables: a leftover is harmless to most tests, and `reset` is the user's call on dev/master/lab.
db_state() {
  local code_v db_v q left
  code_v="$(sed -n 's/^__version__ = "\(.*\)"$/\1/p' "$B/apps/frappe/frappe/__init__.py" | head -1)"
  db_v="$(psql -d "$DB" -Atc "SELECT app_version FROM \"tabInstalled Application\" WHERE app_name = 'frappe'" 2>/dev/null || true)"
  [ -z "$db_v" ] || [ "$db_v" = "$code_v" ] \
    || die "this env's DB was last migrated on Frappe $db_v, but the code is Frappe $code_v, so the run would fail on missing tables. Run: devenv.sh run $TASK migrate"
  q="$(psql -d "$DB" -Atc "SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM %I WHERE name LIKE %L', table_name, table_name, 'TEST-%'), ' UNION ALL ')
       FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'name' AND table_name LIKE 'tab%'
       AND data_type IN ('character varying', 'text')")"
  left="$(psql -d "$DB" -Atc "SELECT string_agg(t || ' ' || n, ', ' ORDER BY n DESC) FROM ($q) x WHERE n > 0" 2>/dev/null || true)"
  if [ -n "$left" ]; then
    echo "  data  : Frappe $code_v; rows an older test run left behind (TEST-…): $left"
    echo "          a test that counts or matches rows may fail on them; devenv.sh reset $TASK gives a clean DB"
  else
    echo "  data  : Frappe $code_v; no TEST-… rows left behind"
  fi
}

migrate() {    # frappe migrate, after clearing locks a killed or failed run left behind (else DocumentLockedError)
  pgrep -f -- "--site $SITE migrate" >/dev/null && die "a migrate is already running on $SITE"
  rm -f "$B/sites/$SITE/locks/"*.lock
  # The schema files are read before the migrate, and become the env's record only once it succeeded. The record is
  # best-effort: when it cannot be made, the next `test` simply migrates again, and the migrate itself still runs.
  # The old record goes first: a migrate that fails (e.g. reset's, on a fresh clone) leaves the next test to migrate.
  local next="$B/.migrated-schema.next"
  rm -f "$B/.migrated-schema"
  schema record "$next" || rm -f "$next"
  frappe_cmd migrate "$@" && make_safe || return
  if [ -f "$next" ]; then mv "$next" "$B/.migrated-schema"; fi
}

# The env's schema files (every doctype JSON, patches.txt, hooks.py) against what its last migrate saw:
# `schema record <file>` saves them, `schema check` exits 10 (and says why) when they differ. See devenv_schema.py.
schema() {
  local cmd="$1" stamp="${2:-$B/.migrated-schema}"
  python3 -I "$SELF_DIR/devenv_schema.py" "$cmd" "$B/apps/nirmaan_stack" "$stamp"
}

# Before a test run: migrate first when the schema files changed since the env's last migrate (a merge that adds a
# doctype or field), else the run fails on a missing table and may leave rows behind.
migrate_if_needed() {
  local why rc=0
  why="$(schema check)" || rc=$?
  case "$rc" in
    0)  echo "  migrate: none needed (doctype JSON, patches.txt and hooks.py unchanged since the env's last migrate)" ;;
    10) echo "  migrate: $why; migrating first (log: benches/$TASK/logs/migrate.log)"
        ( migrate ) >"$B/logs/migrate.log" 2>&1 \
          || { tail -30 "$B/logs/migrate.log"; die "migrate failed, so no test ran"; }
        echo "  migrate: done" ;;
    *)  die "could not tell whether $TASK needs a migrate (devenv_schema.py exited $rc)" ;;
  esac
}

# The DB is a copy of the dev DB, which holds real phone push tokens (a test once pushed to the CEO's phone), a live
# outgoing mail account, and the GCS attachment hook that uploads to the production bucket. Cut all three here.
# The GCS hook skips only the doctypes listed in ignore_gcs_upload_for_doctype, so list every doctype the DB has
# ("File" covers an upload not attached yet); migrate re-runs this, so a doctype a task adds is listed too.
make_safe() {
  psql -v ON_ERROR_STOP=1 -qAt -d "$DB" \
    -c 'UPDATE "tabNirmaan Users" SET fcm_token = NULL WHERE fcm_token IS NOT NULL' \
    -c 'UPDATE "tabEmail Account" SET enable_outgoing = 0 WHERE enable_outgoing = 1'
  psql -v ON_ERROR_STOP=1 -qAt -d "$DB" -c 'SELECT name FROM "tabDocType"' > "$B/logs/doctypes.txt"
  python3 - "$B/sites/$SITE/site_config.json" "$B/logs/doctypes.txt" <<'PY'
import json, sys
conf_path, doctypes_path = sys.argv[1:]
conf = json.load(open(conf_path))
doctypes = sorted({"File", *filter(None, open(doctypes_path).read().split("\n"))})
conf.update(mute_emails=1, ignore_gcs_upload_for_doctype=doctypes)
json.dump(conf, open(conf_path, "w"), indent=1)
PY
  echo "  safe: push tokens cleared, outgoing mail off, uploads kept local"
  # Some users in the dev DB lack a Notification Settings row, and the SPA renders blank for them. Create the row the
  # way Frappe does on user creation, so a walk can impersonate any of them.
  local made; made="$(cd "$B/sites" && FRAPPE_BENCH_ROOT="$B" PYTHONPATH="$B/apps/nirmaan_stack" "$B/env/bin/python" - "$SITE" <<'PY'
import sys, frappe
from frappe.desk.doctype.notification_settings.notification_settings import create_notification_settings
frappe.init(site=sys.argv[1], sites_path="."); frappe.connect()
users = frappe.db.sql_list("""select u.name from "tabUser" u join "tabNirmaan Users" n on n.name = u.name
  where u.enabled = 1 and not exists (select 1 from "tabNotification Settings" s where s.name = u.name)""")
for user in users:
    create_notification_settings(user)
frappe.db.commit(); frappe.destroy()
print(len(users))
PY
)"
  echo "  notification settings: created $(tail -1 <<<"$made") for enabled Nirmaan users that had none"
}

role_logins() {   # one "<role profile>  <email>" per role profile: its first enabled user whose SPA loads
  psql -v ON_ERROR_STOP=1 -qAt -F $'\t' -d "$DB" <<'SQL' | while IFS=$'\t' read -r role email; do printf '    %-46s %s\n' "$role" "$email"; done
SELECT DISTINCT ON (n.role_profile) n.role_profile, u.name
FROM "tabNirmaan Users" n JOIN "tabUser" u ON u.name = n.name JOIN "tabNotification Settings" s ON s.name = u.name
WHERE u.enabled = 1 AND coalesce(n.role_profile, '') <> ''
ORDER BY n.role_profile, u.name
SQL
}

# SO_REUSEADDR, as vite and frappe set it: a port whose last connections sit in TIME_WAIT is free to listen on, and
# without it a just-stopped walk's port reads as taken for a minute. A port something still listens on stays taken.
port_free() { python3 -c 'import socket,sys;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(("0.0.0.0",int(sys.argv[1])))' "$1" 2>/dev/null; }

ensure_node_modules() {   # $1 = a frontend dir. A worktree has none: link the master checkout's (relative, so the
  local fe="$1" src=/workspace/development/nirmaan_stack_variants/master/frontend/node_modules   # link works on both sides)
  [ -e "$fe/node_modules" ] && return
  [ -d "$src" ] || die "no node_modules at $src"
  ln -s "$(python3 -c 'import os,sys;print(os.path.relpath(*sys.argv[1:]))' "$src" "$fe")" "$fe/node_modules"
}

gemini_key_state() {   # "set" when the env's Gemini key decrypts to something, else "missing"
  cd "$B/sites"
  FRAPPE_BENCH_ROOT="$B" PYTHONPATH="$B/apps/nirmaan_stack" "$B/env/bin/python" - "$SITE" 2>/dev/null <<'PY' || echo missing
import sys, frappe
from frappe.utils.password import get_decrypted_password
frappe.init(site=sys.argv[1], sites_path="."); frappe.connect()
key = get_decrypted_password("Document AI Settings", "Document AI Settings", "gemini_api_key", raise_exception=False)
print("set" if key else "missing")
PY
}

# The env's web-port slot: benches/<task>/.slot, else (an env made before .slot existed) the webserver_port in its
# common_site_config.json, which is what that env's own vite proxy reads when its code predates FRAPPE_WEB_PORT.
env_slot() {
  local s; s="$(cat "$B/.slot" 2>/dev/null || true)"
  [ -z "$s" ] && s="$(grep -o '"webserver_port": 800[2-5]' "$B/sites/common_site_config.json" 2>/dev/null | grep -o '[2-5]$' || true)"
  echo "${s:-0}"
}

serve_ports() {   # WEB, VITE and FE (the real frontend path) for $B: the lane its `serve` claimed, else the old fixed pair
  local slot lane; slot="$(env_slot)"
  lane="$(sed -n 's/^ports=//p' "$B/.serve" 2>/dev/null | head -1 || true)"
  if [ -n "$lane" ]; then read -r WEB VITE <<<"$lane"
  else WEB=$(( slot > 0 ? 8000 + slot : 8001 )); VITE=8081; fi
  FE="$(cd "$B/apps/nirmaan_stack/frontend" && pwd -P)"
}

# Walk lanes. Each published vite port is one lane; $LANES/<vite port> names the task holding it. A test-only env
# (slot 0) gets the backend port 8090 + n for lane 808n; that port stays inside the container (vite proxies to it),
# so it needs no publishing. Claiming happens under one lock, so two queued walks can never take the same lane.
LANES="$BENCHES/.walk-lanes"
lanes_lock() {
  local lock="$LANES.lock" n=0
  until mkdir "$lock" 2>/dev/null; do
    # A lock older than a minute was left by a killed run: nothing holds it for longer than a few port checks.
    [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ] && { rmdir "$lock" 2>/dev/null || true; continue; }
    n=$((n + 1)); [ $n -gt 300 ] && die "could not take $lock"; sleep 0.2
  done
}
lanes_unlock() { rmdir "$LANES.lock" 2>/dev/null || true; }
lane_owner_live() {   # $1 = vite port: true when the task named in its lane file is still serving on it
  local owner; owner="$(cat "$LANES/$1" 2>/dev/null)" || return 1
  grep -qx "ports=[0-9]* $1" "$BENCHES/$owner/.serve" 2>/dev/null
}
claim_lane() {   # sets WEB and VITE and records them; returns 1 when every lane is taken
  local slot v web; slot="$(env_slot)"
  mkdir -p "$LANES"; lanes_lock
  for v in ${WALK_VITE_PORTS:-8081}; do
    lane_owner_live "$v" && continue
    rm -f "$LANES/$v"                                    # stale: its task stopped, crashed or was destroyed
    web=$(( slot > 0 ? 8000 + slot : 8090 + v - 8080 ))
    port_free "$v" && port_free "$web" || continue       # e.g. a walk started before lanes existed
    echo "$TASK" > "$LANES/$v"; echo "ports=$web $v" > "$B/.serve"
    WEB=$web; VITE=$v; lanes_unlock; return 0
  done
  lanes_unlock; return 1
}
release_lane() {
  local v; v="$(sed -n 's/^ports=[0-9]* //p' "$B/.serve" 2>/dev/null | head -1 || true)"
  [ -n "$v" ] && [ "$(cat "$LANES/$v" 2>/dev/null)" = "$TASK" ] && rm -f "$LANES/$v"
  true
}

# Each start runs under setsid, so its pid is its process group; .serve keeps one "what=pid" line per process.
start_web() {
  cd "$B/sites"
  FRAPPE_BENCH_ROOT="$B" PYTHONPATH="$B/apps/nirmaan_stack" setsid nohup "$B/env/bin/python" -m frappe.utils.bench_helper \
    frappe --site "$SITE" serve --port "$WEB" --noreload >"$B/logs/serve-web.log" 2>&1 </dev/null &
  echo "web=$!" >> "$B/.serve"
}
start_vite() {   # FRAPPE_WEB_PORT points the proxy at this env, VITE_CACHE_DIR keeps the main vite's cache apart
  ensure_node_modules "$FE"; cd "$FE"
  FRAPPE_WEB_PORT="$WEB" VITE_CACHE_DIR="$B/.vite-cache" NODE_OPTIONS=--max-http-header-size=8192 \
    setsid nohup node_modules/.bin/vite --host --port "$VITE" --strictPort >"$B/logs/serve-vite.log" 2>&1 </dev/null &
  echo "vite=$!" >> "$B/.serve"
}
wait_up() {      # $1 = url
  local n=0
  until curl -sf -o /dev/null "$1"; do
    n=$((n + 1)); [ $n -gt 90 ] && { stop_serving; die "$1 did not come up; see benches/$TASK/logs/serve-*.log"; }
    sleep 1
  done
}

stop_one() {     # $1 = web|vite: kill its group from .serve, then anything of this env's still on that job
  local what="$1" pid
  pid="$(sed -n "s/^$what=//p" "$B/.serve" 2>/dev/null)"
  [ -n "$pid" ] && { kill -- "-$pid" 2>/dev/null && echo "  stopped $what (pid $pid)" || echo "  $what (pid $pid) was not running"; }
  sed -i "/^$what=/d" "$B/.serve" 2>/dev/null || true
  local n=0   # let the group exit, so the fallback below does not find it again
  while [ -n "$pid" ] && kill -0 -- "-$pid" 2>/dev/null && [ $n -lt 10 ]; do n=$((n + 1)); sleep 0.5; done
  # Fallback for a process .serve does not name (e.g. one started by hand): match this env's site or frontend.
  if [ "$what" = web ]; then
    pkill -f -- "--site $SITE serve" && echo "  stopped a stray web on $SITE" || true
  else
    for pid in $(pgrep -f -- "vite --host --port $VITE" || true); do
      [ "$(readlink "/proc/$pid/cwd")" = "$FE" ] && kill "$pid" && echo "  stopped a stray vite (pid $pid)"
    done
  fi
  true
}
stop_serving() {
  [ -d "$B/apps/nirmaan_stack/frontend" ] || { rm -f "$B/.serve"; return 0; }
  serve_ports; touch "$B/.serve"
  stop_one web; stop_one vite
  release_lane; rm -f "$B/.serve"
}

clone_db() {   # (re)create role + DB from the template and hand table ownership to the task role
  local pw="$1" src; src="$(src_db)"
  psql -v ON_ERROR_STOP=1 -qAt -d postgres <<SQL
DROP DATABASE IF EXISTS "$DB" WITH (FORCE);
DO \$\$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB') THEN CREATE ROLE "$DB" LOGIN; END IF;
END\$\$;
ALTER ROLE "$DB" PASSWORD '$pw';
CREATE DATABASE "$DB" TEMPLATE "$TPL_DB";
SQL
  # REASSIGN OWNED also moves databases owned by the old role; make sure there are none.
  [ "$(psql -Atc "select count(*) from pg_database where datdba = '$src'::regrole")" = 0 ] \
    || die "role $src owns a database; REASSIGN OWNED would move it. Stopping."
  psql -v ON_ERROR_STOP=1 -qAt -d "$DB" -c "REASSIGN OWNED BY \"$src\" TO \"$DB\""
}

# ---------------------------------------------------------------- inside the container
if [ "${1:-}" = "_in" ]; then
  in_container || die "_in is internal"
  shift; CMD="$1"; shift
  M=/workspace/development/frappe-bench; BENCHES=/workspace/development/benches
  case "$CMD" in
    template-build)
      SRC="$(src_db)"
      psql -Atc "select 1 from pg_database where datname='$TPL_DB'" | grep -q 1 && die "$TPL_DB exists; template-drop first"
      DUMP=/tmp/devenv_tpl_dump; rm -rf "$DUMP"
      pg_dump -Fd -j 3 -f "$DUMP" "$SRC";                      took "dumped $SRC"
      createdb "$TPL_DB"
      pg_restore -j 3 -d "$TPL_DB" "$DUMP";                     took "restored into $TPL_DB"
      rm -rf "$DUMP"
      psql -qc "ALTER DATABASE \"$TPL_DB\" WITH IS_TEMPLATE true ALLOW_CONNECTIONS false" \
           -c "COMMENT ON DATABASE \"$TPL_DB\" IS 'built $(date '+%Y-%m-%d %H:%M') from $SRC'"
      took "template ready: $(psql -Atc "select pg_size_pretty(pg_database_size('$TPL_DB'))")"
      ;;
    template-drop)
      psql -qc "ALTER DATABASE \"$TPL_DB\" WITH IS_TEMPLATE false" 2>/dev/null || true
      psql -qc "DROP DATABASE IF EXISTS \"$TPL_DB\""; echo "dropped $TPL_DB"
      ;;
    create)
      check_task "$1"; SLOT="$2"
      [ -d "$B/apps/nirmaan_stack" ] || die "worktree missing at $B/apps/nirmaan_stack"
      mkdir -p "$B/sites/$SITE"/{public/files,private/files,locks,logs} "$B/logs" "$B/config/pids" "$B/sites/assets"
      for a in $SHARED_APPS; do ln -sfn "$M/apps/$a" "$B/apps/$a"; done
      ln -sfn "$M/env" "$B/env"
      cp "$M/sites/apps.txt" "$B/sites/"
      cp "$M"/sites/assets/assets*.json "$B/sites/assets/"
      ln -sfn "$M/apps/frappe/frappe/public" "$B/sites/assets/frappe"
      ln -sfn "$B/apps/nirmaan_stack/nirmaan_stack/public" "$B/sites/assets/nirmaan_stack"
      PW="$(python3 -c 'import secrets;print(secrets.token_hex(12))')"
      python3 - "$M" "$B" "$TASK" "$SITE" "$DB" "$PW" "$SLOT" <<'PY'
import json, sys
m, b, task, site, db, pw, slot = sys.argv[1:]; slot = int(slot)
common = json.load(open(f"{m}/sites/common_site_config.json"))
common.update(bench_id=f"task-{task}", default_site=site, pause_scheduler=1)
if slot:  # slot 0 = test-only env: no web ports of its own
    common.update(webserver_port=8000 + slot, socketio_port=9000 + slot, file_watcher_port=6787 + slot)
json.dump(common, open(f"{b}/sites/common_site_config.json", "w"), indent=1)
main = json.load(open(f"{m}/sites/localhost/site_config.json"))
json.dump(dict(db_name=db, db_password=pw, db_type="postgres", db_host="postgresql",
               encryption_key=main["encryption_key"], allow_tests=True, pause_scheduler=1),
          open(f"{b}/sites/{site}/site_config.json", "w"), indent=1)
PY
      if [ "$SLOT" != 0 ]; then
        printf 'web: bench --site %s serve --port %s\nsocketio: node apps/frappe/socketio.js\nworker: bench worker\n' \
          "$SITE" "$((8000 + SLOT))" > "$B/Procfile"
        took "bench skeleton (slot $SLOT: web :$((8000 + SLOT)))"
      else
        took "bench skeleton (test-only: all port slots taken)"
      fi
      clone_db "$PW";                                             took "cloned DB $DB from $TPL_DB"
      guard
      migrate >"$B/logs/migrate.log" 2>&1 || { tail -30 "$B/logs/migrate.log"; die "migrate failed"; }
      took "migrated (log: benches/$TASK/logs/migrate.log)"
      ;;
    test)
      # Frappe's run-tests exits 0 on failures unless $CI is set (frappe/commands/utils.py), and $CI changes
      # other behaviour, so read unittest's own verdict line instead.
      check_task "$1"; shift
      # run-tests keeps only the LAST --module, so run each module on its own and judge each run.
      MODS=(); REST=(); SKIPS=; MIGRATE=1
      while [ $# -gt 0 ]; do
        case "$1" in
          --module) MODS+=("${2:?--module needs a value}"); shift 2 ;;
          --skips) SKIPS=1; shift ;;
          --no-migrate) MIGRATE=; shift ;;
          *) REST+=("$1"); shift ;;
        esac
      done
      guard
      if [ -n "$MIGRATE" ]; then migrate_if_needed; else echo "  migrate: skipped (--no-migrate): the DB as it is"; fi
      db_state
      # --skips: Frappe prints a skip's reason only at verbosity 2 (`frappe --verbose`), one line per test, so the
      # screen gets just the skips, failures and verdict; the whole run is still in the log.
      VERBOSE=(); [ -n "$SKIPS" ] && VERBOSE=(--verbose)
      LOG="$B/logs/last-test.log"; : > "$LOG"; FAILED_MODS=()
      if [ ${#MODS[@]} -eq 0 ]; then MODS=(""); fi
      for m in "${MODS[@]}"; do
        one="$B/logs/last-test-one.log"
        # `|| true`: a module that fails to import exits non-zero; judge it by its log and run the rest.
        args=(${VERBOSE[@]+"${VERBOSE[@]}"} run-tests ${REST[@]+"${REST[@]}"}); [ -n "$m" ] && args+=(--module "$m")
        if [ -n "$SKIPS" ]; then
          frappe_cmd "${args[@]}" > "$one" 2>&1 || true
          grep -E "skipped '|^(FAIL|ERROR):|^Ran |^OK|^FAILED" "$one" || true
        else frappe_cmd "${args[@]}" 2>&1 | tee "$one" || true; fi
        cat "$one" >> "$LOG"
        grep -qE '^OK( |$)' "$one" && ! grep -qE '^FAILED' "$one" || FAILED_MODS+=("${m:-<all>}")
      done
      # The verdict is always the last line, so `| tail -1` answers "did it pass?" whatever the tests printed.
      [ ${#MODS[@]} -gt 1 ] && echo "devenv: ran ${#MODS[@]} modules: ${MODS[*]}"
      [ ${#FAILED_MODS[@]} -eq 0 ] \
        || { echo "devenv: FAIL ${#FAILED_MODS[@]}/${#MODS[@]}: ${FAILED_MODS[*]} (full log: benches/$TASK/logs/last-test.log)"; exit 1; }
      echo "devenv: PASS ${#MODS[@]}/${#MODS[@]}"
      ;;
    run)
      check_task "$1"; shift; guard
      if [ "${1:-}" = migrate ]; then shift; migrate "$@"; else frappe_cmd "$@"; fi ;;
    script)
      # -I drops PYTHONPATH, the current folder and the script's folder from sys.path, so a stray .py (the container's
      # /tmp holds several) cannot shadow the stdlib; the runner puts the task's code first by hand instead.
      check_task "$1"; F="$B/tmp/$2"; shift 2; guard; cd "$B/sites"
      FRAPPE_BENCH_ROOT="$B" exec "$B/env/bin/python" -I - "$B" "$SITE" "$F" "$@" <<'PY'
import sys
b, site, path, *args = sys.argv[1:]
sys.path.insert(0, f"{b}/apps/nirmaan_stack")
import runpy, frappe, nirmaan_stack
if not nirmaan_stack.__file__.startswith(f"{b}/apps/nirmaan_stack/"):
    sys.exit(f"guard failed: code is {nirmaan_stack.__file__}, not the task's. Not running.")
frappe.init(site=site, sites_path="."); frappe.connect()
print(f"  script: {path}  (a frappe.db.commit() in it writes to {frappe.conf.db_name} only)", flush=True)
sys.argv = [path, *args]
try:
    runpy.run_path(path, run_name="__main__")
finally:
    if getattr(frappe.local, "db", None):   # what the file did not commit is dropped
        frappe.db.rollback(); frappe.destroy()
PY
      ;;
    reset)
      check_task "$1"
      PW="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["db_password"])' "$B/sites/$SITE/site_config.json")"
      # A fresh clone is unmigrated: its old record goes first, so a reset stopped before its migrate leaves the next
      # `test` to migrate.
      rm -f "$B/.migrated-schema"
      clone_db "$PW"; took "re-cloned $DB"
      guard; migrate >"$B/logs/migrate.log" 2>&1 || die "migrate failed, see benches/$TASK/logs/migrate.log"
      took "migrated"
      ;;
    destroy)
      check_task "$1"; stop_serving
      psql -qc "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "DROP ROLE IF EXISTS \"$DB\""
      "$M/env/bin/python" - "$TASK" "$DB" <<'PY'
import sys, redis
task, db = sys.argv[1:]
for url, pat in (("redis://redis-queue:6379", f"task-{task}:*"), ("redis://redis-queue:6379", f"rq:*task-{task}*"),
                 ("redis://redis-cache:6379", f"{db}|*")):
    r = redis.from_url(url); keys = list(r.scan_iter(pat, count=1000))
    if keys: r.delete(*keys)
    print(f"  redis {url.split('//')[1]}: removed {len(keys)} keys matching {pat}")
PY
      rm -rf "$B/sites" "$B/logs" "$B/config" "$B/env" "$B/Procfile" "$B/.vite-cache" "$B/tmp" \
        "$B/.migrated-schema" "$B/.migrated-schema.next"
      # Every shared-app link, including those of an app the bench has since dropped.
      find "$B/apps" -maxdepth 1 -type l ! -name nirmaan_stack -delete
      took "dropped DB/role, cleared redis, removed bench files"
      ;;
    unit)
      # No site and no DB: Postgres settings are dropped, and the worktree is the current directory, so there is
      # no sites/ folder for frappe to find. FRAPPE_STREAM_LOGGING keeps frappe.logger() at import time from
      # opening ../logs/*.log.
      WT="$1"; shift
      [ -d "$WT/nirmaan_stack" ] || die "no nirmaan_stack package in $WT"
      cd "$WT"; unset PGHOST PGUSER PGPASSWORD
      export FRAPPE_STREAM_LOGGING=1 PYTHONPATH="$WT"
      "$M/env/bin/python" - "$WT" <<'PY'
import sys, importlib.util
wt = sys.argv[1]
code = importlib.util.find_spec("nirmaan_stack").origin
print(f"  code  : {code}\n  db    : none (no site, no DB)")
sys.exit(0 if code.startswith(f"{wt}/nirmaan_stack/") else "guard failed: code is not this worktree's. Not running.")
PY
      exec "$M/env/bin/python" -m unittest "$@"
      ;;
    serve)
      check_task "$1"; shift; WAIT=0; [ "${1:-}" = --wait ] && WAIT=1
      guard
      [ -f "$B/.serve" ] && die "$TASK is already serving; 'devenv.sh stop $TASK' first"
      FE="$(cd "$B/apps/nirmaan_stack/frontend" && pwd -P)"
      n=0
      until claim_lane; do   # 108 x 5 s = 9 min: a queued call ends inside one 10-minute tool call
        [ $WAIT = 1 ] && [ $n -lt 108 ] \
          || die "every walk lane (${WALK_VITE_PORTS:-8081}) is in use; see 'devenv.sh list'. --wait queues; run it again to keep waiting"
        [ $n = 0 ] && echo "  every walk lane (${WALK_VITE_PORTS:-8081}) is in use; waiting for one (up to 9 min)"
        n=$((n + 1)); sleep 5
      done
      start_web; start_vite
      wait_up "http://127.0.0.1:$WEB/api/method/ping"; wait_up "http://127.0.0.1:$VITE/"
      # The site's own host name (Chrome resolves *.localhost to 127.0.0.1): cookies are per host, not per port, so
      # every walk on 127.0.0.1 would share one login. `frappe serve --site` ignores the host it is called by.
      took "serving $SITE: open http://$SITE:$VITE/   (backend :$WEB; logs benches/$TASK/logs/serve-*.log)"
      # What a walk cannot do here, so it is not mistaken for a bug.
      # The cloned key row may not decrypt here, so ask frappe; it prints set/missing, never the key.
      [ "$(gemini_key_state | tail -1)" = set ] \
        || echo "  missing: Gemini API key (photo reading fails). The user sets it at http://$SITE:$VITE/app/document-ai-settings"
      echo "  not served: realtime (Socket.IO), so a screen that waits for a realtime event does not refresh"
      echo "  log in: 'devenv.sh run $TASK set-admin-password <pw>' sets a test password on this env's DB only;"
      echo "  'devenv.sh run $TASK set-password <email> <pw>' does the same for a user. One working login per role profile"
      echo "  (enabled, with Nirmaan Users and Notification Settings rows; impersonate it or set its password):"
      role_logins
      echo "  Restart the backend after a Python change: devenv.sh restart $TASK.  Stop with: devenv.sh stop $TASK"
      ;;
    restart)
      check_task "$1"; shift; WHAT="${1:-web}"
      case "$WHAT" in web|vite) ;; *) die "restart web or vite" ;; esac
      [ -f "$B/.serve" ] || die "$TASK is not serving; 'devenv.sh serve $TASK' first"
      guard; serve_ports; stop_one "$WHAT"
      P=$WEB; [ "$WHAT" = vite ] && P=$VITE
      n=0; until port_free "$P"; do n=$((n + 1)); [ $n -gt 15 ] && die "port $P still busy after stopping $WHAT"; sleep 1; done
      if [ "$WHAT" = web ]; then start_web; wait_up "http://127.0.0.1:$WEB/api/method/ping"
      else start_vite; wait_up "http://127.0.0.1:$VITE/"; fi
      took "restarted $WHAT"
      ;;
    stop)
      check_task "$1"; stop_serving ;;
    vitest)
      WT="$1"; shift; FE="$WT/frontend"
      [ -d "$FE" ] || die "no frontend folder in $WT"
      ensure_node_modules "$FE"; cd "$FE"
      echo "  code  : $FE"
      NO_COLOR=1 exec node_modules/.bin/vitest run "$@"
      ;;
    typecheck)
      WT="$1"; shift; FE="$WT/frontend"
      [ -d "$FE" ] || die "no frontend folder in $WT"
      [ -f "$FE/scripts/typecheck.mjs" ] \
        || die "this checkout has no frontend/scripts/typecheck.mjs yet (it arrives with branch chore/dev-loop-speed)"
      ensure_node_modules "$FE"; cd "$FE"
      # tsc's incremental cache: a worktree's first run starts from the last finished run's (any checkout), so it
      # rechecks only what differs (about 15 s) instead of the whole project (about 3 min).
      seed="$BENCHES/.tsbuildinfo-seed"
      [ -f .tsbuildinfo ] || [ ! -f "$seed" ] || cp "$seed" .tsbuildinfo
      echo "  code  : $FE"
      # One tsc at a time: each takes 1-2 GB, and Docker has about 5.5 GB for Postgres, every bench and every walk.
      lock="$BENCHES/.tsc.lock"; n=0
      until mkdir "$lock" 2>/dev/null; do
        [ -n "$(find "$lock" -maxdepth 0 -mmin +15 2>/dev/null)" ] && { rmdir "$lock" 2>/dev/null || true; continue; }
        [ $n = 0 ] && echo "  another typecheck is running; waiting for it"
        n=$((n + 1)); [ $n -gt 540 ] && die "waited 9 min for $lock"; sleep 1
      done
      trap 'rmdir "$lock" 2>/dev/null || true' EXIT
      rc=0; NODE_OPTIONS=--max-old-space-size=3072 node scripts/typecheck.mjs "$@" || rc=$?
      # 0 and 1 both leave a complete cache (1 = new errors found); 2 = tsc itself failed, so keep the old seed.
      [ $rc -le 1 ] && [ -f .tsbuildinfo ] && cp .tsbuildinfo "$seed.tmp" && mv "$seed.tmp" "$seed"
      exit $rc
      ;;
    dbs)   # task DBs, one per line
      psql -Atc "select datname from pg_database where datname like 't\_%'" ;;
    template-age)
      psql -Atc "select coalesce(shobj_description(oid, 'pg_database'), 'build date unknown') from pg_database where datname = '$TPL_DB'" ;;
    *) die "unknown internal command $CMD" ;;
  esac
  exit 0
fi

# ---------------------------------------------------------------- on the host
in_container && die "run this on the host, not inside the container"

reserve_slot() {   # claim the first unused web-port slot 2..5 for $B (0 = test-only) and print it
  local lock="$BENCHES/.slot.lock" used s n=0
  until mkdir "$lock" 2>/dev/null; do                 # concurrent `up` calls take turns
    n=$((n + 1)); [ $n -gt 300 ] && die "stale $lock (remove it if no devenv is running)"; sleep 0.2
  done
  used="$( { cat "$BENCHES"/*/.slot 2>/dev/null
             cat "$BENCHES"/*/sites/common_site_config.json 2>/dev/null | grep -o '"webserver_port": 800[2-5]' | grep -o '[0-9]$'
           } || true)"
  s=0; for c in 2 3 4 5; do echo "$used" | grep -qx "$c" || { s=$c; break; }; done
  echo "$s" > "$B/.slot"; rmdir "$lock"; echo "$s"
}

preflight() {      # refuse when Postgres is short of disk; show how old the template is
  local free_kb
  free_kb="$(docker exec "${CONTAINER%-frappe-1}-postgresql-1" df -Pk /var/lib/postgresql/data | awk 'NR==2{print $4}')"
  [ "$free_kb" -gt $((4 * 1024 * 1024)) ] || die "Postgres disk has only $((free_kb / 1024)) MB free; run '$0 gc' first"
  echo "  template $TPL_DB: $(inside template-age)   postgres disk free: $((free_kb / 1024 / 1024)) GB"
  # data.sh restore stamps the data it loaded. Past 7 days, the owner supplies a fresh backup; an agent never fetches one.
  local stamp="$M/sites/localhost/data_stamp.json"
  if [ -f "$stamp" ]; then
    python3 - "$stamp" <<'PY'
import json, sys, datetime
s = json.load(open(sys.argv[1]))
days = (datetime.datetime.now() - datetime.datetime.fromisoformat(s["backup_time"])).days
print(f"  data: backup of {s['backup_time']} ({s['source']}), {days} days old")
if days > 7:
    print(f"  WARN data is {days} days old: ask the owner for a fresh backup (scripts/devenv/data.sh). Do not fetch one yourself.")
PY
  else
    echo "  data: date unknown (no data_stamp.json; scripts/devenv/data.sh restore writes one)"
  fi
  # Production deploys frappe's version-15 head; the boxes follow it by bootstrap.sh bump, which only the owner runs.
  local have newest
  have="$(git -C "$M/apps/frappe" describe --tags --exact-match 2>/dev/null || echo "an untagged commit")"
  newest="$(git ls-remote --tags https://github.com/frappe/frappe 'v15.*' 2>/dev/null | sed 's|.*refs/tags/||' \
            | grep -E '^v15\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
  if [ -n "$newest" ] && [ "$have" != "$newest" ]; then
    echo "  WARN frappe is $have; production deploys $newest: tell the owner (scripts/devenv/bootstrap.sh bump). Do not run it yourself."
  fi
}

task_for() {    # print the task whose apps/nirmaan_stack is the given worktree
  local d
  for d in "$BENCHES"/*/apps/nirmaan_stack; do
    [ -e "$d" ] && [ "$(cd "$d" && pwd -P)" = "$1" ] && { basename "$(dirname "$(dirname "$d")")"; return 0; }
  done
  return 1
}

pick_task() {   # task from the first argument, else from the worktree we are standing in
  PICKED_FROM_ARG=0
  # destroy and reset take only a task: a name with no env behind it is a typo, never "the folder I stand in".
  if [ "${STRICT_TASK:-0}" = 1 ] && [ -n "${1:-}" ] && [ "${1#-}" = "$1" ] && [ ! -d "$BENCHES/$1" ]; then
    die "no env named '$1' (run '$0 list'). $CMD never falls back to the env of the folder you stand in."
  fi
  if [ -n "${1:-}" ] && [ -d "$BENCHES/$1" ]; then check_task "$1"; PICKED_FROM_ARG=1; return; fi
  local wt t; wt="$(git rev-parse --show-toplevel 2>/dev/null)" || die "give a task name, or run this inside its worktree"
  t="$(task_for "$(cd "$wt" && pwd -P)")" || die "no env for $wt yet: run '$0 up' first"
  check_task "$t"
}

# ---- prune. A row is one candidate: R_KIND (env | worktree), R_NAME, R_TASK (its env, or empty), R_BENCH (the env's
# folder, or empty), R_WT (the worktree, physical, or empty), R_SHA (its HEAD), R_LOCKED and R_GONE (1 or empty),
# R_STATUS (git status --porcelain). PRUNE iff landed.sh finds a ref holding R_SHA and no hold in PRUNE_HOLDS applies.
# hold_<name> prints the hold, with a detail after a colon, when it applies to the row.
PRUNE_HOLDS="shared here missing no-worktree locked serving agent new bench-files tracked-changes untracked"

hold_shared() {
  local p; case "$R_TASK" in dev|master|lab) echo shared; return ;; esac
  for p in $SHARED_WTS; do [ "$R_WT" != "$p" ] || { echo shared; return; }; done
}
hold_here() {
  local p; for p in "$R_WT" "$R_BENCH"; do
    [ -z "$p" ] || case "$CALLER/" in "$p"/*) echo here; return ;; esac
  done
}
hold_missing() { [ -z "$R_GONE" ] || echo "missing:git-worktree-prune"; }
hold_no_worktree() { [ -n "$R_WT$R_GONE" ] || echo no-worktree; }
hold_locked() { [ -z "$R_LOCKED" ] || echo locked; }
hold_serving() { [ -z "$R_BENCH" ] || [ ! -f "$R_BENCH/.serve" ] || echo serving; }
hold_agent() {
  local who
  who="$(printf '%s\n' "$PROCS" | awk -F'\t' -v a="$R_WT" -v b="$R_BENCH" \
    '(a != "" && ($3 == a || index($3, a "/") == 1)) || (b != "" && ($3 == b || index($3, b "/") == 1)) {print $2 "/" $1}' \
    | sort -u | paste -sd, -)"
  [ -z "$who" ] || echo "agent:$who"
}
# A worktree made under a day ago with no commit of its own sits at a commit a ref already holds, so it reads as
# landed while its user is about to start. Its age is its oldest HEAD reflog entry. Entries that make a commit:
# commit (merge, amend), cherry-pick, revert, a rebase's pick/squash/fixup/reword, a merge's "Merge made by".
hold_new() {
  [ -n "$R_WT" ] && [ -z "$R_GONE" ] || return 0
  git -C "$R_WT" reflog --date=unix --format='%gd%x09%gs' HEAD 2>/dev/null | awk -F'\t' -v now="$(date +%s)" '
    match($1, /[0-9]+/) {first = substr($1, RSTART, RLENGTH)}
    $2 ~ /^(commit|cherry-pick|revert)|\((pick|squash|fixup|reword)\)|: Merge made by/ {own = 1}
    END {if (first != "" && !own && now - first < 86400) printf "new:%dh\n", (now - first) / 3600}' || true
}
# Files destroy leaves, so its rmdir would fail: the owner's reports and repair scripts have sat there.
hold_bench_files() {
  [ -n "$R_BENCH" ] || return 0
  local f extra=""
  for f in "$R_BENCH"/* "$R_BENCH"/.[!.]* "$R_BENCH"/apps/* "$R_BENCH"/apps/.[!.]*; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    case "${f#"$R_BENCH"/}" in
      sites|logs|config|env|Procfile|.vite-cache|tmp|.migrated-schema|.migrated-schema.next|.slot|.serve|apps) ;;
      apps/nirmaan_stack) ;;
      apps/*) [ -L "$f" ] || extra="$extra,${f#"$R_BENCH"/}" ;;
      *) extra="$extra,${f#"$R_BENCH"/}" ;;
    esac
  done
  [ -z "$extra" ] || echo "bench-files:${extra#,}"
}
hold_tracked_changes() {
  local n; n="$(printf '%s\n' "$R_STATUS" | grep -c '^[^?]' || true)"
  [ "$n" = 0 ] || echo "tracked-changes:$n"
}
hold_untracked() {
  local n; n="$(printf '%s\n' "$R_STATUS" | grep -c '^??' || true)"
  [ "$n" = 0 ] || echo "untracked:$n"
}

phys() { (cd "$1" 2>/dev/null && pwd -P) || echo "$1"; }

# "<pid>\t<command>\t<cwd>" per process this user can see, except this shell and its parents (the caller's own
# shell is the `here` hold). Call it in $(...): it moves to /, so the listing's own processes match no row.
proc_cwds() {
  local skip=" " p=$$
  cd /
  while [ -n "$p" ] && [ "$p" -gt 1 ]; do skip="$skip$p "; p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"; done
  case "$(uname)" in
    Linux) for d in /proc/[0-9]*; do
             c="$(readlink "$d/cwd" 2>/dev/null)" && printf '%s\t%s\t%s\n' "${d#/proc/}" "$(cat "$d/comm" 2>/dev/null)" "$c"
           done ;;
    *) lsof -a -d cwd -Fpcn 2>/dev/null \
         | awk '/^p/ {p = substr($0, 2)} /^c/ {c = substr($0, 2)} /^n/ {print p "\t" c "\t" substr($0, 2)}' ;;
  esac | awk -F'\t' -v skip="$skip" 'index(skip, " " $1 " ") == 0'
}

# One line per row, fields split by US (\037; read merges empty fields split by a tab): kind, name, task, bench,
# worktree, sha, locked, gone. Every env, then every worktree of the repo no env claims (an env's worktree is
# benches/<task>/apps/nirmaan_stack, made by create or linked by up).
US=$'\037'
prune_rows() {
  local wts d t l wt e
  wts="$(git -C "$MAIN_GIT" worktree list --porcelain | awk -v OFS="$US" '
    function out() { if (p != "") print p, h, b, l, x }
    /^worktree / {out(); p = substr($0, 10); h = ""; b = ""; l = ""; x = ""}
    /^HEAD / {h = $2} /^branch / {b = substr($0, 8); sub(/^refs\/heads\//, "", b)}
    /^locked/ {l = 1} /^prunable/ {x = 1} END {out()}' | while IFS="$US" read -r p h b l x; do
      echo "$(phys "$p")$US$h$US${b:-detached}$US$l$US$x"; done)"
  for d in "$BENCHES"/*/; do
    [ -d "$d" ] || continue
    t="$(basename "$d")"; l="$BENCHES/$t/apps/nirmaan_stack"
    if [ -e "$l" ]; then
      wt="$(phys "$l")"
      e="$(printf '%s\n' "$wts" | awk -F"$US" -v w="$wt" '$1 == w {print; exit}')"
      echo "env$US$t$US$t$US$(phys "$d")$US$wt$US$(echo "$e" | cut -d"$US" -f2)$US$(echo "$e" | cut -d"$US" -f4)$US"
      wts="$(printf '%s\n' "$wts" | awk -F"$US" -v w="$wt" '$1 != w')"
    else
      echo "env$US$t$US$t$US$(phys "$d")$US$US$US$US$([ -L "$l" ] && echo 1)"
    fi
  done
  printf '%s\n' "$wts" | while IFS="$US" read -r p h b l x; do
    [ -z "$p" ] || echo "worktree$US$b$US$US$US$p$US$h$US$l$US$x"
  done
}

# prune <yes> <quiet>. Lists, then with yes removes each PRUNE row: destroy for an env (it removes a create worktree),
# then git worktree remove for a worktree still there. Never forced and never rm -rf, so a second run finds nothing.
prune() {
  local yes="$1" quiet="$2" HP rows h d line rel prune_lines="" keep_lines="" todo="" n_env=0 n_wt=0 failed=0
  HP="$(phys "$HERE")"; CALLER="$(pwd -P)"
  SHARED_WTS="$(phys "$HERE/nirmaan_stack_variants/dev") $(phys "$HERE/nirmaan_stack_variants/master")"
  SHARED_WTS="$SHARED_WTS $(phys "$HERE/nirmaan_stack_variants/lab") $(phys "$(git -C "$MAIN_GIT" worktree list --porcelain | sed -n '1s/^worktree //p')")"
  PROCS="$(proc_cwds)"
  rows="$(prune_rows)"
  while IFS="$US" read -r R_KIND R_NAME R_TASK R_BENCH R_WT R_SHA R_LOCKED R_GONE; do
    [ -n "$R_KIND" ] || continue
    R_STATUS=""; [ -z "$R_WT" ] || R_STATUS="$(git -C "$R_WT" status --porcelain 2>/dev/null || true)"
    R_HOLDS=""
    for h in $PRUNE_HOLDS; do d="$(hold_${h//-/_})"; [ -z "$d" ] || R_HOLDS="$R_HOLDS $d"; done
    # --quiet runs after every merge into master (the post-merge hook), so it stays fast: a held row is never pruned
    # and is not checked, and a merge lands work by ancestry, so it skips the slow equal-patch check.
    R_LANDED=""
    if [ "$quiet" = 0 ]; then
      [ -z "$R_SHA" ] || R_LANDED="$(cd "$MAIN_GIT" && landed "$R_SHA")" || R_LANDED=""
    elif [ -n "$R_SHA" ] && [ -z "$R_HOLDS" ]; then
      R_LANDED="$(cd "$MAIN_GIT" && landed "$R_SHA" --ancestry-only)" || R_LANDED=""
    fi
    rel="${R_WT:-$R_BENCH}"; rel="${rel#"$HP"/}"
    if [ -n "$R_LANDED" ] && [ -z "$R_HOLDS" ]; then
      line="$(printf 'PRUNE  %-8s %-34s %-52s landed:%s' "$R_KIND" "$R_NAME" "$rel" "$R_LANDED")"
      prune_lines="$prune_lines$line"$'\n'
      todo="$todo$R_TASK$US$R_WT"$'\n'
      if [ -n "$R_TASK" ]; then n_env=$((n_env + 1)); else n_wt=$((n_wt + 1)); fi
    else
      line="$(printf 'KEEP   %-8s %-34s %-52s landed:%-18s%s' "$R_KIND" "$R_NAME" "$rel" "${R_LANDED:--}" "$R_HOLDS")"
      keep_lines="$keep_lines$line"$'\n'
    fi
  done <<<"$rows"
  [ "$quiet" = 0 ] || [ -n "$prune_lines" ] || return 0
  echo "== prune on $(hostname -s): envs and worktrees whose work has landed in a ref"
  printf '%s' "$prune_lines"
  [ "$quiet" = 1 ] || printf '%s' "$keep_lines"
  echo "to prune: $n_env envs, $n_wt worktrees$([ "$yes" = 1 ] || [ -z "$prune_lines" ] || echo " (devenv.sh prune --yes removes them; branches stay)")"
  [ "$yes" = 1 ] || return 0
  while IFS="$US" read -r t wt; do
    [ -n "$t$wt" ] || continue
    if [ -n "$t" ]; then
      bash "$SELF_DIR/devenv.sh" destroy "$t" </dev/null || { echo "FAILED destroy $t"; failed=1; continue; }
    fi
    if [ -n "$wt" ] && [ -d "$wt" ]; then
      git -C "$MAIN_GIT" worktree remove "$wt" && echo "removed worktree $wt" || { echo "FAILED git worktree remove $wt"; failed=1; }
    fi
  done <<<"$todo"
  return "$failed"
}
CMD="${1:-}"; shift || true
case "$CMD" in
  template-build|template-drop)
    inside "$CMD" ;;
  create)
    check_task "${1:-}"; shift
    BRANCH=""; REF=""; ON=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --branch) BRANCH="${2:?--branch needs a name}"; shift 2 ;;
        --on) ON="${2:?--on needs a branch}"; shift 2 ;;
        *) REF="$1"; shift ;;
      esac
    done
    [ -n "$ON" ] && { [ -z "$BRANCH$REF" ] || die "--on takes no ref and no --branch"; }
    REF="${REF:-$(git rev-parse HEAD 2>/dev/null || git -C "$MAIN_GIT" rev-parse HEAD)}"
    [ -e "$B" ] && die "$B already exists"
    preflight
    mkdir -p "$B/apps"
    if [ -n "$ON" ]; then     # an existing branch, e.g. one handoff.sh brought: commits land on it
      git -C "$MAIN_GIT" worktree add "$B/apps/nirmaan_stack" "$ON"
    elif [ -n "$BRANCH" ]; then
      git -C "$MAIN_GIT" worktree add -b "$BRANCH" "$B/apps/nirmaan_stack" "$REF"
    else
      git -C "$MAIN_GIT" worktree add --detach "$B/apps/nirmaan_stack" "$REF"
    fi
    # Relative gitdir so git also works inside the container (same trick as nirmaan_stack_variants/master).
    wt="$(sed 's/^gitdir: //' "$B/apps/nirmaan_stack/.git")"
    rel="$(python3 -c 'import os,sys;print(os.path.relpath(sys.argv[1],sys.argv[2]))' "$wt" "$B/apps/nirmaan_stack")"
    echo "gitdir: $rel" > "$B/apps/nirmaan_stack/.git"
    inside create "$TASK" "$(reserve_slot)"
    echo "Ready. Worktree: $B/apps/nirmaan_stack${BRANCH:+ (branch $BRANCH)}${ON:+ (on branch $ON)}   Site: $SITE   DB: $DB"
    echo "Test:  $0 test $TASK --module nirmaan_stack.<path>.test_<x>"
    ;;
  up)
    WT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run 'up' from inside a git worktree"
    WT="$(cd "$WT" && pwd -P)"
    case "$WT/" in "$(cd "$HERE" && pwd -P)"/*) ;; *) die "$WT is outside $HERE, so the container cannot see it. Put worktrees under $HERE." ;; esac
    [ "$WT" = "$(cd "$M/apps/nirmaan_stack" && pwd -P)" ] \
      && echo "  note: the main bench (:8000, site localhost) also runs this checkout; this env is separate from it"
    if found="$(task_for "$WT")"; then echo "Env already exists: $found"; exit 0; fi
    name="$(basename "$WT" | tr 'A-Z_.' 'a-z--' | tr -cd 'a-z0-9-' | cut -c1-31)"
    check_task "$name"; [ -e "$B" ] && die "$B already exists for another worktree"
    preflight
    mkdir -p "$B/apps"
    ln -s "$(python3 -c 'import os,sys;print(os.path.relpath(sys.argv[1],sys.argv[2]))' "$WT" "$B/apps")" "$B/apps/nirmaan_stack"
    inside create "$TASK" "$(reserve_slot)"
    echo "Ready. Task: $TASK   Site: $SITE   DB: $DB   (worktree $WT)"
    ;;
  affected)
    [ $# -eq 1 ] || die "give a base ref, e.g. $0 affected spec/1470"
    WT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run 'affected' from inside a checkout or worktree"
    python3 -I "$SELF_DIR/devenv_affected.py" "$(cd "$WT" && pwd -P)" "$1" ;;
  unit|vitest|typecheck)
    [ "$CMD" != unit ] || [ $# -gt 0 ] || die "give a module, e.g. $0 unit nirmaan_stack.services.test_approval_tiers"
    WT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run '$CMD' from inside a checkout or worktree"
    WT="$(cd "$WT" && pwd -P)"; H="$(cd "$HERE" && pwd -P)"
    case "$WT/" in "$H"/*) ;; *) die "$WT is outside $HERE, so the container cannot see it." ;; esac
    rc=0; inside "$CMD" "/workspace/development/${WT#"$H"/}" "$@" || rc=$?
    case "$CMD" in unit|typecheck) proof "$WT" "$CMD" "$rc" ;; esac
    exit $rc ;;
  test|run|reset|serve|stop|restart)
    [ "$CMD" = reset ] && STRICT_TASK=1
    pick_task "$@"; [ "$PICKED_FROM_ARG" = 1 ] && shift
    [ -d "$B/sites" ] || die "no env named $TASK"
    if [ "$CMD" = test ]; then
      # --affected <base>: expand here, on the host, where git works for every worktree.
      ARGS=(); AFFECTED=0; AFF_BASE=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --affected)
            AFFECTED=1; AFF_BASE="$(git -C "$B/apps/nirmaan_stack" rev-parse "${2:?--affected needs a base ref}^{commit}")"
            mods="$(python3 -I "$SELF_DIR/devenv_affected.py" "$(cd "$B/apps/nirmaan_stack" && pwd -P)" "${2:?--affected needs a base ref}")" \
              || exit 1
            for m in $mods; do ARGS+=(--module "$m"); done; shift 2 ;;
          *) ARGS+=("$1"); shift ;;
        esac
      done
      # A loop, not `printf | grep -q`: under pipefail, grep -q exiting on the first match sends printf SIGPIPE
      # on a long module list, and the pipeline reads as "no module" (a run of 325 modules ran none).
      HAS_MODULE=0; for a in ${ARGS[@]+"${ARGS[@]}"}; do [ "$a" != --module ] || HAS_MODULE=1; done
      if [ "$AFFECTED" = 1 ] && [ "$HAS_MODULE" = 0 ]; then
        echo "devenv: no backend test module is affected; nothing to run"
        proof "$B/apps/nirmaan_stack" test 0 "{\"affected_base\": \"$AFF_BASE\", \"modules\": 0}"; exit 0
      fi
      rc=0; inside "$CMD" "$TASK" ${ARGS[@]+"${ARGS[@]}"} < /dev/null || rc=$?   # never swallow the caller's stdin
      proof "$B/apps/nirmaan_stack" test "$rc" "{\"affected_base\": \"${AFF_BASE:-}\"}"
      exit $rc
    elif [ "$CMD" = serve ]; then
      WALK_VITE_PORTS="$(published_vite_ports)" inside "$CMD" "$TASK" "$@"
    else
      inside "$CMD" "$TASK" "$@"
    fi ;;
  script)
    pick_task "$@"; [ "$PICKED_FROM_ARG" = 1 ] && shift
    [ -d "$B/sites" ] || die "no env named $TASK"
    [ -f "${1:-}" ] || die "give a Python file, e.g. $0 script $TASK ./check.py"
    mkdir -p "$B/tmp"; F="$(basename "$1")"; cp "$1" "$B/tmp/$F"; shift
    inside script "$TASK" "$F" "$@" ;;
  destroy)
    SHARED=0; ARGS=()
    for a in "$@"; do [ "$a" = --shared ] && SHARED=1 || ARGS+=("$a"); done
    set -- "${ARGS[@]+"${ARGS[@]}"}"
    STRICT_TASK=1 pick_task "$@"; [ -d "$B" ] || die "no env named $TASK"
    case "$TASK" in dev|master|lab)
      [ "$SHARED" = 1 ] || die "'$TASK' is the user's own env for that checkout. Leave it, or pass --shared if the user asked." ;;
    esac
    if [ -L "$B/apps/nirmaan_stack" ]; then        # made by `up`: leave the worktree alone
      inside destroy "$TASK"; rm "$B/apps/nirmaan_stack"
    else
      [ -z "$(git -C "$B/apps/nirmaan_stack" status --porcelain 2>/dev/null)" ] \
        || die "worktree has uncommitted changes. Commit them (or delete them yourself) first."
      inside destroy "$TASK"
      git -C "$MAIN_GIT" worktree remove "$B/apps/nirmaan_stack"
    fi
    rm -f "$B/.slot"; rmdir "$B/apps" "$B"
    echo "Destroyed env $TASK. Commits stay in git."
    ;;
  list)
    for d in "$BENCHES"/*/; do
      t="$(basename "$d")"; lane="$(sed -n 's/^ports=[0-9]* //p' "$d/.serve" 2>/dev/null | head -1 || true)"
      [ -d "$d/sites" ] && echo "$t  $(git -C "$d/apps/nirmaan_stack" log -1 --format='%h %s' 2>/dev/null)$([ -f "$d/.serve" ] && echo "   [serving${lane:+ at http://t-$t.localhost:$lane/}: '$0 stop $t']")"
    done
    echo "walk lanes (published vite ports): $(published_vite_ports)"
    docker exec "$CONTAINER" bash -c "PGPASSWORD=123 psql -h postgresql -U postgres -Atc \"select datname, pg_size_pretty(pg_database_size(datname)) from pg_database where datname like 't\\_%' or datname='$TPL_DB'\""
    echo "postgres disk free: $(( $(docker exec "${CONTAINER%-frappe-1}-postgresql-1" df -Pk /var/lib/postgresql/data | awk 'NR==2{print $4}') / 1024 / 1024 )) GB"
    ;;
  gc)
    YES=0; [ "${1:-}" = "--yes" ] && YES=1
    found=0
    for d in "$BENCHES"/*/; do
      t="$(basename "$d")"; l="$d/apps/nirmaan_stack"
      if [ -L "$l" ] && [ ! -e "$l" ]; then
        found=1; echo "env $t: its worktree is gone"
        if [ $YES = 1 ]; then check_task "$t"; inside destroy "$t"; rm -f "$l" "$B/.slot"; rmdir "$B/apps" "$B"; fi
      fi
    done
    for db in $(inside dbs); do
      t=""; for n in $(ls "$BENCHES"); do [ "t_${n//-/_}" = "$db" ] && t="$n"; done
      [ -n "$t" ] && continue
      found=1; echo "DB $db: no bench folder uses it"
      [ $YES = 1 ] && docker exec "$CONTAINER" bash -c "PGPASSWORD=123 psql -h postgresql -U postgres -qc 'DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)' -c 'DROP ROLE IF EXISTS \"$db\"'"
    done
    [ $found = 0 ] && echo "nothing to clean"
    [ $found = 1 ] && [ $YES = 0 ] && echo "(dry run: add --yes to remove the above)"
    true
    ;;
  prune)
    YES=0 QUIET=0
    for a in "$@"; do
      case "$a" in --yes) YES=1 ;; --quiet) QUIET=1 ;; *) die "usage: $0 prune [--yes] [--quiet]" ;; esac
    done
    . "$SELF_DIR/landed.sh"
    prune "$YES" "$QUIET" ;;
  *) sed -n '2,65p' "$0"; exit 1 ;;
esac
exit
}
