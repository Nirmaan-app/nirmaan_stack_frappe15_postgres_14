#!/usr/bin/env python3
"""Isolate the DEV site from the outside world: dev is a copy of production and still holds production's
push tokens, mail accounts and API credentials (CU-0 section 5). Run after EVERY dev refresh, then --verify.

WHAT IT DOES (every before-value goes to a backup file first; --restore puts each one back):
  * site config: mute_emails 1, disable_push 1, disable_cloud_upload 1;
  * every Email Account: incoming and outgoing off;
  * the given Scheduled Job Types: stopped 1 (the RULED list is an input, --stopped-file, never hard-coded);
  * Nirmaan Users: fcm_token blanked, push_notification 'false';
  * Token Cache rows (the Connected App's OAuth tokens): removed;
  * User api_secret: rotated to a fresh random value;
  * Asset Master asset_email_password / asset_pin: removed.
KEEPS, on purpose: the Anthropic key (BoQ AI settings are never switched off), the Map and Gemini keys (owner
"let it be"), the GCP credentials (uploads are held by disable_cloud_upload), each Connected App's own client
secret (only its tokens go).

REFUSES unless: the site is `localhost`; developer_mode is 1; db_host is the docker service name; the site
config carries `nirmaan_env: "dev"` (production never has it); and --yes is given (without it, it prints the
site, the database and what it would change, and exits 2).

Every write is raw SQL on purpose: an Email Account save connects to its mail server and a Nirmaan Users save
runs permission / notification hooks -- exactly the outside calls this script exists to prevent. Nothing here
is ever printed but counts. The backup file holds secret values (Password fields as their raw ENCRYPTED
`__Auth` rows -- never decrypted -- plus push tokens); it lives in sites/localhost/private/, never the repo.

USAGE (from the host)
  docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \\
      env/bin/python apps/nirmaan_stack/scripts/dev_isolate.py --stopped-file <json list> [--yes | --verify]
  ... dev_isolate.py --restore sites/localhost/private/isolation_backup_<stamp>.json --yes
"""
from __future__ import annotations

import argparse
import json
import os
import sys

SITE = "localhost"
DOCKER_DB_HOST = "postgresql"
MARKER_KEY, MARKER_VALUE = "nirmaan_env", "dev"
BENCH_SITES = "/workspace/development/frappe-bench/sites"
CONFIG_FLAGS = {"mute_emails": 1, "disable_push": 1, "disable_cloud_upload": 1}
ASSET_SECRET_FIELDS = ("asset_email_password", "asset_pin")


def refusals(site: str, conf: dict, yes: bool) -> list[str]:
    """Why this run must not go ahead; empty when every guard holds. Pure."""
    out = []
    if site != SITE:
        out.append(f"site is {site!r}, not {SITE!r}")
    if int(conf.get("developer_mode") or 0) != 1:
        out.append("developer_mode is not 1")
    if conf.get("db_host") != DOCKER_DB_HOST:
        out.append(f"db_host is not the docker service name {DOCKER_DB_HOST!r}")
    if conf.get(MARKER_KEY) != MARKER_VALUE:
        out.append(f"site config has no {MARKER_KEY}: {MARKER_VALUE!r} marker")
    if not yes:
        out.append("--yes not given")
    return out


# ---------------------------------------------------------------- reads / writes, each optionally scoped
def _in(names):
    """A name scope for a query: none = every row; an empty list = no row."""
    if names is None:
        return "", {}
    return (" and name in %(names)s", {"names": tuple(names)}) if names else (" and false", {})


def _auth_rows(doctype, fieldnames, names=None):
    import frappe

    extra, args = _in(names)
    return [list(r) for r in frappe.db.sql(
        f'select doctype, name, fieldname, password, encrypted from "__Auth" where doctype = %(dt)s '
        f'and fieldname in %(fields)s{extra}', {"dt": doctype, "fields": tuple(fieldnames), **args})]


def _put_auth_rows(rows):
    import frappe

    for doctype, name, fieldname, password, encrypted in rows:
        frappe.db.sql('delete from "__Auth" where doctype=%s and name=%s and fieldname=%s', (doctype, name, fieldname))
        frappe.db.sql('insert into "__Auth" (doctype, name, fieldname, password, encrypted) values (%s, %s, %s, %s, %s)',
                      (doctype, name, fieldname, password, encrypted))


def isolate_config(backup, config_path=None):
    import frappe
    from frappe.installer import update_site_config

    conf = json.load(open(config_path or frappe.get_site_path("site_config.json")))
    backup["config"] = {k: conf.get(k) for k in CONFIG_FLAGS}
    changed = 0
    for key, value in CONFIG_FLAGS.items():
        if conf.get(key) != value:
            update_site_config(key, value, site_config_path=config_path or frappe.get_site_path("site_config.json"))
            changed += 1
    return changed


def isolate_email_accounts(backup, names=None):
    import frappe

    extra, args = _in(names)
    rows = frappe.db.sql(f'select name, enable_incoming, enable_outgoing from "tabEmail Account" '
                         f'where (enable_incoming = 1 or enable_outgoing = 1){extra}', args)
    backup["email_accounts"] = [list(r) for r in rows]
    for name, _incoming, _outgoing in rows:
        frappe.db.sql('update "tabEmail Account" set enable_incoming = 0, enable_outgoing = 0 where name = %s', (name,))
    return len(rows)


def isolate_stopped(backup, stopped):
    import frappe

    rows = frappe.db.sql('select name, stopped from "tabScheduled Job Type" where name in %s', (tuple(stopped),)) if stopped else []
    backup["stopped"] = [list(r) for r in rows]
    missing = sorted(set(stopped) - {r[0] for r in rows})
    if missing:
        raise SystemExit(f"--stopped-file names {len(missing)} job(s) that do not exist: {missing}")
    changed = [r[0] for r in rows if not r[1]]
    for name in changed:
        frappe.db.sql('update "tabScheduled Job Type" set stopped = 1 where name = %s', (name,))
    return len(changed)


def isolate_push(backup, names=None):
    import frappe

    extra, args = _in(names)
    rows = frappe.db.sql(f'''select name, fcm_token, push_notification from "tabNirmaan Users"
                             where (coalesce(fcm_token, '') <> '' or coalesce(push_notification, '') <> 'false'){extra}''', args)
    backup["nirmaan_users"] = [list(r) for r in rows]
    for name, _token, _push in rows:
        frappe.db.sql('''update "tabNirmaan Users" set fcm_token = '', push_notification = 'false' where name = %s''', (name,))
    return len(rows)


def isolate_token_cache(backup, names=None):
    import frappe

    extra, args = _in(names)
    names_now = [r[0] for r in frappe.db.sql(f'select name from "tabToken Cache" where true{extra}', args)]
    backup["token_cache"] = [frappe.get_doc("Token Cache", n).as_dict(convert_dates_to_str=True) for n in names_now]
    backup["token_cache_auth"] = _auth_rows("Token Cache", ("access_token", "refresh_token"), names_now) if names_now else []
    for n in names_now:
        for child in frappe.get_meta("Token Cache").get_table_fields():
            frappe.db.sql(f'delete from "tab{child.options}" where parenttype = %s and parent = %s', ("Token Cache", n))
        frappe.db.sql('delete from "tabToken Cache" where name = %s', (n,))
        frappe.db.sql('''delete from "__Auth" where doctype = 'Token Cache' and name = %s''', (n,))
    return len(names_now)


def isolate_api_secrets(backup, names=None):
    import frappe
    from frappe.utils.password import set_encrypted_password

    rows = _auth_rows("User", ("api_secret",), names)
    backup["api_secrets"] = rows
    for _dt, name, _f, _p, _e in rows:
        set_encrypted_password("User", name, frappe.generate_hash(length=15), "api_secret")
    return len(rows)


def isolate_asset_secrets(backup, names=None):
    import frappe

    rows = _auth_rows("Asset Master", ASSET_SECRET_FIELDS, names)
    backup["asset_secrets"] = rows
    for _dt, name, fieldname, _p, _e in rows:
        frappe.db.sql('''delete from "__Auth" where doctype = 'Asset Master' and name = %s and fieldname = %s''', (name, fieldname))
    return len(rows)


def restore(backup, config_path=None):
    """Put every recorded before-value back. Returns {item: rows restored}."""
    import frappe
    from frappe.installer import update_site_config

    out = {}
    for key, value in (backup.get("config") or {}).items():
        update_site_config(key, "None" if value is None else value,
                           site_config_path=config_path or frappe.get_site_path("site_config.json"))
    out["config"] = len(backup.get("config") or {})
    for name, incoming, outgoing in backup.get("email_accounts", []):
        frappe.db.sql('update "tabEmail Account" set enable_incoming = %s, enable_outgoing = %s where name = %s',
                      (incoming, outgoing, name))
    out["email_accounts"] = len(backup.get("email_accounts", []))
    for name, stopped in backup.get("stopped", []):
        frappe.db.sql('update "tabScheduled Job Type" set stopped = %s where name = %s', (stopped, name))
    out["stopped"] = len(backup.get("stopped", []))
    for name, token, push in backup.get("nirmaan_users", []):
        frappe.db.sql('update "tabNirmaan Users" set fcm_token = %s, push_notification = %s where name = %s', (token, push, name))
    out["nirmaan_users"] = len(backup.get("nirmaan_users", []))
    for d in backup.get("token_cache", []):
        if not frappe.db.exists("Token Cache", d["name"]):
            doc = frappe.get_doc(d)
            doc.db_insert()
            for child in doc.get_all_children():
                child.db_insert()
    _put_auth_rows(backup.get("token_cache_auth", []))
    out["token_cache"] = len(backup.get("token_cache", []))
    _put_auth_rows(backup.get("api_secrets", []))
    out["api_secrets"] = len(backup.get("api_secrets", []))
    _put_auth_rows(backup.get("asset_secrets", []))
    out["asset_secrets"] = len(backup.get("asset_secrets", []))
    return out


def verify(stopped, names=None, config_path=None) -> tuple[dict, list[str]]:
    """(counts, failures). Every count must be 0 / as ruled for the site to count as isolated."""
    import frappe

    conf = json.load(open(config_path or frappe.get_site_path("site_config.json")))
    q = frappe.db.sql
    scope = names or {}

    def _scoped(dt):
        return _in(scope[dt]) if dt in scope else ("", {})

    e, a = _scoped("Nirmaan Users")
    counts = {
        "push_tokens": q(f'''select count(*) from "tabNirmaan Users" where coalesce(fcm_token, '') <> ''{e}''', a)[0][0],
        "push_on": q(f'''select count(*) from "tabNirmaan Users" where coalesce(push_notification, '') <> 'false'{e}''', a)[0][0],
    }
    e, a = _scoped("Email Account")
    counts["email_accounts_enabled"] = q(f'select count(*) from "tabEmail Account" where (enable_incoming = 1 or enable_outgoing = 1){e}', a)[0][0]
    e, a = _scoped("Token Cache")
    counts["token_cache_rows"] = q(f'select count(*) from "tabToken Cache" where true{e}', a)[0][0]
    e, a = _scoped("Asset Master")
    counts["asset_secrets"] = q(f'''select count(*) from "__Auth" where doctype = 'Asset Master' and fieldname in %(f)s{e}''',
                                {"f": ASSET_SECRET_FIELDS, **a})[0][0]
    not_stopped = sorted(r[0] for r in q('select name from "tabScheduled Job Type" where name in %s and stopped = 0',
                                          (tuple(stopped),))) if stopped else []
    counts["listed_jobs_not_stopped"] = len(not_stopped)
    counts["stopped_total"] = q('select count(*) from "tabScheduled Job Type" where stopped = 1')[0][0]
    for key, value in CONFIG_FLAGS.items():
        counts[key] = conf.get(key)
    counts["marker"] = conf.get(MARKER_KEY) == MARKER_VALUE
    failures = [k for k in ("push_tokens", "push_on", "email_accounts_enabled", "token_cache_rows", "asset_secrets",
                            "listed_jobs_not_stopped") if counts[k]]
    failures += [k for k, v in CONFIG_FLAGS.items() if counts[k] != v]
    if not counts["marker"]:
        failures.append("marker")
    return counts, failures


def isolate(stopped, names=None, config_path=None) -> tuple[dict, dict]:
    """(backup, {item: rows changed}). Commits nothing; the caller commits after the backup is on disk."""
    scope = names or {}
    backup, changed = {}, {}
    changed["config"] = isolate_config(backup, config_path) if names is None else 0
    changed["email_accounts"] = isolate_email_accounts(backup, scope.get("Email Account") if names is not None else None)
    changed["stopped"] = isolate_stopped(backup, stopped)
    changed["nirmaan_users"] = isolate_push(backup, scope.get("Nirmaan Users") if names is not None else None)
    changed["token_cache"] = isolate_token_cache(backup, scope.get("Token Cache") if names is not None else None)
    changed["api_secrets"] = isolate_api_secrets(backup, scope.get("User") if names is not None else None)
    changed["asset_secrets"] = isolate_asset_secrets(backup, scope.get("Asset Master") if names is not None else None)
    return backup, changed


def _write_backup(backup) -> str:
    import frappe

    path = frappe.get_site_path("private", f"isolation_backup_{frappe.utils.now_datetime():%Y-%m-%d_%H%M%S}.json")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(backup, fh, default=str)
    return path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--site", default=SITE)
    ap.add_argument("--stopped-file", help="JSON list of Scheduled Job Type names to keep stopped (the ruled set)")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--restore", metavar="BACKUP_JSON")
    args = ap.parse_args(argv)

    os.chdir(BENCH_SITES)
    import frappe

    frappe.init(site=args.site)
    frappe.connect()
    try:
        stopped = json.load(open(args.stopped_file)) if args.stopped_file else []
        print(f"site {frappe.local.site}  database {frappe.conf.db_name}")
        if args.verify:
            counts, failures = verify(stopped)
            for k, v in counts.items():
                print(f"  {k}: {v}")
            print("VERIFY PASS" if not failures else f"VERIFY FAIL: {failures}")
            return 0 if not failures else 1
        why = refusals(args.site, dict(frappe.conf), args.yes)
        if why:
            print("REFUSED: " + "; ".join(why))
            return 2
        if args.restore:
            restored = restore(json.load(open(args.restore)))
            frappe.db.commit()
            print("restored rows:", restored)
            return 0
        if not args.stopped_file:
            print("REFUSED: --stopped-file (the ruled stopped set) is required")
            return 2
        backup, changed = isolate(stopped)
        path = _write_backup(backup)       # on disk BEFORE the commit: a failed write rolls everything back
        frappe.db.commit()
        print(f"backup written ({os.path.basename(path)}, mode 600)")
        print("rows changed:", changed)
        return 0
    except BaseException:
        frappe.db.rollback()
        raise
    finally:
        frappe.destroy()


if __name__ == "__main__":
    sys.exit(main())
