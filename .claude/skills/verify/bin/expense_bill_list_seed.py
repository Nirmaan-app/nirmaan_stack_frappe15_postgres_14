"""Seed the Bill check column part of the Expense bills walk (`walk_expense_bills.py --part bill-check`, #1640).

    devenv.sh script <task> .claude/skills/verify/bin/expense_bill_list_seed.py <stamp>

Makes made-up Paid spends whose descriptions start "WalkBC <stamp>", each with its latest Expense bill seeded in one
state (the env's reader gives only Not read, so the other results are seeded):

* Non-Project Expenses: "WalkBC <stamp> mismatched" (Mismatched, Pending), "... matched" (Matched, Auto-approved),
  "... rejected" (Not read, Rejected; an older Matched bill under it that no longer counts), "... none" (no bill).
* Project Expenses: "WalkBC <stamp> checking" (Checking, Pending), "... notchecked" (Not checked, Approved by a
  person), "... none" (no bill).

Prints one line `EXPENSE_BILL_LIST_SEED {json}`: {slug: {"doctype", "name", "description"}}. Writes to the env DB
only (its own commit).
"""

import json
import sys

import frappe
from frappe.utils import now_datetime, nowdate

from nirmaan_stack.services.outflow_import.card_types import FALLBACK_EXPENSE_TYPE

stamp = sys.argv[1]
NPE, PE = "Non Project Expenses", "Project Expenses"
project = frappe.get_all("Projects", pluck="name", order_by="creation asc", limit=1)[0]
project_type = frappe.db.get_value("Expense Type", {"project": 1}, "name")


def spend(doctype: str, slug: str, amount: float) -> dict:
    description = f"WalkBC {stamp} {slug}"
    fields = {"projects": project, "type": project_type} if doctype == PE else {"type": FALLBACK_EXPENSE_TYPE}
    name = frappe.get_doc({"doctype": doctype, "status": "Paid", "amount": amount, "payment_date": nowdate(),
                           "description": description, **fields}).insert(ignore_permissions=True).name
    return {"doctype": doctype, "name": name, "description": description}


def bill(expense: dict, latest: int = 1, **state) -> str:
    return frappe.get_doc({"doctype": "Expense Bill", "expense_doctype": expense["doctype"], "expense": expense["name"],
                           "is_latest": latest, "bill_file": f"/private/files/walkbc-{stamp}.pdf",
                           "uploaded_by": "walk-accountant@example.com", "line_amount": 1000,
                           "read_claimed_at": now_datetime(), **state}).insert(ignore_permissions=True).name


seeded = {
    "npe_mismatched": spend(NPE, "mismatched", 1000),
    "npe_matched": spend(NPE, "matched", 1000),
    "npe_rejected": spend(NPE, "rejected", 1000),
    "npe_none": spend(NPE, "none", 1000),
    "pe_checking": spend(PE, "checking", 1000),
    "pe_notchecked": spend(PE, "notchecked", 1000),
    "pe_none": spend(PE, "none", 1000),
}
bill(seeded["npe_mismatched"], bill_check="Mismatched", read_total=1250, status="Pending")
bill(seeded["npe_matched"], bill_check="Matched", read_total=1000, status="Approved", auto_approved=1,
     approved_by="System", approved_on=now_datetime())
bill(seeded["npe_rejected"], latest=0, bill_check="Matched", read_total=1000, status="Approved", auto_approved=1,
     approved_by="System", approved_on=now_datetime())
bill(seeded["npe_rejected"], bill_check="Not read", bill_check_reason="The reader failed (ClientError).",
     status="Rejected", rejection_reason="Walk: wrong shop", rejected_by="walk-accountant@example.com",
     rejected_on=now_datetime())
bill(seeded["pe_checking"], bill_check="Checking", status="Pending")
bill(seeded["pe_notchecked"], bill_check="Not checked", status="Approved", approved_by="walk-accountant@example.com",
     approved_on=now_datetime())
frappe.db.commit()
print("EXPENSE_BILL_LIST_SEED " + json.dumps(seeded))
