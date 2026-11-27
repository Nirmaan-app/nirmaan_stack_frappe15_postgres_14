#!/usr/bin/env python3
"""Feature walk: the Software Developer profile sees what Admin sees (ADR-0051), side by side.

    python3 .claude/skills/verify/bin/walk_software_developer.py --task <task> --admin <admin email> --password <pw>

Seeds a made-up developer (`dev.walker@example.com`) and a made-up Accountant to rename on the env DB
(`software_developer_seed.py`), sets the walk password for the Admin and the developer on the env DB only, reads the
DB side (`software_developer_db.py`), then walks the same screens as each of the two, the way they reach them:
the sidebar and the dashboard with its Reminders panel; Admin Options -> Users (the developer's badge, Rename Email);
Project Payment & Expense (Payment Pending Approval); Expenses (the review queue); Vendor Invoice Recon (Pending
Invoice Approvals); Admin Options -> Projects. Each screen is checked against the DB and against the other user's
view of it. Prints each miss and exits 1 when there is any.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from drive import evidence_dir, save, session, sidebar

DEVENV = "scripts/devenv/devenv.sh"
BIN = Path(__file__).resolve().parent
DEVELOPER = "dev.walker@example.com"
TARGET = "rename.target@example.com"
MENU = '[data-sidebar="menu-button"]'

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--admin", required=True)
ap.add_argument("--password", required=True)
a = ap.parse_args()

out = evidence_dir(a.task)
os.environ["VERIFY_OUT"] = str(out)  # every session of the walk saves into this one folder
misses: list[str] = []


def check(ok: bool, what: str) -> None:
    print(("ok   " if ok else "MISS ") + what)
    if not ok:
        misses.append(what)


def devenv(*args: str) -> str:
    res = subprocess.run([DEVENV, *args], capture_output=True, text=True, timeout=600)
    if res.returncode:
        sys.exit(f"devenv {' '.join(args[:2])} failed:\n{(res.stdout + res.stderr)[-800:]}")
    return res.stdout


def settle(page, ms: int = 2500) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def sidebar_labels(page) -> list[str]:
    menu = page.locator(MENU)
    menu.get_by_text("Dashboard", exact=True).wait_for(timeout=30_000)
    last = -1
    for _ in range(40):
        if menu.count() == last and last > 3:
            break
        last = menu.count()
        page.wait_for_timeout(750)
    labels = [menu.nth(i).inner_text().strip() for i in range(menu.count())]
    # The user's own block and their notification count are theirs, not the role's.
    return [label for label in labels if "\n" not in label and "@" not in label]


def tab_count(page, label: str, role: str = "button") -> int:
    button = page.get_by_role(role, name=re.compile(rf"^{re.escape(label)}\s+\d+$")).first
    button.wait_for(timeout=60_000)

    def read() -> int:
        return int(re.split(r"\s+", button.inner_text().strip())[-1].replace(",", ""))

    # A tab shows 0 until its count arrives: read until two reads 1.5 s apart agree.
    last = read()
    for _ in range(20):
        page.wait_for_timeout(1500)
        now = read()
        if now == last:
            return now
        last = now
    return last


def admin_option(page, label: str) -> None:
    page.locator(MENU).get_by_text("Admin Options", exact=True).click()
    page.locator('[data-sidebar="menu-sub"]').get_by_text(label, exact=True).first.click()
    settle(page)


def find_user(page, email: str):
    """Admin Options -> Users, searched by email (the list's search reads the email); returns the user's row."""
    admin_option(page, "Users")
    page.locator("main input[placeholder^='Search']").first.fill(email)
    settle(page)
    row = page.get_by_role("row").filter(has_text=email).first
    row.wait_for(timeout=30_000)
    return row


def rename_state(page, email: str) -> str:
    """Open the user from the Users list and read whether Actions -> Rename Email is enabled."""
    find_user(page, email).get_by_role("link").first.click()
    page.wait_for_url(re.compile(rf"/users/{re.escape(email)}$"))
    settle(page)
    page.get_by_role("button", name=re.compile("Actions")).first.click()
    item = page.get_by_role("menuitem", name=re.compile("Rename Email"))
    item.wait_for()
    state = "disabled" if item.get_attribute("data-disabled") is not None else "enabled"
    page.keyboard.press("Escape")
    return state


print(devenv("script", a.task, str(BIN / "software_developer_seed.py")).strip().splitlines()[-2:])
for email in (a.admin, DEVELOPER):
    devenv("run", a.task, "set-password", email, a.password)
db_out = devenv("script", a.task, str(BIN / "software_developer_db.py"), a.admin, DEVELOPER)
db = json.loads(next(line for line in db_out.splitlines() if line.startswith("JSON "))[5:])
(out / "db.txt").write_text(json.dumps(db, indent=1))

check(db["developer"]["role_profile"] == "Nirmaan Software Developer Profile", "db: the developer holds the profile")
check(db["developer"]["roles"] == db["admin"]["roles"], "db: the developer has exactly Admin's Roles (decision 1)")
check(db["developer"]["project_permissions"] == 0, "db: the developer is on no project (decision 6)")
check(db["developer"]["reminders"] == db["admin"]["reminders"] and db["admin"]["reminders"],
      "db: the developer's reminder schedules are Admin's")

views: dict[str, dict] = {}
for who, email in (("admin", a.admin), ("developer", DEVELOPER)):
    v: dict = {}
    with session(a.task, email, a.password) as (page, _):
        # 1. Sidebar and dashboard, with its Reminders panel.
        v["sidebar"] = sidebar_labels(page)
        page.get_by_text("Action Center").first.wait_for(timeout=30_000)
        settle(page, 4000)
        text = page.locator("main").inner_text()
        v["dashboard"] = "Admin Dashboard" in text
        m = re.search(r"Projects\s+Active construction projects\s+(\d+)", text)
        v["dashboard_projects"] = int(m.group(1)) if m else None
        v["reminders"] = sorted(r for r in db["admin"]["pending_reminders"] if r in text)
        save(page, out, f"{who}-01-dashboard")

        # 2. Users: the developer's badge, and Rename Email.
        row = find_user(page, DEVELOPER)
        v["badge"] = "Software Developer" in row.inner_text()
        # Decision 5: its own colour. The badge is the element carrying the role label.
        badge = row.get_by_text("Software Developer", exact=True).first
        v["badge_class"] = "bg-orange-50" in (badge.get_attribute("class") or "") + " " + (
            badge.locator("xpath=..").get_attribute("class") or "")
        save(page, out, f"{who}-02-users")
        v["rename_target"] = rename_state(page, TARGET)
        save(page, out, f"{who}-03-rename-target")
        # An Admin-profile account cannot be renamed: each opens the other of the two.
        v["rename_admin_profile"] = rename_state(page, DEVELOPER if who == "admin" else a.admin)
        save(page, out, f"{who}-04-rename-admin-profile")

        # 3. Payments: the approve tab, with its approve controls.
        sidebar(page, "Project Payment & Expense")
        v["payments_pending"] = tab_count(page, "Payment Pending Approval")
        settle(page)
        v["payments_approve_buttons"] = page.locator("main").get_by_role("checkbox").count() > 0
        save(page, out, f"{who}-05-payments")

        # 4. Expenses: the review queue.
        sidebar(page, "Expenses")
        v["expenses_pending"] = tab_count(page, "Pending Approval")
        save(page, out, f"{who}-06-expenses")

        # 5. Vendor Invoice Recon: Pending Invoice Approvals, with the approvers' Re-check.
        sidebar(page, "Vendor Invoice Recon")
        page.get_by_role("button", name="Pending Invoice Approvals").wait_for(timeout=60_000)
        settle(page)
        v["invoice_approvals"] = page.get_by_role("button", name="Re-check").count() > 0
        m = re.search(r"Page \d+ of \d+ \(\d+-\d+ of (\d+)\)", page.locator("main").inner_text())
        v["pending_po_invoices"] = int(m.group(1)) if m else 0
        save(page, out, f"{who}-07-invoice-approvals")

        # 6. Projects list.
        admin_option(page, "Projects")
        settle(page, 4000)
        v["projects"] = tab_count(page, "Won Projects", role="tab")
        save(page, out, f"{who}-08-projects")
    views[who] = v
    (out / f"{who}-view.json").write_text(json.dumps(v, indent=1))

adm, dev = views["admin"], views["developer"]
for key in adm:
    check(adm[key] == dev[key], f"same view: {key} (admin {adm[key]!r} / developer {dev[key]!r})")
check(dev["dashboard"], "developer sees Admin Dashboard (decision 5)")
check(dev["dashboard_projects"] == db["projects"], "dashboard Projects card = DB projects")
check(dev["reminders"] == db["developer"]["pending_reminders"] and dev["reminders"],
      "Reminders panel lists the pending reminders of the Admin-profile schedules")
check(dev["badge"], "Users list shows the developer's Software Developer badge")
check(dev["badge_class"], "the badge is orange, its own colour (decision 5)")
check(dev["rename_target"] == "enabled", "developer may rename a user's email")
check(adm["rename_admin_profile"] == "disabled", "a developer account cannot be renamed")
check(dev["payments_pending"] == db["requested_payments"], "Payment Pending Approval count = DB Requested payments")
check(dev["payments_approve_buttons"], "developer gets the approve controls (row checkboxes)")
check(dev["expenses_pending"] == db["pending_expense_requests"], "Expenses Pending Approval = DB pending requests")
check(dev["invoice_approvals"], "developer works Pending Invoice Approvals (Re-check)")
check(dev["pending_po_invoices"] == db["pending_po_invoices"], "Pending Invoice Approvals (PO) = DB pending PO invoices")
check(dev["projects"] == db["won_projects"], "Projects list: Won Projects = DB Won projects (none filtered away)")

print(f"evidence: {out}")
if misses:
    print(f"{len(misses)} miss(es)")
    sys.exit(1)
print("all checks passed")
