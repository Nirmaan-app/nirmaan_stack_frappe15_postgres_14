#!/usr/bin/env python3
"""Walk #1720: a Cashbook Wallet Credit is booked as a minus Expense, on a project when its remark names one, and an
unpaired refund whose spend has no Expense is placed the same way. Each story is asserted on screen and by a DB read;
it exits 1 when one is not seen (it walks on past a miss, and lists every miss at the end).

    python3 .claude/skills/verify/bin/walk_cashbook_credits.py --task <task> --accountant <email> --lead <email> \
        --password <pw>

Both users need the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). It uploads one made-up
statement (`cashbook_credits_seed.py`; every Txn Id carries a stamp, so every run is a new import). An env runs no RQ
worker, so the walk drains the `long` queue itself after Create. The import stays; the credit it unreconciles stays
open.

As the Accountant:
 1. Sidebar Bulk Import Transactions -> Import statement -> Source Cashbook -> the statement -> Read statement. Review
    heads "1 expense record" and ₹70 (spends only), lists "2 wallet credits (money paid in from outside) will be
    booked as minus expenses", the project credit on Project Expenses and its project, the other on Non Project
    Expenses / Petty Cash, and the refund on the project; no line stays open.
 2. Create -> the job runs. DB: both credits and the refund Settled; each a Paid Expense of minus its Credit (₹600 on
    the project, ₹250 Non-Project Petty Cash, ₹45 on the project), `payment_ref` its Txn Id, the Cashbook marker,
    match `target_amount` negative, "Wallet credit from <payer>"; none in the Cashbook invoice queue; Tier SYSTEM.
 3. Dashboard -> Project Expenses -> Paid: the project credit's row, green "-₹600", on the project.
 4. Dashboard -> Non-Project Expenses -> Paid: the other credit's row, -₹250.
As the Accountant Lead:
 5. Bulk Import Transactions -> Settled – Inflow -> the Non-Project credit's line -> Unreconcile: DB its Expense is
    deleted and the line is open (Mismatched); the line is back on Not Matched – Inflow.
"""

import argparse
import datetime
import json
import re
import subprocess

from drive import save, session, sidebar
from cashbook_walk import expense_list, open_import, search, unreconcile

BIN = ".claude/skills/verify/bin"

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--accountant", required=True)
ap.add_argument("--lead", required=True)
ap.add_argument("--password", required=True)
a = ap.parse_args()

STAMP = datetime.datetime.now(datetime.timezone.utc).strftime("%m%d%H%M%S")
MISSES: list[str] = []
TXNS = ("SPEND", "CPROJ", "CNON", "NREF")


def devenv(*args: str) -> str:
    return subprocess.run(["scripts/devenv/devenv.sh", *args], capture_output=True, text=True, check=True).stdout


def check(ok: bool, what: str) -> bool:
    print(f"{'seen' if ok else 'NOT SEEN'}: {what}")
    if not ok:
        MISSES.append(what)
    return ok


seeded = dict(re.findall(r"^(\w+): (.*)$", devenv("script", a.task, f"{BIN}/cashbook_credits_seed.py", STAMP), re.M))
PROJECT, PROJECT_NAME = seeded["project"], seeded["project_name"]


def db(*extra: str) -> dict:
    out = devenv("script", a.task, f"{BIN}/cashbook_credits_db.py", *(seeded[t] for t in TXNS), *extra)
    raw = json.loads(next(line for line in out.splitlines() if line.startswith("JSON:"))[5:])
    raw["by"] = {t: raw["lines"][seeded[t]] for t in TXNS}
    return raw


# ---- 1-4, as the Accountant ----------------------------------------------------------------------------------------
with session(a.task, a.accountant, a.password) as (page, out):
    (out / "seeded.json").write_text(json.dumps(seeded, indent=2))
    dialog = open_import(page, seeded["statement"])
    dialog.get_by_text(re.compile(r"^1 expense record")).wait_for(timeout=60_000)
    text = dialog.inner_text()
    check("₹70" in text, "1720-4: Review heads 1 expense record and ₹70, the spend only")
    heading = "2 wallet credits (money paid in from outside) will be booked as minus expenses"
    check(heading in text, f"1720-4: Review lists the credits in their own group: {heading!r}")
    box = dialog.get_by_text(heading, exact=True).locator("xpath=..")
    credits = box.inner_text() if box.count() else ""
    check(f"Wallet Credit {seeded['CPROJ']}" in credits and f"Project Expenses · {PROJECT_NAME}" in credits,
          f"1720-1: the project credit says it goes to Project Expenses on {PROJECT_NAME}")
    check(f"Wallet Credit {seeded['CNON']}" in credits and "Non Project Expenses · Petty Cash" in credits,
          "1720-1: the other credit says Non Project Expenses, Petty Cash")
    check("-₹600" in credits.replace("−", "-") and "-₹250" in credits.replace("−", "-"),
          "1720-1: each credit reads as a minus amount")
    refunds = dialog.get_by_text(re.compile(r"^1 wallet refund will be booked")).locator("xpath=..")
    check(refunds.count() == 1 and f"Project Expenses · {PROJECT_NAME}" in refunds.inner_text(),
          f"1720-2: the refund whose spend has no Expense goes to Project Expenses on {PROJECT_NAME}")
    check("will stay open" not in text, "1720-4: no line stays open")
    save(page, out, "01-review")

    dialog.get_by_role("button", name=re.compile(r"^Create 4 records")).click()
    page.wait_for_timeout(2000)
    devenv("run", a.task, "worker", "--queue", "long", "--burst")
    page.wait_for_timeout(3000)
    save(page, out, "02-created")

    state = db()
    by = state["by"]
    (out / "02-db.json").write_text(json.dumps(state, indent=2, default=str))
    batch = by["SPEND"]["line"]["import_batch"]
    for key, doctype, amount, payer in (
        ("CPROJ", "Project Expenses", 600.0, f"Testpayer Project {STAMP}"),
        ("CNON", "Non Project Expenses", 250.0, f"Testpayer Upi {STAMP}"),
        ("NREF", "Project Expenses", 45.0, None),
    ):
        got, exp = by[key], by[key]["expense"] or {}
        check(got["line"]["row_status"] == "Settled" and exp.get("doctype") == doctype
              and float(exp.get("amount") or 0) == -amount and exp.get("status") == "Paid"
              and exp.get("payment_ref") == seeded[key] and exp.get("cashbook_batch") == batch
              and float(exp.get("target_amount") or 0) == -amount and str(exp.get("payment_date")) == "2026-11-17",
              f"1720-1/2: DB {key} is Paid {doctype} {exp.get('name')} of -₹{amount:g}, its Txn Id, its date, the "
              "Cashbook marker, match negative")
        if doctype == "Project Expenses":
            check(exp.get("projects") == PROJECT, f"1720-1/2: DB {key} is on {PROJECT} ({exp.get('projects')})")
        if payer:
            check(exp.get("description") == f"Wallet credit from {payer}", f"1720-1: DB {key} reads 'Wallet credit from {payer}'")
        check(not got["in_cashbook_queue"], f"1720-3: DB {key} is not in Pending Invoices Upload -> Cashbook")
        check(got["tier"] == "system", f"1720-3: DB {key} reads the SYSTEM tier ({got['tier']})")
    check(by["CNON"]["expense"] and by["CNON"]["expense"].get("type") == "Petty Cash",
          "1720-1: DB the Non-Project credit is typed Petty Cash")

    page.keyboard.press("Escape")
    page.wait_for_timeout(700)
    rows = expense_list(page, "Project Expenses", f"Wallet credit from Testpayer Project {STAMP}")
    amount_cell = rows.first.locator("div.text-green-600")
    check(rows.count() == 1 and PROJECT_NAME in rows.first.inner_text(),
          f"1720-1: the Project Expenses list shows the credit on {PROJECT_NAME}")
    check(amount_cell.count() == 1 and re.search(r"[-−]₹\s?600\b", amount_cell.inner_text()) is not None,
          "1720-1: its amount reads green -₹600")
    save(page, out, "03-project-expenses-credit")

    rows = expense_list(page, "Non-Project Expenses", f"Wallet credit from Testpayer Upi {STAMP}")
    check(rows.count() == 1 and re.search(r"[-−]₹\s?250\b", rows.first.inner_text()) is not None,
          "1720-1: the Non-Project Expenses list shows the credit at -₹250")
    save(page, out, "04-non-project-expenses-credit")
    print(f"evidence: {out}")

# ---- 5, as the Accountant Lead ---------------------------------------------------------------------------------------
with session(a.task, a.lead, a.password) as (page, out):
    expense = by["CNON"]["expense"]["name"]
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    dialog = unreconcile(page, "Settled – Inflow", f"Walk 1720 credit UPI {STAMP}", "Walk 1720: unreconcile the credit")
    save(page, out, "05a-unreconcile-credit-dialog")
    dialog.get_by_role("button", name=re.compile(r"^Reverse all \d+$")).click()
    dialog.wait_for(state="hidden", timeout=30_000)
    page.wait_for_timeout(1500)
    save(page, out, "05b-credit-unreconciled")
    after = db("--expense", expense)
    (out / "05-db.json").write_text(json.dumps(after, indent=2, default=str))
    check(not after["exists"][expense] and after["by"]["CNON"]["line"]["row_status"] == "Mismatched"
          and not after["by"]["CNON"]["expense"],
          f"1720-5: DB Unreconcile deleted the credit's Expense {expense} and the line is open (Mismatched)")
    page.get_by_role("button", name=re.compile(r"^Not Matched – Inflow \d+$")).click()
    search(page, f"Walk 1720 credit UPI {STAMP}")
    check(page.get_by_role("row").filter(has_text=f"Walk 1720 credit UPI {STAMP}").count() == 1,
          "1720-5: the credit line is back on Not Matched – Inflow")
    save(page, out, "05c-credit-open-again")
    print(f"evidence: {out}")

if MISSES:
    print(f"{len(MISSES)} NOT SEEN:")
    for miss in MISSES:
        print(f"  - {miss}")
    raise SystemExit(1)
print("all seen")
