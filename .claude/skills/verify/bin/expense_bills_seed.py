"""Seed the Expense bills walk (`walk_expense_bills.py`, #1639) on an env DB: one made-up card spend and one made-up
wallet spend, each with its statement line, both waiting in Pending Invoices Upload.

    devenv.sh script <task> .claude/skills/verify/bin/office_rent_seed.py      # the free Accountant, the Home folder
    devenv.sh script <task> .claude/skills/verify/bin/expense_bills_seed.py <stamp>

`<stamp>` makes this run's records unique, so the walk can run again: the card spend's merchant is
"WALKCAFE<stamp>" and its description "Walk card spend <stamp>" (₹1,180.00) and the wallet spend's remark "Walk site tea <stamp>" (₹2,360.00). The card spend is
a Non-Project Expense on a made-up statement; the wallet spend a Project Expense on the env's first project.
Prints one line `EXPENSE_BILLS_SEED {json}`. Writes to the env DB only (its own commit).
"""

import json
import sys

import frappe
from frappe.utils import nowdate

from nirmaan_stack.services.outflow_import.card_types import FALLBACK_EXPENSE_TYPE

stamp = sys.argv[1]
NPE, PE = "Non Project Expenses", "Project Expenses"


def line_and_match(source: str, doctype: str, expense: str, amount: float, **row) -> str:
    transfer_id = f"WALK{doctype[0]}{stamp}"  # unique per line
    batch = frappe.get_doc({"doctype": "Outflow Import Batch", "source": source}).insert(ignore_permissions=True).name
    line = frappe.get_doc({"doctype": "Outflow Import Row", "import_batch": batch, "transfer_id": transfer_id,
                           "amount": amount, "row_status": "Settled", "direction": "Debit", **row}
                          ).insert(ignore_permissions=True).name
    frappe.get_doc({"doctype": "Outflow Row Match", "import_row": line, "import_batch": batch,
                    "transfer_id": transfer_id, "target_doctype": doctype, "target_name": expense,
                    "target_amount": amount, "match_kind": "Settled",
                    "match_basis": "card statement" if source.endswith("Card Statement") else "cashbook remark",
                    "created_by_import": 1}).insert(ignore_permissions=True)
    return batch


statement = frappe.get_doc({"doctype": "Credit Card Statement", "holder": f"WALK CARDHOLDER {stamp}",
                            "company": "STRATOS INFRA TECHNOLOGIES PVT LTD", "statement_date": nowdate(),
                            "period_from": nowdate(), "period_to": nowdate()}).insert(ignore_permissions=True).name
card = frappe.get_doc({"doctype": NPE, "type": FALLBACK_EXPENSE_TYPE,
                       "status": "Paid", "amount": 1180, "payment_date": nowdate(),
                       "payment_ref": f"WALKCAFE{stamp} Bangalore IN - {stamp}", "description": f"Walk card spend {stamp}",
                       "credit_card_statement": statement}).insert(ignore_permissions=True).name
line_and_match("ICICI Credit Card Statement", NPE, card, 1180, remarks=f"WALKCAFE{stamp} Bangalore IN")

project = frappe.get_all("Projects", pluck="name", order_by="creation asc", limit=1)[0]
wallet = frappe.get_doc({"doctype": PE, "projects": project,
                         "type": frappe.db.get_value("Expense Type", {"project": 1}, "name"),
                         "status": "Paid", "amount": 2360, "payment_date": nowdate(),
                         "description": f"Walk site tea {stamp}"}).insert(ignore_permissions=True).name
batch = line_and_match("Cashbook", PE, wallet, 2360, remarks=f"Walk site tea {stamp}", added_by_raw="Walk Wallet Holder")
# The Cashbook job sets this marker when it creates the Expense; it is what puts it in the Cashbook queue.
frappe.db.set_value(PE, wallet, "cashbook_batch", batch, update_modified=False)

frappe.db.commit()
print("EXPENSE_BILLS_SEED " + json.dumps({"card": card, "wallet": wallet, "project": project, "statement": statement}))
