# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Porter Statement import: its own pipeline, beside Cashbook's (ADR-0032, spec #1442).

Porter's monthly CSV becomes one Expense per completed delivery order, but only after every Porter
Invoice it names agrees with Porter's own PDF. The pure rules live in `services/outflow_import/porter*.py`;
this module holds the upload, retry and status endpoints. The records and the shared gates are
`porter_records`'s; the upload's steps `porter_upload`'s.

THE STEPS
---------
    upload    `upload_porter_statement`   parse, group, refuse, save the CSV, stage   batch + lines +
                                                                                     Porter Invoices
    status    `get_porter_status`         the import and its Porter Invoices          reads only
    validate  (#1444)  started by upload; `porter_validation.validate_porter_import` downloads each
              invoice PDF, reads it with Gemini and compares; `retry_porter_invoice` re-queues an
              Error invoice. `porter_records.is_validated(batch)` is the gate Review and Create ask.
    review    (#1446)  `porter_review.get_porter_review` / `set_porter_placement`: correct each
              completed order's project on a Validated import; the edit is the line's stored plan
    create    `porter_create.create_porter_expenses` (#1445): one Porter Order and one Expense per
              completed order, at Paid, by a background job; `get_porter_status` reports its progress
    rectify   `porter_rectify.rectify_porter_rows` (#1449): move a created order's Expense to another
              project or ledger, by replacing it; Admin and Accountant Lead
    discard   `porter_discard.discard_porter_import` (#1447): an import Create has not written to

⚠️ IT NEVER RUNS THE MATCHER. A Porter line creates its expense and settles nothing; `match_batch`
and every other settlement entry point are out of reach (`NEVER_MATCHED_SOURCES`, and an AST test).
The generic Cashfree/ICICI upload is not reused either: it assumes matching, and it refuses this source.

⚠️ NOTHING IS SAVED BEFORE THE WHOLE FILE IS READ. `save_file` commits inside the request (the cloud
attachment hook), so every refusal -- a missing column, no rows, an invoice whose lines disagree, an
invoice-level repeat (`porter_repeats`) -- happens before it.

⚠️ ITS OPEN LINES ARE NOT BANK LINES. Until Create settles them they are outside the main table's
population (`review._row_filters`), so they are in no tab, not in *Still open* and not in *Total
Unreconciled Outflow*; and every main-table action refuses them (`sources.CREATE_GATED_SOURCES`).
"""

import json
from dataclasses import asdict

import frappe
from frappe.utils import getdate
from frappe.utils.file_manager import save_file

from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.porter_records import (
    BATCH_DOCTYPE,
    SOURCE,
    created_anything,
    failed_lines,
    porter_progress,
    refuse_unless_porter_import,
)
from nirmaan_stack.api.outflow_import.porter_upload import (
    leave_out_porter_repeats,
    placement_master,
    read_statement,
    read_upload,
    stage,
)
from nirmaan_stack.api.outflow_import.porter_validation import enqueue_validation, validation_job_id
from nirmaan_stack.services.outflow_import.parser import (
    PORTER_ORDER_COMPLETED,
    PORTER_STATEMENT_COLUMNS,
)
from nirmaan_stack.services.outflow_import.porter import INVOICE_DOCTYPE
from nirmaan_stack.services.outflow_import.porter_state import (
    CREATE_LINE_STATUSES,
    INVOICE_COMPARING,
    INVOICE_ERROR,
    INVOICE_FAILED,
    INVOICE_PASSED,
    INVOICE_QUEUED,
    import_state,
)
from nirmaan_stack.services.outflow_import.porter_verdict import invoice_date_window, warnings_from_stored
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_PORTER_CANCELLED
from nirmaan_stack.services.outflow_import.status import ROW_ERROR, ROW_SETTLED


@frappe.whitelist(methods=["POST"])
def upload_porter_statement():
    """Read a Porter Statement and stage it. Returns the import as `get_porter_status` reports it.

    Multipart form: `file`, a .csv -- Porter's own export. Any other file is refused, unread.
    The steps are `porter_upload`'s.
    URL: /api/method/nirmaan_stack.api.outflow_import.porter.upload_porter_statement

    Refused, with the reason, and with NOTHING saved: a file that is not a Porter Statement (a missing
    column, no rows), an invoice link whose lines disagree on invoice number / Porter GSTIN / customer
    GSTIN / billing entity, and the invoice-level repeats `porter_repeats.leave_out_repeats` blocks (a
    created invoice listing different orders; an invoice held by an import never created; a file with
    nothing new). An invoice already created is LEFT OUT, never downloaded again, and its orders are
    counted in the batch's `repeats_not_saved` (#1447).

    Saves: the CSV (private, attached to the batch); the batch, its period the first to the last order
    completion date; one line per order -- a cancelled order skipped and locked, a completed one pending
    with its starting project suggestion; and one Porter Invoice per invoice link, `Queued`.

    Then starts the validation job, de-duplicated per import (`porter-validate-<batch>`).
    """
    user = require_outflow_access()
    filename, content = read_upload()
    judged = leave_out_porter_repeats(read_statement(content), filename)
    master = placement_master()

    # ⚠️ THE FIRST WRITE, AND IT CANNOT BE ROLLED BACK: everything that can refuse has run above.
    saved = save_file(fname=filename, content=content, dt=None, dn=None, is_private=1)
    batch = stage(
        judged.statement,
        master,
        file_url=saved.file_url,
        filename=filename,
        user=user,
        repeats_not_saved=judged.repeats_not_saved,
    )
    frappe.db.set_value(
        "File",
        saved.name,
        {
            "attached_to_doctype": BATCH_DOCTYPE,
            "attached_to_name": batch,
            "attached_to_field": "source_file",
        },
        update_modified=False,
    )
    frappe.db.commit()
    enqueue_validation(batch, user)
    return porter_status(batch)


@frappe.whitelist(methods=["GET"])
def get_porter_statement_rules() -> dict:
    """What the upload screen checks a chosen file against before upload (#1555). Read-only.

    The parser's own required columns and its completed-order status, so the screen keeps no copy of
    either. The parser stays the authority: the upload re-reads the file and its refusals still show.
    URL: /api/method/nirmaan_stack.api.outflow_import.porter.get_porter_statement_rules
    """
    require_outflow_access()
    return {"columns": list(PORTER_STATEMENT_COLUMNS), "completed_status": PORTER_ORDER_COMPLETED}


@frappe.whitelist(methods=["POST"])
def retry_porter_invoice(invoice: str):
    """Validate one Porter Invoice again after an *Error* (a download or Gemini failure). Returns the import.

    URL: /api/method/nirmaan_stack.api.outflow_import.porter.retry_porter_invoice  (POST `invoice`)

    ⚠️ ONLY AN ERROR IS RETRIED. A *Failed* invoice disagrees with the statement, and that is final for
    this import -- there is no override, for anyone (ADR-0032); a Passed or in-hand one has nothing to
    retry. The status is read again under the row lock, so two clicks queue it once.

    The PDF already stored is reused: the job reads it again without downloading.
    """
    user = require_outflow_access()
    rows = frappe.db.sql(
        """SELECT name, import_batch, validation_status FROM "tabPorter Invoice" WHERE name = %s FOR UPDATE""",
        (invoice,),
        as_dict=True,
    )
    if not rows:
        frappe.throw(f"Porter Invoice {invoice} does not exist.", title="Not found")
    row = rows[0]
    if row.validation_status != INVOICE_ERROR:
        if row.validation_status == INVOICE_FAILED:
            reason = (
                f"Invoice {invoice} Failed: its PDF disagrees with the statement. A Failed invoice is "
                "final and cannot be retried or overridden."
            )
        else:
            reason = (
                f"Invoice {invoice} is {row.validation_status}. Only an invoice that hit an Error can "
                "be retried."
            )
        frappe.throw(reason, title="Cannot retry")
    # Raw: `Porter Invoice` has no doc_events, and its status is read, never derived from.
    frappe.db.set_value(
        INVOICE_DOCTYPE,
        invoice,
        {"validation_status": INVOICE_QUEUED, "validation_message": None},
        update_modified=False,
    )
    frappe.db.commit()
    enqueue_validation(row.import_batch, user, job_id=validation_job_id(row.import_batch, invoice))
    return porter_status(row.import_batch)


@frappe.whitelist()
def get_porter_status(batch: str):
    """The Porter import and its Porter Invoices, for the import dialog. READS ONLY.

    URL: /api/method/nirmaan_stack.api.outflow_import.porter.get_porter_status?batch=OFI-...

    Read from the records, which are the durable truth: a reload, or a worker restart, loses nothing.
    """
    require_outflow_access()
    refuse_unless_porter_import(batch)
    return porter_status(batch)


def porter_status(batch: str) -> dict:
    """The import's own figures and one entry per Porter Invoice, in the order they were uploaded."""
    meta = frappe.db.get_value(
        BATCH_DOCTYPE,
        batch,
        ["name", "original_filename", "period_from", "period_to", "gross_amount", "repeats_not_saved"],
        as_dict=True,
    )
    by_status = dict(
        frappe.db.sql(
            """
            SELECT row_status, COUNT(*) FROM "tabOutflow Import Row"
            WHERE import_batch = %s GROUP BY row_status
            """,
            (batch,),
        )
    )
    lines = frappe.db.sql(
        """
        SELECT COUNT(*) AS orders,
               COALESCE(SUM(CASE WHEN skip_kind = %s THEN 1 ELSE 0 END), 0) AS cancelled
        FROM "tabOutflow Import Row"
        WHERE import_batch = %s
        """,
        (SKIP_KIND_PORTER_CANCELLED, batch),
        as_dict=True,
    )[0]
    invoices = frappe.get_all(
        INVOICE_DOCTYPE,
        filters={"import_batch": batch},
        fields=[
            "name",
            "invoice_number",
            "city",
            "billing_entity",
            "completed_orders",
            "fare_total",
            "tax_total",
            "validation_status",
            "validation_message",
            "validation_warnings",
            "invoice_file",
            "read_invoice_number",
            "read_invoice_date",
            "read_supplier_gstin",
            "read_receiver_gstin",
            "read_fare",
            "read_tax",
            "porter_gstin",
            "customer_gstin",
        ],
        order_by="creation asc, name asc",
    )
    orders = int(lines["orders"] or 0)
    cancelled = int(lines["cancelled"] or 0)
    progress = porter_progress([batch])[batch]
    return {
        "batch": meta.name,
        "source": SOURCE,
        "original_filename": meta.original_filename,
        "period_from": str(meta.period_from) if meta.period_from else None,
        "period_to": str(meta.period_to) if meta.period_to else None,
        "orders": orders,
        "completed": orders - cancelled,
        "cancelled": cancelled,
        "fare_total": float(meta.gross_amount or 0),
        # Orders on invoices already created, left out of this upload (#1447).
        "repeats_not_saved": int(meta.repeats_not_saved or 0),
        # Discard is still possible: Create has written nothing (#1447). Who may discard is not asked here.
        "discardable": not created_anything(batch),
        # Derived from the invoices below and the lines, never stored (`porter_state.import_state`).
        "state": import_state([invoice.validation_status for invoice in invoices], by_status),
        # Create's progress (#1445), counted from the lines, which are the durable record. `to_create`
        # is what a run of Create would still write (waiting, failed, or reopened by Unreconcile).
        "to_create": sum(int(by_status.get(status) or 0) for status in CREATE_LINE_STATUSES),
        "created": int(by_status.get(ROW_SETTLED) or 0),
        "failed": int(by_status.get(ROW_ERROR) or 0),
        # The Create job is queued or running: the dialog polls while it is.
        "create_running": progress["create"]["running"],
        # Per phase: what is done, what is waiting and what needs a person (#1556). Import History
        # gets the same summary per Porter import (`review.list_imports`).
        "progress": progress,
        # Each line Create could not create: its CRN, the note it stored and its fix (#1561).
        "failed_lines": failed_lines(batch),
        "invoices": [
            {
                "name": invoice.name,
                "invoice_number": invoice.invoice_number,
                "city": invoice.city,
                "billing_entity": invoice.billing_entity,
                "completed_orders": int(invoice.completed_orders or 0),
                "fare_total": float(invoice.fare_total or 0),
                "tax_total": float(invoice.tax_total or 0),
                "validation_status": invoice.validation_status,
                "validation_message": invoice.validation_message,
                "porter_gstin": invoice.porter_gstin,
                "customer_gstin": invoice.customer_gstin,
                "can_retry": invoice.validation_status == INVOICE_ERROR,
                "has_pdf": bool(invoice.invoice_file),
                # What Gemini read, beside the statement's figures above (None until it has read).
                "read": what_gemini_read(invoice),
                # Figures the PDF read differently that decide nothing (GSTINs, tax, invoice number, #1559).
                "warnings": [
                    asdict(warning) for warning in warnings_from_stored(_json(invoice.validation_warnings))
                ],
            }
            for invoice in invoices
        ],
        # The dates an invoice of this statement may carry (`porter_verdict.invoice_date_window`), so the
        # screen can mark a date that failed without a copy of the rule.
        "invoice_date_window": _date_window(meta.period_from, meta.period_to),
    }


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def _date_window(period_from, period_to) -> dict | None:
    if not (period_from and period_to):
        return None
    start, end = invoice_date_window(getdate(period_from), getdate(period_to))
    return {"from": str(start), "to": str(end)}


def what_gemini_read(invoice) -> dict | None:
    """THE ONE READER of a Porter Invoice's `read_*` fields. None until Gemini has read the PDF.

    It has read once the invoice reached Comparing (or decided after it), or an Error kept something it
    read (a figure it could not read is an Error, not a Failure). ⚠️ `read_fare` / `read_tax` are NOT
    NULL columns, written 0 for a figure not read: a Porter invoice always bills a fare and its GST, so
    0 reads back as "not read".
    """
    texts = (invoice.read_invoice_number, invoice.read_supplier_gstin, invoice.read_receiver_gstin)
    if invoice.validation_status not in (INVOICE_COMPARING, INVOICE_PASSED, INVOICE_FAILED) and not any(texts):
        return None

    def _money(value):
        return float(value) if value else None

    return {
        "invoice_number": invoice.read_invoice_number,
        "invoice_date": str(invoice.read_invoice_date) if invoice.read_invoice_date else None,
        "supplier_gstin": invoice.read_supplier_gstin,
        "receiver_gstin": invoice.read_receiver_gstin,
        "fare": _money(invoice.read_fare),
        "tax": _money(invoice.read_tax),
    }
