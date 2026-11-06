"""Seed the made-up lines the Internal Transfers walk acts on (#1619, #1626).

    devenv.sh script <task> .claude/skills/verify/bin/internal_transfers_seed.py

Writes to the env DB only, and is idempotent: a line already seeded (remarks WALK-IT ...) is reset. Prints:

- `line:` one open Cashfree line, to mark by hand and send back;
- `cashbook_line:` one open Cashbook spend (From `WALK-IT Test Employee`), whose Mark dialog pre-fills Detail;
- `zero_line:` one old Cashbook top-up, an Internal Transfer line whose record holds ₹0 (as imports before #1623
  left them), which the statement below repeats: its preview says one old record gets its amount;
- `statement:` a made-up Cashbook statement (.xlsx, fresh Txn Ids each run) with one `Bank → VA` top-up, one spend
  and the old top-up again with its Credit, for the upload preview. It is written under the bench's `tmp/`, which
  the host sees at `benches/<task>/tmp/`. Never confirmed by the walk.

An earlier version seeded a move seen twice (`WALK-IT made-up wallet move seen twice`) for Send back of a repeat, which
#1619's decision 3 retired: such lines left in the env DB are sent back to Mismatched here, record and all, so every
Internal Transfer line holds one record.
"""

import os

import frappe
from openpyxl import Workbook

from nirmaan_stack.api.outflow_import.internal_transfers import record_for_line
from nirmaan_stack.services.outflow_import.internal_transfers import (
    PLACE_CASHBOOK_VA,
    PLACE_ICICI_CURRENT,
    TransferEnds,
)

ROW = "Outflow Import Row"
REMARKS = "WALK-IT made-up wallet top-up the rules missed"
CASHBOOK_REMARKS = "WALK-IT made-up cashbook spend"
RETIRED_REPEAT_REMARKS = "WALK-IT made-up wallet move seen twice"
ZERO_REMARKS = "WALK-IT made-up old top-up with a zero record"
ZERO_TXN = "VALOAD-WALKITZERO"


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

for retired in frappe.get_all(ROW, filters={"remarks": RETIRED_REPEAT_REMARKS}, pluck="name"):
    frappe.db.delete("Internal Transfer", {"import_row": retired})
    frappe.db.set_value(ROW, retired, open_values, update_modified=False)

moved = {"row_status": "Internal Transfer", "outcome_note": "Internal Transfer from ICICI Current Account to "
         "Cashbook Virtual Account.", "decided_by": None}
zero = line(ZERO_REMARKS, {"transfer_id": ZERO_TXN, "amount": 0.0, "direction": "", "status_raw": "SUCCESS",
                           "added_on": "2026-10-01 10:00:00", "row_kind": "Bank → VA",
                           "added_by_raw": "WALK-IT Test Company", "beneficiary_name": "Virtual Account", **moved},
            source="Cashbook", filename="walk-it-cashbook-old.xlsx", reset=moved)
record_for_line(frappe.get_doc(ROW, zero), TransferEnds(PLACE_ICICI_CURRENT, PLACE_CASHBOOK_VA),
                made_by="cashbook_bank_to_va", amount=0, direction="In")

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
                           "Made-up tea and snacks"),
            statement_line("Bank → VA", "WALK-IT Test Company", "Virtual Account", "", "9000", ZERO_TXN, ZERO_REMARKS)):
    book.active.append(row)
path = os.path.abspath(os.path.join(frappe.get_site_path(), "..", "..", "tmp", "walk-it-cashbook-statement.xlsx"))
os.makedirs(os.path.dirname(path), exist_ok=True)
book.save(path)

frappe.db.commit()
print(f"line: {cashfree}")
print(f"cashbook_line: {cashbook}")
print(f"zero_line: {zero}")
print(f"statement: {path}")
