#!/usr/bin/env python3
"""Walk the Bill check on hand-attached bills (#1639) and on the bills a Cashbook import copies (#1641), spec
#1637, as an Accountant.

    devenv.sh script <task> .claude/skills/verify/bin/office_rent_seed.py      # once per env: the free Accountant
    devenv.sh run <task> set-password walk-accountant@example.com <pw>   # the walk gives its other two users <pw>
    python3 .claude/skills/verify/bin/walk_expense_bills.py --task <task> --password <pw> [--accountant <email>]
        [--part attach|cashbook|all]      # default all

Part `attach` (#1639):

Each run seeds its own made-up card spend (₹1,180.00) and wallet spend (₹2,360.00) with their statement lines
(`expense_bills_seed.py`) and writes two made-up PDF bills: one for ₹1,180.00 (Matched) and one for ₹2,500.00
(Mismatched).

1. Sidebar Vendor Invoice Recon -> Pending Invoices Upload -> Credit Card: the spend is listed; Attach invoice with
   the ₹1,180 bill; the spend leaves the list. DB: an Expense bill, Checking, Pending, against its line (₹1,180).
2. -> Cashbook: the same with the ₹2,500 bill. DB: Checking, Pending, against its wallet line (₹2,360).
3. A one-shot worker on the env's `long` queue runs the readings (the env serves no worker), with the env's real
   reader. DB: the card bill Matched, Approved, auto-approved by System, its number and date on the Expense; the
   wallet bill Mismatched, Pending, nothing on the Expense.
4. Dashboard -> Non-Project Expenses: the card spend's row shows the bill's Invoice Ref and Invoice Date.
   Dashboard -> Project Expenses: the wallet spend's row shows none.

Then Pending Approval (#1644), with `expense_bill_approval_seed.py <stamp>`: a made-up card spend whose bill was
read Mismatched (seeded: the env's reader cannot give one), and two made-up users, an Accountant Lead and a PMO.

5. As the Accountant, Vendor Invoice Recon -> Pending Invoice Approvals: the PO / WO / Cashbook / Credit Card
   pills. PO lists every Pending PO Vendor Invoice and WO every Pending WO one (DB).
6. Credit Card: the seeded bill's row (spend date, line ₹1,180, total read ₹1,250, Mismatched, the typed number,
   the holder, who attached it, the file). Approve: the form offers the typed number; a corrected number and date
   are approved; the row leaves. DB: Approved by the Accountant, both mirrored onto the spend, a Version by the
   Accountant on the bill and on the spend.
7. Cashbook: the wallet bill (step 3's, Pending) -> Reject with a reason; the row leaves. DB: Rejected with the
   reason, the spend's attachment, ref and date cleared, Versions by the Accountant.
8. Pending Invoices Upload -> Cashbook: the wallet spend is back, showing "Last bill rejected: <reason>".
9. As the Accountant Lead: Pending Invoices Upload -> Cashbook -> No invoice on that spend; it leaves. DB: marked.
10. As the PMO (outside the approvers): Vendor Invoice Recon shows no Pending Invoice Approvals tab, and a direct
   call of the reject endpoint is refused (403). DB: the bill is still Pending.

Then Read again (#1645), with `expense_bill_read_again_seed.py`: a made-up Not read card bill and a made-up wallet
bill whose reading stopped (Checking, claimed 30 minutes ago). Steps 11-14 are `read_again_part`'s docstring: the
Accountant sees no Read again and is refused; the Accountant Lead presses it on both rows, they leave as Checking,
a second press reads once, a one-shot worker reads them, and each row's new result shows. `--part read-again` runs
only these steps.

Then the Bill check column of the expense lists (#1640), steps 15-18, with `expense_bill_list_seed.py <stamp>`:
made-up Paid spends "WalkBC <stamp> ..." whose latest bills are seeded in each state. They are `bill_check_part`'s
docstring. `--part bill-check` runs only these steps (they need only the Accountant).

`--shots DIR` also keeps one half-size screenshot per acceptance criterion there.

Every step asserts the screen's text and its DB row; a miss raises, saves `FAIL.*` and exits 1. When the env's
reader is unavailable (no valid key, no network: the bill's reason says so), step 3 asserts the Not read path
instead -- both bills Not read with their reason, Pending, nothing on either Expense -- and prints NOT WALKED for
Matched and Mismatched.

Part `cashbook` (#1641): `cashbook_bills_seed.py` confirms two made-up Cashbook imports as the Accountant through the
real endpoint and runs their job: a spend with one bill link (read: Matched), one with two (Not checked, total =
line amount, never read) and one whose bill comes late with the second import (read: Mismatched). SEEDED: the env
cannot reach the wallet's bill storage and its reader key is refused, so the seed answers the downloads with made-up
files and reads with a stand-in reader; the screens below show those seeded results.
5. DB: each spend's one Expense bill -- ONE Matched, Approved by System, its number on the Expense; TWO Not checked,
   Pending, `invoice_amount` = line amount, no number or date, never claimed by a reading; LATE Mismatched, Pending,
   nothing on the Expense. Each uploaded by the Accountant who confirmed the import.
6. Dashboard -> each spend's expense list -> Paid: ONE's row shows its Invoice Ref; TWO's and LATE's show none.

Evidence: `$VERIFY_OUT`, else ~/claude-artifacts/verify/<task>/<UTC time>/.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from drive import save, session, sidebar

ROOT = Path(__file__).resolve().parents[4]
DEVENV = str(ROOT / "scripts/devenv/devenv.sh")
BIN = ROOT / ".claude/skills/verify/bin"
NPE, PE = "Non Project Expenses", "Project Expenses"
#: A Not read reason that says the reader itself is unavailable, not that this bill could not be read.
READER_DOWN = re.compile(r"^(The reader failed|The reader timed out|Reading is switched off)")

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--password", required=True)
ap.add_argument("--accountant", default="walk-accountant@example.com")
ap.add_argument("--lead", default="walk-accountant-lead@example.com")
ap.add_argument("--outsider", default="walk-pmo@example.com")
ap.add_argument("--shots", help="also keep one half-size screenshot per acceptance criterion here")
ap.add_argument("--part", choices=("all", "read-again", "cashbook", "bill-check"), default="all",
                help="read-again: only steps 11-14 (#1645); cashbook: only the Cashbook import walk (#1641); bill-check: only steps 15-18 (#1640); each with its own seed")
a = ap.parse_args()

STAMP = datetime.datetime.now(datetime.timezone.utc).strftime("%m%d%H%M%S")
TODAY = datetime.date.today()


def expect(ok: bool, what: str) -> None:
    if not ok:
        raise AssertionError(f"MISS: {what}")
    print(f"ok   {what}")


def script(name: str, *args: str) -> str:
    res = subprocess.run([DEVENV, "script", a.task, str(BIN / name), *args], capture_output=True, text=True)
    if res.returncode:
        raise RuntimeError(f"{name} failed:\n{res.stdout[-2000:]}\n{res.stderr[-2000:]}")
    return res.stdout


def seed() -> dict:
    return seed_as(STAMP)


def seed_as(stamp: str) -> dict:
    line = next(l for l in script("expense_bills_seed.py", stamp).splitlines() if l.startswith("EXPENSE_BILLS_SEED "))
    return json.loads(line.removeprefix("EXPENSE_BILLS_SEED "))


def db(out: Path, name: str, spends: dict) -> dict:
    """Both spends' invoice fields and Expense bills, saved beside the screenshots as `<name>.db.json`."""
    return db_of(out, name, [NPE, spends["card"], PE, spends["wallet"]])


def db_of(out: Path, name: str, pairs: list[str]) -> dict:
    """The invoice fields and Expense bills of each (doctype, name) in `pairs`, saved as `<name>.db.json`."""
    stdout = script("expense_bills_db.py", *pairs)
    answer = json.loads(next(l for l in stdout.splitlines() if l.startswith("EXPENSE_BILLS_DB ")).removeprefix(
        "EXPENSE_BILLS_DB "))
    (out / f"{name}.db.json").write_text(json.dumps(answer, indent=2))
    return answer


def bill_pdf(path: Path, number: str, total: str, seller: str) -> Path:
    """A one-page made-up tax invoice: seller, number, date, one line and its total (incl. GST)."""
    lines = [
        (16, seller), (11, "TAX INVOICE"), (11, f"Invoice No: {number}"),
        (11, f"Invoice Date: {TODAY.strftime('%d-%m-%Y')}"), (11, "Bill to: Stratos Infra Technologies Pvt Ltd"),
        (11, "Item: Food and beverages"), (11, f"Taxable value: Rs {float(total.replace(',', '')) / 1.05:.2f}"),
        (11, "GST 5%: included"), (13, f"Grand Total (incl. GST): Rs {total}"),
    ]
    text = "BT\n" + "".join(f"/F1 {size} Tf 1 0 0 1 60 {760 - 30 * i} Tm ({t}) Tj\n" for i, (size, t) in enumerate(lines)) + "ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(text)} >>\nstream\n{text}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    # The second line's high bytes mark the file binary, as every real PDF's does: Frappe hands a local file that
    # decodes as text back as a str, and the reader refuses a str.
    body, offsets = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(body))
        body += f"{i} 0 obj\n{obj}\nendobj\n"
    xref = len(body)
    body += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    body += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    path.write_bytes(body.encode("latin-1"))
    return path


def attach(page, pill: str, search: str, pdf: Path, out: Path, step: str) -> None:
    """In Pending Invoices Upload -> `pill`, find the spend by `search`, attach `pdf`, see it leave the list."""
    page.get_by_role("button", name=re.compile(rf"^{pill}")).click()
    page.wait_for_load_state("networkidle")
    page.get_by_placeholder(re.compile("search", re.I)).first.fill(search)
    row = page.get_by_role("row").filter(has_text=search)
    row.first.wait_for(timeout=30_000)
    expect(row.count() == 1, f"{pill}: the spend '{search}' waits for its invoice")
    save(page, out, f"{step}a-{pill.lower().replace(' ', '-')}-waiting")
    row.get_by_role("button", name="Attach invoice").click()
    page.get_by_text("Upload Invoice").wait_for()
    page.locator('input[type="file"]').last.set_input_files(str(pdf))
    page.wait_for_timeout(500)
    save(page, out, f"{step}b-{pill.lower().replace(' ', '-')}-dialog")
    page.get_by_role("button", name="Save Invoice").click()
    page.get_by_text("Upload Invoice").wait_for(state="hidden", timeout=60_000)
    page.get_by_role("row").filter(has_text=search).first.wait_for(state="detached", timeout=30_000)
    expect(page.get_by_role("row").filter(has_text=search).count() == 0, f"{pill}: the spend left the list")
    save(page, out, f"{step}c-{pill.lower().replace(' ', '-')}-attached")


def open_list(page, card: str, search: str) -> str:
    """Dashboard -> the expense list's card -> Paid; the row of `search`'s spend (by Description), as text."""
    sidebar(page, "Dashboard")
    page.get_by_text(card, exact=True).first.click()
    page.wait_for_load_state("networkidle")
    # The seeded spends are Paid; the list opens on another tab.
    page.get_by_role("button", name=re.compile(r"^Paid \d+$")).click()
    page.wait_for_load_state("networkidle")
    page.get_by_placeholder(re.compile("search", re.I)).first.fill(search)
    row = page.get_by_role("row").filter(has_text=search).first
    row.wait_for(timeout=30_000)
    return row.inner_text()


def approval_db(out: Path, name: str, *bills: str) -> dict:
    stdout = script("expense_bill_approval_db.py", *bills)
    answer = json.loads(next(l for l in stdout.splitlines() if l.startswith("EXPENSE_BILL_APPROVAL_DB ")).removeprefix(
        "EXPENSE_BILL_APPROVAL_DB "))
    (out / f"{name}.db.json").write_text(json.dumps(answer, indent=2))
    return answer


def shot(page, out: Path, name: str, criterion: str | None = None) -> None:
    """`save`, and with --shots a half-size copy named for the acceptance criterion it shows."""
    save(page, out, name)
    if a.shots and criterion:
        Path(a.shots).mkdir(parents=True, exist_ok=True)
        target = Path(a.shots) / f"{criterion}.png"
        shutil.copy(out / f"{name}.png", target)
        if sys.platform == "darwin":
            width = int(subprocess.run(["sips", "-g", "pixelWidth", str(target)], capture_output=True, text=True)
                        .stdout.split()[-1])
            subprocess.run(["sips", "--resampleWidth", str(width // 2), str(target)], capture_output=True)


def pill(page, label: str) -> None:
    page.get_by_role("button", name=label, exact=True).click()
    page.wait_for_load_state("networkidle")


def find_row(page, search: str):
    page.get_by_placeholder(re.compile("search", re.I)).first.fill(search)
    row = page.get_by_role("row").filter(has_text=search)
    row.first.wait_for(timeout=30_000)
    expect(row.count() == 1, f"one row for '{search}'")
    return row.first


def gone(page, search: str, what: str) -> None:
    page.get_by_role("row").filter(has_text=search).first.wait_for(state="detached", timeout=30_000)
    expect(page.get_by_role("row").filter(has_text=search).count() == 0, what)


READ_AGAIN_API = "/api/method/nirmaan_stack.api.expenses.expense_bill_approval.read_expense_bill_again"


def press_read_again_by_hand(page, bill: str) -> list:
    """POST Read again for `bill` from the page's own session, as the button does: [status, body]."""
    return page.evaluate(
        """async ([url, bill]) => {
            const r = await fetch(url, {
                method: 'POST', headers: {'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': window.csrf_token},
                body: JSON.stringify({bill})});
            return [r.status, await r.text()];
        }""",
        [READ_AGAIN_API, bill],
    )


def approvals_pill(page, label: str) -> None:
    sidebar(page, "Vendor Invoice Recon")
    page.get_by_role("button", name="Pending Invoice Approvals").click()
    page.wait_for_load_state("networkidle")
    pill(page, label)


def read_again_part() -> None:
    """Steps 11-14: Read again (#1645) on a seeded Not read card bill and a seeded wallet bill whose reading stopped.

    11. As the Accountant: Pending Invoice Approvals -> Credit Card and -> Cashbook list both rows Not read (the
        wallet one "The reading stopped.") with no Read again; the endpoint answers 403 and the bill is unchanged.
    12. As the Accountant Lead: Credit Card -> the row's Read again; the row leaves. DB: Checking, unclaimed. A
        second press (two POSTs from the page) is answered 200 and leaves it Checking: one reading. Cashbook -> the
        stopped row's Read again; it leaves. DB: Checking, unclaimed.
    13. A one-shot worker on the env's `long` queue reads both again.
    14. Back on both pills: each row's new result, the same as its DB row. The env's reader is refused, so the
        result is Not read with the reader's reason; Matched (auto-approved, leaves) is NOT WALKED here and is
        proven by `test_expense_bill_read_again`.
    """
    spends = seed_as(f"R{STAMP}")
    ra = json.loads(next(l for l in script("expense_bill_read_again_seed.py", STAMP, spends["card"], spends["wallet"])
                         .splitlines() if l.startswith("EXPENSE_BILL_READ_AGAIN_SEED "))
                    .removeprefix("EXPENSE_BILL_READ_AGAIN_SEED "))
    print(f"seeded for Read again: {ra}")
    card_bill, wallet_bill = ra["card_bill"], ra["wallet_bill"]
    subprocess.run([DEVENV, "run", a.task, "set-password", a.lead, a.password], capture_output=True, check=True)

    # 11. The Accountant sees both rows, and no Read again.
    with session(a.task, a.accountant, a.password) as (page, out):
        approvals_pill(page, "Credit Card")
        row = find_row(page, ra["card_holder"])
        expect("Not read" in row.inner_text(), "Accountant, Credit Card: the bill is Not read")
        expect(row.get_by_role("button", name="Read again").count() == 0, "Accountant, Credit Card: no Read again")
        expect(row.get_by_role("button", name="Approve").count() == 1, "Accountant, Credit Card: Approve still shows")
        row.get_by_role("button", name="Approve").scroll_into_view_if_needed()  # the table scrolls sideways
        shot(page, out, "19-accountant-no-read-again", "1a-accountant-no-read-again")
        pill(page, "Cashbook")
        row = find_row(page, ra["wallet_holder"])
        cells = row.inner_text()
        expect("Not read" in cells and "The reading stopped." in cells,
               "Accountant, Cashbook: the stopped reading shows Not read, 'The reading stopped.'")
        expect(row.get_by_role("button", name="Read again").count() == 0, "Accountant, Cashbook: no Read again")
        save(page, out, "20-accountant-cashbook-stopped")
        status = press_read_again_by_hand(page, card_bill)
        (out / "21-accountant-read-again.txt").write_text(json.dumps(status))
        expect(status[0] == 403, f"Accountant: the Read again endpoint refuses ({status[0]})")
        after = approval_db(out, "21-after-accountant", card_bill)[card_bill]["bill"]
        expect(after["bill_check"] == "Not read", "DB: the Accountant's call changed nothing (still Not read)")
        print(f"evidence: {out}")

    # 12. The Accountant Lead presses Read again on both.
    with session(a.task, a.lead, a.password) as (page, out):
        approvals_pill(page, "Credit Card")
        row = find_row(page, ra["card_holder"])
        button = row.get_by_role("button", name="Read again")
        expect(button.count() == 1, "Accountant Lead, Credit Card: Read again on the Not read row")
        button.scroll_into_view_if_needed()
        shot(page, out, "22-lead-read-again-card", "1b-lead-read-again-on-not-read")
        button.click()
        gone(page, ra["card_holder"], "Credit Card: the bill left the list while it is Checking")
        shot(page, out, "23-lead-after-read-again", "2a-read-again-checking")
        after = approval_db(out, "23-after-read-again", card_bill)[card_bill]["bill"]
        expect((after["bill_check"], after["bill_check_reason"], after["read_claimed_at"]) == ("Checking", None, None),
               "DB: the card bill is Checking, unclaimed")
        twice = [press_read_again_by_hand(page, card_bill)[0] for _ in range(2)]
        (out / "24-second-press.txt").write_text(json.dumps(twice))
        expect(twice == [200, 200], f"a second press is answered without an error ({twice})")
        after = approval_db(out, "24-after-second-press", card_bill)[card_bill]["bill"]
        expect((after["bill_check"], after["read_claimed_at"]) == ("Checking", None), "DB: still Checking, unclaimed")

        pill(page, "Cashbook")
        row = find_row(page, ra["wallet_holder"])
        expect("The reading stopped." in row.inner_text(), "Accountant Lead, Cashbook: 'The reading stopped.'")
        button = row.get_by_role("button", name="Read again")
        expect(button.count() == 1, "Accountant Lead, Cashbook: Read again on the stopped row")
        save(page, out, "25-lead-read-again-cashbook")
        button.click()
        gone(page, ra["wallet_holder"], "Cashbook: the bill left the list while it is Checking")
        after = approval_db(out, "26-after-read-again-wallet", wallet_bill)[wallet_bill]["bill"]
        expect((after["bill_check"], after["read_claimed_at"]) == ("Checking", None),
               "DB: the wallet bill is Checking, its old claim cleared")

        # 13. The readings.
        worker = subprocess.run([DEVENV, "run", a.task, "worker", "--queue", "long", "--burst"],
                                capture_output=True, text=True)
        (out / "27-worker.txt").write_text(worker.stdout + worker.stderr)
        state = approval_db(out, "27-after-reading", card_bill, wallet_bill)

        # 14. Each row's new result.
        for label, holder, name, crit in (("Credit Card", ra["card_holder"], card_bill, "3-new-result-card"),
                                          ("Cashbook", ra["wallet_holder"], wallet_bill, None)):
            got = state[name]["bill"]
            expect(got["read_claimed_at"] is not None, f"DB: {name} was claimed by a reading")
            page.reload()
            page.wait_for_load_state("networkidle")
            pill(page, label)
            if got["bill_check"] == "Matched":
                expect(got["status"] == "Approved", f"DB: {name} Matched and auto-approved")
                page.get_by_placeholder(re.compile("search", re.I)).first.fill(holder)
                page.wait_for_timeout(1000)
                expect(page.get_by_role("row").filter(has_text=holder).count() == 0, f"{label}: Matched bill is gone")
                shot(page, out, f"28-{label.lower().replace(' ', '-')}-new-result", crit)
                continue
            expect(got["status"] == "Pending", f"DB: {name} {got['bill_check']} stays Pending")
            row = find_row(page, holder)
            cells = row.inner_text()
            row.get_by_role("button", name="Approve").scroll_into_view_if_needed()
            expect(got["bill_check"] in cells and (got["bill_check_reason"] or "") in cells,
                   f"{label}: the new result shows: {got['bill_check']}: {got['bill_check_reason']}")
            shot(page, out, f"28-{label.lower().replace(' ', '-')}-new-result", crit)
            if READER_DOWN.match(got["bill_check_reason"] or ""):
                print(f"NOT WALKED: {name} Matched -- the env's reader is unavailable: {got['bill_check_reason']}")
        print(f"evidence: {out}")


def walk_cashbook(page, out) -> None:
    stdout = script("cashbook_bills_seed.py", STAMP, a.accountant)
    seeded = json.loads(next(l for l in stdout.splitlines() if l.startswith("CASHBOOK_BILLS_SEED ")).removeprefix(
        "CASHBOOK_BILLS_SEED "))
    print(f"seeded Cashbook imports: {seeded}")
    state = db_of(out, "07-cashbook-import", [part for key in ("ONE", "TWO", "LATE") for part in seeded[key][:2]])
    one, two, late = (state[seeded[key][1]] for key in ("ONE", "TWO", "LATE"))
    for key, spend in (("ONE", one), ("TWO", two), ("LATE", late)):
        expect(len(spend["bills"]) == 1, f"{key}: one Expense bill")
        bill = spend["bills"][0]
        expect(bill["bill_file"] == spend["expense"]["invoice_attachment"] and bool(bill["bill_file"]),
               f"{key}: the copied bill is the Expense's invoice and its Expense bill's file")
        expect(bill["uploaded_by"] == a.accountant, f"{key}: attached by the Accountant who confirmed the import")
        expect(bool(bill["statement_line"]), f"{key}: compared against its statement line")
    bill = one["bills"][0]
    expect((bill["bill_check"], bill["status"], bill["auto_approved"], bill["approved_by"])
           == ("Matched", "Approved", 1, "System"), "ONE (one bill link): Matched, auto-approved by System")
    expect(one["expense"]["invoice_ref"] == f"WALK-ONE-{STAMP}", "ONE: its Invoice Ref filled from the bill")
    bill = two["bills"][0]
    expect((bill["bill_check"], bill["status"]) == ("Not checked", "Pending"), "TWO (two bill links): Not checked, Pending")
    expect(float(bill["invoice_amount"]) == float(bill["line_amount"]), "TWO: its total is the line amount")
    expect(not bill["invoice_no"] and not bill["invoice_date"] and not bill["read_claimed_at"],
           "TWO: no number or date, and never read")
    bill = late["bills"][0]
    expect((bill["bill_check"], bill["status"], bill["auto_approved"]) == ("Mismatched", "Pending", 0),
           "LATE (bill brought by the second import): Mismatched, Pending")
    expect(not late["expense"]["invoice_ref"], "LATE: nothing written to its Invoice Ref")

    for step, key in (("08", "ONE"), ("09", "TWO"), ("10", "LATE")):
        doctype, _, description = seeded[key]
        card = "Project Expenses" if doctype == PE else "Non-Project Expenses"
        row = open_list(page, card, description)
        save(page, out, f"{step}-{key.lower()}-{card.lower().replace(' ', '-')}")
        if key == "ONE":
            expect(f"WALK-ONE-{STAMP}" in row, f"{card}: ONE's row shows its Invoice Ref WALK-ONE-{STAMP}")
        else:
            expect("WALK-" not in row, f"{card}: {key}'s row shows no Invoice Ref")


# One evidence folder for every session of this walk.

LIST_API = "nirmaan_stack.api.data-table.get_list_with_count_enhanced"


def bill_check_part() -> None:
    """Steps 15-18: the Bill check column and its two filters on the Paid and All tabs of both expense lists (#1640),
    as the Accountant, over seeded spends (the env's reader gives only Not read, so every other state is seeded).

    15. Dashboard -> Non-Project Expenses -> Paid, searched "WalkBC <stamp>": each spend's Bill check cell shows its
        latest bill's result and approval (Mismatched / Pending, Matched / Auto-approved, Not read / Rejected -- an
        older Matched bill under it does not count) and the spend with no Expense bill shows "—". DB: each latest bill.
    16. The header's Bill check filter -> Mismatched: only that spend is left; the list request carries the filter
        (the server pages it). Cleared, then the Approval filter -> Rejected: only the rejected spend.
    17. -> All: the column shows there too, the same cells.
    18. Dashboard -> Project Expenses -> Paid: Checking / Pending, Not checked / Approved, "—"; the Bill check filter ->
        "— (no bill)": only the spend with none. -> All: the Approval filter -> Approved: only the Not checked one.
    """
    seeded = json.loads(next(l for l in script("expense_bill_list_seed.py", STAMP).splitlines()
                             if l.startswith("EXPENSE_BILL_LIST_SEED ")).removeprefix("EXPENSE_BILL_LIST_SEED "))
    print(f"seeded for the Bill check column: {seeded}")
    search = f"WalkBC {STAMP}"

    with session(a.task, a.accountant, a.password) as (page, out):
        stdout = script("expense_bill_list_db.py", *(f"{s['doctype']}:{s['name']}" for s in seeded.values()))
        bills = json.loads(next(l for l in stdout.splitlines() if l.startswith("EXPENSE_BILL_LIST_DB "))
                           .removeprefix("EXPENSE_BILL_LIST_DB "))
        (out / "15-db.json").write_text(json.dumps(bills, indent=2))
        list_requests: list[str] = []
        page.on("request", lambda r: list_requests.append(r.post_data or "") if LIST_API in r.url else None)

        def latest(slug: str) -> tuple | None:
            rows = [b for b in bills[seeded[slug]["name"]] if b["is_latest"]]
            return (rows[0]["bill_check"], rows[0]["status"], rows[0]["auto_approved"]) if rows else None

        def open_tab(card: str, tab: str) -> None:
            sidebar(page, "Dashboard")
            page.get_by_text(card, exact=True).first.click()
            page.wait_for_load_state("networkidle")
            page.get_by_role("button", name=re.compile(rf"^{tab} \d+$")).click()
            page.wait_for_load_state("networkidle")
            page.get_by_placeholder(re.compile("search", re.I)).first.fill(search)
            page.get_by_role("row").filter(has_text=search).first.wait_for(timeout=30_000)
            page.wait_for_load_state("networkidle")

        def cells() -> dict[str, str]:
            """{description slug: the row's Bill check cell text} of the rows on screen."""
            header = [h.inner_text().strip() for h in page.get_by_role("columnheader").all()]
            col = next(i for i, h in enumerate(header) if h.startswith("Bill check"))
            shown = {}
            for row in page.get_by_role("row").filter(has_text=search).all():
                texts = [c.inner_text().strip() for c in row.get_by_role("cell").all()]
                slug = next(t for t in texts if t.startswith(search)).removeprefix(search).strip()
                shown[slug] = " ".join(texts[col].split())
            return shown

        def expect_rows(want: dict[str, str], what: str) -> None:
            page.wait_for_timeout(800)
            page.wait_for_load_state("networkidle")
            got = cells()
            expect(got == want, f"{what}: {got}")

        def pick(line: str, option: str) -> None:
            """Open the header's `line` filter ("Bill check" or "Approval") and toggle `option`."""
            header = page.get_by_role("columnheader").filter(has_text="Bill check")
            index = 0 if line == "Bill check" else 1
            header.locator('[aria-haspopup="dialog"]').nth(index).click()
            page.get_by_role("option", name=option, exact=True).click()
            page.keyboard.press("Escape")
            page.wait_for_load_state("networkidle")

        def filtered_request(field: str, value: str) -> None:
            """A list request since the last clear sent `[field, "in", [... value ...]]` with a page limit."""
            def carries(body: str) -> bool:
                try:
                    payload = json.loads(body)
                    filters = payload.get("filters")
                    filters = json.loads(filters) if isinstance(filters, str) else filters or []
                except ValueError:
                    return False
                return bool(payload.get("limit_page_length")) and any(
                    isinstance(f, list) and f[:2] == [field, "in"] and value in f[2] for f in filters)
            expect(any(carries(r) for r in list_requests),
                   f"the list request sends the {field} filter ({value}) with its page: filtered on the server")

        # 15. Non-Project Expenses -> Paid.
        expect(latest("npe_mismatched") == ("Mismatched", "Pending", 0), "DB: mismatched spend's latest bill")
        expect(latest("npe_matched") == ("Matched", "Approved", 1), "DB: matched spend's latest bill, auto-approved")
        expect(latest("npe_rejected") == ("Not read", "Rejected", 0), "DB: rejected spend's latest bill")
        expect(len(bills[seeded["npe_rejected"]["name"]]) == 2, "DB: the rejected spend also has an older bill")
        expect(latest("npe_none") is None, "DB: no Expense bill on the 'none' spend")
        open_tab("Non-Project Expenses", "Paid")
        npe = {"mismatched": "Mismatched Pending", "matched": "Matched Auto-approved",
               "rejected": "Not read Rejected", "none": "—"}
        expect_rows(npe, "15. Non-Project Paid: each spend's Bill check")
        shot(page, out, "15-npe-paid-column", "1-bill-check-column")
        shot(page, out, "15b-npe-paid-no-bill", "3-no-bill-dash")

        # 16. The two filters.
        list_requests.clear()
        pick("Bill check", "Mismatched")
        expect_rows({"mismatched": "Mismatched Pending"}, "16. Bill check filter Mismatched")
        filtered_request("bill_check", "Mismatched")
        shot(page, out, "16-npe-filter-result", "2-filter-result")
        pick("Bill check", "Mismatched")  # off again
        expect_rows(npe, "16. Bill check filter cleared")
        list_requests.clear()
        pick("Approval", "Rejected")
        expect_rows({"rejected": "Not read Rejected"}, "16. Approval filter Rejected")
        filtered_request("bill_approval", "Rejected")
        shot(page, out, "16b-npe-filter-approval", "2-filter-approval")

        # 17. -> All.
        open_tab("Non-Project Expenses", "All")
        expect_rows(npe, "17. Non-Project All: each spend's Bill check")
        shot(page, out, "17-npe-all-column", "1-bill-check-column-all")

        # 18. Project Expenses.
        expect(latest("pe_checking") == ("Checking", "Pending", 0), "DB: checking spend's latest bill")
        expect(latest("pe_notchecked") == ("Not checked", "Approved", 0), "DB: not-checked spend's latest bill")
        expect(latest("pe_none") is None, "DB: no Expense bill on the project 'none' spend")
        open_tab("Project Expenses", "Paid")
        pe = {"checking": "Checking Pending", "notchecked": "Not checked Approved", "none": "—"}
        expect_rows(pe, "18. Project Paid: each spend's Bill check")
        shot(page, out, "18-pe-paid-column", "1-bill-check-column-project")
        list_requests.clear()
        pick("Bill check", "— (no bill)")
        expect_rows({"none": "—"}, "18. Bill check filter '— (no bill)'")
        filtered_request("bill_check", "__NOT_SET__")
        shot(page, out, "18b-pe-filter-no-bill", "2-filter-no-bill")
        open_tab("Project Expenses", "All")
        expect_rows(pe, "18. Project All: each spend's Bill check")
        pick("Approval", "Approved")
        expect_rows({"notchecked": "Not checked Approved"}, "18. Approval filter Approved on All")
        shot(page, out, "18c-pe-all-filter-approval", "2-filter-approval-project-all")

os.environ.setdefault("VERIFY_OUT", str(Path.home() / "claude-artifacts" / "verify" / a.task /
                                        datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")))
if a.part == "read-again":
    read_again_part()
    sys.exit(0)
if a.part == "cashbook":
    with session(a.task, a.accountant, a.password) as (page, out):
        walk_cashbook(page, out)
    sys.exit(0)
if a.part == "bill-check":
    bill_check_part()
    sys.exit(0)
spends = seed()
print(f"seeded: {spends}")
approval = json.loads(next(l for l in script("expense_bill_approval_seed.py", STAMP).splitlines()
                           if l.startswith("EXPENSE_BILL_APPROVAL_SEED ")).removeprefix("EXPENSE_BILL_APPROVAL_SEED "))
print(f"seeded for approval: {approval}")
for user in (a.lead, a.outsider):  # made by the seed above; a password on the env DB only
    subprocess.run([DEVENV, "run", a.task, "set-password", user, a.password], capture_output=True, check=True)

with session(a.task, a.accountant, a.password) as (page, out):
    card_pdf = bill_pdf(out / f"walk-cafe-{STAMP}.pdf", f"WC-{STAMP}", "1,180.00", f"WALKCAFE{STAMP} Cafe")
    wallet_pdf = bill_pdf(out / f"walk-tea-{STAMP}.pdf", f"WT-{STAMP}", "2,500.00", "Walk Tea Stall")

    # 1-2. Attach in both tabs.
    sidebar(page, "Vendor Invoice Recon")
    page.get_by_role("button", name="Pending Invoices Upload").click()
    page.wait_for_load_state("networkidle")
    attach(page, "Credit Card", f"WALKCAFE{STAMP}", card_pdf, out, "01")
    attach(page, "Cashbook", f"Walk site tea {STAMP}", wallet_pdf, out, "02")

    state = db(out, "03-after-attach", spends)
    for spend, line in ((spends["card"], 1180.0), (spends["wallet"], 2360.0)):
        [bill] = state[spend]["bills"]
        expect((bill["bill_check"], bill["status"], bill["is_latest"]) == ("Checking", "Pending", 1),
               f"{spend}: one Expense bill, Checking, Pending, latest")
        expect(bill["statement_line"] and float(bill["line_amount"]) == line, f"{spend}: against its line of {line}")
        expect(bill["uploaded_by"] == a.accountant, f"{spend}: uploaded by the Accountant")
        expect(bool(state[spend]["expense"]["invoice_attachment"]), f"{spend}: the file is on the Expense")

    # 3. The readings, on the `long` queue.
    worker = subprocess.run([DEVENV, "run", a.task, "worker", "--queue", "long", "--burst"],
                            capture_output=True, text=True)
    (out / "04-worker.txt").write_text(worker.stdout + worker.stderr)
    state = db(out, "04-after-reading", spends)
    card_bill, card_expense = state[spends["card"]]["bills"][0], state[spends["card"]]["expense"]
    wallet_bill, wallet_expense = state[spends["wallet"]]["bills"][0], state[spends["wallet"]]["expense"]
    card_list_search, wallet_list_search = f"Walk card spend {STAMP}", f"Walk site tea {STAMP}"
    if card_bill["bill_check"] == "Not read" and READER_DOWN.match(card_bill["bill_check_reason"] or ""):
        # The env's reader cannot be reached (no valid key, no network): the Not read path is what it can show.
        print(f"NOT WALKED: Matched and Mismatched -- the env's reader is unavailable: {card_bill['bill_check_reason']}")
        for spend, bill, expense in ((spends["card"], card_bill, card_expense),
                                     (spends["wallet"], wallet_bill, wallet_expense)):
            expect(bill["bill_check"] == "Not read" and bool(bill["bill_check_reason"]),
                   f"{spend}: Not read, with its reason: {bill['bill_check_reason']}")
            expect((bill["status"], bill["auto_approved"]) == ("Pending", 0), f"{spend}: the bill stays Pending")
            expect(not expense["invoice_ref"] and not expense["invoice_date"],
                   f"{spend}: nothing written to its Invoice Ref or Date")
        card_shows = None
    else:
        expect(card_bill["bill_check"] == "Matched",
               f"card bill Matched (got {card_bill['bill_check']}: {card_bill['bill_check_reason']})")
        expect((card_bill["status"], card_bill["auto_approved"], card_bill["approved_by"]) == ("Approved", 1, "System"),
               "card bill auto-approved by System")
        expect(card_expense["invoice_ref"] == card_bill["read_invoice_no"] and bool(card_expense["invoice_ref"]),
               f"card spend's Invoice Ref filled from the bill: {card_expense['invoice_ref']}")
        expect(bool(card_expense["invoice_date"]), f"card spend's Invoice Date filled: {card_expense['invoice_date']}")
        expect(wallet_bill["bill_check"] == "Mismatched",
               f"wallet bill Mismatched (got {wallet_bill['bill_check']}: {wallet_bill['bill_check_reason']})")
        expect((wallet_bill["status"], wallet_bill["auto_approved"]) == ("Pending", 0), "wallet bill stays Pending")
        expect(not wallet_expense["invoice_ref"] and not wallet_expense["invoice_date"],
               "wallet spend: nothing written to its Invoice Ref or Date")
        card_shows = (card_expense["invoice_ref"],
                      datetime.date.fromisoformat(card_expense["invoice_date"]).strftime("%d-%b-%Y"))

    # 4. The two lists.
    row = open_list(page, "Non-Project Expenses", card_list_search)
    save(page, out, "05-non-project-expenses")
    if card_shows:
        expect(all(text in row for text in card_shows), f"Non-Project Expenses: the card spend shows {card_shows}")
    else:
        expect(f"WC-{STAMP}" not in row, "Non-Project Expenses: the card spend shows no Invoice Ref")
    row = open_list(page, "Project Expenses", wallet_list_search)
    save(page, out, "06-project-expenses")
    expect(f"WT-{STAMP}" not in row, "Project Expenses: the wallet spend shows no Invoice Ref")

    # 5. Pending Approval's pills; PO and WO are today's table split by document type.
    wallet_bill = wallet_bill["name"]
    before = approval_db(out, "07-before-approval", approval["bill"], wallet_bill)
    sidebar(page, "Vendor Invoice Recon")
    page.get_by_role("button", name="Pending Invoice Approvals").click()
    page.wait_for_load_state("networkidle")
    for label in ("PO", "WO", "Cashbook", "Credit Card"):
        expect(page.get_by_role("button", name=label, exact=True).count() == 1, f"Pending Approval: the {label} pill")
    pill(page, "PO")
    page.wait_for_timeout(1500)
    text = page.locator("body").inner_text()
    pos, wos = before["pending"]["Procurement Orders"], before["pending"]["Service Requests"]
    expect(all(name in text for name in pos), f"PO pill: every Pending PO invoice listed ({len(pos)})")
    expect(not any(name in text for name in wos), "PO pill: no WO invoice")
    shot(page, out, "08-pending-approval-po", "1-pills-po")
    pill(page, "WO")
    page.wait_for_timeout(1500)
    text = page.locator("body").inner_text()
    expect(all(name in text for name in wos), f"WO pill: every Pending WO invoice listed ({len(wos)})")
    expect(not any(name in text for name in pos), "WO pill: no PO invoice")
    save(page, out, "09-pending-approval-wo")

    # 6. Credit Card: the seeded Mismatched bill, approved with a corrected number and date.
    pill(page, "Credit Card")
    row = find_row(page, approval["holder"])
    cells = row.inner_text()
    typed_shown = datetime.date.fromisoformat(approval["typed_date"]).strftime("%d-%b-%Y")
    for want in (TODAY.strftime("%d-%b-%Y"), "₹1,180", "₹1,250", "Mismatched", f"TYPED-{STAMP}", typed_shown,
                 "Walk Accountant", "View"):
        expect(want in cells, f"Credit Card row shows {want!r}")
    expect(row.get_by_role("link", name="View").get_attribute("href").endswith(approval["file_url"]),
           "Credit Card row links the bill file")
    shot(page, out, "10-credit-card-pill", "2-credit-card-list")
    row.get_by_role("button", name="Approve").click()
    number = page.locator("#expense_bill_invoice_no")
    number.wait_for()
    expect(number.input_value() == f"TYPED-{STAMP}", "Approve form offers the number the Accountant typed")
    expect(page.locator("#expense_bill_invoice_date").input_value() == approval["typed_date"],
           "Approve form offers the date the Accountant typed")
    corrected_date = (TODAY - datetime.timedelta(days=2)).isoformat()
    number.fill(f"BK-FIX-{STAMP}")
    page.locator("#expense_bill_invoice_date").fill(corrected_date)
    shot(page, out, "11-approve-corrected", "3-approve-corrected")
    page.get_by_role("dialog").get_by_role("button", name="Approve").click()
    gone(page, approval["holder"], "Credit Card: the approved bill left the list")
    save(page, out, "12-credit-card-after-approve")
    after = approval_db(out, "12-after-approve", approval["bill"])[approval["bill"]]
    expect((after["bill"]["status"], after["bill"]["approved_by"]) == ("Approved", a.accountant),
           "DB: the bill is Approved by the Accountant")
    expect(bool(after["bill"]["approved_on"]), f"DB: approved_on {after['bill']['approved_on']}")
    expect((after["bill"]["invoice_no"], after["bill"]["invoice_date"]) == (f"BK-FIX-{STAMP}", corrected_date),
           "DB: the corrected number and date are on the bill")
    expect((after["expense"]["invoice_ref"], after["expense"]["invoice_date"]) == (f"BK-FIX-{STAMP}", corrected_date),
           "DB: ... and mirrored onto the spend")
    expect(after["versions"].get("Expense Bill", {}).get(a.accountant, 0) >= 1
           and after["versions"].get(NPE, {}).get(a.accountant, 0) >= 1,
           f"DB: a Version by the Accountant on the bill and the spend: {after['versions']}")

    # 7. Cashbook: the wallet bill rejected with a reason.
    reason = f"Walk wrong shop {STAMP}"
    pill(page, "Cashbook")
    row = find_row(page, "Walk Wallet Holder")
    expect(before[wallet_bill]["bill"]["bill_check"] in row.inner_text(), "Cashbook row shows the wallet bill's Bill check")
    row.get_by_role("button", name="Reject").click()
    page.locator("#expense_bill_reject_reason").fill(reason)
    shot(page, out, "13-reject-reason", "4a-reject-reason")
    page.get_by_role("dialog").get_by_role("button", name="Reject").click()
    gone(page, "Walk Wallet Holder", "Cashbook: the rejected bill left the list")
    after = approval_db(out, "14-after-reject", wallet_bill)[wallet_bill]
    expect((after["bill"]["status"], after["bill"]["rejection_reason"]) == ("Rejected", reason),
           "DB: the wallet bill is Rejected with the reason")
    expect(not any((after["expense"]["invoice_attachment"], after["expense"]["invoice_ref"],
                    after["expense"]["invoice_date"])), "DB: the spend's invoice attachment, ref and date are cleared")
    expect(after["versions"].get("Expense Bill", {}).get(a.accountant, 0) >= 1
           and after["versions"].get(PE, {}).get(a.accountant, 0) >= 1,
           f"DB: a Version by the Accountant on the bill and the spend: {after['versions']}")

    # 8. The spend waits again in Pending Invoices Upload -> Cashbook, with the reason.
    page.get_by_role("button", name="Pending Invoices Upload").click()
    page.wait_for_load_state("networkidle")
    pill(page, "Cashbook")
    row = find_row(page, wallet_list_search)
    expect(f"Last bill rejected: {reason}" in row.inner_text(), "Pending Invoices Upload: 'Last bill rejected: <reason>'")
    shot(page, out, "15-back-in-cashbook-queue", "4b-back-in-pending-invoices-upload")
    print(f"evidence: {out}")

# 9. The Accountant Lead marks the rejected spend No invoice.
with session(a.task, a.lead, a.password) as (page, out):
    sidebar(page, "Vendor Invoice Recon")
    page.get_by_role("button", name="Pending Invoices Upload").click()
    page.wait_for_load_state("networkidle")
    pill(page, "Cashbook")
    row = find_row(page, wallet_list_search)
    row.get_by_role("button", name="No invoice").click()
    page.locator("#cashbook_no_invoice_reason").fill(f"Walk tea stall, no bill {STAMP}")
    shot(page, out, "16-lead-no-invoice", "6-no-invoice-after-reject")
    page.get_by_role("button", name="Mark No invoice").click()
    gone(page, wallet_list_search, "Cashbook: the spend marked No invoice left the list")
    after = approval_db(out, "17-after-no-invoice", wallet_bill)[wallet_bill]
    expect(after["expense"]["no_invoice_by"] == a.lead, "DB: marked No invoice by the Accountant Lead")

# 10. Outside the approvers: no tab, and the server refuses.
with session(a.task, a.outsider, a.password) as (page, out):
    sidebar(page, "Vendor Invoice Recon")
    page.wait_for_timeout(1000)
    expect(page.get_by_role("button", name="Pending Invoice Approvals").count() == 0,
           "PMO: no Pending Invoice Approvals tab")
    status = page.evaluate(
        """async (bill) => {
            const r = await fetch('/api/method/nirmaan_stack.api.expenses.expense_bill_approval.reject_expense_bill', {
                method: 'POST', headers: {'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': window.csrf_token},
                body: JSON.stringify({bill, reason: 'PMO tries'})});
            return [r.status, await r.text()];
        }""",
        card_bill["name"],
    )
    (out / "18-outsider-reject.txt").write_text(json.dumps(status))
    expect(status[0] == 403, f"PMO: the reject endpoint refuses ({status[0]})")
    shot(page, out, "18-outsider-no-tab", "7-refused-outside-approvers")
    after = approval_db(out, "18-after-outsider", card_bill["name"])[card_bill["name"]]
    expect(after["bill"]["status"] == card_bill["status"], f"DB: the bill is still {card_bill['status']}")
    print(f"evidence: {out}")

read_again_part()

with session(a.task, a.accountant, a.password) as (page, out):
    walk_cashbook(page, out)

bill_check_part()
