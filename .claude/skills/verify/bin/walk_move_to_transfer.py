#!/usr/bin/env python3
"""Walk #1762: an Accountant Lead moves a Cashbook spend with a bill to Internal Transfer from Bulk Import, choosing
From, To and Detail as Mark as Internal Transfer asks; the line becomes an Internal Transfer whose record keeps the
bill as its proof. Unreconcile is not offered on a line Move accepts, and is on a line Linked to an existing record.
Each step is asserted on screen and by a DB read; it exits 1 when one is not seen (it walks on past a miss, and lists
every miss at the end).

    python3 .claude/skills/verify/bin/walk_move_to_transfer.py --task <task> --lead <email> --password <pw>

The user needs the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). It seeds one made-up
Cashbook import with `cashbook_move_seed.py` (the #1757 walk's seed; every Txn Id carries a stamp, so every run is a
new import) whose courier spend (Rs 2,380, Meera Iyer, Non Project) has one bill. The Linked line is read from the
env's own data (`move_to_transfer_db.py --linked`), so no real line is named here. The moved line stays moved.

As the Accountant Lead:
 1. Sidebar Bulk Import Transactions -> Matched / Settled – Outflow -> the spend's line: Move, and no Unreconcile;
    ticked, no `Unreconcile 1` in the toolbar either.
 2. The Linked line: Unreconcile is offered.
 3. The spend's Move -> Move to: Internal Transfer. From reads Cashbook Employee Wallet, Detail starts as Meera Iyer;
    To: ICICI Credit Card, a reason, "Move to Internal Transfer" -> "1 expense moved to Internal Transfer."
    DB: the expense is gone, no live Settled match, the leg Reversed with the reason; the line Internal Transfer; its
    record from the wallet to the card, by hand, with the reason, its proof the bill's file, which is attached to the
    record; the Expense bill kept as history.
 4. Internal Transfers tab -> the line, its ends, and its record link -> the record in Desk shows its Proof.
"""

import argparse
import datetime
import json
import re
import subprocess

from cashbook_walk import search
from drive import save, session, sidebar

BIN = ".claude/skills/verify/bin"
REASON = "Walk 1762: a card bill paid from the wallet"
WALLET, CARD = "Cashbook Employee Wallet", "ICICI Credit Card"
SETTLED_TAB = re.compile(r"^Matched \/ Settled – Outflow")
REMARK = "Courier charges from bngl"

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


def db(*args: str) -> dict:
    out = devenv("script", a.task, f"{BIN}/move_to_transfer_db.py", *args)
    return json.loads(next(line for line in out.splitlines() if line.startswith("JSON:"))[5:])


seeded = dict(re.findall(r"^(\w+): (.*)$", devenv("script", a.task, f"{BIN}/cashbook_move_seed.py", STAMP), re.M))
TXN = seeded["txn"]
old = json.loads(
    next(
        line for line in devenv("script", a.task, f"{BIN}/cashbook_move_db.py", TXN).splitlines()
        if line.startswith("JSON:")
    )[5:]
)
EXPENSE = f"{old['expense']['doctype']}/{old['expense']['name']}"
before = db(TXN, "--expense", EXPENSE)
check(before["expense_exists"] and before["bills"] and before["line"]["row_status"] == "Settled",
      f"seed: the spend {TXN} is Settled to {EXPENSE}, with a bill")
linked = db("--linked")["linked"]


def settled_tab(page):
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    page.get_by_role("button", name=SETTLED_TAB).click()
    page.wait_for_load_state("networkidle")


with session(a.task, a.lead, a.password) as (page, out):
    (out / "seeded.json").write_text(json.dumps({**seeded, "before": before, "linked": linked}, indent=2, default=str))

    # 1. The spend's line: Move, no Unreconcile.
    settled_tab(page)
    search(page, TXN)
    row = page.get_by_role("row").filter(has_text=REMARK)
    row.first.wait_for(timeout=30_000)
    check(row.count() == 1, f"the search finds the one line of {TXN}")
    check(row.first.get_by_role("button", name="Move to a project").count() == 1,
          "1762: the created spend's line offers Move")
    check(row.first.get_by_role("button", name="Unreconcile").count() == 0,
          "1762 (story 53): no Unreconcile on a line Move accepts")
    save(page, out, "01-move-accepted-line-no-unreconcile")
    # Ticked, the toolbar offers Move and no `Unreconcile 1` either (#1762: "not offered" covers the toolbar).
    row.first.get_by_role("checkbox").click()
    page.get_by_role("button", name="Clear").wait_for(timeout=10_000)
    check(page.get_by_role("button", name=re.compile(r"^Unreconcile \d")).count() == 0,
          "1762 (story 53): the toolbar offers no Unreconcile while a line Move accepts is ticked")
    save(page, out, "01b-ticked-move-accepted-line-no-toolbar-unreconcile")
    page.get_by_role("button", name="Clear").click()

    # 2. A Linked line keeps Unreconcile.
    if check(linked is not None, "the env holds a Settled Cashbook line Linked to an existing record"):
        search(page, linked["transfer_id"])
        page.wait_for_timeout(1500)
        check(page.get_by_role("table").first.get_by_role("button", name="Unreconcile").count() == 1,
              f"1762 (story 54): the line Linked to {linked['target_doctype']} keeps Unreconcile")
        save(page, out, "02-linked-line-keeps-unreconcile")

    # 3. Move the spend to Internal Transfer.
    search(page, TXN)
    row = page.get_by_role("row").filter(has_text=REMARK)
    row.first.wait_for(timeout=30_000)
    row.first.get_by_role("button", name="Move to a project").click()
    dialog = page.get_by_role("dialog", name="Move to a project")
    dialog.wait_for(timeout=30_000)
    dialog.get_by_test_id("move-details").first.wait_for(timeout=30_000)
    dialog.get_by_text("Move to", exact=True).locator("xpath=following-sibling::*[1]").click()
    page.keyboard.type("Internal")
    page.wait_for_timeout(600)
    options = page.get_by_role("option", name="Internal Transfer", exact=True)
    if check(options.count() >= 1, "1762 (story 13): Move to offers Internal Transfer"):
        options.first.click()
        fields = dialog.get_by_test_id("move-transfer")
        fields.wait_for(timeout=10_000)
        check(dialog.locator("#move-it-own").inner_text() == WALLET, f"1762: From reads the line's own side, {WALLET}")
        check(dialog.locator("#move-it-detail").input_value() == "Meera Iyer",
              "1762: Detail starts as the wallet holder, as Mark starts it")
        check(dialog.get_by_text("Expense type", exact=True).count() == 0, "1762: no expense type is asked")
        dialog.locator("#move-it-other").select_option(CARD)
        dialog.get_by_placeholder("Why does it belong there?").fill(REASON)
        page.wait_for_timeout(300)
        save(page, out, "03-move-to-internal-transfer")
        dialog.get_by_role("button", name="Move to Internal Transfer").click()
        dialog.get_by_text("1 expense moved to Internal Transfer.").wait_for(timeout=60_000)
        check(True, "1762: the dialog says 1 expense moved to Internal Transfer")
        save(page, out, "04-moved")
        dialog.get_by_role("button", name="Done").click()

    after = db(TXN, "--expense", EXPENSE)
    (out / "04-db.json").write_text(json.dumps(after, indent=2, default=str))
    record = after["record"] or {}
    bill = before["bills"][0]
    check(after["expense_exists"] is False, f"1762 (story 28): DB the expense {EXPENSE} is gone")
    check(after["settled"] == [] and any(leg["reversal_reason"] == REASON for leg in after["reversed"]),
          "1762: DB no live Settled match; the leg is Reversed with the reason")
    check(after["line"]["row_status"] == "Internal Transfer", "1762 (story 28): DB the line is Internal Transfer")
    check((record.get("from_place"), record.get("to_place"), record.get("detail"), record.get("made_by"),
           record.get("marked_by"), record.get("mark_reason")) == (WALLET, CARD, "Meera Iyer", "by hand", a.lead, REASON),
          f"1762 (story 13): DB record {record.get('name')} runs {WALLET} -> {CARD}, by hand, with the reason")
    check(record.get("proof") == bill["bill_file"] and len(record.get("proof_files") or []) == 1,
          "1762 (story 27): DB the record's proof is the bill's file, and that File is attached to the record")
    check(len(after["bills"]) == 1 and after["bills"][0]["name"] == bill["name"] and after["bills"][0]["is_latest"] == 0,
          "1762: DB the Expense bill stays, as history")

    # 4. The Internal Transfers tab, and the record in Desk.
    page.get_by_role("button", name=re.compile(r"^Internal Transfers \d+$")).click()
    page.wait_for_load_state("networkidle")
    search(page, TXN)
    row = page.get_by_role("row").filter(has_text=REMARK)
    row.first.wait_for(timeout=30_000)
    check(CARD in row.first.inner_text() and WALLET in row.first.inner_text(),
          "1762: the Internal Transfers tab lists the line with its two ends")
    save(page, out, "05-internal-transfers-tab")
    link = row.first.get_by_role("link", name=record.get("name") or "-")
    if check(link.count() == 1, f"1762: the line links its record {record.get('name')}"):
        with page.context.expect_page() as opened:
            link.click()
        desk = opened.value
        desk.wait_for_load_state("networkidle")
        desk.get_by_text("Proof", exact=True).first.wait_for(timeout=30_000)
        file_name = (record.get("proof") or "").rsplit("/", 1)[-1].split("?")[0]
        check(bool(file_name) and file_name in desk.locator("body").inner_text(),
              f"1762 (story 27): the record in Desk shows its Proof ({file_name})")
        save(desk, out, "06-record-proof-in-desk")
    print(f"evidence: {out}")

print(f"misses: {len(MISSES)}")
for miss in MISSES:
    print(f"  NOT SEEN: {miss}")
raise SystemExit(1 if MISSES else 0)
