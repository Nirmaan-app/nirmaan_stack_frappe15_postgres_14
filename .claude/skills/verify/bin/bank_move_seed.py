"""Two made-up bank lines for `walk_bank_move.py` (#1760): one on an ICICI Bank Statement import and one on a Cashfree
import, each staged as its upload stages it and recorded with Create (`expenses.create_expense`) as a Non Project
Expense, the way a person records it. The Cashfree expense then gets what a person or a data fix adds after Create: a
pay-to account, approval dates and a comment (owner decisions of 2026-11-26), so the walk can see them travel.

    devenv.sh script <task> .claude/skills/verify/bin/bank_move_seed.py <stamp>

Prints `icici:` and `cashfree:` (each line's UTR), `type:` (the expense type, one both ledgers take), `project:` and
`project_name:` (the first Won project not on CEO Hold), and the made-up Accountant Lead the walk drives
(`walk-accountant-lead@example.com`, made once). Writes only to the env DB.
"""

import sys

import frappe

from nirmaan_stack.api.outflow_import.expenses import create_expense

STAMP = sys.argv[1]
EMAIL, ROLE = "walk-accountant-lead@example.com", "Nirmaan Accountant Lead"

if not frappe.db.exists("User", EMAIL):
    user = frappe.new_doc("User")
    user.update({"email": EMAIL, "first_name": "Walk Accountant Lead", "send_welcome_email": 0})
    user.flags.no_welcome_mail = True
    user.insert(ignore_permissions=True)
frappe.get_doc("User", EMAIL).add_roles(ROLE)
# Raw: `Nirmaan Users` is the app's user mirror; the walk only needs its profile, which feeds no recompute.
frappe.db.set_value("Nirmaan Users", EMAIL, "role_profile", f"{ROLE} Profile", update_modified=False)
frappe.db.commit()
print(f"user_lead: {EMAIL}")

expense_type = frappe.db.get_value("Expense Type", {"project": 1, "non_project": 1}, "name")
CARRIED = {
    "pay_to_account_name": "Testvendor Hardware Stores",
    "pay_to_account_number": "000111222333",
    "pay_to_ifsc": "TEST0001234",
    "approval_date": "2026-10-12",
    "ceo_approval_date": "2026-10-13",
}

for key, source in (("icici", "ICICI Bank Statement"), ("cashfree", "Cashfree")):
    batch = frappe.new_doc("Outflow Import Batch")
    batch.update({"source": source, "status": "In Review", "source_file": f"/private/files/walk-1760-{key}.csv"})
    batch.insert(ignore_permissions=True)
    utr = f"WALKUTR{key.upper()}{STAMP}"
    row = frappe.new_doc("Outflow Import Row")
    row.update(
        {
            "import_batch": batch.name,
            "source": source,
            "transfer_id": utr,
            "amount": 4250 if key == "icici" else 1870,
            "direction": "Debit" if key == "icici" else None,
            "added_on": "2026-10-14 11:20:00",
            "bank_reference_no": utr,
            "settlement_reference": utr,
            "beneficiary_name": "Testvendor Hardware Stores",
            "remarks": f"walk 1760 site cement {key}",
            "row_status": "Mismatched",
        }
    )
    row.insert(ignore_permissions=True)
    frappe.db.commit()
    name = create_expense(row=row.name, doctype="Non Project Expenses", expense_type=expense_type)["settled"]["name"]
    if key == "cashfree":
        frappe.db.set_value("Non Project Expenses", name, CARRIED, update_modified=False)
        frappe.get_doc("Non Project Expenses", name).add_comment("Comment", text="Walk 1760: type checked by hand")
        frappe.db.commit()
    print(f"{key}: {utr}")

project = frappe.get_all(
    "Projects",
    filters={"tendering_status": "Won", "status": ["!=", "CEO Hold"], "project_name": ["is", "set"]},
    fields=["name", "project_name"],
    order_by="creation asc",
    limit=1,
)[0]
print(f"type: {expense_type}")
print(f"project: {project.name}")
print(f"project_name: {project.project_name}")
