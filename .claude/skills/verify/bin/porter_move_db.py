"""The #1759 walk's DB read (`walk_porter_move.py`): one Settled Porter line whose expense the import created and Move
offers, for each ledger, with the delivery's facts as its Porter Order and Porter Invoice hold them.

    devenv.sh script <task> .claude/skills/verify/bin/porter_move_db.py

Prints one line `JSON:{"Non Project Expenses": <line>, "Project Expenses": <line>}`; a ledger with no such line maps
to null. Each line: `row`, `batch`, `crn`, `doctype`, `expense`, `amount`, `project_name`, `from_address`,
`to_address`, `city`, `fare`, `rcm_gst`, `invoice_number`, `has_pdf`, `refusal`. A line Move would refuse is passed
over, and one with an invoice PDF comes first. Reads only.
"""

import json

import frappe

from nirmaan_stack.api.outflow_import.porter_rectify import plan_rectify
from nirmaan_stack.api.outflow_import.rectify_sources import PORTER

LINES = frappe.db.sql(
    """SELECT r.name AS row, r.import_batch AS batch, r.transfer_id AS crn, r.suggested_doctype AS doctype,
              r.suggested_name AS expense
       FROM "tabOutflow Import Row" r
       WHERE r.source = 'Porter Statement' AND r.row_status = 'Settled' AND r.suggested_name IS NOT NULL
         AND r.suggested_doctype IN ('Non Project Expenses', 'Project Expenses')
       ORDER BY r.creation DESC
       LIMIT 400""",
    as_dict=True,
)


def facts(line) -> dict | None:
    if not frappe.db.exists(line.doctype, line.expense):
        return None
    expense = frappe.db.get_value(
        line.doctype, line.expense, ["name", "amount", "porter_order", "invoice_attachment", "status"], as_dict=True
    )
    if not expense.porter_order:
        return None
    [plan] = plan_rectify(PORTER, json.dumps([line.row]))["lines"]
    if plan["refusal"]:
        return None
    order = frappe.db.get_value(
        "Porter Order",
        expense.porter_order,
        ["from_address", "to_address", "city", "fare", "rcm_gst", "porter_invoice"],
        as_dict=True,
    )
    invoice = order.porter_invoice and frappe.db.get_value("Porter Invoice", order.porter_invoice, "invoice_number")
    return {
        **line,
        "amount": expense.amount,
        "project_name": plan.get("project_name"),
        "from_address": order.from_address,
        "to_address": order.to_address,
        "city": order.city,
        "fare": order.fare,
        "rcm_gst": order.rcm_gst,
        "invoice_number": invoice or "",
        "has_pdf": bool(expense.invoice_attachment),
        "refusal": plan["refusal"],
    }


found: dict = {"Non Project Expenses": None, "Project Expenses": None}
for line in LINES:
    current = found[line.doctype]
    if current and current["has_pdf"]:
        continue
    line_facts = facts(line)
    if line_facts and (not current or line_facts["has_pdf"]):
        found[line.doctype] = line_facts
    if all(f and f["has_pdf"] for f in found.values()):
        break
print("JSON:" + json.dumps(found, default=str))
