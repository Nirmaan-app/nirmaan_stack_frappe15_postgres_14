#!/usr/bin/env python3
"""Walk the Internal Transfers feature (spec #1619): the tab, the summary figure, the Skipped popup, the two hand
actions, Made by in words, the Mark dialog's pre-filled Detail on a Cashbook line, Send back of a move seen twice,
the Cashbook upload preview's Internal transfers heading, and the card import's Review list. Exits 1 on the first
screen or DB read that is not as expected.

    python3 .claude/skills/verify/bin/walk_internal_transfers.py --task <task> \
        --lead <accountant lead email> --accountant <accountant email> --password <pw>

Both users need the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). The Accountant Lead
walks the main table and both hand actions; the Accountant (who imports Cashbook and card statements) reads a
made-up Cashbook statement's preview (never confirmed) and opens the card import's Review. Run it after `patches/v3_0/internal_transfers_from_old_skips` has run on the env (a migrate runs it), so the
env's old lines are Internal Transfers, and with at least one Credit Card Statement import holding an auto-debit.
It seeds made-up lines and a made-up statement (`internal_transfers_seed.py`), and leaves the lines open.
"""

import argparse
import json
import re
import subprocess
from pathlib import Path

from drive import save, session, sidebar

BIN = ".claude/skills/verify/bin"
MOVED_KINDS = ("Cashfree wallet top-up", "Cashbook wallet top-up", "Porter wallet top-up", "Wallet money returned",
               "Bank internal transfer", "Credit card bill payment", "Credit card auto-debit")

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--lead", required=True)
ap.add_argument("--accountant", required=True)
ap.add_argument("--password", required=True)
a = ap.parse_args()


def script(name: str, *args: str) -> str:
    done = subprocess.run(["scripts/devenv/devenv.sh", "script", a.task, f"{BIN}/{name}", *args],
                          capture_output=True, text=True, check=True)
    return done.stdout


def db(line: str = "") -> dict:
    out = script("internal_transfers_db.py", *([line] if line else []))
    return json.loads(next(l for l in out.splitlines() if l.startswith("JSON:"))[5:])


def check(ok: bool, what: str) -> None:
    if not ok:
        raise AssertionError(what)
    print(f"seen: {what}")


seeded = dict(re.findall(r"^(\w+): (\S+)$", script("internal_transfers_seed.py"), re.M))
line, cashbook_line = seeded["line"], seeded["cashbook_line"]
repeat_first, repeat_second = seeded["repeat_first"], seeded["repeat_second"]
# The container's /workspace/development is the host's development folder, four levels above this app.
statement = Path("../../../..").resolve() / seeded["statement"].removeprefix("/workspace/development/")
before = db()
log = [f"seeded: {json.dumps(seeded)}", f"db before: {json.dumps(before)}"]


def settle(page) -> None:
    """Let a dialog finish opening (its animation) before a screenshot."""
    page.wait_for_timeout(700)

with session(a.task, a.lead, a.password) as (page, out):
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    tab = page.get_by_role("button", name=re.compile(r"^Internal Transfers \d+$"))
    tab.wait_for(timeout=60_000)
    page.get_by_text(re.compile(r"^Internal transfers$")).wait_for()
    figure = page.get_by_test_id("internal-transfers-figure").inner_text()
    n = before["figure"][0]
    check(re.search(rf"\b{n} lines? ·", figure) is not None, f"summary figure counts {n} lines: {figure!r}")
    check(tab.inner_text().split()[-1] == str(before["tab"]), f"tab count {before['tab']} = DB")
    save(page, out, "01-summary-figure-and-tab")

    tab.click()
    page.get_by_role("columnheader", name=re.compile("FROM", re.I)).wait_for()
    for header in ("DIRECTION", "TO", "DETAIL"):
        check(page.get_by_role("columnheader", name=re.compile(rf"^{header}", re.I)).count() > 0,
              f"Internal Transfers tab has a {header.title()} column")
    page.get_by_role("row").filter(has_text="ICICI Current Account").first.wait_for(timeout=60_000)
    check(page.get_by_role("row").filter(has_text="Not-Matched").count() == 0,
          "a row names ICICI Current Account as an end, and no open line is in the tab")
    table = page.get_by_role("table").first.inner_text()
    # A Made by cell is words; a rule id may appear only inside the line's stored note, never as a cell of its own.
    check("Rule: " in table and not re.search(r"^\s*(platform|cashbook|card|internal_gl|credit|gateway|neft)_[a-z_]+\s*$",
                                               table, re.M),
          "Made by is words (Rule: ...), never a rule id")
    save(page, out, "02-internal-transfers-tab")

    page.get_by_role("button", name=re.compile(r"^\d+\s+Skipped$")).click()
    popup = page.get_by_role("dialog", name="Skipped transfers")
    popup.wait_for()
    page.wait_for_timeout(2500)
    text = popup.inner_text()
    check(not any(kind in text for kind in MOVED_KINDS) and not before["moved_kinds_skipped"],
          "the Skipped popup lists no moved kind, and the DB holds none Skipped")
    save(page, out, "03-skipped-popup-without-moved-lines")
    page.keyboard.press("Escape")

    page.get_by_role("button", name=re.compile(r"^Not Matched – Outflow \d+$")).click()
    row = page.get_by_role("row").filter(has_text="WALK-IT made-up wallet top-up")
    row.wait_for()
    row.get_by_role("button", name="Mark as Internal Transfer").click()
    dialog = page.get_by_role("dialog", name="Mark as Internal Transfer")
    dialog.wait_for()
    dialog.locator("#it-to").select_option("Porter Wallet")
    dialog.locator("#it-reason").fill("Walk: a Porter top-up the rules missed")
    settle(page)
    save(page, out, "04-mark-as-internal-transfer-dialog")
    dialog.get_by_role("button", name="Mark as Internal Transfer").click()
    dialog.wait_for(state="hidden", timeout=30_000)
    marked = db(line)["line"]
    check(marked["row_status"] == "Internal Transfer" and len(marked["records"]) == 1
          and marked["records"][0]["made_by"] == "by hand" and marked["records"][0]["to_place"] == "Porter Wallet"
          and marked["records"][0]["marked_by"] == a.lead, "DB: the line is an Internal Transfer, one record by hand")
    log.append(f"db after mark: {json.dumps(marked)}")

    page.get_by_role("button", name=re.compile(r"^Internal Transfers \d+$")).click()
    page.get_by_placeholder(re.compile("Search remarks")).fill("WALK-IT")
    row = page.get_by_role("row").filter(has_text="WALK-IT made-up wallet top-up")
    row.wait_for()
    check(row.get_by_text(re.compile(r"^Marked by hand · ")).count() == 1, "the row says Marked by hand, who and when")
    check(row.get_by_text("Porter Wallet").count() > 0, "the row's To is Porter Wallet")
    check(row.get_by_text("By hand", exact=True).count() > 0, "Made by says By hand")
    save(page, out, "05-marked-line-in-internal-transfers-tab")

    row.get_by_role("button", name="Send back to Mismatched").click()
    dialog = page.get_by_role("dialog", name="Send back to Mismatched")
    dialog.wait_for()
    dialog.locator("#it-reason").fill("Walk: not ours after all")
    settle(page)
    save(page, out, "06-send-back-dialog")
    dialog.get_by_role("button", name="Send back to Mismatched").click()
    dialog.wait_for(state="hidden", timeout=30_000)
    back = db(line)["line"]
    check(back["row_status"] == "Mismatched" and back["records"] == [] and back["decided_by"] == a.lead
          and "Walk: not ours after all" in (back["outcome_note"] or ""),
          "DB: the line is Mismatched, its record deleted, who and why kept")
    log.append(f"db after send back: {json.dumps(back)}")

    page.get_by_role("button", name=re.compile(r"^Not Matched – Outflow \d+$")).click()
    row = page.get_by_role("row").filter(has_text="WALK-IT made-up wallet top-up")
    row.wait_for()
    check(row.get_by_text(re.compile("Sent back to Mismatched")).count() > 0, "the open row says who sent it back")
    save(page, out, "07-sent-back-line-open-again")

    # Owner decision 8a (#1619): on a Cashbook line the Detail starts as the wallet holder (From, money out).
    page.get_by_placeholder(re.compile("Search remarks")).fill("WALK-IT made-up cashbook")
    row = page.get_by_role("row").filter(has_text="WALK-IT made-up cashbook spend")
    row.wait_for()
    row.get_by_role("button", name="Mark as Internal Transfer").click()
    dialog = page.get_by_role("dialog", name="Mark as Internal Transfer")
    dialog.wait_for()
    check(dialog.locator("#it-detail").input_value() == "WALK-IT Test Employee",
          "a Cashbook line's Mark dialog starts with Detail = the statement's From")
    check(dialog.locator("#it-from").inner_text() == "Cashbook Employee Wallet", "its own side is the employee wallet")
    settle(page)
    save(page, out, "09-cashbook-mark-dialog-detail-prefilled")
    dialog.get_by_role("button", name="Cancel").click()
    dialog.wait_for(state="hidden")
    check(db(cashbook_line)["line"]["row_status"] == "Mismatched", "DB: cancelling changed nothing")

    # Review finding (#1619): sending back a status-changed repeat sends back its whole move, record and all.
    page.get_by_role("button", name=re.compile(r"^Internal Transfers \d+$")).click()
    page.get_by_placeholder(re.compile("Search remarks")).fill("WALK-IT made-up wallet move")
    rows = page.get_by_role("row").filter(has_text="WALK-IT made-up wallet move seen twice")
    rows.nth(1).wait_for()
    check(rows.count() == 2, "both lines of the move are in the Internal Transfers tab")
    repeat_row = rows.filter(has_not=page.get_by_role("link", name=re.compile(r"^INT-")))
    check(repeat_row.count() == 1, "one of them, the repeat, holds no record link")
    repeat_row.get_by_role("button", name="Send back to Mismatched").click()
    dialog = page.get_by_role("dialog", name="Send back to Mismatched")
    dialog.wait_for()
    check(dialog.get_by_text(re.compile("Any repeat of the same move")).count() == 1,
          "the dialog says the move's repeats go back with it")
    dialog.locator("#it-reason").fill("Walk: an employee's own money")
    settle(page)
    save(page, out, "10-send-back-a-repeat-dialog")
    dialog.get_by_role("button", name="Send back to Mismatched").click()
    dialog.wait_for(state="hidden", timeout=30_000)
    pair = [db(name)["line"] for name in (repeat_first, repeat_second)]
    check(all(l["row_status"] == "Mismatched" and l["records"] == [] and "Walk: an employee's own money"
              in (l["outcome_note"] or "") for l in pair),
          "DB: both lines of the move are Mismatched with the same reason, and the move's record is gone")
    log.append(f"db after sending back the repeat: {json.dumps(pair)}")
    page.get_by_role("button", name=re.compile(r"^Not Matched – Outflow \d+$")).click()
    page.get_by_placeholder(re.compile("Search remarks")).fill("WALK-IT made-up wallet move")
    rows = page.get_by_role("row").filter(has_text="WALK-IT made-up wallet move seen twice")
    rows.nth(1).wait_for()
    check(rows.filter(has_text="Sent back to Mismatched").count() == 2, "both open rows say who sent them back")
    save(page, out, "11-the-whole-move-back-in-not-matched")
    (out / "db.txt").write_text("\n".join(log) + "\n")
    print(f"evidence: {out}")

# Owner decision 7 (#1619): the Cashbook upload preview lists Internal Transfer lines under their own heading.
with session(a.task, a.accountant, a.password) as (page, out):
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    page.get_by_role("button", name="Import statement").click()
    dialog = page.get_by_role("dialog", name="Import a bank statement")
    dialog.wait_for()
    dialog.get_by_role("combobox", name="Source").click()
    page.get_by_role("option", name=re.compile(r"^Cashbook")).click()
    # The dialog's title follows the source ("Import a petty cash statement").
    dialog = page.get_by_role("dialog", name=re.compile(r"^Import a "))
    dialog.locator("input[type=file]").set_input_files(str(statement))
    dialog.get_by_role("button", name="Read statement").click()
    heading = dialog.get_by_text("Internal transfers · 1 line", exact=True)
    heading.wait_for(timeout=60_000)
    section = heading.locator("xpath=..")
    check(section.get_by_text(re.compile(r"VALOAD-WALKIT")).count() == 1
          and section.get_by_text("Internal Transfer from ICICI Current Account to Cashbook Virtual Account.").count()
          == 1, "the top-up is listed under Internal transfers, naming From and To")
    check(dialog.get_by_text("Not importing", exact=True).count() == 0, "and there is no Not importing list for it")
    settle(page)
    save(page, out, "12-cashbook-preview-internal-transfers")
    page.keyboard.press("Escape")
    print(f"evidence: {out}")

with session(a.task, a.accountant, a.password) as (page, out):
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    page.get_by_role("button", name="Import history").click()
    history = page.get_by_role("dialog", name="Import history")
    history.wait_for()
    for _ in range(12):
        page.wait_for_timeout(1500)
        if history.get_by_role("tab", name=re.compile(r"^Credit Card \([1-9]")).count():
            break
        history.get_by_role("button", name="Previous month").click()
    history.get_by_role("tab", name=re.compile(r"^Credit Card")).click()
    history.get_by_role("tabpanel").get_by_role("button").first.click()
    page.get_by_text(re.compile(r"^Internal transfers · \d+ lines?$")).wait_for(timeout=60_000)
    row = page.get_by_role("row").filter(has_text="Autodebit Payment Recd.")
    check(row.filter(has_text="Internal Transfer from ICICI Current Account to ICICI Credit Card").count() == 1,
          "card Review lists the auto-debit under Internal transfers")
    skipped = page.get_by_text(re.compile(r"lines? skipped:")).inner_text()
    check("Autodebit" not in skipped, f"and not among the skipped lines: {skipped!r}")
    save(page, out, "08-card-review-internal-transfers")
    print(f"evidence: {out}")
