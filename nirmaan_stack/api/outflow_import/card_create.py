# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Credit Card Statement import's Create step: one *Paid* Non-Project Expense per card spend (#1568,
spec #1565, ADR-0037 rulings 1, 6, 7).

Cashbook's and Porter's job are the prior art (`cashbook._write_one`, `porter_create._create_one`): the same
per-line transaction, the same writer (`settle.create_expense_from_row`).

EACH SPEND, IN ONE TRANSACTION, COMMITTED BEFORE THE NEXT
--------------------------------------------------------
    1. its Expense, at Paid: the line amount, the transaction date, payment_ref = the line's
       `settlement_reference` ("{details} - {SerNo}", staged), the type the line holds (as staged, or as
       Review left it), the description "Card spend at {merchant}, {holder}'s card", and the
       `credit_card_statement` link. No vendor; the type's extra form fields are left empty.
    2. a Settled `Outflow Row Match`: `card_upload.MATCH_BASIS`, `created_by_import`
    3. the line -> Settled

⚠️ NO PAID BY. Non Project Expenses has no such field (README ruling 1): the holder is carried by the
`credit_card_statement` link and named in the description.

⚠️ SPENDS ONLY. A credit line is open at `Mismatched` too, the status Unreconcile reopens a spend to, so
every read here asks the direction as well: a credit is decided in the main table (#1567), never created.

⚠️ IT RESUMES, AND IT RE-CREATES WHAT WAS UNRECONCILED. The job writes every spend whose status is in
`card_types.CREATE_LINE_STATUSES` and nothing else; each is re-read under its row lock and skipped once it
is no longer one of those, so a spend is never written twice.

⚠️ NO FILE ROW PER EXPENSE. The statement PDF is one File on the Credit Card Statement (it names the holder
and the card); the Expense links the statement and carries no attachment of its own.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.outflow_import.card_import import (
    card_import,
    create_job_id,
    refuse_unless_card_import,
)
from nirmaan_stack.api.outflow_import.card_upload import (
    MATCH_BASIS,
    ROW_DOCTYPE,
    SPEND_DOCTYPE,
    STATEMENT_DOCTYPE,
)
from nirmaan_stack.api.outflow_import.expenses import MATCH_DOCTYPE
from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.review import StagedRow
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.card_types import CREATE_LINE_STATUSES, spend_description
from nirmaan_stack.services.outflow_import.import_comment import import_comment
from nirmaan_stack.services.outflow_import.parser import DIRECTION_DEBIT
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup, target_snapshot
from nirmaan_stack.services.outflow_import.settle import create_expense_from_row
from nirmaan_stack.services.outflow_import.status import ROW_ERROR, ROW_SETTLED

_JOB = "nirmaan_stack.api.outflow_import.card_create.create_card_import"

#: `settlement_origin` of a created spend: the line's own plan (as staged, or as Review left it).
_ORIGIN = "Suggestion accepted"


@frappe.whitelist(methods=["POST"])
def create_card_expenses(batch: str):
    """Start Create on a card import. Returns the import as `get_card_import` reports it.

    URL: /api/method/nirmaan_stack.api.outflow_import.card_create.create_card_expenses  (POST `batch`)

    Admin, Accountant Lead and Accountant (the Bulk Import gate). Refused once no spend is left to create.
    Otherwise enqueues the job, de-duplicated per import (`card-create-<batch>`, which Discard waits for):
    pressing it twice, or while it runs, queues it once. Pressing it again after a run that left a spend in
    Error, or after a spend was unreconciled, creates only those.
    """
    user = require_outflow_access()
    refuse_unless_card_import(batch)
    if not _spends_to_create(batch):
        frappe.throw(f"Every spend of {batch} is already created.", title="Already created")
    frappe.enqueue(
        _JOB,
        queue="long",
        timeout=3600,
        batch=batch,
        actor=user,
        job_id=create_job_id(batch),
        deduplicate=True,
    )
    return card_import(batch)


def create_card_import(batch: str, actor: str) -> None:
    """THE JOB: create every spend Create still owes, one transaction per spend.

    A failing spend is rolled back, marked Error with a sentence, and the run carries on: one bad line must
    not strand the rest. Re-running finishes it.
    """
    statement = frappe.db.get_value(STATEMENT_DOCTYPE, {"import_batch": batch}, ["name", "holder"], as_dict=True)
    if not statement:
        frappe.log_error(title="Card Create: no Credit Card Statement", message=f"{batch}: nothing was written.")
        return
    for line in _spends_to_create(batch):
        try:
            _create_one(line, batch, actor, statement)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            frappe.local.message_log = []
            frappe.log_error(
                title="Card Create: could not create an expense",
                message=f"{batch} / {line}\n\n{frappe.get_traceback()}",
            )
            _mark_error(line, "Could not create this expense. Run Create again.")

    refresh_batch_rollup(batch)
    frappe.db.commit()


def _spends_to_create(batch: str) -> list[str]:
    return frappe.db.sql(
        """
        SELECT name FROM "tabOutflow Import Row"
        WHERE import_batch = %s AND direction = %s AND row_status IN %s
        ORDER BY name
        """,
        (batch, DIRECTION_DEBIT, CREATE_LINE_STATUSES),
        pluck=True,
    )


def _create_one(name: str, batch: str, actor: str, statement) -> None:
    """One spend -> its Expense -> its match -> Settled. Writes nothing when the line is no longer one Create
    owes (another run took it)."""
    rows = frappe.db.sql("""SELECT * FROM "tabOutflow Import Row" WHERE name = %s FOR UPDATE""", (name,), as_dict=True)
    if not rows or rows[0].row_status not in CREATE_LINE_STATUSES or rows[0].direction != DIRECTION_DEBIT:
        return
    row = rows[0]

    # ⚠️ THE ADAPTER, NOT THE RAW ROW: the writer reads `added_on_date` and a Decimal `amount` by attribute.
    result = create_expense_from_row(
        StagedRow(row),
        doctype=SPEND_DOCTYPE,
        expense_type=row.suggested_expense_type,
        actor=actor,
        description=spend_description(row.remarks, statement.holder),
        comment=import_comment(None, batch),
        # The PDF names the holder and the card: it stays the statement's one File.
        statement_file_url=None,
        credit_card_statement=statement.name,
    )

    match = frappe.new_doc(MATCH_DOCTYPE)
    match.update(
        {
            "import_row": row.name,
            "import_batch": batch,
            "transfer_id": row.transfer_id,
            "target_doctype": result.doctype,
            "target_name": result.name,
            "target_amount": float(result.amount),
            "match_kind": MATCH_SETTLED,
            "match_basis": MATCH_BASIS,
            "settlement_origin": _ORIGIN,
            "created_by_import": 1,
            "matched_at": frappe.utils.now_datetime(),
            "matched_by": actor,
            **target_snapshot(result.doctype, result.name),
        }
    )
    match.insert(ignore_permissions=True)

    # Raw: `Outflow Import Row` has no doc_events; the batch rollup is recomputed from the rows at the end.
    frappe.db.set_value(
        ROW_DOCTYPE,
        row.name,
        {
            "row_status": ROW_SETTLED,
            "suggested_name": result.name,
            "outcome_note": f"Created {result.doctype} {result.name}.",
            "decided_at": frappe.utils.now_datetime(),
            "decided_by": actor,
            "settlement_origin": _ORIGIN,
            # A line reopened by Unreconcile was marked Confirm by hand; created again, it is done.
            "confirm_by_hand": 0,
        },
        update_modified=False,
    )


def _mark_error(line: str, note: str) -> None:
    """The line -> Error with its sentence, committed. Raw: `Outflow Import Row` has no doc_events, and the
    batch rollup is recomputed from the rows at the end of the run."""
    frappe.db.set_value(ROW_DOCTYPE, line, {"row_status": ROW_ERROR, "outcome_note": note}, update_modified=False)
    frappe.db.commit()
