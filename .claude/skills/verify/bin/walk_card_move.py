#!/usr/bin/env python3
"""Walk #1761: an Accountant Lead moves a card spend's expense to a Won project from Bulk Import, and finds it still
waiting in Vendor Invoice Recon -> Pending Invoices Upload -> Credit Card with the card holder as its Paid by. Each
step is asserted on screen and by a DB read; it exits 1 when one is not seen (it walks on past a miss, and lists every
miss at the end).

    python3 .claude/skills/verify/bin/walk_card_move.py --task <task> --lead <email> --password <pw>

The user needs the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). It seeds one made-up card
import (`card_move_seed.py`: a fresh holder and SerNos each run) whose spend "PARK RESIDENCY Cochin IN" (Rs 1,933) the
import booked Non Project. The moved expense stays.

As the Accountant Lead:
 1. Sidebar Bulk Import Transactions -> Matched / Settled – Outflow -> the spend's line: its button reads "Move to a
    project". The dialog (title "Move to a project") shows its placement, the card holder, merchant, statement, amount
    and date.
 2. Choose the Won project and a type the project takes (the card's Misc. Expenses is Non Project only, so none is
    offered first); a reason; Move -> "1 expense moved to <project>". DB: the Non Project Expense is gone; a Project
    Expense on the project with the same amount, date and reference, the statement link, Paid by the holder; the line
    Settled, pointing at it, one live Settled match.
 3. Sidebar Vendor Invoice Recon -> Pending Invoices Upload -> Credit Card, searched by the holder: the moved spend is
    still listed, its Holder the card holder. DB: the queue endpoint lists it as a Project Expense.
"""

import argparse
import json
import re
import subprocess

from cashbook_walk import search
from drive import save, session, sidebar

BIN = ".claude/skills/verify/bin"
REASON = "Walk 1761: the hotel was for the site visit"
PROJECT_TYPE = "Petty Cash"
SETTLED_TAB = re.compile(r"^Matched \/ Settled – Outflow")
DETAILS = "PARK RESIDENCY Cochin IN"

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--lead", required=True)
ap.add_argument("--password", required=True)
a = ap.parse_args()

MISSES: list[str] = []


def devenv(*args: str) -> str:
    return subprocess.run(["scripts/devenv/devenv.sh", *args], capture_output=True, text=True, check=True).stdout


def check(ok: bool, what: str) -> bool:
    print(f"{'seen' if ok else 'NOT SEEN'}: {what}")
    if not ok:
        MISSES.append(what)
    return ok


seeded = dict(re.findall(r"^(\w+): (.*)$", devenv("script", a.task, f"{BIN}/card_move_seed.py"), re.M))
TXN, BATCH, HOLDER = seeded["txn"], seeded["batch"], seeded["holder"]
PROJECT, PROJECT_NAME, STATEMENT = seeded["project"], seeded["project_name"], seeded["statement"]


def db(*expenses: str) -> dict:
    args = [arg for e in expenses for arg in ("--expense", e)]
    out = devenv("script", a.task, f"{BIN}/card_move_db.py", BATCH, TXN, *args)
    return json.loads(next(line for line in out.splitlines() if line.startswith("JSON:"))[5:])


def choose(page, dialog, label: str, value: str):
    """A FuzzySearchSelect in the dialog: open it by its label, type, take the option."""
    dialog.get_by_text(label, exact=True).locator("xpath=following-sibling::*[1]").click()
    page.keyboard.type(value)
    page.wait_for_timeout(600)
    page.get_by_role("option", name=value, exact=True).first.click()
    page.wait_for_timeout(400)


before = db()
old = before["expense"] or {}
check(old.get("doctype") == "Non Project Expenses" and old.get("credit_card_statement") == STATEMENT,
      f"seed: the spend {TXN} is a Non Project Expense on {STATEMENT}")

with session(a.task, a.lead, a.password) as (page, out):
    (out / "seeded.json").write_text(json.dumps({**seeded, "before": before}, indent=2, default=str))

    # 1. Bulk Import -> the Settled card line -> Move.
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    page.get_by_role("button", name=SETTLED_TAB).click()
    search(page, TXN)
    row = page.get_by_role("row").filter(has_text=DETAILS)
    row.first.wait_for(timeout=30_000)
    check(row.count() == 1, f"the search finds the one card line {TXN}")
    button = row.first.get_by_role("button", name="Move to a project")
    check(button.count() == 1, "1753-4/37: the Non Project card spend's line offers \"Move to a project\"")
    save(page, out, "01-settled-card-line")
    button.click()
    dialog = page.get_by_role("dialog", name="Move to a project")
    dialog.wait_for(timeout=30_000)
    dialog.get_by_test_id("move-details").first.wait_for(timeout=30_000)
    text = dialog.inner_text()
    check(f"Now: Non-Project Expense ({old.get('name')})" in text, "1753-46: the dialog shows where the expense is now")
    for words, what in ((f"Card holder: {HOLDER}", "card holder"), ("Merchant: PARK RESIDENCY", "merchant"),
                        (STATEMENT, "statement"), ("₹1,933", "amount"), ("Date: 23-Sep-2026", "date")):
        check(words in text, f"1753-43: the details show the {what} ({words!r})")
    save(page, out, "02-card-move-dialog")

    # 2. A Won project, a type it takes, a reason -> Move.
    choose(page, dialog, "Move to", PROJECT_NAME)
    choose(page, dialog, "Expense type", PROJECT_TYPE)
    dialog.get_by_placeholder("Why does it belong there?").fill(REASON)
    page.wait_for_timeout(300)
    save(page, out, "03-card-move-chosen")
    dialog.get_by_role("button", name="Move to a project").click()
    dialog.get_by_text(f"1 expense moved to {PROJECT_NAME}.").wait_for(timeout=60_000)
    check(True, f"1753-4: the dialog says 1 expense moved to {PROJECT_NAME}")
    save(page, out, "04-card-moved")
    dialog.get_by_role("button", name="Done").click()

    after = db(f"Non Project Expenses/{old.get('name')}")
    (out / "04-db.json").write_text(json.dumps(after, indent=2, default=str))
    new = after["expense"] or {}
    check(not after["exists"][f"Non Project Expenses/{old.get('name')}"], f"DB the old expense {old.get('name')} is gone")
    check(new.get("doctype") == "Project Expenses" and new.get("projects") == PROJECT,
          f"1753-4: DB the new expense {new.get('name')} is a Project Expense on {PROJECT}")
    check((new.get("amount"), new.get("payment_date"), new.get("payment_ref"), new.get("status"), new.get("type"))
          == (old.get("amount"), old.get("payment_date"), old.get("payment_ref"), "Paid", PROJECT_TYPE),
          "1753-17: DB same amount, date, reference, Paid, the type chosen")
    check(new.get("credit_card_statement") == STATEMENT, "1753-55: DB the card statement link stays")
    check(new.get("payment_by") == HOLDER, "1753-57: DB Paid by is the card holder")
    line = after["line"]
    check(line["row_status"] == "Settled" and line["suggested_name"] == new.get("name")
          and line["resolved_project"] == PROJECT, "1753-22/23: DB the line points at the new expense and its project")
    check(len(after["settled"]) == 1 and after["settled"][0]["target_name"] == new.get("name"),
          "1753-22: DB one live Settled match, the new expense's")
    queued = after["queued"] or {}
    check(queued.get("doctype") == "Project Expenses" and queued.get("holder") == HOLDER,
          "1753-56: DB the queue endpoint lists it as a Project Expense with its holder")

    # 3. Pending Invoices Upload -> Credit Card: still listed, Holder the card holder.
    sidebar(page, "Vendor Invoice Recon")
    page.get_by_role("button", name="Pending Invoices Upload").click()
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name=re.compile(r"^Credit Card")).click()
    page.wait_for_load_state("networkidle")
    page.get_by_placeholder(re.compile("search", re.I)).first.fill(HOLDER)
    page.wait_for_timeout(1500)
    rows = page.get_by_role("row").filter(has_text=HOLDER).filter(has_text="PARK RESIDENCY")
    rows.first.wait_for(timeout=30_000)
    check(rows.count() == 1, "1753-56: Pending Invoices Upload -> Credit Card still lists the moved spend")
    check(HOLDER in rows.first.inner_text() and "1,933" in rows.first.inner_text(),
          f"1753-57: its row shows the holder {HOLDER} as Paid by, and its amount")
    save(page, out, "05-credit-card-queue-after-move")
    print(f"evidence: {out}")

print(f"misses: {len(MISSES)}")
for miss in MISSES:
    print(f"  NOT SEEN: {miss}")
raise SystemExit(1 if MISSES else 0)
