"""A Cashbook import for `walk_cashbook_move.py` (#1757): the made-up statement of the Cashbook tests, each Txn Id
stamped with `<stamp>`, imported by the job run inline with the bill download replaced (`_fake_bills`), as the tests do.
The courier spend's one bill is then read to Mismatched by a stand-in reader, so its verdict and remark are there to
travel. An env cannot reach the wallet's bill storage, so the import is seeded, not uploaded: upload is not this walk's.

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_move_seed.py <stamp>

Prints `txn:` (the courier spend: a Wallet Spend of Rs 2,380 by Meera Iyer, booked Non Project, one bill), `batch:`,
`project:` and `project_name:` (the first Won project not on CEO Hold), and the two made-up users the walk drives,
which the app access gate leaves open: `walk-accountant@example.com` (Nirmaan Accountant) and
`walk-accountant-lead@example.com` (Nirmaan Accountant Lead), made once. Writes only to the env DB.
"""

import dataclasses
import sys
from decimal import Decimal
from unittest.mock import patch

import frappe

from nirmaan_stack.api.expenses.test_expense_bills import FakeReader, run_reading
from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import.test_cashbook_bills import ONE_LINK, STATEMENT, _fake_bills
from nirmaan_stack.services.expense_bills.bill_check import BillRead
from nirmaan_stack.services.outflow_import.parser import parse_statement

STAMP = sys.argv[1]
suffix = f"W{STAMP}"

for email, name, role in (
    ("walk-accountant@example.com", "Walk Accountant", "Nirmaan Accountant"),
    ("walk-accountant-lead@example.com", "Walk Accountant Lead", "Nirmaan Accountant Lead"),
):
    if not frappe.db.exists("User", email):
        user = frappe.new_doc("User")
        user.update({"email": email, "first_name": name, "send_welcome_email": 0})
        user.flags.no_welcome_mail = True
        user.insert(ignore_permissions=True)
    frappe.get_doc("User", email).add_roles(role)
    # Raw: `Nirmaan Users` is the app's user mirror; the walk only needs its profile, which feeds no recompute.
    frappe.db.set_value("Nirmaan Users", email, "role_profile", f"{role} Profile", update_modified=False)
    print(f"user_{'lead' if 'Lead' in role else 'accountant'}: {email}")
frappe.db.commit()

parsed = parse_statement(STATEMENT.read_bytes(), source="Cashbook")
parsed = dataclasses.replace(
    parsed, rows=[dataclasses.replace(r, transfer_id=r.transfer_id + suffix) for r in parsed.rows]
)
batch = cb._stage(
    parsed, cb._build_plan(parsed), file_url="/private/files/walk-1757-statement.xlsx",
    filename=f"walk-1757-{STAMP}.xlsx", user="Administrator",
).name
frappe.db.commit()
queued = []
# No RQ worker on an env, and the readings are run here: nothing is queued.
with patch.object(bills, "fetch_bill", _fake_bills()), patch.object(frappe, "enqueue", lambda *a, **k: queued.append(a)):
    cb._cashbook_worker(batch, "Administrator")

txn = ONE_LINK + suffix
match = frappe.db.get_value(
    "Outflow Row Match", {"transfer_id": txn, "match_kind": "Settled"}, ["target_doctype", "target_name"], as_dict=True
)
bill = frappe.db.get_value("Expense Bill", {"expense_doctype": match.target_doctype, "expense": match.target_name}, "name")
with patch.object(frappe, "enqueue", lambda *a, **k: queued.append(a)):
    run_reading(bill, FakeReader(BillRead(total=Decimal("1999.00"), invoice_no="WALK-1757")))
frappe.db.commit()

project = frappe.get_all(
    "Projects",
    filters={"tendering_status": "Won", "status": ["!=", "CEO Hold"], "project_name": ["is", "set"]},
    fields=["name", "project_name"],
    order_by="creation asc",
    limit=1,
)[0]
print(f"txn: {txn}")
print(f"batch: {batch}")
print(f"project: {project.name}")
print(f"project_name: {project.project_name}")
