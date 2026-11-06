"""Seed one made-up open Cashfree line for the Internal Transfers walk to mark by hand (#1626).

    devenv.sh script <task> .claude/skills/verify/bin/internal_transfers_seed.py

Idempotent: a line already seeded (remarks WALK-IT ...) is reset to Mismatched with no record. Writes to the env DB
only. Prints the line's name.
"""

import frappe

REMARKS = "WALK-IT made-up wallet top-up the rules missed"
existing = frappe.db.get_value("Outflow Import Row", {"remarks": REMARKS}, ["name", "import_batch"], as_dict=True)
if existing:
    frappe.db.delete("Internal Transfer", {"import_row": existing.name})
    frappe.db.set_value("Outflow Import Row", existing.name,
                        {"row_status": "Mismatched", "outcome_note": "Seeded for the walk."}, update_modified=False)
    name = existing.name
else:
    batch = frappe.get_doc({"doctype": "Outflow Import Batch", "source": "Cashfree", "status": "In Review",
                            "original_filename": "walk-it-cashfree.csv"}).insert(ignore_permissions=True)
    row = frappe.get_doc({
        "doctype": "Outflow Import Row", "import_batch": batch.name, "source": "Cashfree",
        "transfer_id": "WALKIT0001", "bank_reference_no": "WALKIT0001", "amount": 4321.0, "status_raw": "SUCCESS",
        "direction": "Debit", "row_status": "Mismatched", "remarks": REMARKS, "beneficiary_name": "WALK-IT Test Payee",
        "added_on": "2026-10-20 10:00:00", "outcome_note": "Seeded for the walk.",
    }).insert(ignore_permissions=True)
    name = row.name
frappe.db.commit()
print(f"line: {name}")
