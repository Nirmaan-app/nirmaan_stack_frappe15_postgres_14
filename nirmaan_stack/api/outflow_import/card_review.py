# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Review a Credit Card Statement import's spend types before Create (#1568, spec #1565, ADR-0039 ruling 5).

Review lists every line (`card_import.get_card_import`); this module writes the one thing Review changes: a
spend's expense type, chosen from the live Non-Project list.

⚠️ AN EDIT IS THE PLAN CREATE READS. It writes the line's `suggested_expense_type` -- what the Create job
turns into the Expense's type -- the moment it is made, so closing the browser loses nothing.

⚠️ ONLY A SPEND CREATE WOULD STILL WRITE (`card_types.CREATE_LINE_STATUSES`, direction Debit). A created
spend is refused under its row lock: its type is changed on the Expense. A credit has no type at all.
"""

import frappe

from nirmaan_stack.api.outflow_import.card_import import card_import, refuse_unless_card_import
from nirmaan_stack.api.outflow_import.card_upload import ROW_DOCTYPE
from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.porter_records import line_names
from nirmaan_stack.services.outflow_import.card_types import CREATE_LINE_STATUSES, TYPE_SOURCE_REVIEW
from nirmaan_stack.services.outflow_import.parser import DIRECTION_DEBIT


@frappe.whitelist(methods=["POST"])
def set_card_expense_type(batch: str, rows, expense_type: str):
    """Give one or more spends of a card import an expense type. Returns the import as `get_card_import` does.

    URL: /api/method/nirmaan_stack.api.outflow_import.card_review.set_card_expense_type
    Body: `batch`, `rows` (line names: a JSON list, or one name), `expense_type` (a live Non-Project type).

    Writes each line's type and marks it chosen on Review (no longer "Check"). Refused, writing nothing: not a
    card import; no lines; a type that is not a live Non-Project type; a line of another import, a credit,
    or a spend already created.
    """
    require_outflow_access()
    names = line_names(rows)
    if not names:
        frappe.throw("No spends were given to retype.", title="No spends")
    refuse_unless_card_import(batch)
    expense_type = (expense_type or "").strip()
    if not frappe.db.get_value("Expense Type", expense_type, "non_project"):
        frappe.throw(f"'{expense_type}' is not a Non-Project expense type.", title="Wrong expense type")

    lines = frappe.db.sql(
        """
        SELECT name, import_batch, direction, row_status FROM "tabOutflow Import Row"
        WHERE name IN %s ORDER BY name FOR UPDATE
        """,
        (tuple(names),),
        as_dict=True,
    )
    found = {line.name: line for line in lines}
    for name in names:
        line = found.get(name)
        if not line or line.import_batch != batch:
            frappe.throw(f"{name} is not a line of {batch}.", title="Not this import")
        if line.direction != DIRECTION_DEBIT:
            frappe.throw(f"{name} is a credit: only a spend has an expense type.", title="Not a spend")
        if line.row_status not in CREATE_LINE_STATUSES:
            frappe.throw(
                f"{name} is {line.row_status}: its Expense is already created. Change the type on the Expense.",
                title="Already created",
            )

    # Raw: `Outflow Import Row` carries no doc_events, and the type is read, never derived from -- Create
    # reads it as it stands. The row status does not move, so no batch rollup is due.
    frappe.db.set_value(
        ROW_DOCTYPE,
        {"name": ["in", names]},
        {"suggested_expense_type": expense_type, "type_source": TYPE_SOURCE_REVIEW},
    )
    frappe.db.commit()
    return card_import(batch)
