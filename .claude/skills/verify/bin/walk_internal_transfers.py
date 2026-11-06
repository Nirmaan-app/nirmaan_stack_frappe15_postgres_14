#!/usr/bin/env python3
"""Walk the Internal Transfers feature (spec #1619): the tab, the summary figure, the Skipped popup, the two hand
actions, and the card import's Review list. Exits 1 on the first screen or DB read that is not as expected.

    python3 .claude/skills/verify/bin/walk_internal_transfers.py --task <task> \
        --lead <accountant lead email> --accountant <accountant email> --password <pw>

Both users need the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). The Accountant Lead
walks the main table and both hand actions; the Accountant (who imports card statements) opens the card import's
Review. Run it after `patches/v3_0/internal_transfers_from_old_skips` has run on the env (a migrate runs it), so the
env's old lines are Internal Transfers, and with at least one Credit Card Statement import holding an auto-debit.
It seeds one made-up open Cashfree line (`internal_transfers_seed.py`) to mark and send back, and leaves it open.
"""

import argparse
import json
import re
import subprocess

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


line = re.search(r"line: (\S+)", script("internal_transfers_seed.py")).group(1)
before = db()
log = [f"seeded line {line}", f"db before: {json.dumps(before)}"]

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
    save(page, out, "05-marked-line-in-internal-transfers-tab")

    row.get_by_role("button", name="Send back to Mismatched").click()
    dialog = page.get_by_role("dialog", name="Send back to Mismatched")
    dialog.wait_for()
    dialog.locator("#it-reason").fill("Walk: not ours after all")
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
    (out / "db.txt").write_text("\n".join(log) + "\n")
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
