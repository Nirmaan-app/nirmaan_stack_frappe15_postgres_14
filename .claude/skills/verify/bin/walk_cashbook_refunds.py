#!/usr/bin/env python3
"""Walk spec #1711's Cashbook stories: a Collect Payment created like any spend and paired with its full refund
(#1708), lines before 1 Apr 2026 left out and counted (#1707), and an unpaired wallet refund booked as a minus Expense
where its spend is booked (#1709). Each story is asserted on screen and by a DB read; it exits 1 when one is not seen
(it walks on past a miss, and lists every miss at the end).

    python3 .claude/skills/verify/bin/walk_cashbook_refunds.py --task <task> --accountant <email> --lead <email> \
        --password <pw>

Both users need the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). It uploads two made-up
statements (`cashbook_refunds_seed.py`; every Txn Id carries a stamp, so every run is a new import, and each run's
part refund names a new spend). An env runs no RQ worker, so the walk drains the `long` queue itself after Create.
The import stays, as `walk_cashbook_collect.py`'s does; the lines it unreconciles and skips stay so.

As the Accountant:
 1. Sidebar Bulk Import Transactions -> Import statement -> Source Cashbook -> the statement -> Read statement. Review
    heads "2 expense records" and ₹550 (spends only), says "1 line before 1 Apr 2026 left out", shows no
    "shop-requested" box, lists the Collect payment in its group, lists 2 wallet refunds each with the spend it
    reduces (the project spend's Expense and project; "no Expense yet" and Non Project Expenses), and 2 paired
    wallet refunds (a Collect Payment's and a Wallet Spend's).
 2. Create 4 records -> the job runs -> the progress says the left-out line again. DB: Collect and spend Settled with
    their Expenses; both pairs Skipped, no Expense; the part refund a Paid Project Expense of minus its Credit on the
    spend's project and type, match `target_amount` negative; the orphan refund a Paid Non Project Expense of -₹45;
    no line stored for the early spend; the import's `lines_before_cutoff` is 1; no refund in the Cashbook queue.
 3. Import history -> Cashbook: the import's row says "1 line before 1 Apr 2026 left out".
 4. Import statement -> Cashbook -> a file of only March 2026 lines: refused, with why, and no Create; DB: no line.
 5. Dashboard -> Project Expenses -> Paid: the part refund's row, green "-₹", on the spend's project.
 6. Dashboard -> Non-Project Expenses -> Paid: the orphan refund's row, -₹45.
 7. Vendor Invoice Recon -> Pending Invoices Upload -> Cashbook: this run's spends wait; neither refund is listed.
As the Accountant Lead:
 8. Project Payment & Expense -> Payment Done / Reconciliation Done: the spend's row has Upload Inv; the wallet
    refund's and a card refund's rows have neither Upload Inv nor Edit Inv.
 9. Bulk Import Transactions -> Settled - Inflow -> the orphan refund's line -> Unreconcile: DB its Expense is
    deleted and the line is open again.
10. Matched / Settled - Outflow -> the Collect payment's line -> Unreconcile (setup for 11).
As the Accountant:
11. Not Matched - Outflow -> the Collect payment's line -> Choose: the "Nothing to link?" box -> Skip transfer;
    DB: the line is Skipped by hand.
As the Accountant Lead (`--part tier-export` walks this step alone):
12. Project Payment & Expense -> Payment Done / Reconciliation Done -> Export (#1710): the downloaded CSV's Tier,
    held row by row to the DB (`approval_tier_export_db.py`): SYSTEM on every Expense with an import marker (Cashbook
    and card, spends and refunds, above ₹50,000 too), AUTO / L1 / L1+L2 by amount on every person-raised one; this
    run's Cashbook Expenses read SYSTEM. The CSV is saved under the bench's `tmp/` (the env's data; it goes with
    `devenv.sh destroy`).
"""

import argparse
import csv
import datetime
import json
import re
import subprocess
from pathlib import Path

from cashbook_walk import expense_list, host, open_import, search, unreconcile
from drive import save, session, sidebar

BIN = ".claude/skills/verify/bin"

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--accountant", required=True)
ap.add_argument("--lead", required=True)
ap.add_argument("--password", required=True)
ap.add_argument("--part", choices=("all", "tier-export"), default="all",
                help="tier-export walks only step 12, on the env's Paid Expenses as they are")
a = ap.parse_args()

STAMP = datetime.datetime.now(datetime.timezone.utc).strftime("%m%d%H%M%S")
MISSES: list[str] = []
# This run's Cashbook Expenses that outlive the walk (the spend's and the part refund's): step 12 reads their Tier.
RUN_EXPENSES: list[str] = []


def devenv(*args: str) -> str:
    return subprocess.run(["scripts/devenv/devenv.sh", *args], capture_output=True, text=True, check=True).stdout


def check(ok: bool, what: str) -> bool:
    print(f"{'seen' if ok else 'NOT SEEN'}: {what}")
    if not ok:
        MISSES.append(what)
    return ok


seeded = dict(re.findall(r"^(\w+): (.*)$", devenv("script", a.task, f"{BIN}/cashbook_refunds_seed.py", STAMP), re.M))
TXNS = ("COLLECT", "SPEND", "CPAIR", "CPAIR_REF", "SPAIR", "SPAIR_REF", "PREF", "NREF", "EARLY", "E1", "E2")
PART = float(seeded["part"])
SPEND_TXN = seeded["PREF"].removeprefix("REF-")
NREF_SPEND = seeded["NREF"].removeprefix("REF-")


def db(*extra: str) -> dict:
    out = devenv("script", a.task, f"{BIN}/cashbook_refunds_db.py", *(seeded[t] for t in TXNS), *extra)
    raw = json.loads(next(line for line in out.splitlines() if line.startswith("JSON:"))[5:])
    raw["by"] = {t: raw["lines"][seeded[t]] for t in TXNS}
    return raw


def tier_export(page, out) -> None:
    """12. Project Payment & Expense -> Payment Done / Reconciliation Done -> Export: the CSV's Tier column (#1710)."""
    sidebar(page, "Project Payment & Expense")
    page.get_by_role("button", name=re.compile(r"^Payment Done \/ Reconciliation Done")).click()
    page.wait_for_load_state("networkidle")
    page.get_by_role("row").nth(1).wait_for(timeout=60_000)
    save(page, out, "13a-payment-done-before-export")
    with page.expect_download(timeout=300_000) as download:
        page.get_by_role("button", name=re.compile(r"^Export")).first.click()
    name = f"walk-tier-export-{STAMP}.csv"
    csv_path = Path(host(seeded["statement"])).parent / name
    download.value.save_as(str(csv_path))
    (out / "13-export-file.txt").write_text(f"{download.value.suggested_filename} -> {csv_path}\n")
    save(page, out, "13b-exported")
    raw = devenv("script", a.task, f"{BIN}/approval_tier_export_db.py", f"{Path(seeded['statement']).parent}/{name}")
    got = json.loads(next(line for line in raw.splitlines() if line.startswith("JSON:"))[5:])
    (out / "13-db.json").write_text(json.dumps(got, indent=2, default=str))
    kinds = got["kinds"]
    print(f"tier export: {got['rows']} Expense rows; kinds {json.dumps(kinds)}")
    check(got["rows"] > 0 and got["mismatch_count"] == 0,
          f"1710-1: every Expense row's Tier in the export matches the DB ({got['rows']} rows, "
          f"{got['mismatch_count']} differ: {got['mismatches'][:3]})")
    for kind in ("cashbook_spend", "cashbook_refund", "card_spend", "card_refund"):
        check(kind in kinds and kinds[kind]["example"][2] == "SYSTEM",
              f"1710-1: a {kind.replace('_', ' ')} reads SYSTEM ({kinds.get(kind)})")
    if "imported_above_50k" in kinds:
        check(kinds["imported_above_50k"]["example"][2] == "SYSTEM",
              f"1710-1: an imported Expense above ₹50,000 reads SYSTEM ({kinds['imported_above_50k']})")
    else:
        print("note: no imported Expense above ₹50,000 on Payment Done in this env")
    for label in ("AUTO", "L1", "L1+L2"):
        kind = f"person_{label}"
        check(kind in kinds and kinds[kind]["example"][2] == label,
              f"1710-1: a person-raised Expense reads {label} ({kinds.get(kind)})")
    with open(csv_path, encoding="utf-8-sig", newline="") as handle:
        tiers = {row["ID"]: row["Tier"] for row in csv.DictReader(handle)}
    for expense in RUN_EXPENSES:
        check(tiers.get(expense) == "SYSTEM", f"1710-1: this run's Cashbook Expense {expense} reads SYSTEM ({tiers.get(expense)})")


if a.part == "all":
    # ---- 1-7, as the Accountant ----------------------------------------------------------------------------------------
    with session(a.task, a.accountant, a.password) as (page, out):
        (out / "seeded.json").write_text(json.dumps(seeded, indent=2))
        dialog = open_import(page, seeded["statement"])
        dialog.get_by_text(re.compile(r"^2 expense records")).wait_for(timeout=60_000)
        text = dialog.inner_text()
        check("₹550" in text, "1709-1: Review heads 2 expense records and ₹550, the spends only")
        check("1 line before 1 Apr 2026 left out" in text and f"Walk 1711 early {STAMP}" not in text,
              "1707-1: Review says '1 line before 1 Apr 2026 left out' and does not list the early line")
        check("shop-requested" not in text.lower(), "1708-1: Review shows no 'shop-requested payments' box")
        heading = (
            "2 wallet refunds will be booked as minus expenses: each where its spend is booked, or else where its "
            "remark says"
        )
        check(heading in text, f"1709-1: Review lists the refunds apart: {heading!r}")
        box = dialog.get_by_text(heading, exact=True).locator("xpath=..")
        refunds = box.inner_text() if box.count() else ""
        check(f"reduces {SPEND_TXN} ({seeded['spend_expense']})" in refunds and seeded["spend_project_name"] in refunds
              and "Project Expenses" in refunds,
              f"1709-1: the part refund names the spend it reduces, {SPEND_TXN} ({seeded['spend_expense']}), "
              f"on {seeded['spend_project_name']}")
        check(f"reduces {NREF_SPEND} (no Expense yet)" in refunds and "Non Project Expenses" in refunds,
              "1709-1: the orphan refund says its spend has no Expense yet, and goes to Non Project Expenses")
        pairs = "2 paired wallet refunds: each refund gives back a whole spend, so neither line is recorded"
        check(pairs in text and f"Collect Payment {seeded['CPAIR']}" in text and f"Wallet Spend {seeded['SPAIR']}" in text,
              "1708-2 / 1709-8: Review lists 2 paired wallet refunds, a Collect Payment's and a Wallet Spend's")
        save(page, out, "01-review")
        dialog.get_by_role("button", name=re.compile(r"Petty Cash")).first.click()
        check(dialog.get_by_text(f"Walk 1711 collect {STAMP}").count() > 0,
              "1708-1: the Collect payment is listed among the spends to create")
        save(page, out, "02-collect-in-its-group")

        dialog.get_by_role("button", name="Create 4 records").click()
        page.wait_for_timeout(2000)
        devenv("run", a.task, "worker", "--queue", "long", "--burst")
        page.wait_for_timeout(4000)
        check(dialog.get_by_text("1 line before 1 Apr 2026 left out").count() > 0,
              "1707-1: the import's progress says the left-out line again")
        save(page, out, "03-created")

        state = db()
        by = state["by"]
        batch = by["COLLECT"]["line"]["import_batch"]
        state = db("--batch", batch)
        by = state["by"]
        (out / "03-db.json").write_text(json.dumps(state, indent=2, default=str))
        for key, amount in (("COLLECT", 480.0), ("SPEND", 70.0)):
            got = by[key]
            check(got["line"]["row_status"] == "Settled" and got["expense"] and float(got["expense"]["amount"]) == amount
                  and got["expense"]["cashbook_batch"] == batch and got["expense"]["payment_ref"] == seeded[key],
                  f"1708-1: DB {key} line Settled, its Expense ₹{amount} with the Cashbook marker and its Txn Id")
        for key in ("CPAIR", "CPAIR_REF", "SPAIR", "SPAIR_REF"):
            got = by[key]
            check(got["line"]["row_status"] == "Skipped" and not got["expense"]
                  and "Paired wallet refund" in (got["line"]["outcome_note"] or "") + (got["line"]["skip_kind"] or ""),
                  f"1708-2 / 1709-8: DB {key} line Skipped as a paired wallet refund, no Expense")
        pref = by["PREF"]["expense"] or {}
        RUN_EXPENSES.extend(x for x in (pref.get("name"), (by["SPEND"]["expense"] or {}).get("name")) if x)
        check(by["PREF"]["line"]["row_status"] == "Settled" and pref.get("doctype") == "Project Expenses"
              and float(pref.get("amount") or 0) == -PART and pref.get("projects") == seeded["spend_project"]
              and pref.get("type") == seeded["spend_type"] and pref.get("status") == "Paid"
              and pref.get("payment_ref") == seeded["PREF"] and pref.get("cashbook_batch") == batch
              and float(pref.get("target_amount") or 0) == -PART and not pref.get("invoice_attachment"),
              f"1709-2: DB the part refund is Paid Project Expense {pref.get('name')} of -₹{PART:g} on "
              f"{seeded['spend_project']} / {seeded['spend_type']}, match -₹{PART:g}")
        nref = by["NREF"]["expense"] or {}
        check(by["NREF"]["line"]["row_status"] == "Settled" and nref.get("doctype") == "Non Project Expenses"
              and float(nref.get("amount") or 0) == -45.0 and nref.get("status") == "Paid"
              and nref.get("type") == "Petty Cash",
              f"1709-3: DB the orphan refund is Paid Non Project Expense {nref.get('name')} of -₹45, Petty Cash")
        check(by["EARLY"]["line"] is None and state["batch"]["lines_before_cutoff"] == 1,
              "1707-1: DB no line stored for the early spend; the import keeps lines_before_cutoff = 1")
        check(not by["PREF"]["in_cashbook_queue"] and not by["NREF"]["in_cashbook_queue"]
              and by["SPEND"]["in_cashbook_queue"],
              "1709-6: DB the Cashbook invoice queue holds the spend, and neither refund")

        # 3. Import history -> Cashbook: the import's left-out count.
        page.keyboard.press("Escape")
        page.wait_for_timeout(700)
        page.get_by_role("button", name="Import history").click()
        history = page.get_by_role("dialog", name="Import history")
        history.wait_for()
        history.get_by_role("tab", name=re.compile(r"^Cashbook")).click()
        entry = history.get_by_role("button").filter(has_text=state["batch"]["original_filename"])
        entry.first.wait_for(timeout=30_000)
        check("1 line before 1 Apr 2026 left out" in entry.first.inner_text(),
              "1707-2: Import History's row for the import says '1 line before 1 Apr 2026 left out'")
        save(page, out, "04-import-history")
        page.keyboard.press("Escape")
        page.wait_for_timeout(700)

        # 4. A file of only March 2026 lines.
        dialog = open_import(page, seeded["early"])
        refusal = dialog.get_by_text(re.compile(r"^Not imported\. All 2 lines in .* are dated before 1 Apr 2026"))
        refusal.wait_for(timeout=60_000)
        check(dialog.get_by_role("button", name=re.compile(r"^Create \d+ record")).filter(visible=True).count() == 0
              or not dialog.get_by_role("button", name=re.compile(r"^Create \d+ record")).first.is_enabled(),
              "1707-3: a file of only March lines is refused, saying why, with no Create to press")
        save(page, out, "05-only-early-refused")
        early = db()["by"]
        check(early["E1"]["line"] is None and early["E2"]["line"] is None, "1707-3: DB no line stored from that file")
        page.keyboard.press("Escape")
        page.wait_for_timeout(700)

        # 5. Project Expenses: the part refund, green and minus, on the spend's project.
        rows = expense_list(page, "Project Expenses", f"Wallet refund of {SPEND_TXN}")
        row_text = rows.first.inner_text()
        amount_cell = rows.first.locator("div.text-green-600")
        check(rows.count() == 1 and seeded["spend_project_name"] in row_text, "1709-2: the Project Expenses list shows the "
              f"refund on {seeded['spend_project_name']}")
        check(amount_cell.count() == 1 and re.search(rf"[-−]₹\s?{int(PART)}\b", amount_cell.inner_text().replace(",", "")) is not None,
              f"1709-4: its amount reads green -₹{PART:g} ({amount_cell.first.inner_text() if amount_cell.count() else ''})")
        save(page, out, "06-project-expenses-refund")

        # 6. Non-Project Expenses: the orphan refund.
        rows = expense_list(page, "Non-Project Expenses", f"Wallet refund of {NREF_SPEND}")
        check(rows.count() == 1 and re.search(r"[-−]₹\s?45\b", rows.first.inner_text()) is not None,
              "1709-3: the Non-Project Expenses list shows the orphan refund at -₹45")
        save(page, out, "07-non-project-expenses-refund")

        # 7. Pending Invoices Upload -> Cashbook: the spends wait, the refunds do not.
        sidebar(page, "Vendor Invoice Recon")
        page.get_by_role("button", name=re.compile(r"^Pending Invoices Upload")).first.click()
        page.wait_for_load_state("networkidle")
        page.get_by_role("button", name=re.compile(r"^Cashbook")).first.click()
        page.wait_for_load_state("networkidle")
        search(page, f"Walk 1711 spend {STAMP}")
        page.get_by_role("row").filter(has_text=f"Walk 1711 spend {STAMP}").first.wait_for(timeout=30_000)
        check(True, "1709-6: the Cashbook pill finds this run's spend by its remark (the search works)")
        save(page, out, "08a-cashbook-pill-spend")
        for text in (f"Walk 1711 part refund {STAMP}", seeded["PREF"], f"Wallet refund of {SPEND_TXN}",
                     f"Wallet refund of {NREF_SPEND}"):
            search(page, text)
            check(page.get_by_role("row").filter(has_text=re.compile("refund", re.I)).count() == 0,
                  f"1709-6: the Cashbook pill lists no refund for {text!r}")
        save(page, out, "08b-cashbook-pill-no-refund")
        print(f"evidence: {out}")

    # ---- 8-10, as the Accountant Lead --------------------------------------------------------------------------------
    with session(a.task, a.lead, a.password) as (page, out):
        sidebar(page, "Project Payment & Expense")
        page.get_by_role("button", name=re.compile(r"^Payment Done \/ Reconciliation Done")).click()
        page.wait_for_load_state("networkidle")
        search(page, f"Walk 1711 spend {STAMP}")
        spend_row = page.get_by_role("row").filter(has_text=f"Walk 1711 spend {STAMP}")
        spend_row.first.wait_for(timeout=30_000)
        check(spend_row.first.get_by_role("button", name=re.compile(r"^(Upload|Edit) Inv")).count() == 1,
              "1709-5: a wallet spend's row on Payment Done has Upload Inv (the button shows for this user)")
        save(page, out, "09a-payment-done-spend")
        for label, text in (("wallet refund", f"Wallet refund of {SPEND_TXN}"), ("wallet refund", f"Wallet refund of {NREF_SPEND}"),
                            ("card refund", "Card refund from")):
            search(page, text)
            rows = page.get_by_role("row").filter(has_text=text)
            rows.first.wait_for(timeout=30_000)
            check(rows.first.get_by_role("button", name=re.compile(r"(Upload|Edit) Inv")).count() == 0,
                  f"1709-5: the {label} row {text!r} on Payment Done has no Upload / Edit Inv")
            save(page, out, f"09b-payment-done-{label.replace(' ', '-')}-{len(text)}")

        sidebar(page, "Bulk Import Transactions")
        page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
        dialog = unreconcile(page, "Settled – Inflow", f"Walk 1711 orphan refund {STAMP}", "Walk 1711: unreconcile the refund")
        save(page, out, "10a-unreconcile-refund-dialog")
        dialog.get_by_role("button", name=re.compile(r"^Reverse all \d+$")).click()
        dialog.wait_for(state="hidden", timeout=30_000)
        page.wait_for_timeout(1500)
        save(page, out, "10b-refund-unreconciled")
        after = db("--expense", nref["name"])
        (out / "10-db.json").write_text(json.dumps(after, indent=2, default=str))
        check(not after["exists"][nref["name"]] and after["by"]["NREF"]["line"]["row_status"] == "Mismatched"
              and not after["by"]["NREF"]["expense"],
              f"1709-7: DB Unreconcile deleted the refund's Expense {nref['name']} and the line is open (Mismatched)")
        page.get_by_role("button", name=re.compile(r"^Not Matched – Inflow \d+$")).click()
        search(page, f"Walk 1711 orphan refund {STAMP}")
        check(page.get_by_role("row").filter(has_text=f"Walk 1711 orphan refund {STAMP}").count() == 1,
              "1709-7: the refund line is back on Not Matched – Inflow")
        save(page, out, "10c-refund-open-again")

        dialog = unreconcile(page, "Matched / Settled – Outflow", f"Walk 1711 collect {STAMP}", "Walk 1711: reopen the Collect payment")
        dialog.get_by_role("button", name=re.compile(r"^Reverse all \d+$")).click()
        dialog.wait_for(state="hidden", timeout=30_000)
        page.wait_for_timeout(1500)
        save(page, out, "11-collect-unreconciled")
        print(f"evidence: {out}")

    # ---- 11, as the Accountant -------------------------------------------------------------------------------------------
    with session(a.task, a.accountant, a.password) as (page, out):
        sidebar(page, "Bulk Import Transactions")
        page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
        page.get_by_role("button", name=re.compile(r"^Not Matched – Outflow \d+$")).click()
        search(page, f"Walk 1711 collect {STAMP}")
        row = page.get_by_role("row").filter(has_text=f"Walk 1711 collect {STAMP}")
        row.first.wait_for(timeout=30_000)
        row.first.get_by_role("button", name=re.compile(r"^(Choose|Confirm|Review)$")).click()
        dialog = page.get_by_role("dialog").last
        dialog.get_by_text("Nothing to link?").wait_for(timeout=30_000)
        check(dialog.get_by_text("Nothing to link?").count() == 1,
              "1708-3: an open Collect payment line's Choose offers the 'Nothing to link?' Skip box")
        dialog.locator("#skip-transfer-reason").fill("Walk 1711: Skip by hand on a Collect payment")
        page.wait_for_timeout(700)
        save(page, out, "12a-collect-skip-box")
        dialog.get_by_role("button", name="Skip transfer").click()
        page.wait_for_timeout(2500)
        save(page, out, "12b-collect-skipped")
        skipped = db()["by"]["COLLECT"]["line"]
        (out / "12-db.json").write_text(json.dumps(skipped, indent=2, default=str))
        check(skipped["row_status"] == "Skipped", f"1708-3: DB the Collect payment line is Skipped by hand ({skipped})")
        print(f"evidence: {out}")

# ---- 12, as the Accountant Lead: the Approve Payments export ------------------------------------------------------
with session(a.task, a.lead, a.password) as (page, out):
    tier_export(page, out)
    print(f"evidence: {out}")

if MISSES:
    print(f"{len(MISSES)} NOT SEEN:")
    for miss in MISSES:
        print(f"  - {miss}")
    raise SystemExit(1)
print("all seen")
