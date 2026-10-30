#!/usr/bin/env bash
# Load a site backup into a dev box's main site `localhost`, cut it off from the outside world, and rebuild the
# template that every task env is cloned from. The owner supplies the backup; nothing here downloads one.
#
#   data.sh restore <backup> --yes      on the box. <backup> is a production archive (nirmaan-backup-*.tar.gz, as
#                                       backup-policy/backup_and_upload.sh makes) or a folder or archive holding the
#                                       files of `bench backup --with-files`: *-database.sql.gz, and optionally
#                                       *-files.tar, *-private-files.tar, *-site_config_backup.json.
#   data.sh send <ssh host> <backup>    on the laptop: copy the backup to the box over SSH, run restore there, and
#                                       delete the copy. The box's checkout is $DEVBOX_CHECKOUT, default
#                                       ~/work/nirmaan/deploy_setup/frappe_docker/development/nirmaan_stack_variants/master
#
# restore, in order (it stops at the first failure):
#   1. prove the backup is whole (gzip -t, tar listing)
#   2. replace the localhost DB with the dump, and the site's files with the backup's
#   3. migrate, then scripts/dev_isolate.py --yes and --verify (mail, push, cloud upload off, tokens and secrets gone)
#   4. stamp sites/localhost/data_stamp.json (backup time + DB fingerprint): devenv up and bootstrap doctor print the
#      data's age, and ask for a fresh backup past 7 days
#   5. rebuild the template nirmaan_tpl. Task envs already made keep their own DB until `devenv.sh reset <task>`.
#
# The site keeps only db_name, db_password and encryption_key from the backup's site config (the key decrypts the
# stored passwords); everything else in it is production's and is left out.
# The whole body sits in { ... } so bash parses it before running: editing this file mid-run is safe.
{
set -euo pipefail

die() { echo "FAIL  $*" >&2; exit 1; }
ok() { echo "ok    $*"; }
step() { echo; echo "== $*"; }

SELF_DIR="$(cd "$(dirname "$0")" && pwd -P)"
CHECKOUT="$(cd "$SELF_DIR/../.." && pwd -P)"
ROOT="$(dirname "$(dirname "$CHECKOUT")")"
BENCH="$ROOT/frappe-bench"; SITE="$BENCH/sites/localhost"
CONTAINER=frappe_docker_devcontainer-frappe-1; PG=frappe_docker_devcontainer-postgresql-1
inside() { docker exec -i -w /workspace/development/frappe-bench "$CONTAINER" bash -lc "$1"; }
P() { docker exec -i "$PG" psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

send() {
  local host="$1" src="$2" co="${DEVBOX_CHECKOUT:-~/work/nirmaan/deploy_setup/frappe_docker/development/nirmaan_stack_variants/master}"
  [ -e "$src" ] || die "no backup at $src"
  local name; name="$(basename "$src")"
  ssh "$host" 'mkdir -p ~/incoming && chmod 700 ~/incoming'
  echo "copying $name to $host (over SSH)"
  if [ -d "$src" ]; then tar -C "$(dirname "$src")" -czf - "$name" | ssh "$host" "cat > ~/incoming/$name.tar.gz"; name="$name.tar.gz"
  else scp -q "$src" "$host:~/incoming/$name"; fi
  ssh -t "$host" "$co/scripts/devenv/data.sh restore ~/incoming/$name --yes; rc=\$?; rm -f ~/incoming/$name; exit \$rc"
}

restore() {
  local src="$1"
  [ -e "$src" ] || die "no backup at $src"
  [ -d "$BENCH/apps/frappe" ] || die "no bench at $BENCH: run scripts/devenv/bootstrap.sh all first"
  local work="$BENCH/sites/.restore-tmp"; rm -rf "$work"; mkdir -p "$work"
  trap 'rm -rf "$work"' EXIT

  step "1. prove the backup"
  if [ -d "$src" ]; then cp -R "$src"/. "$work/"; else tar -xzf "$src" -C "$work" || die "cannot unpack $src"; fi
  # A production archive holds the bench backup files, possibly one folder down.
  local db files priv conf
  db="$(find "$work" -name '*-database.sql.gz' | head -2)"
  [ "$(echo "$db" | grep -c .)" = 1 ] || die "need exactly one *-database.sql.gz in the backup, found: ${db:-none}"
  files="$(find "$work" -name '*-files.tar' ! -name '*-private-files.tar' | head -1)"
  priv="$(find "$work" -name '*-private-files.tar' | head -1)"
  conf="$(find "$work" -name '*-site_config_backup.json' | head -1)"
  gzip -t "$db" || die "the database dump is not a whole gzip"
  for t in $files $priv; do tar tf "$t" >/dev/null || die "$(basename "$t") does not list"; done
  ok "dump $(basename "$db") ($(du -h "$db" | cut -f1)); public files: $([ -n "$files" ] && echo yes || echo none); private files: $([ -n "$priv" ] && echo yes || echo none)"

  # The site config: db name and password (the dump's objects belong to that role) and the encryption key.
  local keys
  keys="$(python3 - "${conf:-}" "$SITE/site_config.json" <<'PY'
import json, os, sys
backup, current = sys.argv[1:]
src = json.load(open(backup)) if backup else (json.load(open(current)) if os.path.exists(current) else {})
missing = [k for k in ("db_name", "db_password", "encryption_key") if not src.get(k)]
if missing:
    sys.exit(f"no {', '.join(missing)} in the backup's site config, and no site_config.json to take it from")
print(src["db_name"], src["db_password"])
PY
)" || die "$keys"
  local dbname dbpass; read -r dbname dbpass <<<"$keys"

  if [ "$YES" != 1 ]; then
    echo
    echo "This replaces the DB $dbname and the files of site localhost in $BENCH. Run again with --yes."
    exit 2
  fi

  step "2. replace the DB and the files"
  P -d postgres -c "select count(pg_terminate_backend(pid)) from pg_stat_activity where datname='$dbname' and pid<>pg_backend_pid()" >/dev/null
  P -d postgres -c "DROP DATABASE IF EXISTS \"$dbname\""
  P -d postgres -c "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$dbname') THEN CREATE ROLE \"$dbname\" LOGIN; END IF; END\$\$" \
    -c "ALTER ROLE \"$dbname\" PASSWORD '$dbpass'"
  P -d postgres -c "CREATE DATABASE \"$dbname\" OWNER \"$dbname\" ENCODING 'UTF8' TEMPLATE template0"
  echo "      loading the dump (minutes)"
  # pg_dump 17.6+ writes \restrict / \unrestrict meta-commands that psql 14 does not know: strip them.
  gunzip -c "$db" | sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
    | docker exec -i "$PG" psql -U postgres -d "$dbname" -q -v ON_ERROR_STOP=1 > "$work/load.log" 2>&1 \
    || { tail -20 "$work/load.log"; die "the dump did not load"; }
  # A dump made without owners leaves the tables to postgres; frappe connects as the site role and must own them
  # to migrate. ALTER TABLE carries a table's own sequences along, so only free-standing sequences are moved alone.
  P -d "$dbname" -c "DO \$\$DECLARE r record; BEGIN
    FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = 'postgres' AND (c.relkind IN ('r','p','v','m')
        OR (c.relkind = 'S' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a','i'))))
    LOOP EXECUTE format('ALTER %s public.%I OWNER TO %I', CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
      WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, r.relname, '$dbname'); END LOOP;
    EXECUTE format('ALTER SCHEMA public OWNER TO %I', '$dbname'); END\$\$"
  ok "DB $dbname loaded"

  mkdir -p "$SITE"/{locks,logs,private/backups}
  python3 - "${conf:-}" "$SITE/site_config.json" <<'PY'
import json, os, sys
backup, path = sys.argv[1:]
cur = json.load(open(path)) if os.path.exists(path) else {}
src = json.load(open(backup)) if backup else cur
cur.update({k: src[k] for k in ("db_name", "db_password", "encryption_key")})
cur.update(db_type="postgres", db_host="postgresql", nirmaan_env="dev", allow_tests=True, pause_scheduler=1)
json.dump(cur, open(path, "w"), indent=1)
PY
  ok "site_config.json: the backup's DB and encryption key, marked nirmaan_env=dev"
  local kind tarf
  for kind in public private; do
    tarf="$files"; [ $kind = private ] && tarf="$priv"
    [ -n "$tarf" ] || continue
    local x="$work/x-$kind"; mkdir -p "$x"; tar -xf "$tarf" -C "$x"
    local got; got="$(find "$x" -type d -path "*/$kind/files" | head -1)"
    [ -n "$got" ] || die "no $kind/files folder in $(basename "$tarf")"
    rm -rf "$SITE/$kind/files"; mkdir -p "$SITE/$kind"; mv "$got" "$SITE/$kind/files"
    ok "$kind files: $(find "$SITE/$kind/files" -type f | wc -l | tr -d ' ')"
  done
  mkdir -p "$SITE/public/files" "$SITE/private/files"

  step "3. migrate and isolate"
  # Locks a killed or earlier run left behind (jobs queued with no worker to run them) fail migrate with
  # DocumentLockedError, as devenv.sh's migrate also knows.
  rm -f "$SITE/locks/"*.lock
  inside "bench --site localhost migrate" > "$work/migrate.log" 2>&1 \
    || { tail -30 "$work/migrate.log"; die "migrate failed"; }
  ok "migrated"
  echo '[]' > "$SITE/private/dev_isolate_stopped.json"   # the scheduler is paused on a dev box; no job is listed
  inside "env/bin/python apps/nirmaan_stack/scripts/dev_isolate.py --stopped-file /workspace/development/frappe-bench/sites/localhost/private/dev_isolate_stopped.json --yes" \
    > "$work/isolate.log" 2>&1 || { tail -20 "$work/isolate.log"; die "dev_isolate failed"; }
  inside "env/bin/python apps/nirmaan_stack/scripts/dev_isolate.py --stopped-file /workspace/development/frappe-bench/sites/localhost/private/dev_isolate_stopped.json --verify" \
    > "$work/verify.log" 2>&1 || { tail -20 "$work/verify.log"; die "dev_isolate --verify failed: the data is NOT safe to use"; }
  ok "isolated and verified (mail, push, cloud upload off; tokens and secrets gone)"

  step "4. stamp"
  local fp; fp="$(docker exec -w /workspace/development/frappe-bench "$CONTAINER" env/bin/python -I \
    apps/nirmaan_stack/scripts/env_sync/remote/db_fingerprint.py 2>/dev/null | grep '^fp_' | tr '\n' ' ' || true)"
  python3 - "$SITE/data_stamp.json" "$(basename "$db")" "$(basename "$src")" "$fp" <<'PY'
import json, re, sys, datetime
path, dump, source, fp = sys.argv[1:]
m = re.match(r"(\d{8})_(\d{6})", dump)
when = datetime.datetime.strptime("".join(m.groups()), "%Y%m%d%H%M%S") if m else None
json.dump({"source": source, "dump": dump,
           "backup_time": (when or datetime.datetime.now()).isoformat(timespec="minutes"),
           "backup_time_known": bool(when),
           "restored_at": datetime.datetime.now().isoformat(timespec="minutes"),
           "fingerprint": fp.strip()}, open(path, "w"), indent=1)
PY
  ok "data_stamp.json: $(python3 -c 'import json,sys;s=json.load(open(sys.argv[1]));print(s["backup_time"], s["source"])' "$SITE/data_stamp.json")"

  step "5. template"
  "$SELF_DIR/devenv.sh" template-drop >/dev/null 2>&1 || true
  "$SELF_DIR/devenv.sh" template-build | tail -2
  ok "done. New task envs get this data; existing ones keep theirs until 'devenv.sh reset <task>'."
}

CMD="${1:-}"; shift || true
YES=0; ARGS=()
for a in "$@"; do [ "$a" = --yes ] && YES=1 || ARGS+=("$a"); done
case "$CMD" in
  restore) [ ${#ARGS[@]} = 1 ] || die "usage: data.sh restore <backup> --yes"; restore "${ARGS[0]}" ;;
  send) [ ${#ARGS[@]} = 2 ] || die "usage: data.sh send <ssh host> <backup>"; send "${ARGS[0]}" "${ARGS[1]}" ;;
  *) sed -n '2,23p' "$0"; exit 1 ;;
esac
exit
}
