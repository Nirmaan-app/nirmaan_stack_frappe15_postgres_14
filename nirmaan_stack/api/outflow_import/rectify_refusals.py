# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Why a line cannot be rectified (moved), in plain words (#1449; #1757, spec #1753 stories 29-36).

The Rectify core (`porter_rectify`) asks these twice: its plan, to say why before anyone confirms, and its write,
again under the locks. Each answer is a sentence or `None`.

  * `line_refusal`: the line itself -- missing, another source's, not Settled, settled to more than one record, to
    a record its import did not create or to a created record that is not an expense, or moving without the line it
    must move with (a wallet spend and its refund).
  * `expense_refusal`: the expense the line holds -- not Paid, a Reimbursement's, an Expense Request's, carrying a
    Payment TDS Deduction, on a Cheque (#1413: its delete would take it off the cheque), or with a bill being read.
    A Porter expense is none of these.
"""

from __future__ import annotations

from typing import Collection

import frappe

from nirmaan_stack.api.outflow_import.rectify_sources import RectifySource
from nirmaan_stack.services.cheques.lines import cheques_naming
from nirmaan_stack.services.expense_bills.receive import bill_being_read
from nirmaan_stack.services.outflow_import.ledgers import NON_PROJECT_EXPENSE_DOCTYPE, PAID, is_expense_doctype
from nirmaan_stack.services.outflow_import.status import ROW_SETTLED

_TDS_DOCTYPE = "Payment TDS Deduction"


def line_refusal(source: RectifySource, line, legs, ticked: Collection[str]) -> str | None:
    """Why this line cannot be rectified, or `None`. `legs` are its live Settled matches; `ticked` the lines moving
    with it in this one transaction."""
    wording = source.wording
    if not line:
        return wording.not_found
    if (line.source or "").strip() != source.source:
        return wording.not_this_source
    if line.row_status != ROW_SETTLED:
        return wording.not_settled.format(status=line.row_status)
    if len(legs) > 1:
        return wording.split_line
    if len(legs) != 1 or not legs[0].created_by_import:
        return wording.not_created
    if not is_expense_doctype(legs[0].target_doctype):
        return wording.not_an_expense.format(doctype=legs[0].target_doctype)
    if not frappe.db.exists(legs[0].target_doctype, legs[0].target_name):
        return wording.not_created
    partners, sentence = source.partners(line)
    if sentence and not (partners and set(partners) <= set(ticked)):
        return sentence
    return None


def expense_refusal(expense, *, lock: bool = False) -> str | None:
    """Why this created expense cannot be replaced, or `None`. `lock` (the write): its bills are locked while asked."""
    if expense.status != PAID:
        return f"This expense is {expense.status or 'not set'}, not Paid, so it cannot be moved."
    if expense.get("reimbursement"):
        return f"This expense belongs to Reimbursement {expense.reimbursement}, so it cannot be moved."
    if expense.get("request_id"):
        return (
            f"This expense came from Expense Request {expense.request_id}, which a move would delete, "
            "so it cannot be moved."
        )
    if expense.doctype == NON_PROJECT_EXPENSE_DOCTYPE:
        tds = frappe.db.get_value(_TDS_DOCTYPE, {"non_project_expense": expense.name}, "name")
        if tds:
            return f"This expense carries Payment TDS Deduction {tds}, so it cannot be moved."
    cheques = cheques_naming(expense.doctype, [expense.name])
    if cheques:
        return f"This expense is on Cheque {cheques[0].cheque_no or cheques[0].cheque}, so it cannot be moved."
    if bill_being_read(expense.doctype, expense.name, for_update=lock):
        return "A bill on this expense is being read right now. Move it once the Bill check is done."
    return None


def already_there(source: RectifySource, project: str | None) -> str:
    """The sentence for a move to where the expense already is."""
    if not project:
        return source.wording.already_non_project
    name = frappe.db.get_value("Projects", project, "project_name") or project
    return source.wording.already_on.format(name=name)
