"""Seed the made-up lines the Internal Transfers walk acts on (#1619, #1626).

    devenv.sh script <task> .claude/skills/verify/bin/internal_transfers_seed.py

Writes to the env DB only, and is idempotent: a line already seeded (remarks WALK-IT ...) is reset. Prints:

- `line:` one open Cashfree line, to mark by hand and send back;
- `cashbook_line:` one open Cashbook spend (From `WALK-IT Test Employee`), whose Mark dialog pre-fills Detail;
- `repeat_first:` / `repeat_second:` one Cashbook move seen twice (SUCCESS, then REVERSED in a later import), both
  Internal Transfer lines and the record on the first, to send back together;
- `statement:` a made-up Cashbook statement (.xlsx, fresh Txn Ids each run) with one `Bank → VA` top-up and one
  spend, for the upload preview. It is written under the bench's `tmp/`, which the host sees at
  `benches/<task>/tmp/`. Never confirmed by the walk.
"""

import os

import frappe
from openpyxl import Workbook

from nirmaan_stack.api.outflow_import.internal_transfers import record_for_line
from nirmaan_stack.services.outflow_import.internal_transfers import (
    PLACE_CASHBOOK_VA,
    PLACE_CASHBOOK_WALLET,
    TransferEnds,
)

ROW = "Outflow Import Row"
REMARKS = "WALK-IT made-up wallet top-up the rules missed"
CASHBOOK_REMARKS = "WALK-IT made-up cashbook spend"
REPEAT_REMARKS = "WALK-IT made-up wallet move seen twice"


def batch(source: str, filename: str) -> str:
    return frappe.get_doc({"doctype": "Outflow Import Batch", "source": source, "status": "In Review",
                           "original_filename": filename}).insert(ignore_permissions=True).name


def line(remarks: str, values: dict, *, source: str, filename: str, reset: dict) -> str:
    existing = frappe.db.get_value(ROW, {"remarks": remarks, **({"status_raw": values["status_raw"]})}, "name")
    if existing:
        frappe.db.delete("Internal Transfer", {"import_row": existing})
        frappe.db.set_value(ROW, existing, reset, update_modified=False)
        return existing
    return frappe.get_doc({"doctype": ROW, "import_batch": batch(source, filename), "source": source,
                           "remarks": remarks, **values}).insert(ignore_permissions=True).name


open_values = {"row_status": "Mismatched", "outcome_note": "Seeded for the walk.", "decided_by": None}
cashfree = line(REMARKS, {
    "transfer_id": "WALKIT0001", "bank_reference_no": "WALKIT0001", "amount": 4321.0, "status_raw": "SUCCESS",
    "direction": "Debit", "beneficiary_name": "WALK-IT Test Payee", "added_on": "2026-10-20 10:00:00",
    **open_values,
}, source="Cashfree", filename="walk-it-cashfree.csv", reset=open_values)

cashbook = line(CASHBOOK_REMARKS, {
    "transfer_id": "WALKITCB0001", "amount": 275.0, "status_raw": "SUCCESS", "direction": "",
    "added_by_raw": "WALK-IT Test Employee", "beneficiary_name": "WALK-IT Test Shop",
    "added_on": "2026-10-21 10:00:00", "row_kind": "Wallet Spend", **open_values,
}, source="Cashbook", filename="walk-it-cashbook-a.xlsx", reset=open_values)

moved = {"row_status": "Internal Transfer", "outcome_note": "Internal Transfer from Cashbook Virtual Account to "
         "Cashbook Employee Wallet (WALK-IT Test Employee).", "decided_by": None}
repeat_values = {"transfer_id": "WALKITCB0002", "amount": 0.0, "direction": "", "added_on": "2026-10-22 10:00:00",
                 "row_kind": "VA → Wallet", "added_by_raw": "Virtual Account",
                 "beneficiary_name": "WALK-IT Test Employee", **moved}
first = line(REPEAT_REMARKS, {**repeat_values, "status_raw": "SUCCESS"}, source="Cashbook",
             filename="walk-it-cashbook-b.xlsx", reset=moved)
second = line(REPEAT_REMARKS, {**repeat_values, "status_raw": "REVERSED"}, source="Cashbook",
              filename="walk-it-cashbook-c.xlsx", reset=moved)
record_for_line(frappe.get_doc(ROW, first),
                TransferEnds(PLACE_CASHBOOK_VA, PLACE_CASHBOOK_WALLET, "WALK-IT Test Employee"),
                made_by="cashbook_va_to_wallet", amount=650, direction="In")

header = ["Date", "Time", "Type", "From", "To", "Debit", "Credit", "Affected Wallet Balance", "VA Balance", "Remark",
          "Note", "Employee ID", "Reporting Manager", "Reporting Manager Employee ID", "Payment Status", "Txn Id",
          "Category", "Category Code", "Location", "Location Code", "Department", "Department Code", "Title",
          "Title Code", "Bill Attached", "Attachments", "", "", ""]
tag = frappe.generate_hash(length=6).upper()


def statement_line(kind, who_from, who_to, debit, credit, txn, remark=""):
    return ["01/10/2026", "10:00 AM", kind, who_from, who_to, debit, credit, "", "", remark, "", "", "", "",
            "SUCCESS", txn, "", "", "", "", "", "", "", "", "No", "", "", "", ""]


book = Workbook()
for row in (header,
            statement_line("Bank → VA", "WALK-IT Test Company", "Virtual Account", "", "12000", f"VALOAD-WALKIT{tag}"),
            statement_line("Wallet Spend", "WALK-IT Test Employee", "WALK-IT Test Shop", "150", "", f"OBOWALKIT{tag}",
                           "Made-up tea and snacks")):
    book.active.append(row)
path = os.path.abspath(os.path.join(frappe.get_site_path(), "..", "..", "tmp", "walk-it-cashbook-statement.xlsx"))
os.makedirs(os.path.dirname(path), exist_ok=True)
book.save(path)

frappe.db.commit()
print(f"line: {cashfree}")
print(f"cashbook_line: {cashbook}")
print(f"repeat_first: {first}")
print(f"repeat_second: {second}")
print(f"statement: {path}")
