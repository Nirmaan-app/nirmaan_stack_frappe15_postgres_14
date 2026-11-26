"""A card import for `walk_card_move.py` (#1761): the made-up card statement of the card tests
(`services/outflow_import/tests/fixtures/icici_card_statement.txt`) with a fresh holder and fresh SerNos each run,
read and staged as an upload stages it, then Created by the Create job run inline. Upload and Create are walked by
`walk_card_import.py`; this walk's subject is the Move after them.

    devenv.sh script <task> .claude/skills/verify/bin/card_move_seed.py

Prints `holder:`, `statement:` (the Credit Card Statement), `batch:`, `txn:` (the SerNo of the spend "PARK RESIDENCY
Cochin IN", Rs 1,933, booked Non Project, no bill), `project:` and `project_name:` (the first Won project not on CEO
Hold), and the made-up Accountant Lead the walk drives, `walk-accountant-lead@example.com`, made once and left open by
the app access gate. Writes only to the env DB.
"""

import random

import frappe

from nirmaan_stack.api.outflow_import import card_create
from nirmaan_stack.api.outflow_import.card_upload import leave_out_repeats, read_statement, refuse_same_period, stage
from nirmaan_stack.api.outflow_import.test_card_import import _LINE_START, FIXTURE
from nirmaan_stack.services.outflow_import.tests.card_pdf_builder import pdf_from_text

LEAD = "walk-accountant-lead@example.com"
if not frappe.db.exists("User", LEAD):
    user = frappe.new_doc("User")
    user.update({"email": LEAD, "first_name": "Walk Accountant Lead", "send_welcome_email": 0})
    user.flags.no_welcome_mail = True
    user.insert(ignore_permissions=True)
frappe.get_doc("User", LEAD).add_roles("Nirmaan Accountant Lead")
# Raw: `Nirmaan Users` is the app's user mirror; the walk only needs its profile, which feeds no recompute.
frappe.db.set_value("Nirmaan Users", LEAD, "role_profile", "Nirmaan Accountant Lead Profile", update_modified=False)
frappe.db.commit()

holder = f"WALK HOLDER {frappe.generate_hash(length=5).upper()}"
base = random.randint(700_000, 799_999) * 10_000
counter = iter(range(1, 1000))
text = FIXTURE.read_text(encoding="utf-8").replace("ARJUN TESTHOLDER", holder)
text = _LINE_START.sub(lambda m: f"{m.group(1)} {base + next(counter):011d} ", text)

statement = read_statement(pdf_from_text(text))
refuse_same_period(statement)
batch, record = stage(
    statement, leave_out_repeats(statement), file_url="/private/files/walk-1761-statement.pdf",
    filename="walk-1761-statement.pdf", user="Administrator",
)
frappe.db.commit()
card_create.create_card_import(batch, "Administrator")
frappe.db.commit()

txn = frappe.db.get_value(
    "Outflow Import Row", {"import_batch": batch, "remarks": "PARK RESIDENCY Cochin IN"}, "transfer_id"
)
project = frappe.get_all(
    "Projects",
    filters={"tendering_status": "Won", "status": ["!=", "CEO Hold"], "project_name": ["is", "set"]},
    fields=["name", "project_name"],
    order_by="creation asc",
    limit=1,
)[0]
print(f"holder: {holder}")
print(f"statement: {record}")
print(f"batch: {batch}")
print(f"txn: {txn}")
print(f"project: {project.name}")
print(f"project_name: {project.project_name}")
print(f"user_lead: {LEAD}")
