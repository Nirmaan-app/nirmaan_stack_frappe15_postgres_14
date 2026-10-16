# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Porter upload, step by step (#1443, #1447, #1448, ADR-0032): what `porter.upload_porter_statement`
calls, in order.

    read_upload              the posted CSV's name and bytes (refuses anything but a .csv)
    read_statement           parse and group into Porter Invoices, or refuse the file
    leave_out_porter_repeats the invoice-level repeat rules (`porter_repeats`), or refuse
    placement_master         everything placement reads, once per upload
    stage                    the batch, its Porter Invoices and one line per order

⚠️ NOTHING IS SAVED BEFORE THE WHOLE FILE IS READ. Every step before `stage` only reads or refuses: the
endpoint saves the CSV (which commits inside the request) between them and `stage`.
"""

import os

import frappe

from nirmaan_stack.api.outflow_import.porter_records import (
    BATCH_DOCTYPE,
    ROW_DOCTYPE,
    SOURCE,
    created_imports,
    won_projects,
)
from nirmaan_stack.api.outflow_import.review import refresh_batch_rollup
from nirmaan_stack.services.outflow_import.parser import StatementFormatError, parse_statement
from nirmaan_stack.services.outflow_import.porter import (
    INVOICE_DOCTYPE,
    MATCH_BASIS,
    PorterStatement,
    PorterStatementError,
    read_porter_statement,
)
from nirmaan_stack.services.outflow_import.porter_placement import (
    EarlierPlacement,
    OrderFacts,
    PlacementMaster,
    SiteAddress,
    build_placement_master,
    place_orders,
)
from nirmaan_stack.services.outflow_import.porter_repeats import (
    HeldInvoice,
    PorterRepeatRefusal,
    RepeatJudgement,
    leave_out_repeats,
)
from nirmaan_stack.services.outflow_import.porter_state import INVOICE_QUEUED
from nirmaan_stack.services.outflow_import.settlement_reference import (
    resolve_settlement_reference,
)
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_PORTER_CANCELLED
from nirmaan_stack.services.outflow_import.status import (
    ROW_PENDING_MATCH,
    ROW_SKIPPED,
    SKIP_ORIGIN_SYSTEM,
    SKIP_REASON_PORTER_CANCELLED,
)

#: Porter's statement is a CSV export (spec #1442); anything else is refused unread.
_ALLOWED_EXTENSIONS = frozenset({".csv"})
_MAX_FILE_BYTES = 5 * 1024 * 1024


def read_upload() -> tuple[str, bytes]:
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


def read_statement(content: bytes) -> PorterStatement:
    """Parse with the Porter adapter, then group into invoices. Either step may refuse the file."""
    try:
        return read_porter_statement(parse_statement(content, source=SOURCE))
    except (StatementFormatError, PorterStatementError) as exc:
        frappe.throw(str(exc), title="Could not read this Porter Statement")


def leave_out_porter_repeats(statement: PorterStatement, filename: str) -> RepeatJudgement:
    """The invoice-level repeat rules (#1447), BEFORE `save_file`: the statement to stage, or a refusal."""
    try:
        return leave_out_repeats(statement, held_invoices(statement), filename=filename)
    except PorterRepeatRefusal as exc:
        frappe.throw(str(exc), title="Already imported")


def held_invoices(statement: PorterStatement) -> dict[str, HeldInvoice]:
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


def placement_master() -> PlacementMaster:
    """Everything placement reads, read ONCE per upload (#1448): the WON projects with their site
    addresses, and every earlier Porter order's current placement. No aliases, no AI (ADR-0032).

    Signal 5 reads, per earlier `Porter Order`, its `remark` and `city` and the LIVE Expense that links
    to it (`porter_order` on `Project Expenses` -> its `projects`; on `Non Project Expenses` -> no
    project). The Expense owns the link, so a Rectify (#1449) that replaces the Expense is seen as the
    new placement, and an Unreconcile that deletes it leaves the order out.
    """
    won = won_projects()
    sites = (
        frappe.db.sql(
            """
            SELECT p.name, a.address_line1, a.address_line2, a.city, a.state, a.country, a.pincode
            FROM "tabProjects" p
            JOIN "tabAddress" a ON a.name = p.project_address
            WHERE p.name IN %s
            """,
            (tuple(p["name"] for p in won),),
            as_dict=True,
        )
        if won
        else []
    )
    earlier = frappe.db.sql(
        """
        SELECT o.remark, o.city, e.projects AS project
        FROM "tabPorter Order" o JOIN "tabProject Expenses" e ON e.porter_order = o.name
        UNION ALL
        SELECT o.remark, o.city, NULL AS project
        FROM "tabPorter Order" o JOIN "tabNon Project Expenses" e ON e.porter_order = o.name
        """,
        as_dict=True,
    )
    return build_placement_master(
        [(p["name"], p["project_name"]) for p in won],
        sites=[
            SiteAddress(
                project=row.name,
                address_line1=row.address_line1 or "",
                address_line2=row.address_line2 or "",
                city=row.city or "",
                state=row.state or "",
                country=row.country or "",
                pincode=row.pincode or "",
            )
            for row in sites
            if row.address_line1 or row.address_line2 or row.pincode
        ],
        earlier=[
            EarlierPlacement(remark=row.remark or "", city=row.city or "", project=row.project or None)
            for row in earlier
        ],
    )


def stage(
    statement: PorterStatement,
    master: PlacementMaster,
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

    # Placed together, not line by line: an order's suggestion depends on its remark group's.
    placements = place_orders(
        [
            OrderFacts(
                name=line.crn,
                remarks=line.row.remarks or "",
                city=line.statement.get("city", ""),
                from_address=line.statement.get("from_address", ""),
                to_address=line.statement.get("to_address", ""),
            )
            for line in statement.completed
        ],
        master,
    )

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
            placement = placements[line.crn]
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
                    "skip_reason": SKIP_REASON_PORTER_CANCELLED,
                    "skip_kind": SKIP_KIND_PORTER_CANCELLED,
                    "skip_origin": SKIP_ORIGIN_SYSTEM,
                }
            )
        doc = frappe.new_doc(ROW_DOCTYPE)
        doc.update(values)
        doc.insert(ignore_permissions=True)

    refresh_batch_rollup(batch.name)
    return batch.name
