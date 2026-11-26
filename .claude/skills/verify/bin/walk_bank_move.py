#!/usr/bin/env python3
"""Walk #1760: an Accountant Lead moves an expense created with Create from a Settled ICICI Bank Statement line and
from a Settled Cashfree line to a project, in Bulk Import. Each step is asserted on screen and by a DB read; it exits 1
when one is not seen (it walks on past a miss, and lists every miss at the end).

    python3 .claude/skills/verify/bin/walk_bank_move.py --task <task> --lead <email> --password <pw>

The user needs the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). It seeds two made-up
lines (`bank_move_seed.py`; each UTR carries a stamp, so every run is new), each recorded with Create as a Non Project
Expense; the Cashfree one also has a pay-to account, approval dates and a comment. The moved expenses stay.

For each line, as the Accountant Lead:
 1. Sidebar Bulk Import Transactions -> Matched / Settled – Outflow -> the line: its button reads "Move to a project".
    The dialog (title "Move to a project") shows where the expense is now, and the line's date, UTR, beneficiary,
    amount and remark (story 44).
 2. Choose the Won project; the type offered is the expense's own; a reason; Move -> "1 expense moved to <project>".
    DB: one live Settled match, created by the import, on a Project Expense on the project with the same amount, date,
    UTR and type; the line points at it. Cashfree: the pay-to account, approval dates and the comment came along.
"""

import argparse
import datetime
import json
import re
import subprocess

from cashbook_walk import search
from drive import save, session, sidebar

BIN = ".claude/skills/verify/bin"
REASON = "Walk 1760: the remark names the site"
SETTLED_TAB = re.compile(r"^Matched \/ Settled – Outflow")

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
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


seeded = dict(re.findall(r"^(\w+): (.*)$", devenv("script", a.task, f"{BIN}/bank_move_seed.py", STAMP), re.M))
PROJECT, PROJECT_NAME, TYPE = seeded["project"], seeded["project_name"], seeded["type"]


def db(utr: str) -> dict:
    out = devenv("script", a.task, f"{BIN}/bank_move_db.py", utr)
    return json.loads(next(line for line in out.splitlines() if line.startswith("JSON:"))[5:])


def choose(page, dialog, label: str, value: str):
    """A FuzzySearchSelect in the dialog: open it by its label, type, take the option."""
    dialog.get_by_text(label, exact=True).locator("xpath=following-sibling::*[1]").click()
    page.keyboard.type(value)
    page.wait_for_timeout(600)
    page.get_by_role("option", name=value, exact=True).first.click()


def walk_line(page, out, key: str, step: int):
    utr = seeded[key]
    remark = f"walk 1760 site cement {key}"
    before = db(utr)
    old = before["expense"] or {}
    check(old.get("doctype") == "Non Project Expenses" and before["settled"][0]["created_by_import"] == 1,
          f"seed: the {key} line's expense {old.get('name')} is a Non Project Expense its Create made")

    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    page.get_by_role("button", name=SETTLED_TAB).click()
    search(page, utr)
    row = page.get_by_role("row").filter(has_text=remark)
    row.first.wait_for(timeout=30_000)
    check(row.count() == 1, f"the search finds the one {key} line {utr}")
    button = row.first.get_by_role("button", name="Move to a project")
    check(button.count() == 1, f"1760-5: the {key} line offers \"Move to a project\"")
    save(page, out, f"{step:02d}-{key}-settled-line")
    button.click()

    dialog = page.get_by_role("dialog", name="Move to a project")
    dialog.wait_for(timeout=30_000)
    dialog.get_by_test_id("move-details").first.wait_for(timeout=30_000)
    text = dialog.inner_text()
    check(f"Now: Non-Project Expense ({old.get('name')})" in text, f"1760: the {key} dialog shows where it is now")
    amount = "₹4,250" if key == "icici" else "₹1,870"
    for words, what in (("Date: 14-Oct-2026", "date"), (f"UTR: {utr}", "UTR"),
                        ("Beneficiary: Testvendor Hardware Stores", "beneficiary"), (amount, "amount"),
                        (f"Remark: {remark}", "remark")):
        check(words in text, f"1760-44: the {key} details show the {what} ({words!r})")
    save(page, out, f"{step + 1:02d}-{key}-move-dialog")

    choose(page, dialog, "Move to", PROJECT_NAME)
    page.wait_for_timeout(500)
    type_shown = dialog.get_by_text("Expense type", exact=True).locator("xpath=following-sibling::*[1]").inner_text()
    check(TYPE in type_shown, f"1760: the type offered is the expense's own ({TYPE})")
    dialog.get_by_placeholder("Why does it belong there?").fill(REASON)
    page.wait_for_timeout(300)
    save(page, out, f"{step + 2:02d}-{key}-move-chosen")
    dialog.get_by_role("button", name="Move to a project").click()
    dialog.get_by_text(f"1 expense moved to {PROJECT_NAME}.").wait_for(timeout=60_000)
    check(True, f"1760-5: the dialog says 1 expense moved to {PROJECT_NAME}")
    save(page, out, f"{step + 3:02d}-{key}-moved")
    dialog.get_by_role("button", name="Done").click()

    after = db(utr)
    (out / f"{step + 3:02d}-{key}-db.json").write_text(json.dumps({"before": before, "after": after}, indent=2))
    new = after["expense"] or {}
    check(len(after["settled"]) == 1 and after["settled"][0]["created_by_import"] == 1
          and after["settled"][0]["source"] == before["line"]["source"],
          f"1760: DB one live Settled match, created by the {key} import")
    check(new.get("doctype") == "Project Expenses" and new.get("projects") == PROJECT and new.get("name") != old.get("name"),
          f"1760-5: DB the new expense {new.get('name')} is a Project Expense on {PROJECT}")
    check(all(new.get(f) == old.get(f) for f in ("amount", "payment_date", "payment_ref", "type", "status", "comment")),
          "1760: DB same amount, date, UTR, type, status and comment")
    check(after["line"]["suggested_name"] == new.get("name"), "1760: DB the line points at the new expense")
    if key == "cashfree":
        kept = ("pay_to_account_name", "pay_to_account_number", "pay_to_ifsc", "approval_date", "ceo_approval_date")
        check(all(new.get(f) == old.get(f) and old.get(f) for f in kept),
              "owner 2026-11-26: DB the pay-to account and approval dates came along")
        check("Walk 1760: type checked by hand" in after["comments"], "owner 2026-11-26: DB the comment came along")


with session(a.task, a.lead, a.password) as (page, out):
    (out / "seeded.json").write_text(json.dumps(seeded, indent=2))
    walk_line(page, out, "icici", 1)
    walk_line(page, out, "cashfree", 5)
    print(f"evidence: {out}")

print(f"misses: {len(MISSES)}")
for miss in MISSES:
    print(f"  NOT SEEN: {miss}")
raise SystemExit(1 if MISSES else 0)
