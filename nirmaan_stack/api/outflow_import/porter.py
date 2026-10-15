# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Porter Statement import: its own pipeline, beside Cashbook's (ADR-0032, spec #1442).

Porter's monthly CSV becomes one Expense per completed delivery order, but only after every Porter
Invoice it names agrees with Porter's own PDF. The pure rules live in `services/outflow_import/porter.py`;
this module reads, refuses, persists and reports.

THE STEPS, AND WHICH ONE THIS SLICE BUILT (#1443 built the first and the status reader)
---------------------------------------------------------------------------------------
    upload    `upload_porter_statement`   parse, group, refuse, save the CSV, stage   batch + lines +
                                                                                     Porter Invoices
    status    `get_porter_status`         the import and its Porter Invoices          reads only
    validate  (#1444)  started by upload; `porter_validation.validate_porter_import` downloads each
              invoice PDF, reads it with Gemini and compares; `retry_porter_invoice` re-queues an
              Error invoice. `is_validated(batch)` is the gate Review and Create ask.
    review    (#1446)  `porter_review.get_porter_review` / `set_porter_placement`: correct each
              completed order's project on a Validated import; the edit is the line's stored plan
    create    `porter_create.create_porter_expenses` (#1445): one Porter Order and one Expense per
              completed order, at Paid, by a background job; `get_porter_status` reports its progress
    rectify   (#1449)
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

import os

import frappe
from frappe.utils.background_jobs import is_job_enqueued
from frappe.utils.file_manager import save_file

from nirmaan_stack.api.outflow_import.expenses import _refresh_batch_rollup
from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.porter_validation import enqueue_validation, validation_job_id
from nirmaan_stack.services.outflow_import.parser import StatementFormatError, parse_statement
from nirmaan_stack.services.outflow_import.porter import (
    CREATE_LINE_STATUSES,
    IMPORT_VALIDATED,
    INVOICE_COMPARING,
    INVOICE_ERROR,
    INVOICE_FAILED,
    INVOICE_PASSED,
    INVOICE_QUEUED,
    MATCH_BASIS,
    SKIP_REASON_CANCELLED,
    PorterStatement,
    PorterStatementError,
    import_state,
    read_porter_statement,
    suggest_placement,
)
from nirmaan_stack.services.outflow_import.porter_repeats import (
    HeldInvoice,
    PorterRepeatRefusal,
    RepeatJudgement,
    leave_out_repeats,
)
from nirmaan_stack.services.outflow_import.project_match import ProjectIndex, build_project_index
from nirmaan_stack.services.outflow_import.settlement_reference import (
    resolve_settlement_reference,
)
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_PORTER_CANCELLED
from nirmaan_stack.services.outflow_import.sources import PORTER_STATEMENT_SOURCE
from nirmaan_stack.services.outflow_import.status import (
    ROW_ERROR,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
    SKIP_ORIGIN_SYSTEM,
)

BATCH_DOCTYPE = "Outflow Import Batch"
ROW_DOCTYPE = "Outflow Import Row"
INVOICE_DOCTYPE = "Porter Invoice"
SOURCE = PORTER_STATEMENT_SOURCE

_ALLOWED_EXTENSIONS = frozenset({".csv", ".xlsx"})
_MAX_FILE_BYTES = 5 * 1024 * 1024

# Only Won projects are suggested (ADR-0032): a Tendering duplicate of a Won project's name would tie it
# in the whole-name step and hide it (measured: "EXL KOCHI" vs "EXL Kochi").
_WON = "Won"


@frappe.whitelist(methods=["POST"])
def upload_porter_statement():
    """Read a Porter Statement and stage it. Returns the import as `get_porter_status` reports it.

    Multipart form: `file` (.csv; .xlsx is read too).
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
    filename, content = _read_upload()
    judged = _leave_out_repeats(_read_statement(content), filename)
    index = _won_project_index()

    # ⚠️ THE FIRST WRITE, AND IT CANNOT BE ROLLED BACK: everything that can refuse has run above.
    saved = save_file(fname=filename, content=content, dt=None, dn=None, is_private=1)
    batch = _stage(
        judged.statement,
        index,
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


def porter_import_states(batches: list[str]) -> dict[str, str]:
    """Each Porter import's state (Validating / Validated / Validation failed / Creating / Created),
    DERIVED from its Porter Invoices and its lines, two queries for any number of imports. Never stored:
    `Outflow Import Batch.status` keeps its own meaning."""
    invoices = _invoice_statuses(batches)
    lines: dict[str, set[str]] = {batch: set() for batch in batches}
    if batches:
        # `import_state` asks only "any" / "all" of the lines, so each import's distinct statuses do.
        for row in frappe.db.sql(
            """
            SELECT DISTINCT import_batch, row_status FROM "tabOutflow Import Row"
            WHERE import_batch IN %s
            """,
            (tuple(batches),),
            as_dict=True,
        ):
            lines[row.import_batch].add(row.row_status)
    return {batch: import_state(invoices[batch], lines[batch]) for batch in batches}


def _invoice_statuses(batches: list[str]) -> dict[str, list[str]]:
    statuses: dict[str, list[str]] = {batch: [] for batch in batches}
    if not batches:
        return statuses
    for row in frappe.db.sql(
        """SELECT import_batch, validation_status FROM "tabPorter Invoice" WHERE import_batch IN %s""",
        (tuple(batches),),
        as_dict=True,
    ):
        statuses[row.import_batch].append(row.validation_status)
    return statuses


def is_validated(batch: str) -> bool:
    """THE GATE for Review and Create (#1445, #1446): every Porter Invoice of the import has Passed.

    False while any is still being checked, and for good once one has Failed: nothing may proceed past
    a failed invoice, and there is no override. ⚠️ It asks the INVOICES only, so it stays True once
    Create has started (Creating / Created): a re-run of Create passes the same gate.
    """
    return import_state(_invoice_statuses([batch])[batch]) == IMPORT_VALIDATED


def create_job_id(batch: str) -> str:
    """The Create job's id: one per import, so pressing Create twice queues it once (#1445)."""
    return f"porter-create-{batch}"


@frappe.whitelist()
def get_porter_status(batch: str):
    """The Porter import and its Porter Invoices, for the import dialog. READS ONLY.

    URL: /api/method/nirmaan_stack.api.outflow_import.porter.get_porter_status?batch=OFI-...

    Read from the records, which are the durable truth: a reload, or a worker restart, loses nothing.
    """
    require_outflow_access()
    if frappe.db.get_value(BATCH_DOCTYPE, batch, "source") != SOURCE:
        frappe.throw(f"{batch} is not a {SOURCE} import.", title="Not a Porter import")
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
        # Derived from the invoices below and the lines, never stored (`porter.import_state`).
        "state": import_state([invoice.validation_status for invoice in invoices], by_status),
        # Create's progress (#1445), counted from the lines, which are the durable record. `to_create`
        # is what a run of Create would still write (waiting, failed, or reopened by Unreconcile).
        "to_create": sum(int(by_status.get(status) or 0) for status in CREATE_LINE_STATUSES),
        "created": int(by_status.get(ROW_SETTLED) or 0),
        "failed": int(by_status.get(ROW_ERROR) or 0),
        # The Create job is queued or running: the dialog polls while it is.
        "create_running": is_job_enqueued(create_job_id(batch)),
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
            }
            for invoice in invoices
        ],
    }


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


# --- upload, step by step -------------------------------------------------------------------------


def _read_upload() -> tuple[str, bytes]:
    """The posted file's name and bytes. The werkzeug stream is read exactly once."""
    files = getattr(frappe.request, "files", None) or {}
    if "file" not in files:
        frappe.throw("No file uploaded.", title="Missing file")
    uploaded = files["file"]
    filename = uploaded.filename or ""
    _, ext = os.path.splitext(filename)
    if ext.lower() not in _ALLOWED_EXTENSIONS:
        frappe.throw(
            f"A Porter Statement is a .csv file. You uploaded a '{ext or 'file with no extension'}'.",
            title="Unsupported file type",
        )
    content = uploaded.read()
    if len(content) > _MAX_FILE_BYTES:
        frappe.throw(
            f"This file is {len(content) / (1024 * 1024):.1f} MB. Maximum is "
            f"{_MAX_FILE_BYTES // (1024 * 1024)} MB.",
            title="File too large",
        )
    return filename, content


def _read_statement(content: bytes) -> PorterStatement:
    """Parse with the Porter adapter, then group into invoices. Either step may refuse the file."""
    try:
        return read_porter_statement(parse_statement(content, source=SOURCE))
    except (StatementFormatError, PorterStatementError) as exc:
        frappe.throw(str(exc), title="Could not read this Porter Statement")


def _leave_out_repeats(statement: PorterStatement, filename: str) -> RepeatJudgement:
    """The invoice-level repeat rules (#1447), BEFORE `save_file`: the statement to stage, or a refusal."""
    try:
        return leave_out_repeats(statement, _held_invoices(statement), filename=filename)
    except PorterRepeatRefusal as exc:
        frappe.throw(str(exc), title="Already imported")


def _held_invoices(statement: PorterStatement) -> dict[str, HeldInvoice]:
    """Each invoice number of the file a Porter Invoice already holds: its import, whether that import has
    created anything, and the orders it staged under the invoice. Three queries, whatever the file."""
    numbers = [invoice.invoice_number for invoice in statement.invoices]
    held = frappe.get_all(INVOICE_DOCTYPE, filters={"name": ["in", numbers]}, fields=["name", "import_batch"])
    if not held:
        return {}
    created = created_imports(sorted({row.import_batch for row in held}))
    crns: dict[str, set[str]] = {row.name: set() for row in held}
    for row in frappe.db.sql(
        """SELECT porter_invoice, transfer_id FROM "tabOutflow Import Row" WHERE porter_invoice IN %s""",
        (tuple(crns),),
        as_dict=True,
    ):
        crns[row.porter_invoice].add(row.transfer_id)
    return {
        row.name: HeldInvoice(
            invoice_number=row.name,
            import_batch=row.import_batch,
            created=row.import_batch in created,
            crns=frozenset(crns[row.name]),
        )
        for row in held
    }


def created_imports(batches: list[str]) -> set[str]:
    """Which of these Porter imports Create has written to: any match (Settled, or Reversed by
    Unreconcile / Rectify) or any Porter Order. Both outlive every correction, so an import that has
    created once stays created -- past Discard (#1447), and its invoices left out of a re-upload."""
    if not batches:
        return set()
    return set(
        frappe.db.sql(
            """
            SELECT import_batch FROM "tabOutflow Row Match" WHERE import_batch IN %(batches)s
            UNION
            SELECT i.import_batch FROM "tabPorter Order" o
            JOIN "tabPorter Invoice" i ON i.name = o.porter_invoice
            WHERE i.import_batch IN %(batches)s
            """,
            {"batches": tuple(batches)},
            pluck=True,
        )
    )


def created_anything(batch: str) -> bool:
    """Create has written to this import: Discard is refused from here on (#1447)."""
    return batch in created_imports([batch])


def _won_project_index() -> ProjectIndex:
    """The existing name matcher's index over WON projects only, and no aliases (ADR-0032)."""
    won = frappe.db.sql(
        """SELECT name, project_name FROM "tabProjects" WHERE tendering_status = %s""",
        (_WON,),
        as_dict=True,
    )
    return build_project_index([(row["name"], row.get("project_name") or "") for row in won])


def _stage(
    statement: PorterStatement,
    index: ProjectIndex,
    file_url: str,
    filename: str,
    user: str,
    repeats_not_saved: int = 0,
) -> str:
    """The batch, its Porter Invoices and one line per order, in file order. Returns the batch name.

    `repeats_not_saved` counts the orders of the invoices left out as already created (ADR-0031's batch
    figure, written once here)."""
    batch = frappe.new_doc(BATCH_DOCTYPE)
    batch.update(
        {
            "source": SOURCE,
            "source_file": file_url,
            "original_filename": filename,
            "period_from": statement.period_from,
            "period_to": statement.period_to,
            # The completed orders' Porter fare: what the wallet paid. A cancelled order moved nothing.
            "gross_amount": float(statement.fare_total),
            "charges_amount": 0,
            "repeats_not_saved": repeats_not_saved,
            "uploaded_by": user,
            "uploaded_at": frappe.utils.now_datetime(),
            "status": "Draft",
        }
    )
    batch.insert(ignore_permissions=True)

    for invoice in statement.invoices:
        doc = frappe.new_doc(INVOICE_DOCTYPE)
        doc.update(
            {
                "invoice_number": invoice.invoice_number,
                "import_batch": batch.name,
                "invoice_link": invoice.invoice_link,
                "porter_gstin": invoice.porter_gstin,
                "customer_gstin": invoice.customer_gstin,
                "billing_entity": invoice.billing_entity,
                "city": invoice.city,
                "completed_orders": invoice.completed_orders,
                "fare_total": float(invoice.fare_total),
                "tax_total": float(invoice.tax_total),
                "validation_status": INVOICE_QUEUED,
            }
        )
        doc.insert(ignore_permissions=True)

    for line in statement.lines:
        row = line.row
        values = {
            "import_batch": batch.name,
            "source": SOURCE,
            "transfer_id": row.transfer_id,
            "added_on": row.added_on,
            "amount": float(row.amount),
            "status_raw": row.status_raw,
            "direction": row.direction or None,
            "beneficiary_name": row.beneficiary_name,
            "remarks": row.remarks,
            "added_by_raw": row.added_by_raw,
            # The CRN: a Porter order's only reference (`TRANSFER_ID_REFERENCE_SOURCES`), and what the
            # Expense's `payment_ref` will carry -- through the one ladder, never written by hand.
            "settlement_reference": resolve_settlement_reference(
                bank_reference_no=row.bank_reference_no,
                reference_id=row.reference_id,
                transfer_id=row.transfer_id,
                remarks=row.remarks,
                source=SOURCE,
            )
            or None,
            "porter_invoice": line.invoice_number,
            "porter_line": dict(line.statement),
        }
        if line.completed:
            placement = suggest_placement(row.remarks, index)
            values.update(
                {
                    "row_status": ROW_PENDING_MATCH,
                    "suggested_doctype": placement.ledger,
                    "resolved_project": placement.project,
                    "suggested_expense_type": placement.expense_type,
                    "placement_reason": placement.reason or None,
                    "placement_strength": placement.strength or None,
                    "match_basis": MATCH_BASIS,
                    "auto_matched": 1,
                }
            )
        else:
            values.update(
                {
                    "row_status": ROW_SKIPPED,
                    "skip_reason": SKIP_REASON_CANCELLED,
                    "skip_kind": SKIP_KIND_PORTER_CANCELLED,
                    "skip_origin": SKIP_ORIGIN_SYSTEM,
                }
            )
        doc = frappe.new_doc(ROW_DOCTYPE)
        doc.update(values)
        doc.insert(ignore_permissions=True)

    _refresh_batch_rollup(batch.name)
    return batch.name
