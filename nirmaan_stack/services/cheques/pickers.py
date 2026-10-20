# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What the cheque dialogs' pickers offer (spec #1407, #1477). Reads only.

A Payment cheque's lines are never picked: it is made with its one payment on the PO page, and its Edit
leaves its lines alone (spec #1514).

A Security Deposit cheque's "Secures" picker (#1486): `securable_records` -- the Vendor's open POs, each
with its project. Never a Work Order: Work Orders have no cheques (spec #1514).

The Clear dialog's picker (#1484): `bank_lines_for` -- the imported, unmatched ICICI debits carrying a
cheque's number (leading zeros ignored) and amount, that a hand clear may link.

The same rules are enforced on save (`lines.lines_problem`); these lists only spare the user a refusal.
"""

import frappe
from frappe.utils import cint, flt

from nirmaan_stack.services.cheques.clear_rules import (
    DIRECTION_DEBIT,
    ICICI_STATEMENT_SOURCE,
    UNMATCHED_LINE_STATUSES,
    BankLine,
    bank_line_problem,
)
from nirmaan_stack.services.cheques.rules import (
    CHEQUE_TYPE_PAYMENT,
    ICICI_BANK,
    LINES_TOLERANCE,
    PO_DOCTYPE,
    cheque_no_key,
)
from nirmaan_stack.services.cheques.writer import CHEQUES

#: A PO in these statuses holds no payment of its own any more.
PO_CLOSED_STATUSES = ("Merged", "Cancelled")


def _project_names(projects) -> dict:
    projects = sorted({p for p in projects if p})
    return dict(
        frappe.get_all("Projects", filters={"name": ["in", projects]}, fields=["name", "project_name"], as_list=True)
    ) if projects else {}


def securable_records(vendor: str) -> list[dict]:
    """`[{doctype, name, project, project_name, status}]`: the Vendor's open POs, newest first. What a
    Security Deposit cheque may name as secured (#1486; POs only, spec #1514)."""
    pos = frappe.get_all(
        PO_DOCTYPE, filters={"vendor": vendor, "status": ["not in", PO_CLOSED_STATUSES]},
        fields=["name", "project", "status"], order_by="creation desc",
    )
    names = _project_names(r.project for r in pos)
    return [
        {"doctype": PO_DOCTYPE, "name": r.name, "project": r.project,
         "project_name": names.get(r.project) or r.project, "status": r.status}
        for r in pos
    ]


def bank_lines_for(cheque: str) -> list[dict]:
    """`[{name, added_on, amount, reference_id, remarks, import_batch}]`: the imported bank lines the Clear
    dialog offers for Payment cheque `cheque` (#1484), oldest first. Each is an ICICI statement debit nobody
    has matched yet, carrying the cheque's number (leading zeros ignored) and its amount within ₹5
    (`clear_rules.bank_line_problem`). Empty for a cheque no line can clear: not ICICI Bank, Old-type, a deposit.
    """
    doc = frappe.db.get_value(
        CHEQUES, cheque, ["cheque_no", "bank", "amount", "cheque_type", "old_type"], as_dict=True
    )
    if not doc or doc.bank != ICICI_BANK or doc.cheque_type != CHEQUE_TYPE_PAYMENT or cint(doc.old_type):
        return []
    key = cheque_no_key(doc.cheque_no)
    if not key:
        return []
    amount = flt(doc.amount)
    rows = frappe.get_all(
        "Outflow Import Row",
        filters=[
            ["source", "=", ICICI_STATEMENT_SOURCE],
            ["direction", "=", DIRECTION_DEBIT],
            ["row_status", "in", UNMATCHED_LINE_STATUSES],
            # Frappe's `between` reads its bounds as dates: two comparisons instead.
            ["amount", ">=", amount - LINES_TOLERANCE],
            ["amount", "<=", amount + LINES_TOLERANCE],
            # A first cut in SQL; the exact number rule is checked below.
            ["reference_id", "like", f"%{key}%"],
        ],
        fields=["name", "source", "direction", "row_status", "added_on", "amount", "reference_id", "remarks",
                "import_batch"],
        order_by="added_on asc, name asc",
    )
    return [
        {k: r[k] for k in ("name", "added_on", "amount", "reference_id", "remarks", "import_batch")}
        for r in rows
        if not bank_line_problem(
            BankLine(name=r.name, source=r.source, direction=r.direction, row_status=r.row_status,
                     reference_id=r.reference_id, amount=flt(r.amount)),
            bank=doc.bank, cheque_no=doc.cheque_no, amount=amount,
        )
    ]
