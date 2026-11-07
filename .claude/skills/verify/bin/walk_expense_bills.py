#!/usr/bin/env python3
"""Walk the Bill check on hand-attached bills (#1639) and on the bills a Cashbook import copies (#1641), spec
#1637, as an Accountant.

    devenv.sh script <task> .claude/skills/verify/bin/office_rent_seed.py      # once per env: the free Accountant
    devenv.sh run <task> set-password walk-accountant@example.com <pw>
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

import argparse
import datetime
import json
import re
import subprocess
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
ap.add_argument("--part", choices=("attach", "cashbook", "all"), default="all")
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
    line = next(l for l in script("expense_bills_seed.py", STAMP).splitlines() if l.startswith("EXPENSE_BILLS_SEED "))
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


def walk_attach(page, out) -> None:
    spends = seed()
    print(f"seeded: {spends}")
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


with session(a.task, a.accountant, a.password) as (page, out):
    if a.part in ("attach", "all"):
        walk_attach(page, out)
    if a.part in ("cashbook", "all"):
        walk_cashbook(page, out)
    print(f"evidence: {out}")
