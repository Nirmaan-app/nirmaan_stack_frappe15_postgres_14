#!/usr/bin/env python3
"""Walk a live-refreshing list (#1670): the Customers list redraws when a customer is saved elsewhere, no reload.

    python3 .claude/skills/verify/bin/walk_live_refresh.py --task <task> --user <accountant> --password <pw> \
        --admin-password <pw> [--customer CUST-0054] [--socket-port 9005]

Needs realtime on the env, which `devenv.sh serve` does not give (the vite `/socket.io` proxy points at the main
bench): run the env bench's own `node apps/frappe/socketio.js` on its published `socketio_port`, with
`FRAPPE_BENCH_ROOT` at a copy of the env's `sites/common_site_config.json` that adds `"webserver_host":
"127.0.0.1"` (the realtime server checks each login against the env's backend, and Node cannot resolve
`t-<task>.localhost`), and point the SPA at it with an untracked `frontend/.env.local` `VITE_SOCKET_PORT=<port>`
(then `devenv.sh restart <task> vite`). The walk stops when the page opens no socket to that port.

As a Nirmaan Accountant Profile user (Customers in its sidebar):
  01-list       sidebar Customers: the customer's company name on the list.
  02-refreshed  the Administrator renames the customer through the REST API (PUT /api/resource/Customers/<id>); the
                open list shows the new name and the "Data Updated" toast, with no reload.
  03-restored   the name is put back the same way; the list shows it again.
Each rename is read back from the env DB (`db-*.json`); the name is put back even when a step fails. Each step
prints seen or FAILED; the walk exits 1 on any FAILED.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout

from drive import base_url, save, session, sidebar

DEVENV = "scripts/devenv/devenv.sh"
DB = ".claude/skills/verify/bin/customers_db.py"


def admin_api(base: str, password: str):
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    opener.open(urllib.request.Request(f"{base}/api/method/login", data=urllib.parse.urlencode(
        {"usr": "Administrator", "pwd": password}).encode()))

    def rename(customer: str, name: str) -> None:
        req = urllib.request.Request(f"{base}/api/resource/Customers/{customer}", method="PUT",
                                     data=json.dumps({"company_name": name}).encode(),
                                     headers={"Content-Type": "application/json"})
        opener.open(req).read()

    return rename


def shows(page, text: str, timeout_ms: int = 20000) -> bool:
    try:
        page.get_by_text(text, exact=True).first.wait_for(timeout=timeout_ms)
        return True
    except PlaywrightTimeout:
        return False


def db(task: str, out: Path, label: str, customer: str) -> dict:
    run = subprocess.run([DEVENV, "script", task, DB, "customer", customer], capture_output=True, text=True)
    line = next((ln for ln in run.stdout.splitlines() if ln.startswith("{")), None)
    if run.returncode or line is None:
        sys.exit(f"walk: customers_db.py customer {customer} failed:\n{run.stdout}\n{run.stderr}")
    (out / f"db-{label}.json").write_text(line)
    return json.loads(line)["customer"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True)
    ap.add_argument("--user", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--admin-password", required=True)
    ap.add_argument("--customer", default="CUST-0054")
    ap.add_argument("--socket-port", type=int, default=9005)
    a = ap.parse_args()
    base = base_url(a.task)
    rename = admin_api(base, a.admin_password)
    missed = []

    def check(ok: bool, what: str) -> None:
        print(f"{'seen' if ok else 'FAILED'}: {what}", flush=True)
        if not ok:
            missed.append(what)

    with session(a.task, a.user, a.password) as (page, out):
        sockets = []
        page.on("websocket", lambda ws: sockets.append(ws.url))
        page.reload()
        sidebar(page, "Customers")
        before = db(a.task, out, "01-before", a.customer)["company_name"]
        listed = shows(page, before)
        save(page, out, "01-list")
        socket = next((u for u in sockets if f":{a.socket_port}/" in u), None)
        if socket is None:
            sys.exit(f"walk: the page opened no socket to port {a.socket_port} ({sockets}): realtime is not served")
        check(listed, f"the list shows {before!r} (socket {socket})")

        renamed = f"{before} (live {a.customer})"
        try:
            rename(a.customer, renamed)
            check(db(a.task, out, "02-renamed", a.customer)["company_name"] == renamed, f"the DB holds {renamed!r}")
            check(shows(page, renamed), f"the open list shows {renamed!r} with no reload")
            check(page.get_by_text("Data Updated").first.is_visible(), "the 'Data Updated' toast")
            save(page, out, "02-refreshed")
        finally:
            rename(a.customer, before)
        check(db(a.task, out, "03-restored", a.customer)["company_name"] == before, f"the DB holds {before!r} again")
        check(shows(page, before) and page.get_by_text(re.compile(re.escape(renamed))).count() == 0,
              f"the list shows {before!r} again, and {renamed!r} no more")
        save(page, out, "03-restored")
        print(f"evidence: {out}")
    print("PASS" if not missed else f"FAIL: {len(missed)} missed")
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main())
