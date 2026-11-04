#!/usr/bin/env bash
# Build a dev box (the Mac or a Linux VM) that devenv.sh and the verify skill run on, from this checkout alone.
#
#   bootstrap.sh all          every step below, in order; then: data.sh restore <backup> (the data is never in git)
#   bootstrap.sh <step>       one step: host | compose | bench | link | pylock | frontend | build | playwright
#   bootstrap.sh doctor       read-only: the box against apps.lock.json, plus the data's and template's age
#   bootstrap.sh lock         rewrite apps.lock.json and python.lock.txt from this box's bench (after an upgrade)
#   bootstrap.sh bump         the owner, on the laptop: move frappe to its newest v15 release, rewrite both locks,
#                             migrate localhost, rebuild the Desk assets and the template. Then the full test suite.
#   bootstrap.sh follow       every other box, after pulling a bumped lock: the same, with the locked packages
#
# Production deploys frappe's version-15 branch head, so the boxes follow it: `bump` about weekly, whenever `doctor`
# or `devenv.sh up` warns that frappe is behind (owner, 2026-11-04; revisit when a CI/CD pipeline pins one version
# for both). Every package must meet every app's pins, git pins included (pins_check.py): `bench`, `pylock`, `lock`,
# `bump` and `doctor` refuse a bench or a lock that breaks one.
#
# Every step checks first and skips what is already right, so a step (or `all`) is safe to run again after a failure.
# `compose` never replaces an existing docker-compose.yml that differs from compose.yml unless given --force (it
# keeps a dated backup): the Mac's own file holds local settings.
#
# Layout, the same on every box (this checkout must sit at nirmaan_stack_variants/<name>):
#   <frappe_docker>/.devcontainer/docker-compose.yml        from compose.yml
#   <frappe_docker>/development/                            the dev root; /workspace/development in the container
#     frappe-bench/   apps/nirmaan_stack -> ../../nirmaan_stack_variants/<name>
#     nirmaan_stack_variants/<name>/   (this checkout)       benches/   (task envs, made by devenv.sh)
# The whole body sits in { ... } so bash parses it before running: editing this file mid-run is safe.
{
set -euo pipefail

die() { echo "FAIL  $*" >&2; exit 1; }
ok() { echo "ok    $*"; }
skip() { echo "skip  $*"; }
step() { echo; echo "== $*"; }

SELF_DIR="$(cd "$(dirname "$0")" && pwd -P)"
CHECKOUT="$(cd "$SELF_DIR/../.." && pwd -P)"
[ "$(basename "$(dirname "$CHECKOUT")")" = nirmaan_stack_variants ] \
  || die "this checkout must sit at <frappe_docker>/development/nirmaan_stack_variants/<name>, not $CHECKOUT"
ROOT="$(dirname "$(dirname "$CHECKOUT")")"
[ "$(basename "$ROOT")" = development ] || die "the dev root must be named development, not $ROOT"
FD="$(dirname "$ROOT")"
NAME="$(basename "$CHECKOUT")"
LOCK="$SELF_DIR/apps.lock.json"
PROJECT=frappe_docker_devcontainer
CONTAINER="$PROJECT-frappe-1"; PG="$PROJECT-postgresql-1"
COMPOSE="$FD/.devcontainer/docker-compose.yml"
BENCH="$ROOT/frappe-bench"

lock() { python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(eval(sys.argv[2],{},{"d":d}))' "$LOCK" "$1"; }
inside() { docker exec -i -w /workspace/development "$CONTAINER" bash -lc "$1"; }   # login shell: pyenv, nvm, bench
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
pins_check() { inside "cd frappe-bench && env/bin/python -I /workspace/development/nirmaan_stack_variants/$NAME/scripts/devenv/pins_check.py $*"; }
newest_v15() {   # frappe's newest v15 release tag on GitHub; empty when offline
  git ls-remote --tags "$(lock 'd["frappe"]["url"]')" 'v15.*' 2>/dev/null | sed 's|.*refs/tags/||' \
    | grep -E '^v15\.[0-9]+\.[0-9]+$' | sort -V | tail -1
}

host() {
  step "host"
  for c in docker git python3 curl; do command -v "$c" >/dev/null || die "missing $c"; done
  docker info >/dev/null 2>&1 || die "this user cannot use docker (add it to the docker group, then log in again)"
  docker compose version >/dev/null 2>&1 || die "missing the docker compose plugin"
  ok "docker, compose, git, python3, curl"
  local free; free=$(( $(df -Pk "$FD" | awk 'NR==2{print $4}') / 1024 / 1024 ))
  [ "$free" -ge 20 ] || die "only $free GB free at $FD; a box needs about 20 GB"
  ok "$free GB free at $FD"
  mkdir -p "$HOME/.claude" "$ROOT/benches"   # compose mounts ~/.claude; docker would make it root-owned
  ok "~/.claude and benches/ exist"
}

compose() {
  step "compose"
  mkdir -p "$(dirname "$COMPOSE")"
  if [ ! -f "$COMPOSE" ]; then cp "$SELF_DIR/compose.yml" "$COMPOSE"; ok "wrote $COMPOSE"
  elif cmp -s "$SELF_DIR/compose.yml" "$COMPOSE"; then skip "$COMPOSE matches compose.yml"
  elif [ "${FORCE:-0}" = 1 ]; then
    cp "$COMPOSE" "$COMPOSE.bak-$(date +%Y%m%d%H%M%S)"; cp "$SELF_DIR/compose.yml" "$COMPOSE"; ok "replaced $COMPOSE (backup kept)"
  else
    echo "note  $COMPOSE differs from compose.yml; left as it is (diff them, or rerun with --force to replace it)"
  fi
  docker compose -p "$PROJECT" -f "$COMPOSE" up -d 2>&1 | grep -vE '^\s*$' | tail -8
  local n=0; until docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1; do
    n=$((n + 1)); [ $n -gt 60 ] && die "postgres did not come up"; sleep 1; done
  running "$CONTAINER" || die "$CONTAINER is not running"
  ok "containers up, postgres ready"
}

# The common site config of the main bench: what devenv.sh copies into every task bench.
write_common_config() {
  python3 - "$BENCH/sites/common_site_config.json" <<'PY'
import json, os, sys
path = sys.argv[1]
conf = json.load(open(path)) if os.path.exists(path) else {}
conf.update({
    "allow_cors": "*", "background_workers": 1, "db_host": "postgresql", "db_type": "postgres", "developer_mode": 1,
    "file_watcher_port": 6787, "frappe_user": "frappe", "gunicorn_workers": 4, "ignore_csrf": True,
    "live_reload": True, "maintenance_mode": 0, "pause_scheduler": 1, "rebase_on_pull": False,
    "redis_cache": "redis://redis-cache:6379", "redis_queue": "redis://redis-queue:6379",
    "redis_socketio": "redis://redis-queue:6379", "restart_supervisor_on_update": False,
    "restart_systemd_on_update": False, "serve_default_site": True, "shallow_clone": True, "socketio_port": 9000,
    "use_redis_auth": False, "webserver_port": 8000,
})
conf.pop("frappe_types_pause_generation", None)
json.dump(conf, open(path, "w"), indent=1)
PY
}

bench() {
  step "bench"
  local url ref commit py
  url="$(lock 'd["frappe"]["url"]')"; ref="$(lock 'd["frappe"]["ref"]')"; commit="$(lock 'd["frappe"]["commit"]')"
  py="$(lock 'd["python"]')"
  if [ -d "$BENCH/apps/frappe" ]; then skip "frappe-bench exists"
  else
    echo "      bench init: frappe $ref, python $py (several minutes)"
    inside "bench init --skip-redis-config-generation --skip-assets --frappe-path $url --frappe-branch $ref \
            --python \$HOME/.pyenv/versions/$py/bin/python frappe-bench" > "$ROOT/logs-bootstrap-bench-init.log" 2>&1 \
      || { tail -20 "$ROOT/logs-bootstrap-bench-init.log"; die "bench init failed (log: $ROOT/logs-bootstrap-bench-init.log)"; }
    ok "bench initialised"
  fi
  local moved=0 fr="$BENCH/apps/frappe"
  if [ "$(git -C "$fr" rev-parse HEAD)" != "$commit" ]; then
    [ -z "$(git -C "$fr" status --porcelain --untracked-files=no)" ] || die "apps/frappe has local changes; it cannot move to $ref"
    { git -C "$fr" fetch -q "$url" "$commit" && git -C "$fr" checkout -q "$commit"; } || die "could not move frappe to $ref ($commit)"
    moved=1
  fi
  ok "frappe at $ref"
  write_common_config; ok "common_site_config.json"
  printf '%s\n' 'web: bench serve  --port 8000' 'socketio: node apps/frappe/socketio.js' \
    '# watch: bench watch   # off: about 0.9 GB; run `bench build --app <app>` after Desk JS/CSS edits' \
    'schedule: bench schedule' 'worker:  bench worker 1>> logs/worker.log 2>> logs/worker.error.log' > "$BENCH/Procfile"
  local n i name app_url branch app_commit
  n="$(lock 'len(d["apps"])')"
  for ((i = 0; i < n; i++)); do
    name="$(lock "d['apps'][$i]['name']")"; app_url="$(lock "d['apps'][$i]['url']")"
    branch="$(lock "d['apps'][$i]['branch']")"; app_commit="$(lock "d['apps'][$i]['commit']")"
    if [ ! -d "$BENCH/apps/$name" ]; then
      inside "cd frappe-bench && bench get-app --skip-assets --branch $branch $app_url" > "$ROOT/logs-bootstrap-get-app.log" 2>&1 \
        || { tail -20 "$ROOT/logs-bootstrap-get-app.log"; die "get-app $name failed"; }
    fi
    if [ "$(git -C "$BENCH/apps/$name" rev-parse HEAD)" != "$app_commit" ]; then
      inside "cd frappe-bench/apps/$name && git fetch -q --depth 1 $app_url $app_commit && git checkout -q $app_commit && \
              cd ../.. && env/bin/pip install -q -e apps/$name" || die "could not pin $name to $app_commit"
    fi
    ok "$name at ${app_commit:0:9}"
  done
  if [ $moved = 1 ] || ! pins_check >/dev/null; then
    echo "      bench setup requirements: frappe moved, or a package breaks an app's pins (several minutes)"
    inside "cd frappe-bench && bench setup requirements" > "$ROOT/logs-bootstrap-requirements.log" 2>&1 \
      || { tail -20 "$ROOT/logs-bootstrap-requirements.log"; die "bench setup requirements failed"; }
    pins_check --fix-git >/dev/null || true   # pylock or bump decides; pip leaves a PyPI release where a git pin is asked
    ok "requirements installed"
  fi
}

link() {
  step "link"
  local want="../../nirmaan_stack_variants/$NAME"
  if [ -L "$BENCH/apps/nirmaan_stack" ] && [ "$(readlink "$BENCH/apps/nirmaan_stack")" = "$want" ]; then
    skip "apps/nirmaan_stack -> $want"
  else
    [ -e "$BENCH/apps/nirmaan_stack" ] && [ ! -L "$BENCH/apps/nirmaan_stack" ] \
      && die "$BENCH/apps/nirmaan_stack is a real folder; move it away first"
    ln -sfn "$want" "$BENCH/apps/nirmaan_stack"; ok "apps/nirmaan_stack -> $want"
  fi
  inside "cd frappe-bench && env/bin/python -c 'import nirmaan_stack' 2>/dev/null || env/bin/pip install -q -e apps/nirmaan_stack"
  local where; where="$(inside "cd frappe-bench/sites && ../env/bin/python -c 'import nirmaan_stack;print(nirmaan_stack.__file__)'" | tail -1)"
  case "$where" in */nirmaan_stack_variants/"$NAME"/*|*/apps/nirmaan_stack/*) ok "nirmaan_stack imports from the checkout";;
    *) die "nirmaan_stack imports from $where";; esac
  lock '"\n".join(d["apps_txt"])' > "$BENCH/sites/apps.txt"; ok "sites/apps.txt: $(tr '\n' ' ' < "$BENCH/sites/apps.txt")"
}

# The env's Python packages, pinned to python.lock.txt. Installing the apps resolves their dependencies to the newest
# releases, so without this a new box drifts from the one the tests pass on.
pylock_diff() {   # prints one line per package whose installed version differs from python.lock.txt
  inside "cd frappe-bench && env/bin/pip freeze 2>/dev/null" | python3 -c '
import sys
import re
norm = lambda l: l.strip().lower().replace("_", "-")
name = lambda l: re.split(r"==| @ ", norm(l))[0]   # "pkg==1.2" or "pkg @ git+https://...@<commit>"
have = {name(l): norm(l) for l in sys.stdin if l.strip() and not l.startswith(("#", "-e "))}
for l in open(sys.argv[1]):
    if l.strip() and not l.startswith("#") and have.get(name(l)) != norm(l):
        print(l.strip(), "(installed:", have.get(name(l), "none") + ")")
' "$SELF_DIR/python.lock.txt"
}
pylock() {
  step "pylock"
  local diff; diff="$(pylock_diff)"
  if [ -z "$diff" ]; then skip "env matches python.lock.txt"
  else
    echo "      $(echo "$diff" | grep -c .) packages differ from python.lock.txt; installing the locked versions"
    inside "cd frappe-bench && env/bin/pip install -q --no-deps -r /workspace/development/nirmaan_stack_variants/$NAME/scripts/devenv/python.lock.txt" \
      > "$ROOT/logs-bootstrap-pylock.log" 2>&1 || { tail -20 "$ROOT/logs-bootstrap-pylock.log"; die "pip install of python.lock.txt failed"; }
    diff="$(pylock_diff)"; [ -z "$diff" ] || { echo "$diff" | head; die "the env still differs from python.lock.txt"; }
    ok "env matches python.lock.txt"
  fi
  pins_check || die "python.lock.txt breaks the app pins above, so it is stale: the owner runs bootstrap.sh bump"
  ok "every package meets every app's pins, git pins included"
}

lock_python() {
  { sed -n '1,2p' "$SELF_DIR/python.lock.txt"
    inside "cd frappe-bench && env/bin/pip freeze 2>/dev/null" | grep -vE '^(-e |#)' | sort; } > "$SELF_DIR/python.lock.txt.new"
  mv "$SELF_DIR/python.lock.txt.new" "$SELF_DIR/python.lock.txt"; echo "wrote $SELF_DIR/python.lock.txt"
}

after_frappe_moved() {   # localhost, the Desk assets and the template, on the frappe now in the bench
  step "migrate localhost, build, template"
  inside "cd frappe-bench && bench --site localhost migrate" > "$ROOT/logs-bootstrap-migrate.log" 2>&1 \
    || { tail -20 "$ROOT/logs-bootstrap-migrate.log"; die "migrate failed (log: $ROOT/logs-bootstrap-migrate.log)"; }
  ok "localhost migrated"
  FORCE=1 build
  "$SELF_DIR/devenv.sh" template-drop >/dev/null 2>&1 || true
  "$SELF_DIR/devenv.sh" template-build | tail -2
  echo "next: the full test suite; task envs made before keep their old DB until devenv.sh reset <task>"
}

bump() {
  step "bump: frappe to its newest v15 release (production deploys version-15)"
  local newest commit
  newest="$(newest_v15)"; [ -n "$newest" ] || die "could not read frappe's tags from GitHub"
  commit="$(git ls-remote "$(lock 'd["frappe"]["url"]')" "refs/tags/$newest" "refs/tags/$newest^{}" | sort -k2 | tail -1 | cut -f1)"
  python3 - "$LOCK" "$newest" "$commit" <<'PY'
import json, sys
path, ref, commit = sys.argv[1:]
d = json.load(open(path))
d["frappe"].update(ref=ref, commit=commit)
json.dump(d, open(path, "w"), indent=1); open(path, "a").write("\n")
PY
  ok "apps.lock.json: frappe $newest ($commit)"
  bench
  pins_check || die "frappe $newest's pins are not met after bench setup requirements (above)"
  lock_from_bench; lock_python
  after_frappe_moved
  echo "then commit scripts/devenv/apps.lock.json and python.lock.txt; the other boxes run bootstrap.sh follow"
}

frontend() {
  step "frontend"
  local fe="nirmaan_stack_variants/$NAME/frontend"
  if [ -d "$ROOT/$fe/node_modules/.bin" ] && [ "$ROOT/$fe/node_modules/.yarn-integrity" -nt "$ROOT/$fe/yarn.lock" ]; then
    skip "$fe/node_modules is current"
  else
    echo "      yarn install in the container (its own CPU arch; a few minutes)"
    inside "cd $fe && yarn install --frozen-lockfile --network-timeout 600000" > "$ROOT/logs-bootstrap-yarn.log" 2>&1 \
      || { tail -20 "$ROOT/logs-bootstrap-yarn.log"; die "yarn install failed"; }
    ok "$fe/node_modules installed"
  fi
}

build() {
  step "build"
  if [ -f "$BENCH/sites/assets/assets.json" ] && [ "${FORCE:-0}" != 1 ]; then skip "Desk assets exist (--force rebuilds)"
  else
    echo "      bench build (several minutes)"
    inside "cd frappe-bench && bench build" > "$ROOT/logs-bootstrap-build.log" 2>&1 \
      || { tail -20 "$ROOT/logs-bootstrap-build.log"; die "bench build failed (log: $ROOT/logs-bootstrap-build.log)"; }
    ok "Desk assets built"
  fi
}

playwright() {
  step "playwright (host: the verify skill drives the app from here)"
  if ! python3 -c 'import playwright' 2>/dev/null; then
    python3 -m pip --version >/dev/null 2>&1 || die "no pip for python3. As root: apt-get install -y python3-pip"
    python3 -m pip install -q --user playwright || die "pip install playwright failed"
  fi
  ok "Python Playwright installed"
  if python3 - <<'PY' 2>/dev/null
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    p.chromium.launch().close()
PY
  then ok "Chromium launches"
  else
    python3 -m playwright install chromium >/dev/null 2>&1 || true
    python3 - <<'PY' 2>/dev/null || die "Chromium lacks system libraries. As root: PYTHONPATH=$(python3 -m site --user-site) $(command -v python3) -m playwright install-deps chromium"
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    p.chromium.launch().close()
PY
    ok "Chromium installed and launches"
  fi
}

doctor() {
  step "doctor"
  local bad=0
  check() { if eval "$2"; then ok "$1"; else echo "FAIL  $1"; bad=1; fi; }
  check "containers running" 'running "$CONTAINER" && running "$PG"'
  if [ -f "$COMPOSE" ] && ! cmp -s "$SELF_DIR/compose.yml" "$COMPOSE"; then
    echo "note  $COMPOSE differs from compose.yml (compose --force replaces it, recreating the containers)"
  fi
  check "frappe at $(lock 'd["frappe"]["ref"]')" \
    '[ "$(git -C "$BENCH/apps/frappe" rev-parse HEAD 2>/dev/null)" = "$(lock "d[\"frappe\"][\"commit\"]")" ]'
  local n i name; n="$(lock 'len(d["apps"])')"
  for ((i = 0; i < n; i++)); do
    name="$(lock "d['apps'][$i]['name']")"
    check "$name at the locked commit" \
      '[ "$(git -C "$BENCH/apps/$name" rev-parse HEAD 2>/dev/null)" = "$(lock "d[\"apps\"][$i][\"commit\"]")" ]'
  done
  check "apps/nirmaan_stack -> this checkout" '[ "$(cd "$BENCH/apps/nirmaan_stack" 2>/dev/null && pwd -P)" = "$CHECKOUT" ]'
  check "sites/apps.txt as locked" '[ "$(cat "$BENCH/sites/apps.txt" 2>/dev/null)" = "$(lock "chr(10).join(d[\"apps_txt\"])")" ]'
  check "Python packages as locked" '[ -z "$(pylock_diff)" ]'
  check "every package meets every app's pins, git pins included" 'pins_check'
  local newest; newest="$(newest_v15)"
  if [ -z "$newest" ]; then echo "note  could not read frappe's newest v15 release (offline?)"
  elif [ "$newest" = "$(lock 'd["frappe"]["ref"]')" ]; then ok "frappe is its newest v15 release ($newest)"
  else echo "WARN  frappe locked at $(lock 'd["frappe"]["ref"]'); production deploys version-15, now $newest: bootstrap.sh bump"; fi
  check "Desk assets built" '[ -f "$BENCH/sites/assets/assets.json" ]'
  check "frontend node_modules" '[ -d "$ROOT/nirmaan_stack_variants/$NAME/frontend/node_modules/.bin" ]'
  check "Python Playwright on the host" 'python3 -c "import playwright" 2>/dev/null'
  if [ -f "$BENCH/sites/localhost/site_config.json" ]; then ok "site localhost exists"
  else echo "todo  no site localhost yet: scripts/devenv/data.sh restore <backup>"; bad=1; fi
  local stamp="$BENCH/sites/localhost/data_stamp.json"
  if [ -f "$stamp" ]; then
    local age; age="$(python3 - "$stamp" <<'PY'
import json, sys, datetime
s = json.load(open(sys.argv[1]))
t = datetime.datetime.fromisoformat(s["backup_time"])
print((datetime.datetime.now() - t).days, s["backup_time"], s["source"])
PY
)"
    set -- $age
    if [ "$1" -gt 7 ]; then echo "WARN  data is $1 days old ($2, $3): ask the owner for a fresh backup"
    else ok "data is $1 days old ($2, $3)"; fi
  else echo "note  no data_stamp.json: the data's date is unknown"; fi
  local tpl; tpl="$(docker exec "$CONTAINER" bash -c "PGPASSWORD=123 psql -h postgresql -U postgres -Atc \"select shobj_description(oid, 'pg_database') from pg_database where datname='nirmaan_tpl'\"" 2>/dev/null || true)"
  if [ -n "$tpl" ]; then ok "template nirmaan_tpl: $tpl"
  else echo "todo  no template nirmaan_tpl yet (data.sh restore builds it)"; bad=1; fi
  echo
  [ $bad = 0 ] && echo "doctor: box ready" || { echo "doctor: not ready (see FAIL / todo above)"; return 1; }
}

lock_from_bench() {
  python3 - "$BENCH" "$LOCK" <<'PY'
import json, re, subprocess, sys
bench, lock = sys.argv[1:]
g = lambda app, *a: subprocess.run(["git", "-C", f"{bench}/apps/{app}", *a], capture_output=True, text=True).stdout.strip()
d = json.load(open(lock))
order = [a for a in open(f"{bench}/sites/apps.txt").read().split() if a]
clean = lambda u: re.sub(r"https://[^@/]*@", "https://", u).removesuffix(".git")
d["frappe"]["commit"] = g("frappe", "rev-parse", "HEAD")
d["frappe"]["ref"] = g("frappe", "describe", "--tags", "--exact-match") or d["frappe"]["ref"]
old = {a["name"]: a for a in d["apps"]}
d["apps"] = []
for name in order:
    if name in ("frappe", "nirmaan_stack"):
        continue
    remote = g(name, "remote")
    d["apps"].append({"name": name, "url": clean(g(name, "remote", "get-url", remote.split()[0])),
                      "branch": g(name, "branch", "--show-current") or old.get(name, {}).get("branch", "main"),
                      "commit": g(name, "rev-parse", "HEAD")})
d["apps_txt"] = order
json.dump(d, open(lock, "w"), indent=1); open(lock, "a").write("\n")
print(f"wrote {lock}")
PY
}

CMD="${1:-}"; shift || true
[ "${1:-}" = --force ] && FORCE=1
case "$CMD" in
  all) host; compose; bench; link; pylock; frontend; build; playwright; doctor || true ;;
  host|compose|bench|link|pylock|frontend|build|playwright|doctor|bump) "$CMD" ;;
  follow) bench; pylock; after_frappe_moved ;;
  lock) pins_check || die "this bench breaks the app pins above; a lock of it would carry them to every box"
        lock_from_bench; lock_python ;;
  *) sed -n '2,26p' "$0"; exit 1 ;;
esac
exit
}
