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
    validate  (#1444)  download each invoice PDF, read it with Gemini, compare
    review    (#1447 / #1448)  correct each completed order's project
    create    (#1445)  one Expense per completed order, at Paid
    rectify / discard  (#1449 / #1446)

⚠️ IT NEVER RUNS THE MATCHER. A Porter line creates its expense and settles nothing; `match_batch`
and every other settlement entry point are out of reach (`NEVER_MATCHED_SOURCES`, and an AST test).
The generic Cashfree/ICICI upload is not reused either: it assumes matching, and it refuses this source.

⚠️ NOTHING IS SAVED BEFORE THE WHOLE FILE IS READ. `save_file` commits inside the request (the cloud
attachment hook), so every refusal -- a missing column, no rows, an invoice whose lines disagree, an
invoice already uploaded -- happens before it.

⚠️ ITS OPEN LINES ARE NOT BANK LINES. Until Create settles them they are outside the main table's
population (`review._row_filters`), so they are in no tab, not in *Still open* and not in *Total
Unreconciled Outflow*; and every main-table action refuses them (`sources.CREATE_GATED_SOURCES`).
"""

import os

import frappe
from frappe.utils.file_manager import save_file

from nirmaan_stack.api.outflow_import.expenses import _refresh_batch_rollup
from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.services.outflow_import.parser import StatementFormatError, parse_statement
from nirmaan_stack.services.outflow_import.porter import (
    MATCH_BASIS,
    SKIP_REASON_CANCELLED,
    PorterStatement,
    PorterStatementError,
    read_porter_statement,
    suggest_placement,
)
from nirmaan_stack.services.outflow_import.project_match import ProjectIndex, build_project_index
from nirmaan_stack.services.outflow_import.settlement_reference import (
    resolve_settlement_reference,
)
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_PORTER_CANCELLED
from nirmaan_stack.services.outflow_import.sources import PORTER_STATEMENT_SOURCE
from nirmaan_stack.services.outflow_import.status import (
    ROW_PENDING_MATCH,
    ROW_SKIPPED,
    SKIP_ORIGIN_SYSTEM,
)

BATCH_DOCTYPE = "Outflow Import Batch"
ROW_DOCTYPE = "Outflow Import Row"
INVOICE_DOCTYPE = "Porter Invoice"
SOURCE = PORTER_STATEMENT_SOURCE

#: A Porter Invoice's state before validation has looked at it (#1444 moves it on).
INVOICE_QUEUED = "Queued"

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
    GSTIN / billing entity, and an invoice already held by another import.

    Saves: the CSV (private, attached to the batch); the batch, its period the first to the last order
    completion date; one line per order -- a cancelled order skipped and locked, a completed one pending
    with its starting project suggestion; and one Porter Invoice per invoice link, `Queued`.
    """
    user = require_outflow_access()
    filename, content = _read_upload()
    statement = _read_statement(content)
    _refuse_invoices_already_uploaded(statement)
    index = _won_project_index()

    # ⚠️ THE FIRST WRITE, AND IT CANNOT BE ROLLED BACK: everything that can refuse has run above.
    saved = save_file(fname=filename, content=content, dt=None, dn=None, is_private=1)
    batch = _stage(statement, index, file_url=saved.file_url, filename=filename, user=user)
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
    return porter_status(batch)


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
        ["name", "original_filename", "period_from", "period_to", "gross_amount"],
        as_dict=True,
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
            }
            for invoice in invoices
        ],
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


def _refuse_invoices_already_uploaded(statement: PorterStatement) -> None:
    """An invoice number is a Porter Invoice's identity: one already held by an import refuses the file.

    ⚠️ THE MINIMAL RULE, BEFORE `save_file`. #1446 replaces it with the full invoice-level repeat rules
    (an already-created invoice left out and counted, a changed one blocked, an uncreated import's
    "open it or discard it").
    """
    numbers = [invoice.invoice_number for invoice in statement.invoices]
    held = frappe.get_all(
        INVOICE_DOCTYPE,
        filters={"name": ["in", numbers]},
        fields=["name", "import_batch"],
        order_by="name asc",
    )
    if held:
        named = ", ".join(f"{row.name} ({row.import_batch})" for row in held)
        frappe.throw(
            f"Already uploaded in {held[0].import_batch}: Porter Invoice {named}.",
            title="Already uploaded",
        )


def _won_project_index() -> ProjectIndex:
    """The existing name matcher's index over WON projects only, and no aliases (ADR-0032)."""
    won = frappe.db.sql(
        """SELECT name, project_name FROM "tabProjects" WHERE tendering_status = %s""",
        (_WON,),
        as_dict=True,
    )
    return build_project_index([(row["name"], row.get("project_name") or "") for row in won])


def _stage(
    statement: PorterStatement, index: ProjectIndex, file_url: str, filename: str, user: str
) -> str:
    """The batch, its Porter Invoices and one line per order, in file order. Returns the batch name."""
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
            "repeats_not_saved": 0,
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
