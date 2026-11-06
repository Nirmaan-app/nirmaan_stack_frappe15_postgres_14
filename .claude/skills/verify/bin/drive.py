#!/usr/bin/env python3
"""Drive a served devenv env with headless Playwright and save evidence to disk.

    drive.py snap  --task <task> --user <email> --password <pw> <route> <name> [--wait-text <text>]
    drive.py login --task <task> --user <email> --password <pw>

`snap` logs in through the real login page, opens <route> (e.g. /purchase-orders), waits for the page to
settle (and for <text>, if given), then saves <name>.png, <name>.aria.txt (ARIA snapshot) and <name>.txt
(visible text) under the run's evidence directory, and prints their paths.

For a multi-step drive, import it from a script:

    import sys; sys.path.insert(0, "<repo>/.claude/skills/verify/bin")
    from drive import session, save
    with session("testing-standards", "deepa@nirmaan.app", "pw") as (page, out):
        page.get_by_role("link", name="Bulk Import").click()
        save(page, out, "01-bulk-import")

Evidence goes to $VERIFY_OUT, else ~/claude-artifacts/verify/<task>/<UTC timestamp>/. It is never removed by
cleanup. The base URL is http://t-<task>.localhost:<vite port> from `devenv.sh serve`; pass --base to override.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

def benches() -> Path:
    """benches/ under the dev root (as in scripts/devenv/devenv.sh): $DEVENV_ROOT, else the first folder above the
    current one that holds the main bench. Run from the checkout's root."""
    if os.environ.get("DEVENV_ROOT"):
        return Path(os.environ["DEVENV_ROOT"]) / "benches"
    here = Path.cwd().resolve()
    for d in (here, *here.parents):
        if (d / "frappe-bench" / "apps" / "frappe").is_dir():
            return d / "benches"
    sys.exit("drive: no frappe-bench/ above this folder; run from a checkout under frappe_docker/development or set DEVENV_ROOT")


def base_url(task: str) -> str:
    serve = benches() / task / ".serve"
    m = re.search(r"^ports=\d+ (\d+)$", serve.read_text(), re.M) if serve.exists() else None
    if not m:
        sys.exit(f"drive: env {task!r} is not served; run devenv.sh serve {task} --wait first")
    return f"http://t-{task}.localhost:{m.group(1)}"


def evidence_dir(task: str) -> Path:
    out = os.environ.get("VERIFY_OUT")
    if not out:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        out = str(Path.home() / "claude-artifacts" / "verify" / task / stamp)
    path = Path(out)
    path.mkdir(parents=True, exist_ok=True)
    return path


def login(page: Page, base: str, user: str, password: str) -> None:
    page.goto(f"{base}/login")
    page.locator("#email").fill(user)
    page.locator("#password").fill(password)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url(lambda url: "/login" not in url, timeout=30_000)
    page.wait_for_load_state("networkidle")


def sidebar(page: Page, label: str) -> None:
    """Click a sidebar entry. Scoped to the sidebar: a dashboard card can carry the same name ("Projects")."""
    page.locator('[data-sidebar="menu-button"]').get_by_text(label, exact=True).click()
    page.wait_for_load_state("networkidle")


def save(page: Page, out: Path, name: str) -> list[Path]:
    png, aria, txt = out / f"{name}.png", out / f"{name}.aria.txt", out / f"{name}.txt"
    page.screenshot(path=str(png), full_page=True)
    aria.write_text(page.locator("body").aria_snapshot())
    txt.write_text(f"url: {page.url}\n\n" + page.locator("body").inner_text())
    return [png, aria, txt]


@contextlib.contextmanager
def session(task: str, user: str, password: str, base: str | None = None, headed: bool = False):
    base = base or base_url(task)
    out = evidence_dir(task)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
        verdict = "FAIL"
        try:
            login(page, base, user, password)
            yield page, out
            verdict = "PASS"
        except Exception:
            save(page, out, "FAIL")
            raise
        finally:
            browser.close()
            stamp_walk(task, user, out, verdict)


def stamp_walk(task: str, user: str, out: Path, verdict: str) -> None:
    """Record the walk as a Definition-of-Done proof for the code the env serves (scripts/devenv/dod.py)."""
    dod = Path(__file__).resolve().parents[4] / "scripts" / "devenv" / "dod.py"
    code = benches() / task / "apps" / "nirmaan_stack"
    if not dod.exists() or not code.exists():
        return
    extra = {"task": task, "user": user, "evidence": str(out), "screens": len(list(out.glob("*.png")))}
    subprocess.run([sys.executable, str(dod), "stamp", str(code.resolve()), "verify", verdict, json.dumps(extra)],
                   capture_output=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["snap", "login"])
    ap.add_argument("route", nargs="?")
    ap.add_argument("name", nargs="?")
    ap.add_argument("--task", required=True)
    ap.add_argument("--user", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--base")
    ap.add_argument("--wait-text")
    ap.add_argument("--headed", action="store_true")
    a = ap.parse_args()
    if a.cmd == "snap" and not (a.route and a.name):
        ap.error("snap needs <route> <name>")

    with session(a.task, a.user, a.password, a.base, a.headed) as (page, out):
        if a.cmd == "login":
            print(f"logged in as {a.user}; landed on {page.url}")
            for p in save(page, out, "login"):
                print(p)
            return
        page.goto((a.base or base_url(a.task)) + a.route)
        page.wait_for_load_state("networkidle")
        if a.wait_text:
            page.get_by_text(a.wait_text).first.wait_for(timeout=30_000)
        for p in save(page, out, a.name):
            print(p)


if __name__ == "__main__":
    main()
