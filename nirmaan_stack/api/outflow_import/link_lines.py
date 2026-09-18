# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Many bank lines settle one expense (ADR-0027, #1298).

Thin orchestrator (ADR-0010 B4), the same shape as `expenses.allocate_row` turned the other way
round: there one line fans out to many payments, here many lines fan in to one expense. The rules
live in `services/outflow_import/settle.link_lines_to_expense` and `expense_links`; this module owns
the import-side bookkeeping around them, reusing `expenses.py`'s helpers so the slip, the row status
and the refusal wording are the ones every other settle path writes.

⚠️ ALL OR NOTHING (Q16). One savepoint holds every slip, the expense save and every row refresh. A
refusal on the fifth line leaves the first four unlinked, which is the only shape a person can reason
about: the dialog showed one total and one outcome, so it either happened or it did not.

⚠️ LOCK ORDER: EVERY IMPORT ROW, IN NAME ORDER, THEN THE EXPENSE. Two accountants ticking overlapping
lines take the row locks in the same order and cannot deadlock on them; the expense is taken last, as
`allocate_row` takes the row before the payment.
"""

from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    _concurrent_writer_refusal_as_sentence,
    _guard_is_a_debit,
    _guard_money_not_recorded,
    _link_statement_file_to_target,
    _record_settlement,
    _refresh_row_allocation,
    _statement_file_url,
)
from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.review import (
    ROW_DOCTYPE,
    _StagedRow,
    _refresh_batch_rollup,
    derive_batch_status,
)
from nirmaan_stack.services.outflow_import.expense_links import (
    load_expense_links,
    load_linked_totals,
    remaining_balance,
)
from nirmaan_stack.services.outflow_import.ledgers import (
    EXPENSE_DOCTYPES,
    NON_PROJECT_EXPENSE_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
    RECONCILIATION_PENDING,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.settle import (
    ExpenseSettlementError,
    link_lines_to_expense,
)
from nirmaan_stack.services.outflow_import.status import OPEN_ROW_STATUSES


@frappe.whitelist(methods=["POST"])
def link_rows_to_expense(rows, target_doctype: str, target_name: str, confirm_mismatch=False):
    """Link every given bank line to one Reconciliation Pending expense, in one transaction.

    URL: /api/method/nirmaan_stack.api.outflow_import.link_lines.link_rows_to_expense

    `rows` is a JSON array of `Outflow Import Row` names. Each must be money out and open (no
    decision written yet). The expense ends Paid, dated by its latest linked line, when its linked
    total reaches its amount within ₹5, and stays Reconciliation Pending otherwise.

    ⚠️ `confirm_mismatch` IS THE SAME "... anyway?" ANSWER `settle_row` TAKES (#1260). It is applied
    to every line: the screen asks once for the request, naming the server's sentence.
    """
    names = _parse_rows(rows)
    with _concurrent_writer_refusal_as_sentence("link_rows_to_expense", names[0]):
        done = _link_and_commit(names, target_doctype, target_name, confirm_mismatch)
    _link_statement_file_to_target(done["statement_file_url"], done["result"])

    links = load_expense_links(target_doctype, target_name)
    expense = frappe.db.get_value(
        target_doctype, target_name, ["status", "amount", "payment_date"], as_dict=True
    )
    amount = normalize_amount(expense.get("amount"))
    return {
        "expense": {
            "doctype": target_doctype,
            "name": target_name,
            "status": expense.get("status"),
            "amount": float(amount),
            "linked_total": float(links.linked_total),
            "line_count": links.line_count,
            "remaining": float(remaining_balance(amount, links.linked_total)),
            "payment_date": str(expense["payment_date"]) if expense.get("payment_date") else None,
        },
        "rows": done["rows"],
        "batch_status": done["batch_status"],
    }


def _link_and_commit(names, target_doctype, target_name, confirm_mismatch):
    """The link itself, up to and including the commit (the concurrency wrapper ends there)."""
    actor = require_outflow_access()
    if target_doctype not in EXPENSE_DOCTYPES:
        frappe.throw(
            f"Only a Project Expense or a Non Project Expense can take many bank lines, "
            f"not '{target_doctype}'.",
            ExpenseSettlementError,
            title="Not an expense",
        )

    loaded = [_load_linkable_row(name) for name in sorted(names)]
    for staged, doc in loaded:
        _guard_is_a_debit(doc)
    # Under the row locks, so no other writer can settle one of these lines between the check and
    # the write. Before the savepoint and read-only, so a refusal leaves nothing behind.
    for staged, doc in loaded:
        _guard_money_not_recorded(
            staged, doc, confirm_mismatch, writing=[(target_doctype, target_name)]
        )

    docs_by_row = {staged.name: doc for staged, doc in loaded}
    batches = sorted({doc["import_batch"] for _, doc in loaded})
    statement_file_url = _statement_file_url(loaded[0][1]["import_batch"])

    savepoint = f"ofi_link_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    results = {}
    try:

        def record_link(staged, result):
            results[staged.name] = result
            _record_settlement(staged, docs_by_row[staged.name], result, actor)

        result = link_lines_to_expense(
            [staged for staged, _ in loaded],
            target_doctype,
            target_name,
            actor,
            statement_file_url=statement_file_url,
            record_link=record_link,
        )
        row_statuses = [
            {
                "row": staged.name,
                # `result` feeds the note's amount-correction suffix, which only the 1:1 shape has.
                "row_status": _refresh_row_allocation(staged.name, actor, results[staged.name]),
            }
            for staged, _ in loaded
        ]
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)

    batch_status = {batch: derive_batch_status(_refresh_batch_rollup(batch)) for batch in batches}
    frappe.db.commit()
    return {
        "result": result,
        "statement_file_url": statement_file_url,
        "rows": row_statuses,
        "batch_status": batch_status,
    }


def _parse_rows(rows) -> list:
    """A JSON array of row names. Refuses an empty list and a repeat, before anything is read."""
    if isinstance(rows, str):
        rows = frappe.parse_json(rows)
    names = [str(name).strip() for name in (rows or []) if str(name or "").strip()]
    if not names:
        frappe.throw("Tick at least one bank line to link.", title="Nothing ticked")
    if len(set(names)) != len(names):
        frappe.throw("The same bank line is ticked twice.", title="Repeated line")
    return names


def _load_linkable_row(name: str):
    """One line, read UNDER A `FOR UPDATE` ROW LOCK, refused unless it is still open.

    ⚠️ OPEN ONLY (`status.OPEN_ROW_STATUSES`), NARROWER THAN `_load_allocatable_row`. A Partially
    Allocated line already carries money to a payment, and linking it here would count its whole
    amount twice; a Settled or Skipped line is decided. The screen only lets an open line be ticked,
    and this is the half that does not depend on the screen.
    """
    doc = frappe.db.get_value(ROW_DOCTYPE, name, "*", as_dict=True, for_update=True)
    if not doc:
        frappe.throw(f"Import row '{name}' not found.", title="Not found")
    status = doc.get("row_status") or ""
    if status not in OPEN_ROW_STATUSES:
        who = (doc.get("beneficiary_name") or "").strip() or name
        frappe.throw(
            f"The line to {who} is already {status}, so it cannot be linked. "
            "Untick it and link the rest.",
            ExpenseSettlementError,
            title="Line not open",
        )
    return _StagedRow(doc), doc


@frappe.whitelist()
def get_linkable_expenses():
    """Reconciliation Pending expenses that still have room, for the link dialog's picker.

    URL: /api/method/nirmaan_stack.api.outflow_import.link_lines.get_linkable_expenses

    Both expense ledgers, each with its amount, what its live slips already cover (and how many), and
    what is left. Only expenses with more than ₹0 left are listed: one with nothing left cannot take
    another line. The screen searches and marks fits locally; the write re-checks everything under a
    lock, so this list decides nothing.

    ⚠️ THE LINKED TOTAL COMES FROM `expense_links.load_linked_totals`, the grouped twin of
    `load_expense_links` -- never a query of its own here.
    """
    require_outflow_access()
    records = []
    for doctype in (NON_PROJECT_EXPENSE_DOCTYPE, PROJECT_EXPENSE_DOCTYPE):
        is_project = doctype == PROJECT_EXPENSE_DOCTYPE
        # Non Project Expenses has no project column at all, so there is nothing to select or join.
        rows = frappe.db.sql(
            f"""
            SELECT e.name, e.amount, e.type, e.description, e.payment_ref,
                   {"e.projects AS project, pr.project_name" if is_project else "NULL AS project, NULL AS project_name"}
            FROM "tab{doctype}" e
            {'LEFT JOIN "tabProjects" pr ON pr.name = e.projects' if is_project else ""}
            WHERE e.status = %(status)s AND e.amount IS NOT NULL
            ORDER BY e.modified DESC
            """,
            {"status": RECONCILIATION_PENDING},
            as_dict=True,
        )
        linked = load_linked_totals(doctype)
        for r in rows:
            amount = normalize_amount(r.get("amount"))
            links = linked.get(r["name"])
            linked_total = links.linked_total if links else Decimal("0")
            remaining = remaining_balance(amount, linked_total)
            if remaining <= 0:
                continue
            records.append(
                {
                    "target_doctype": doctype,
                    "name": r["name"],
                    "expense_type": r.get("type") or "",
                    "description": r.get("description") or "",
                    "project": r.get("project") or "",
                    "project_name": r.get("project_name") or r.get("project") or "",
                    "amount": float(amount),
                    "linked_total": float(linked_total),
                    "line_count": links.line_count if links else 0,
                    "remaining": float(remaining),
                    # The After linking bar says whether the reference is kept or gets the bulk id.
                    "payment_ref": r.get("payment_ref") or "",
                }
            )
    return records
