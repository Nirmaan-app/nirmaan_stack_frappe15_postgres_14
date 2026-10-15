# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Porter import's Create step: one Porter Order and one Expense per completed order (#1445, ADR-0032).

Part of the Porter pipeline (`api/outflow_import/porter.py` holds the upload and status endpoints; the
pure rules are in `services/outflow_import/porter.py`). Cashbook's job is the prior art
(`cashbook._cashbook_worker` / `_write_one`): the same per-line transaction, the same writer.

EACH COMPLETED LINE, IN ONE TRANSACTION, COMMITTED BEFORE THE NEXT
-----------------------------------------------------------------
    1. its Porter Order (one per CRN; an existing one is reused)
    2. its Expense, at Paid, through `settle.create_expense_from_row`: the fare, the completion date, the
       CRN, the Porter Invoice's number / date / SHARED PDF URL, the booked-by name, the line's ledger and
       project AS THE LINE HOLDS THEM (Review edits them, #1446), never re-planned here
    3. a Settled `Outflow Row Match` with `porter.MATCH_BASIS`, `created_by_import`
    4. the line -> Settled

⚠️ ONLY A VALIDATED IMPORT IS CREATED. The endpoint refuses anything else, and the job asks again before
it writes (`porter.is_validated`): every Porter Invoice must have Passed, and there is no override.

⚠️ IT RESUMES, AND IT RE-CREATES WHAT WAS UNRECONCILED. The job writes every line whose status is in
`porter.CREATE_LINE_STATUSES` -- waiting, failed on an earlier run (Error), or reopened by Unreconcile
(Mismatched, #1449) -- and nothing else. A Settled line is never written twice: each line is re-read
under its row lock and skipped once it is no longer one of those. A reopened line keeps its Porter Order
(the Expense owns the link, so Unreconcile deletes only the Expense), and the re-run reuses it.

⚠️ NO FILE ROW PER EXPENSE. The invoice PDF is one File, attached to its Porter Invoice; every Expense of
that invoice carries its URL in `invoice_attachment`. The storage app deletes a stored object by key
with no check for other rows sharing it, so a second File row would let one delete take every copy.
`integrations/controllers/expense_files` keeps it so after Create too: no later save may attach a copy,
and an expense's own Files are deleted through `stored_files.delete_files`.

⚠️ THE CEO-HOLD GAP IS RE-EVALUATED ONCE PER PROJECT AT THE END. The Project Expense insert hook's check
is de-duplicated per request (`project_cashflow_hold_update.trigger_check`), and the whole job is one
request: only the first expense of a project would be counted. `_resync_cashflow_hold` runs for every
project the run wrote to, after the last line.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    MATCH_DOCTYPE,
    _refresh_batch_rollup,
    _target_snapshot,
)
from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.porter import (
    BATCH_DOCTYPE,
    INVOICE_DOCTYPE,
    ROW_DOCTYPE,
    SOURCE,
    create_job_id,
    is_validated,
    porter_import_states,
    porter_status,
)
from nirmaan_stack.api.outflow_import.porter_review import won_refusal
from nirmaan_stack.api.outflow_import.review import _StagedRow
from nirmaan_stack.api.outflow_import.unreconcile_cleanup import _resync_cashflow_hold
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.import_comment import import_comment
from nirmaan_stack.services.outflow_import.ledgers import PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.outflow_import.porter import (
    CREATE_LINE_STATUSES,
    EXPENSE_TYPE,
    IMPORT_CREATED,
    MATCH_BASIS,
    booked_by as booked_by_of,
    expense_description,
    porter_order_fields,
    statement_line,
)
from nirmaan_stack.services.outflow_import.settle import ExpenseInvoice, create_expense_from_row
from nirmaan_stack.services.outflow_import.status import ROW_ERROR, ROW_SETTLED

ORDER_DOCTYPE = "Porter Order"

_JOB = "nirmaan_stack.api.outflow_import.porter_create.create_porter_import"

#: `settlement_origin` of a created line: the line's own plan (as suggested, or as Review left it).
_ORIGIN = "Suggestion accepted"


@frappe.whitelist(methods=["POST"])
def create_porter_expenses(batch: str):
    """Start Create on a validated Porter import. Returns the import as `get_porter_status` reports it.

    URL: /api/method/nirmaan_stack.api.outflow_import.porter_create.create_porter_expenses  (POST `batch`)

    Refused unless every Porter Invoice of the import has Passed (Validating and Validation failed name
    themselves), and once every completed order is created. Otherwise enqueues the job, de-duplicated
    per import (`porter-create-<batch>`): pressing it twice, or while it runs, queues it once. Pressing it
    again after a run that left a line in Error, or after a line was unreconciled, creates only those.
    """
    user = require_outflow_access()
    if frappe.db.get_value(BATCH_DOCTYPE, batch, "source") != SOURCE:
        frappe.throw(f"{batch} is not a {SOURCE} import.", title="Not a Porter import")
    if not is_validated(batch):
        state = porter_import_states([batch])[batch]
        frappe.throw(
            f"{batch} cannot be created: it is {state}. Create unlocks only once every Porter Invoice "
            "agrees with Porter's own PDF.",
            title="Not validated",
        )
    if porter_import_states([batch])[batch] == IMPORT_CREATED:
        frappe.throw(f"Every order of {batch} is already created.", title="Already created")
    frappe.enqueue(
        _JOB,
        queue="long",
        timeout=3600,
        batch=batch,
        actor=user,
        job_id=create_job_id(batch),
        deduplicate=True,
    )
    return porter_status(batch)


def create_porter_import(batch: str, actor: str) -> None:
    """THE JOB: create every line Create still owes, one transaction per line.

    A failing line is rolled back, marked Error with a sentence, and the run carries on: the reviewer
    approved the whole import, and one bad line must not strand the rest. Re-running finishes it.
    """
    if not is_validated(batch):
        frappe.log_error(
            title="Porter Create: the import is not validated",
            message=f"{batch}: Create ran, but not every Porter Invoice has Passed. Nothing was written.",
        )
        return

    invoices = {
        invoice.name: ExpenseInvoice(
            number=invoice.invoice_number,
            date=invoice.read_invoice_date,
            file_url=invoice.invoice_file,
        )
        for invoice in frappe.get_all(
            INVOICE_DOCTYPE,
            filters={"import_batch": batch},
            fields=["name", "invoice_number", "read_invoice_date", "invoice_file"],
        )
    }
    lines = frappe.db.sql(
        """
        SELECT name FROM "tabOutflow Import Row"
        WHERE import_batch = %s AND row_status IN %s AND suggested_doctype IS NOT NULL
        ORDER BY name
        """,
        (batch, CREATE_LINE_STATUSES),
        pluck=True,
    )

    projects: set[str] = set()
    for line in lines:
        try:
            project = _create_one(line, batch, actor, invoices)
            frappe.db.commit()
        except _LineRefused as refused:
            frappe.db.rollback()
            _mark_error(line, str(refused))
            continue
        except Exception:
            frappe.db.rollback()
            frappe.local.message_log = []
            frappe.log_error(
                title="Porter Create: could not create an expense",
                message=f"{batch} / {line}\n\n{frappe.get_traceback()}",
            )
            _mark_error(line, "Could not create this expense. Run Create again.")
            continue
        if project:
            projects.add(project)

    for project in sorted(projects):
        try:
            _resync_cashflow_hold(project)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            frappe.log_error(
                title="Porter Create: the CEO-Hold gap could not be re-evaluated",
                message=f"{batch} / {project}\n\n{frappe.get_traceback()}",
            )

    _refresh_batch_rollup(batch)
    frappe.db.commit()


def _create_one(name: str, batch: str, actor: str, invoices: dict[str, ExpenseInvoice]) -> str | None:
    """One line -> its Porter Order -> its Expense -> its match -> Settled. Returns the project written to.

    Returns None, writing nothing, when the line is no longer one Create owes (another run took it).
    """
    rows = frappe.db.sql(
        """SELECT * FROM "tabOutflow Import Row" WHERE name = %s FOR UPDATE""", (name,), as_dict=True
    )
    if not rows or rows[0].row_status not in CREATE_LINE_STATUSES:
        return None
    row = rows[0]
    doctype = row.suggested_doctype
    project = row.resolved_project if doctype == PROJECT_EXPENSE_DOCTYPE else None
    # The project Review left may have stopped being Won since: never spend on it, and never move the
    # line to Non-Project behind the reviewer's back. A person re-places it in Review, then re-runs.
    refusal = project and won_refusal(project)
    if refusal:
        raise _LineRefused(f"{refusal} Place this order again in Review, then run Create again.")
    statement = statement_line(row.porter_line)
    order = _porter_order(row, statement)
    project_name = frappe.db.get_value("Projects", project, "project_name") if project else ""
    booked_by = booked_by_of(statement)

    # ⚠️ THE ADAPTER, NOT THE RAW ROW: the writer reads `added_on_date` and a Decimal `amount` by
    # attribute (see `cashbook._write_one`, where a raw doc cost 115 blank payment dates).
    result = create_expense_from_row(
        _StagedRow(row),
        doctype=doctype,
        expense_type=EXPENSE_TYPE,
        actor=actor,
        project=project,
        description=expense_description(booked_by, project_name),
        comment=import_comment(None, batch),
        # No statement on the expense: the CSV holds staff phone numbers and is attached to the batch.
        statement_file_url=None,
        # Project side only (Non Project Expenses has no Paid by): who booked the order.
        payment_by=booked_by or None,
        blank_payment_by_is_actor=False,
        invoice=invoices.get(row.porter_invoice),
        porter_order=order,
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
            # Frozen after insert: the project this expense was created on, for a later Rectify's history.
            **_target_snapshot(result.doctype, result.name),
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
    return project


class _LineRefused(Exception):
    """A line Create will not write as it stands. The message is its outcome note, for a person."""


def _mark_error(line: str, note: str) -> None:
    """The line -> Error with its sentence, committed. Raw: `Outflow Import Row` has no doc_events, and the
    batch rollup is recomputed from the rows at the end of the run."""
    frappe.db.set_value(ROW_DOCTYPE, line, {"row_status": ROW_ERROR, "outcome_note": note}, update_modified=False)
    frappe.db.commit()


def _porter_order(row, statement: dict) -> str:
    """The line's Porter Order, by its CRN: the one already there (a line re-created after Unreconcile),
    or a new one holding every order detail of the statement line."""
    if frappe.db.exists(ORDER_DOCTYPE, row.transfer_id):
        return row.transfer_id
    doc = frappe.new_doc(ORDER_DOCTYPE)
    doc.update(
        {
            **porter_order_fields(statement),
            "crn": row.transfer_id,
            "completed_at": row.added_on,
            "porter_invoice": row.porter_invoice,
            "import_row": row.name,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name
