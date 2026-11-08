#!/usr/bin/env python3
"""Walk the Credit Card Statement import (spec #1653): an unpaired card refund on Review, Create, and the
Non-Project Expenses list and the main table after it (#1673); the dialog's four phases, Review, Creating,
Finished and Needs another Create, and a finished import reopened from Import History (#1674). Exits 1 on the
first screen or DB read that is not as expected.

    python3 .claude/skills/verify/bin/walk_card_import.py --task <task> --accountant <email> --password <pw>

The Accountant needs the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). It uploads a
made-up statement (`card_import_seed.py`: the card fixture with a fresh holder and SerNos) through the import
dialog, so every run is a new import. An env runs no RQ worker, so the walk drains the `long` queue itself
(`devenv.sh run <task> worker --queue long --burst`) after the upload (the type suggestion) and after Create.
To reach Needs another Create it reopens one created spend through Unreconcile as Administrator
(`card_import_reopen_seed.py`, setup only). The made-up import is left on the env.
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


def footer_buttons(dialog) -> list[str]:
    """The card footer's buttons, in order (the dialog's last row of buttons)."""
    footer = dialog.locator("div.border-t").last
    return [b.inner_text().strip() for b in footer.get_by_role("button").all()]


def open_from_history(page) -> object:
    """Import history -> Credit Card tab -> this holder's statement: the card dialog."""
    page.get_by_role("button", name="Import history").click()
    history = page.get_by_role("dialog", name="Import history")
    history.wait_for()
    for _ in range(14):
        page.wait_for_timeout(1500)
        if history.get_by_role("tabpanel").get_by_role("button").filter(has_text=holder).count():
            break
        if history.get_by_role("tab", name=re.compile(r"^Credit Card \([1-9]")).count():
            history.get_by_role("tab", name=re.compile(r"^Credit Card")).click()
            page.wait_for_timeout(1000)
            if history.get_by_role("tabpanel").get_by_role("button").filter(has_text=holder).count():
                break
        history.get_by_role("button", name="Previous month").click()
    history.get_by_role("tabpanel").get_by_role("button").filter(has_text=holder).first.click()
    dialog = page.get_by_role("dialog", name="Import a Credit Card Statement")
    dialog.get_by_text(holder).first.wait_for(timeout=60_000)
    return dialog


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

    # #1674 Review: Create not started; Discard is the Accountant Lead's, so this Accountant sees Create and Done.
    check(dialog.get_by_role("status", name="Import finished").count() == 0, "Review: no banner yet")
    check(footer_buttons(dialog) == ["Create 40 expenses and 1 refund", "Done"],
          f"Review: the footer offers Create and Done: {footer_buttons(dialog)}")

    # Creating: the job is queued and not yet run (the env has no worker), so the dialog reads Creating.
    create.click()
    creating = dialog.get_by_role("status", name="Create progress")
    creating.wait_for(timeout=30_000)
    check(re.search(r"Creating… 0 of 41", creating.inner_text()) is not None,
          f"Creating: 'Creating… N of M': {creating.inner_text()!r}")
    check(creating.get_by_role("progressbar").count() == 1, "Creating: with a progress bar")
    check(footer_buttons(dialog) == ["Done"], f"Creating: only Done is offered: {footer_buttons(dialog)}")
    save(page, out, "04-creating")

    drain()
    created = db(holder)
    check(created["to_create"] == 0 and created["created"] == 41, f"DB: Create wrote 40 spends and the refund: "
          f"{created['created']} created, {created['to_create']} left")
    [expense] = created["refund_expenses"]
    check(float(expense["amount"]) == -801.5 and expense["status"] == "Paid"
          and expense["description"] == f"Card refund from MAKEMYTRIP, {holder}'s card",
          f"DB: the refund is a Paid Non-Project Expense of -801.50: {json.dumps(expense)}")
    check(created["open_on_main_table"] == [], "DB: nothing of this import is open on the main table")
    log.append(f"db after Create: {json.dumps(created)}")

    # Finished: the green banner with the counts, the lines below read-only, Done the only button.
    banner = dialog.get_by_role("status", name="Import finished")
    banner.wait_for(timeout=30_000)
    text = banner.inner_text()
    for words in ("Import finished", "40 expenses created, ₹1,37,584.99", "1 refund recorded, -₹801.50",
                  "5 lines skipped", "1 internal transfer"):
        check(words in text, f"Finished: the banner says {words!r}")
    check(footer_buttons(dialog) == ["Done"], f"Finished: Done is the only button: {footer_buttons(dialog)}")
    check(dialog.get_by_role("table").first.get_by_role("row").count() > 40
          and dialog.get_by_role("combobox").count() == 0, "Finished: the lines stay below, read-only")
    save(page, out, "05-finished")
    dialog.get_by_role("button", name="Done").click()
    dialog.wait_for(state="hidden")

    # Reopened from Import History, a finished import shows Finished.
    dialog = open_from_history(page)
    dialog.get_by_role("status", name="Import finished").wait_for(timeout=30_000)
    check(footer_buttons(dialog) == ["Done"], "Import History: the reopened import shows Finished, Done only")
    save(page, out, "06-reopened-finished")
    dialog.get_by_role("button", name="Done").click()
    dialog.wait_for(state="hidden")

    # Needs another Create: a spend unreconciled since (setup) waits; the dialog says so and offers Create again.
    log.append(devenv("script", a.task, f"{BIN}/card_import_reopen_seed.py", holder).strip().splitlines()[-1])
    dialog = open_from_history(page)
    notice = dialog.get_by_text("40 of 41 created. 1 line still waits: press Create again to create it.")
    notice.wait_for(timeout=30_000)
    check(dialog.get_by_role("status", name="Import finished").count() == 0, "Needs another Create: no banner")
    check(footer_buttons(dialog) == ["Create the remaining 1 expense", "Done"],
          f"Needs another Create: Create is offered again: {footer_buttons(dialog)}")
    save(page, out, "07-needs-another-create")
    dialog.get_by_role("button", name="Create the remaining 1 expense").click()
    dialog.get_by_role("status", name="Create progress").wait_for(timeout=30_000)
    drain()
    dialog.get_by_role("status", name="Import finished").wait_for(timeout=30_000)
    again = db(holder)
    check(again["to_create"] == 0 and again["created"] == 41, "DB: the second Create wrote the reopened spend")
    log.append(f"db after the second Create: {json.dumps(again)}")
    save(page, out, "08-finished-again")
    dialog.get_by_role("button", name="Done").click()
    dialog.wait_for(state="hidden")

    # The main table: the credit is in no Not Matched tab.
    page.get_by_role("button", name=re.compile(r"^Not Matched – Inflow \d+$")).click()
    page.get_by_placeholder(re.compile("Search remarks")).fill("MAKEMYTRIP(INDIA)")
    page.wait_for_timeout(2500)
    check(page.get_by_role("row").filter(has_text=expense["name"]).count() == 0
          and page.get_by_role("row").filter(has_text=holder).count() == 0,
          "the main table's Not Matched – Inflow tab does not list the refund")
    save(page, out, "09-main-table-not-matched-inflow")

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
    save(page, out, "10-non-project-expenses-negative")

    # The refund needs no bill: Vendor Invoice Recon -> Pending Invoices Upload -> Credit Card lists this import's
    # spends, never its refund.
    sidebar(page, "Vendor Invoice Recon")
    page.get_by_role("button", name="Pending Invoices Upload").click()
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name=re.compile(r"^Credit Card")).click()
    page.wait_for_load_state("networkidle")
    page.get_by_placeholder(re.compile("search", re.I)).first.fill(holder)
    rows = page.get_by_role("row").filter(has_text=holder)
    rows.first.wait_for(timeout=30_000)
    check(rows.count() > 0 and rows.filter(has_text="801.50").count() == 0,
          f"the Credit Card invoice queue lists the spends ({rows.count()} rows) and not the refund")
    save(page, out, "11-credit-card-invoice-queue")

    (out / "db.txt").write_text("\n".join(log) + "\n")
    print(f"evidence: {out}")
