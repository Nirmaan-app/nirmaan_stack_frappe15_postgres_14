#!/usr/bin/env python3
"""Walk the Credit Card Statement import (spec #1653): an unpaired card refund on Review, Create, and the
Non-Project Expenses list and the main table after it (#1673). Exits 1 on the first screen or DB read that is not
as expected.

    python3 .claude/skills/verify/bin/walk_card_import.py --task <task> --accountant <email> --password <pw>

The Accountant needs the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). It uploads a
made-up statement (`card_import_seed.py`: the card fixture with a fresh holder and SerNos) through the import
dialog, so every run is a new import. An env runs no RQ worker, so the walk drains the `long` queue itself
(`devenv.sh run <task> worker --queue long --burst`) after the upload (the type suggestion) and after Create.
The made-up import is left on the env.
"""

import argparse
import json
import re
import subprocess
from pathlib import Path

from drive import save, session, sidebar

BIN = ".claude/skills/verify/bin"
REFUND = "MAKEMYTRIP(INDIA) P Gurgaon IN"
#: Two live Non-Project types; each retype picks the one the line does not hold yet (merchant memory from an
#: earlier walk may already give MakeMyTrip one of them).
TYPES = ("Hotel Expenses", "Staff Welfare Expenses")

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--accountant", required=True)
ap.add_argument("--password", required=True)
a = ap.parse_args()


def devenv(*args: str) -> str:
    return subprocess.run(["scripts/devenv/devenv.sh", *args], capture_output=True, text=True, check=True).stdout


def db(holder: str) -> dict:
    out = devenv("script", a.task, f"{BIN}/card_import_db.py", holder)
    return json.loads(next(l for l in out.splitlines() if l.startswith("JSON:"))[5:])


def drain() -> None:
    """Run the queued background jobs (the type suggestion, Create) once: an env runs no worker."""
    devenv("run", a.task, "worker", "--queue", "long", "--burst")


def check(ok: bool, what: str) -> None:
    if not ok:
        raise AssertionError(what)
    print(f"seen: {what}")


seeded = dict(re.findall(r"^(\w+): (.+)$", devenv("script", a.task, f"{BIN}/card_import_seed.py"), re.M))
holder = seeded["holder"]
# The container's /workspace/development is the host's development folder, four levels above this app.
statement = Path("../../../..").resolve() / seeded["statement"].removeprefix("/workspace/development/")
log = [f"seeded: {json.dumps(seeded)}"]


def retype(row, expense_type: str) -> None:
    """Choose `expense_type` in a line's type picker (a react-select)."""
    picker = row.get_by_role("combobox")
    picker.click()
    row.page.keyboard.type(expense_type)
    row.page.get_by_role("option", name=expense_type, exact=True).click()


with session(a.task, a.accountant, a.password) as (page, out):
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    page.get_by_role("button", name="Import statement").click()
    dialog = page.get_by_role("dialog", name="Import a bank statement")
    dialog.wait_for()
    dialog.get_by_role("combobox", name="Source").click()
    page.get_by_role("option", name=re.compile(r"^Credit Card Statement")).click()
    dialog = page.get_by_role("dialog", name="Import a Credit Card Statement")
    dialog.locator("input[type=file]").set_input_files(str(statement))
    dialog.get_by_role("button", name="Upload statement").click()
    dialog.get_by_text(holder).first.wait_for(timeout=60_000)
    drain()
    page.wait_for_timeout(3000)  # Review polls every 2 s while the suggestion runs.

    # #1673: the unpaired MakeMyTrip credit is listed under Refunds, at a minus amount, with its own picker.
    refunds = dialog.get_by_role("region", name="Refunds")
    refunds.wait_for(timeout=30_000)
    refund_row = refunds.get_by_role("row").filter(has_text=REFUND)
    check(refund_row.count() == 1, "Review lists the unpaired MakeMyTrip credit under Refunds")
    check(re.search(r"-\s?₹\s?801\.50", refund_row.inner_text()) is not None,
          f"at a minus amount: {refund_row.inner_text()!r}")
    check(refund_row.get_by_role("combobox").count() == 1, "with its own type picker")
    create = dialog.get_by_role("button", name=re.compile(r"^Create \d+ expenses? and \d+ refunds?$"))
    check(create.inner_text() == "Create 40 expenses and 1 refund", f"the Create button names both counts: "
          f"{create.inner_text()!r}")
    save(page, out, "01-review-refunds-list")

    # "Use for all" on a MakeMyTrip spend retypes the spends, never the refund.
    before = db(holder)
    refund_type = before["refunds_lines"][0]["expense_type"]
    spend_target = next(t for t in TYPES if [t] != before["makemytrip_spend_types"])
    log.append(f"db before retyping: {json.dumps(before)}")
    spends = dialog.get_by_role("table").first
    first_spend = spends.get_by_role("row").filter(has_text=re.compile("MAKEMYTRIP", re.I)).first
    retype(first_spend, spend_target)
    use_all = dialog.get_by_role("button", name=re.compile(r"^Use for all \d+ MAKEMYTRIP spends$"))
    use_all.first.wait_for(timeout=30_000)
    use_all.first.click()
    after = before
    for _ in range(20):
        page.wait_for_timeout(1000)
        after = db(holder)
        if after["makemytrip_spend_types"] == [spend_target]:
            break
    check(after["makemytrip_spend_types"] == [spend_target], f"DB: every MakeMyTrip spend is {spend_target}")
    check([line["expense_type"] for line in after["refunds_lines"]] == [refund_type],
          f"DB: the refund kept its own type ({refund_type})")
    save(page, out, "02-use-for-all-leaves-the-refund")

    # The refund's own picker types it alone.
    refund_target = next(t for t in TYPES if t != refund_type)
    retype(refunds.get_by_role("row").filter(has_text=REFUND), refund_target)
    chosen = refund_type
    for _ in range(20):
        page.wait_for_timeout(1000)
        chosen = db(holder)["refunds_lines"][0]["expense_type"]
        if chosen == refund_target:
            break
    check(chosen == refund_target, f"DB: the refund's own picker set its type: {chosen!r}")
    log.append(f"db before Create: {json.dumps(db(holder))}")
    save(page, out, "03-refund-typed-on-its-own")

    create.click()
    page.wait_for_timeout(1500)
    drain()
    page.wait_for_timeout(4000)
    created = db(holder)
    check(created["to_create"] == 0 and created["created"] == 41, f"DB: Create wrote 40 spends and the refund: "
          f"{created['created']} created, {created['to_create']} left")
    [expense] = created["refund_expenses"]
    check(float(expense["amount"]) == -801.5 and expense["status"] == "Paid"
          and expense["description"] == f"Card refund from MAKEMYTRIP, {holder}'s card",
          f"DB: the refund is a Paid Non-Project Expense of -801.50: {json.dumps(expense)}")
    check(created["open_on_main_table"] == [], "DB: nothing of this import is open on the main table")
    log.append(f"db after Create: {json.dumps(created)}")
    save(page, out, "04-after-create")
    page.keyboard.press("Escape")

    # The main table: the credit is in no Not Matched tab.
    page.get_by_role("button", name=re.compile(r"^Not Matched – Inflow \d+$")).click()
    page.get_by_placeholder(re.compile("Search remarks")).fill("MAKEMYTRIP(INDIA)")
    page.wait_for_timeout(2500)
    check(page.get_by_role("row").filter(has_text=expense["name"]).count() == 0
          and page.get_by_role("row").filter(has_text=holder).count() == 0,
          "the main table's Not Matched – Inflow tab does not list the refund")
    save(page, out, "05-main-table-not-matched-inflow")

    # The Non-Project Expenses list shows it at minus its amount.
    page.goto(page.url.split("/", 3)[0] + "//" + page.url.split("/", 3)[2] + "/")
    page.get_by_text("Non-Project Expenses", exact=True).first.click()
    page.get_by_role("button", name=re.compile(r"^Paid \d+$")).click()
    page.get_by_placeholder(re.compile("Search by Description", re.I)).fill(f"Card refund from MAKEMYTRIP, {holder}")
    row = page.get_by_role("row").filter(has_text=f"Card refund from MAKEMYTRIP, {holder}")
    row.wait_for(timeout=30_000)
    # The list rounds to the rupee ("₹-802"), as it does every amount.
    check(re.search(r"(-\s?₹|₹\s?-)\s?80(1\.50|2)\b", row.inner_text()) is not None,
          f"the Non-Project Expenses list shows the refund at minus its amount: {row.inner_text()!r}")
    save(page, out, "06-non-project-expenses-negative")

    (out / "db.txt").write_text("\n".join(log) + "\n")
    print(f"evidence: {out}")
