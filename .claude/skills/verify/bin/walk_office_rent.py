#!/usr/bin/env python3
"""Walk an Office Rent bill end to end (spec #1613): Bill = Rent + GST − TDS → Landlord gets.

    devenv.sh script <task> .claude/skills/verify/bin/office_rent_seed.py      # once per env
    devenv.sh run <task> set-password <email> <pw>                             # each of the four users
    python3 .claude/skills/verify/bin/walk_office_rent.py --task <task> --password <pw> \\
        [--hr walk-hr@example.com] [--admin <admin>] [--ceo nitesh@nirmaan.app] [--accountant walk-accountant@example.com]

1. HR Executive: sidebar Expenses -> New Expense -> Office Rent, ₹1,18,000; reads the preview, records it.
   DB: the request and its Expense carry the bill, Requested, no GST, no tax record.
2. Admin: sidebar Project Payment & Expense -> the expense's Approve -> reads the split in the dialog, approves.
   DB: CEO Pending, still the bill.
3. The CEO: the same, approves. DB: Approved at ₹1,08,000 with GST ₹18,000; one record: gross ₹1,00,000,
   10%, ₹10,000, 194-I.
4. Accountant: the TDS register's row (gross ₹1,00,000, tax ₹10,000, Paid Amount ₹1,08,000); the payments queue (the bill, "To be
   paid ₹1,08,000"), Mark as Paid and Mark Reconciled (pays ₹1,08,000; DB: Paid, GST and record as split);
   the Expenses list's row and the request page; the Non-Project Expenses list (Reports > Projects >
   Payments Report (Non-Project), which lists Paid rows only). The register has no Section column on
   screen: 194-I is asserted on the DB row.

Every step asserts the screen's text and its DB row; a miss raises, saves `FAIL.*` and exits 1. Each run raises
a new expense (its Office Location carries the run's stamp), so it can run again after any later change.
Evidence: `$VERIFY_OUT`, else ~/claude-artifacts/verify/<task>/<UTC time>/, one folder per user.
"""

import argparse
import datetime
import json
import re
import subprocess
from pathlib import Path

from drive import save, session, sidebar

ROOT = Path(__file__).resolve().parents[4]
BILL = "118000"
#: The split of ₹1,18,000 as every screen draws it (`utils/expenses/expenseTds.tdsSplitLines`).
SPLIT = ["Bill ₹1,18,000", "Rent ₹1,00,000", "GST 18% ₹18,000", "TDS 10% ₹10,000", "Landlord gets ₹1,08,000"]
PREVIEW = "Bill ₹1,18,000 = Rent ₹1,00,000 + GST 18% ₹18,000 − TDS 10% ₹10,000 → Landlord gets ₹1,08,000"

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--password", required=True)
ap.add_argument("--hr", default="walk-hr@example.com")
ap.add_argument("--admin", default="admins@nirmaan.app")
ap.add_argument("--ceo", default="nitesh@nirmaan.app")
ap.add_argument("--accountant", default="walk-accountant@example.com")
a = ap.parse_args()

STAMP = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S")
LOCATION = f"Walk Office {STAMP}"


def expect(ok: bool, what: str) -> None:
    if not ok:
        raise AssertionError(f"MISS: {what}")
    print(f"ok   {what}")


def db(out: Path, name: str) -> dict:
    """The request, Expense and record of this run's rent, saved beside the screenshots as `<name>.db.json`."""
    res = subprocess.run([str(ROOT / "scripts/devenv/devenv.sh"), "script", a.task,
                          str(ROOT / ".claude/skills/verify/bin/office_rent_db.py"), LOCATION],
                         capture_output=True, text=True, check=True)
    line = next(l for l in res.stdout.splitlines() if l.startswith("OFFICE_RENT_DB "))
    answer = json.loads(line.removeprefix("OFFICE_RENT_DB "))
    (out / f"{name}.db.json").write_text(json.dumps(answer, indent=2))
    return answer


def _blank_png() -> bytes:
    """A 40x20 white PNG, the receipt Mark Reconciled asks for (an env keeps uploads on its own disk)."""
    import struct
    import zlib

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\xff\xff\xff" * 40 for _ in range(20))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 40, 20, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def lines_in(text: str) -> bool:
    flat = re.sub(r"\s+", " ", text)
    return all(line in flat for line in SPLIT)


# ── 1. HR Executive raises the bill ──────────────────────────────────────────────────────────────
with session(a.task, a.hr, a.password) as (page, out):
    sidebar(page, "Expenses")
    page.get_by_role("button", name="New Expense").first.click()
    dlg = page.get_by_role("alertdialog")
    dlg.locator("#new_expense_type").click()
    dlg.locator("#new_expense_type").press_sequentially("Office Rent")
    page.get_by_role("option", name="Office Rent Non-Project").click()
    dlg.get_by_role("spinbutton", name="Amount *").fill(BILL)
    preview = dlg.get_by_text(PREVIEW)
    preview.wait_for()
    expect(preview.is_visible(), f"the preview reads '{PREVIEW}'")
    save(page, out, "01-hr-preview")

    dlg.get_by_role("textbox", name="Payee").fill("Walk Landlord")
    dlg.get_by_role("button", name=re.compile(r"^Walk Landlord Account")).click()
    dlg.locator("input[type=month]").fill("2026-10")
    text_inputs = dlg.locator("input[type=text]:not(#new_expense_type):not(#payee_search)")
    text_inputs.nth(0).fill(LOCATION)
    text_inputs.nth(1).fill("Walk Landlord")
    dlg.get_by_role("textbox", name="ABCPK1234D").fill("WALKP1613L")
    dlg.get_by_role("radio", name="No, I'll add it later").click()
    save(page, out, "02-hr-filled")
    dlg.get_by_role("button", name="Record expense").click()
    dlg.wait_for(state="hidden", timeout=30_000)
    page.wait_for_load_state("networkidle")
    save(page, out, "03-hr-recorded")

    raised = db(out, "03-hr-recorded")
    expect(raised["request"] is not None and raised["request"]["amount"] == 118000, "the request keeps the bill")
    expect(raised["expense"] == {**(raised["expense"] or {}), "status": "Requested", "amount": 118000, "gst_amount": 0},
           "its Expense waits at Requested for the bill, no GST yet")
    expect(raised["record"] is None, "no tax record before approval")
    EXPENSE = raised["expense"]["name"]
    print(f"expense: {EXPENSE}  request: {raised['request']['name']}  evidence: {out}")


# ── 2 and 3. Admin, then the CEO, read the split in the approve dialog and approve ────────────────
def approve(user: str, step: str, landed: str) -> dict:
    with session(a.task, user, a.password) as (page, out):
        sidebar(page, "Project Payment & Expense")
        page.get_by_placeholder("Search PO, SR or description...").fill(LOCATION)
        row = page.get_by_role("row").filter(has_text=LOCATION)
        row.get_by_text("Landlord gets").wait_for()
        expect(lines_in(row.inner_text()) and "₹1,18,000" in row.inner_text(),
               f"{step}: the Approve Payments row reads the bill and its split")
        save(page, out, f"{step}-queue")
        row.get_by_role("button", name="Approve").click()
        dlg = page.get_by_role("alertdialog")
        dlg.get_by_text("10% TDS (194-I) on the rent will be withheld on approval").wait_for()
        pairs = [f"{t} {d}" for t, d in zip(dlg.locator("dt").all_inner_texts(), dlg.locator("dd").all_inner_texts())]
        expect(pairs == SPLIT, f"{step}: the approve dialog reads {SPLIT}")
        save(page, out, f"{step}-dialog")
        dlg.get_by_role("button", name="Confirm approve").click()
        dlg.wait_for(state="hidden", timeout=30_000)
        page.wait_for_load_state("networkidle")
        save(page, out, f"{step}-approved")
        answer = db(out, f"{step}-approved")
        expect(answer["expense"]["status"] == landed, f"{step}: the Expense is now {landed}")
        return answer


after_admin = approve(a.admin, "04-admin", "CEO Pending")
expect(after_admin["expense"]["amount"] == 118000 and after_admin["record"] is None,
       "04-admin: at CEO Pending it is still the bill, nothing withheld")
after_ceo = approve(a.ceo, "05-ceo", "Approved")
expect(after_ceo["expense"]["amount"] == 108000 and after_ceo["expense"]["gst_amount"] == 18000,
       "05-ceo: approved, the Expense is ₹1,08,000 with GST ₹18,000")
record = after_ceo["record"] or {}
expect({k: record.get(k) for k in ("gross_amount", "tds_percentage", "tds_amount", "tds_section")}
       == {"gross_amount": 100000, "tds_percentage": 10, "tds_amount": 10000, "tds_section": "194-I"},
       "05-ceo: one tax record, gross ₹1,00,000 (the rent), 10%, ₹10,000, 194-I")
expect("(Amount incl. 18% GST; 10% TDS on the rent will be deducted)" in after_ceo["expense"]["description"],
       "05-ceo: the Expense reads the version-3 form's sentence (incl. 18% GST)")


# ── 4. Accountant: the TDS register, the payments queue, the expense lists, the request page ──────
with session(a.task, a.accountant, a.password) as (page, out):
    record_name, request_name = after_ceo["record"]["name"], after_ceo["request"]["name"]

    # The TDS register (Reports > Payment), its row searched by Deduction ID, Gross switched on in View.
    sidebar(page, "Reports")
    page.get_by_role("button", name="Payment", exact=True).click()
    page.get_by_placeholder("Search by Deduction ID...").fill(record_name)
    page.locator("div[aria-haspopup=menu]").click()
    page.get_by_role("menuitemcheckbox", name="Gross Amount").click()
    page.keyboard.press("Escape")
    row = page.get_by_role("row").filter(has_text=record_name)
    row.wait_for()
    text = re.sub(r"\s+", " ", row.inner_text())
    expect("₹1,00,000.00" in text and "₹10,000.00" in text and "Walk Landlord" in text,
           "06: the TDS register's row: gross ₹1,00,000 (the rent), tax ₹10,000, the landlord")
    expect("₹1,08,000.00" in text and "₹90,000.00" not in text,
           "06: its Paid Amount is what left the bank, ₹1,08,000 (rent + GST − TDS), not ₹90,000")
    save(page, out, "06-accountant-tds-register")
    register = db(out, "06-accountant-tds-register")
    expect(register["record"]["gross_amount"] + register["expense"]["gst_amount"] - register["record"]["tds_amount"]
           == 108000, "06: DB: the record's gross ₹1,00,000 + the Expense's GST ₹18,000 − tax ₹10,000 = ₹1,08,000")

    # The payments queue's Payment need to paid tab: the bill, "To be paid" what the landlord gets. Mark as
    # Paid, then Mark Reconciled with a receipt and a reference: the dialog pays the landlord ₹1,08,000.
    sidebar(page, "Project Payment & Expense")
    page.get_by_role("button", name=re.compile(r"^Payment need to paid")).click()
    page.get_by_placeholder("Search PO, SR or description...").fill(LOCATION)
    row = page.get_by_role("row").filter(has_text=LOCATION)
    row.get_by_text("Landlord gets").wait_for()
    text = re.sub(r"\s+", " ", row.inner_text())
    expect("₹1,18,000 To be paid ₹1,08,000" in text and lines_in(text),
           "07: the queue reads the bill, 'To be paid ₹1,08,000', and the split")
    save(page, out, "07-accountant-to-be-paid")
    row.get_by_role("button", name="Mark as Paid").click()
    dlg = page.get_by_role("alertdialog")
    dlg.get_by_role("button", name="Yes, mark as Paid").click()
    dlg.wait_for(state="hidden", timeout=30_000)
    page.get_by_role("button", name=re.compile(r"^Payment Done \/ Reconciliation Pending")).click()
    page.get_by_placeholder("Search PO, SR or description...").fill(LOCATION)
    row = page.get_by_role("row").filter(has_text=LOCATION)
    row.get_by_role("button", name="Mark Reconciled").click()
    dlg = page.get_by_role("alertdialog")
    dlg.get_by_role("heading", name="Pay ₹1,08,000 to").wait_for()
    expect(True, "07: Mark Reconciled says 'Pay ₹1,08,000 to' the landlord's account")
    receipt = out / "walk-receipt.png"
    receipt.write_bytes(_blank_png())
    dlg.get_by_role("button", name="Choose Receipt (PDF or image)").set_input_files(str(receipt))
    dlg.get_by_role("textbox", name="Payment Ref *").fill(f"WALK-UTR-{STAMP}")
    save(page, out, "07-accountant-pay-dialog")
    dlg.get_by_role("button", name="Mark as Paid").click()
    dlg.wait_for(state="hidden", timeout=30_000)
    paid = db(out, "07-accountant-paid")
    expect(paid["expense"]["status"] == "Paid" and paid["expense"]["amount"] == 108000
           and paid["expense"]["gst_amount"] == 18000 and paid["record"]["gross_amount"] == 100000,
           "07: Paid at ₹1,08,000; GST ₹18,000 and the record's gross ₹1,00,000 as split")

    # The Expenses list (All tab), then the request page through its link.
    sidebar(page, "Expenses")
    page.get_by_role("button", name=re.compile(r"^All \d+$")).click()
    page.get_by_placeholder("Search by Request ID...").fill(request_name)
    row = page.get_by_role("row").filter(has_text=request_name)
    row.get_by_text("Landlord gets").wait_for()
    text = re.sub(r"\s+", " ", row.inner_text())
    expect("₹1,08,000" in text and lines_in(text), "08: the Expenses list's row reads ₹1,08,000 and the split")
    save(page, out, "08-accountant-expenses-list")
    row.get_by_role("link", name=request_name).click()
    page.get_by_text("Raised for").wait_for()
    text = re.sub(r"\s+", " ", page.locator("main").inner_text())
    expect("Raised for ₹1,18,000" in text and "Landlord gets" in text and "₹1,08,000" in text,
           "09: the request page keeps 'Raised for ₹1,18,000' beside the split")
    save(page, out, "09-accountant-request-page")

    # The Non-Project Expenses list (Reports > Projects > Payments Report (Non-Project)).
    sidebar(page, "Reports")
    page.get_by_role("main").get_by_role("button", name="Projects", exact=True).click()
    page.get_by_role("combobox").first.click()
    page.get_by_role("option", name="Payments Report (Non-Project)").click()
    page.get_by_placeholder("Search by Description...").fill(LOCATION)
    row = page.get_by_role("row").filter(has_text=LOCATION)
    row.get_by_text("Landlord gets").wait_for()
    text = re.sub(r"\s+", " ", row.inner_text())
    expect("₹1,08,000" in text and lines_in(text), "10: the Non-Project Expenses list's row reads the split")
    save(page, out, "10-accountant-non-project-list")
    final = db(out, "10-accountant")
    expect(final["expense"] == {**final["expense"], "status": "Paid", "amount": 108000, "gst_amount": 18000},
           "10: the Expense stays Paid at ₹1,08,000 with GST ₹18,000")
    print(f"evidence: {out}")

print(f"PASS: Office Rent {after_ceo['expense']['name']} walked by HR, Admin, the CEO and an Accountant")
