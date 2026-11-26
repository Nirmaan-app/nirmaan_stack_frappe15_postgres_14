#!/usr/bin/env python3
"""Walk #1757: an Accountant Lead moves a Cashbook spend's expense, from Bulk Import and from the expense's edit dialog,
with its bill and Bill check travelling along; an Accountant sees no Move. Each step is asserted on screen and by a DB
read; it exits 1 when one is not seen (it walks on past a miss, and lists every miss at the end).

    python3 .claude/skills/verify/bin/walk_cashbook_move.py --task <task> --accountant <email> --lead <email> \
        --password <pw>

Both users need the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). It seeds one made-up
Cashbook import (`cashbook_move_seed.py`; every Txn Id carries a stamp, so every run is a new import) whose courier
spend (Rs 2,380, Meera Iyer, Non Project) has one bill read Mismatched. The moved expense stays.

As the Accountant Lead:
 1. Sidebar Bulk Import Transactions -> Matched / Settled – Outflow -> the spend's line: its button reads "Move to a
    project". The dialog (title "Move to a project") shows its placement, date, spender, who was paid, Remark, the
    bill and its verdict with the remark.
 2. Choose the Won project; the type offered is its own (Petty Cash); a reason; Move -> "1 expense moved to <project>".
    DB: the old Non Project Expense is gone; a Project Expense on the project with the same amount, date, Txn Id and
    Paid by Meera Iyer; the bill (Mismatched, its remark) on it and latest; the line Settled, pointing at it, one live
    Settled match.
 3. Dashboard -> Project Expenses -> Paid -> the expense -> Edit: the Project row is locked, with "Change project".
 4. Follow it: Bulk Import opens with the dialog titled "Change project"; choose No project, a reason, Move ->
    "1 expense moved to Non Project". DB: the Project Expense is gone; a Non Project Expense with the same amount, date
    and Txn Id, the bill on it, the line pointing at it.
 5. Dashboard -> Non-Project Expenses -> Paid -> the expense -> Edit: the locked row reads "Move to a project".
As the Accountant:
 6. Bulk Import -> the line: no Move button. Non-Project Expenses -> the expense: no Move link, if Edit is offered.
"""

import argparse
import datetime
import json
import re
import subprocess

from cashbook_walk import search
from drive import save, session, sidebar

BIN = ".claude/skills/verify/bin"
REASON = "Walk 1757: the remark names the site"
SETTLED_TAB = re.compile(r"^Matched \/ Settled – Outflow")

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--accountant", required=True)
ap.add_argument("--lead", required=True)
ap.add_argument("--password", required=True)
a = ap.parse_args()

STAMP = datetime.datetime.now(datetime.timezone.utc).strftime("%m%d%H%M%S")
MISSES: list[str] = []


def devenv(*args: str) -> str:
    return subprocess.run(["scripts/devenv/devenv.sh", *args], capture_output=True, text=True, check=True).stdout


def check(ok: bool, what: str) -> bool:
    print(f"{'seen' if ok else 'NOT SEEN'}: {what}")
    if not ok:
        MISSES.append(what)
    return ok


seeded = dict(re.findall(r"^(\w+): (.*)$", devenv("script", a.task, f"{BIN}/cashbook_move_seed.py", STAMP), re.M))
TXN, PROJECT, PROJECT_NAME = seeded["txn"], seeded["project"], seeded["project_name"]


def db(*expenses: str) -> dict:
    args = [arg for e in expenses for arg in ("--expense", e)]
    out = devenv("script", a.task, f"{BIN}/cashbook_move_db.py", TXN, *args)
    return json.loads(next(line for line in out.splitlines() if line.startswith("JSON:"))[5:])


def settled_line(page):
    """Bulk Import -> Matched / Settled – Outflow -> the spend's row."""
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    page.get_by_role("button", name=SETTLED_TAB).click()
    search(page, TXN)
    # The Reference column shows the Txn Id cut short; the search found the one line, read by its remark.
    row = page.get_by_role("row").filter(has_text="Courier charges from bngl")
    row.first.wait_for(timeout=30_000)
    check(row.count() == 1, f"the search finds the one line of {TXN}")
    return row.first


def choose(page, dialog, label: str, value: str):
    """A FuzzySearchSelect in the dialog: open it by its placeholder, type, take the option."""
    dialog.get_by_text(label, exact=True).locator("xpath=following-sibling::*[1]").click()
    page.keyboard.type(value)
    page.wait_for_timeout(600)
    page.get_by_role("option", name=value, exact=True).first.click()


def move(page, dialog, project_label: str | None):
    choose(page, dialog, "Move to", project_label or "No project (Non-Project expense)")
    page.wait_for_timeout(500)
    dialog.get_by_placeholder("Why does it belong there?").fill(REASON)
    page.wait_for_timeout(300)


def edit_dialog(page, card: str):
    """Dashboard -> `card` -> Paid -> searched by Comment for this run's import (the list has no Txn Id search) -> the
    courier spend's row -> its Edit (pencil) button; the open dialog, or `None` when the row offers no Edit."""
    sidebar(page, "Dashboard")
    page.get_by_text(card, exact=True).first.click()
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name=re.compile(r"^Paid \d+$")).click()
    page.wait_for_load_state("networkidle")
    page.get_by_role("combobox").filter(has_text="Description").first.click()
    page.get_by_role("option", name="Comment", exact=True).click()
    search(page, f"Imported from {seeded['batch']}")
    row = page.get_by_role("row").filter(has_text="Courier charges from bngl")
    row.first.wait_for(timeout=30_000)
    check(row.count() == 1, f"{card} -> Paid lists the one courier spend of {seeded['batch']}")
    pencil = row.first.locator("button:has(svg.lucide-pencil)")
    if not pencil.count():
        return None
    pencil.first.click()
    dialog = page.get_by_role("alertdialog")
    dialog.wait_for()
    page.wait_for_timeout(1500)
    return dialog


before = db()
old = before["expense"]
check(old and old["doctype"] == "Non Project Expenses" and before["bills"] and
      before["bills"][0]["bill_check"] == "Mismatched", f"seed: the spend {TXN} is a Non Project Expense with a "
      "Mismatched bill")

# ---- 1-5, as the Accountant Lead -----------------------------------------------------------------------------------
with session(a.task, a.lead, a.password) as (page, out):
    (out / "seeded.json").write_text(json.dumps({**seeded, "before": before}, indent=2, default=str))
    row = settled_line(page)
    button = row.get_by_role("button", name="Move to a project")
    check(button.count() == 1, "1757-37: the Non Project spend's line offers \"Move to a project\"")
    save(page, out, "01-settled-line")
    button.click()
    dialog = page.get_by_role("dialog", name="Move to a project")
    dialog.wait_for(timeout=30_000)
    dialog.get_by_test_id("move-details").first.wait_for(timeout=30_000)
    text = dialog.inner_text()
    check(f"Now: Non-Project Expense ({old['name']})" in text, "1757-46: the dialog shows where the expense is now")
    for words, story in (("Spent by: Meera Iyer", "spender"), ("Paid to: TESTPAYEE COURIER ONE", "who was paid"),
                         ("Remark: Courier charges from bngl to Ahemadbad", "Remark"), ("₹2,380", "amount"),
                         ("Date: ", "date"), ("Open", "the bill's link"),
                         (f"Mismatched: {before['bills'][0]['bill_check_reason']}", "the Bill check verdict and remark")):
        check(words in text, f"1757-42: the details show the {story} ({words!r})")
    save(page, out, "02-move-dialog")

    move(page, dialog, PROJECT_NAME)
    type_shown = dialog.get_by_text("Expense type", exact=True).locator("xpath=following-sibling::*[1]").inner_text()
    check("Petty Cash" in type_shown, "1757-15: the type offered is the expense's own, which the project ledger takes")
    save(page, out, "03-move-chosen")
    dialog.get_by_role("button", name="Move to a project").click()
    dialog.get_by_text(f"1 expense moved to {PROJECT_NAME}.").wait_for(timeout=60_000)
    check(True, f"1757-10: the dialog says 1 expense moved to {PROJECT_NAME}")
    save(page, out, "04-moved")
    dialog.get_by_role("button", name="Done").click()

    after = db(f"Non Project Expenses/{old['name']}")
    (out / "04-db.json").write_text(json.dumps(after, indent=2, default=str))
    new = after["expense"] or {}
    check(not after["exists"][f"Non Project Expenses/{old['name']}"], f"1757-10: DB the old expense {old['name']} is gone")
    check(new.get("doctype") == "Project Expenses" and new.get("projects") == PROJECT,
          f"1757-10: DB the new expense {new.get('name')} is a Project Expense on {PROJECT}")
    check((new.get("amount"), new.get("payment_date"), new.get("payment_ref"), new.get("status"), new.get("type"))
          == (old["amount"], old["payment_date"], old["payment_ref"], "Paid", "Petty Cash"),
          "1757-17: DB same amount, date, Txn Id, Paid, type")
    check(new.get("payment_by") == "Meera Iyer", "1757-20: DB Paid by is the spender, Meera Iyer")
    check(new.get("cashbook_batch") == old["cashbook_batch"], "1757: DB the wallet marker stays")
    bills = after["bills"]
    check(len(bills) == 1 and bills[0]["name"] == before["bills"][0]["name"] and bills[0]["is_latest"] == 1
          and bills[0]["bill_check"] == "Mismatched"
          and bills[0]["bill_check_reason"] == before["bills"][0]["bill_check_reason"],
          "1757-18/19: DB the bill, latest, with its Mismatched verdict and remark, is on the new expense")
    line = after["line"]
    check(line["row_status"] == "Settled" and line["suggested_name"] == new.get("name")
          and line["resolved_project"] == PROJECT, "1757-22/23: DB the line points at the new expense and its project")
    check(len(after["settled"]) == 1 and after["settled"][0]["target_name"] == new.get("name"),
          "1757-22: DB the Txn Id is held by one live Settled match, the new expense's")

    # 3-4: from the expense's edit dialog.
    on_project = new.get("name")
    dialog = edit_dialog(page, "Project Expenses")
    if check(dialog is not None, f"1757-8: Project Expenses -> Paid -> {on_project} offers Edit"):
        link = dialog.get_by_role("link", name="Change project")
        check(link.count() == 1, "1757-38: the locked Project row links \"Change project\"")
        check(dialog.locator("#project_edit").is_disabled(), "1757-8: the Project row is locked")
        save(page, out, "05-edit-project-expense")
        link.click()
        move_dialog = page.get_by_role("dialog", name="Change project")
        move_dialog.wait_for(timeout=30_000)
        move_dialog.get_by_test_id("move-details").first.wait_for(timeout=30_000)
        check(PROJECT_NAME in move_dialog.inner_text(), "1757-46: the dialog shows the expense is on the project")
        save(page, out, "06-change-project-dialog")
        move(page, move_dialog, None)
        save(page, out, "07-change-project-chosen")
        move_dialog.get_by_role("button", name="Move to a project").or_(
            move_dialog.get_by_role("button", name="Change project")).click()
        move_dialog.get_by_text("1 expense moved to Non Project.").wait_for(timeout=60_000)
        check(True, "1757-12: the dialog says 1 expense moved to Non Project")
        save(page, out, "08-moved-to-non-project")
        move_dialog.get_by_role("button", name="Done").click()

        last = db(f"Project Expenses/{on_project}")
        (out / "08-db.json").write_text(json.dumps(last, indent=2, default=str))
        back = last["expense"] or {}
        check(not last["exists"][f"Project Expenses/{on_project}"], f"1757-12: DB {on_project} is gone")
        check(back.get("doctype") == "Non Project Expenses"
              and (back.get("amount"), back.get("payment_date"), back.get("payment_ref"))
              == (old["amount"], old["payment_date"], old["payment_ref"]),
              f"1757-12: DB {back.get('name')} is a Non Project Expense, same amount, date and Txn Id")
        check(len(last["bills"]) == 1 and last["bills"][0]["bill_check"] == "Mismatched",
              "1757-18: DB the bill and its verdict followed again")
        check(last["line"]["suggested_name"] == back.get("name") and len(last["settled"]) == 1,
              "1757-22: DB the line points at it, one live Settled match")

        dialog = edit_dialog(page, "Non-Project Expenses")
        if check(dialog is not None, f"1757-8: Non-Project Expenses -> Paid -> {back.get('name')} offers Edit"):
            check(dialog.get_by_role("link", name="Move to a project").count() == 1,
                  "1757-37: the Non Project edit dialog's locked row links \"Move to a project\"")
            save(page, out, "09-edit-non-project-expense")
            page.keyboard.press("Escape")
    print(f"evidence: {out}")

# ---- 6, as the Accountant ------------------------------------------------------------------------------------------
with session(a.task, a.accountant, a.password) as (page, out):
    row = settled_line(page)
    check(row.get_by_role("button", name=re.compile(r"^(Move to a project|Change project)$")).count() == 0,
          "1757-3: an Accountant sees no Move on the line")
    save(page, out, "10-accountant-settled-line")
    dialog = edit_dialog(page, "Non-Project Expenses")
    if dialog is None:
        print("seen: 1757-3: an Accountant is offered no Edit on the Paid expense, so no Move link there")
    else:
        check(dialog.get_by_role("link", name=re.compile(r"^(Move to a project|Change project)$")).count() == 0,
              "1757-3: an Accountant's edit dialog has no Move link")
        save(page, out, "11-accountant-edit-dialog")
    print(f"evidence: {out}")

print(f"misses: {len(MISSES)}")
for miss in MISSES:
    print(f"  NOT SEEN: {miss}")
raise SystemExit(1 if MISSES else 0)
