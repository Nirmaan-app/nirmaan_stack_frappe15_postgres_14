# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Discard a Porter import that was never created (#1447, spec #1442 stories 68-69, ADR-0032).

Before Create, a Porter import is only its batch, its lines, its Porter Invoices and their PDFs (plus the
CSV). Discard removes exactly those, so a bad upload -- one that failed validation, one stuck Validating
because its worker died, or one simply abandoned -- can be cleared and the statement uploaded again.

⚠️ REFUSED ONCE CREATE HAS CREATED ANYTHING (`created_anything`): a half-created import is corrected
with Rectify / Unreconcile, never wiped, because its expenses are real spend with live matches.
⚠️ REFUSED WHILE A JOB OF THE IMPORT IS QUEUED OR RUNNING: validation would store a PDF for an invoice
that no longer exists, and Create would write expenses for lines being deleted. A worker that died
leaves no job behind, so a stuck import passes this check.
"""

import frappe
from frappe.utils.background_jobs import is_job_enqueued

from nirmaan_stack.api.outflow_import.permissions import has_outflow_undo_access, require_outflow_access
from nirmaan_stack.api.outflow_import.porter_records import (
    BATCH_DOCTYPE,
    INVOICE_DOCTYPE,
    ROW_DOCTYPE,
    create_job_id,
    created_anything,
    refuse_unless_porter_import,
)
from nirmaan_stack.api.outflow_import.porter_validation import validation_job_id
from nirmaan_stack.services.stored_files import delete_files


@frappe.whitelist(methods=["POST"])
def discard_porter_import(batch: str):
    """Delete a Porter import that Create has not written to: its batch, lines, Porter Invoices and Files.

    URL: /api/method/nirmaan_stack.api.outflow_import.porter_discard.discard_porter_import  (POST `batch`)

    Admin and Accountant Lead only (the undo-access check). Returns `{"batch": <name>}`.

    Refused, with nothing deleted: not a Porter import; Create has created anything; a validation or
    Create job of the import is still queued or running.

    ⚠️ RAW DELETES, ON PURPOSE. None of these doctypes has `doc_events` and nothing is derived from them
    elsewhere (the import's state and counters live on the batch being deleted). `frappe.delete_doc`
    would also trash each record's attached Files through the document layer, deleting stored bytes
    another File may share; the Files go last, through `stored_files.delete_files`, which never does.
    """
    user = require_outflow_access()
    if not has_outflow_undo_access(user):
        frappe.throw(
            "Only an Admin or an Accountant Lead can discard a Porter import.",
            frappe.PermissionError,
            title="Not permitted",
        )

    # The batch row lock serialises two Discards; the line locks wait for a Create line in flight, so
    # what `created_anything` reads below is what that line committed.
    refuse_unless_porter_import(batch, for_update=True)
    rows = frappe.db.sql(
        """SELECT name FROM "tabOutflow Import Row" WHERE import_batch = %s FOR UPDATE""",
        (batch,),
        pluck=True,
    )
    invoices = frappe.get_all(INVOICE_DOCTYPE, filters={"import_batch": batch}, pluck="name")

    if created_anything(batch):
        frappe.throw(
            f"{batch} cannot be discarded: Create has already created expenses from it. Correct its "
            "lines with Rectify or Unreconcile instead.",
            title="Cannot discard",
        )
    jobs = [create_job_id(batch), validation_job_id(batch)]
    jobs += [validation_job_id(batch, invoice) for invoice in invoices]
    running = [job for job in jobs if is_job_enqueued(job)]
    if running:
        frappe.throw(
            f"{batch} is still being worked on in the background ({', '.join(running)}). Wait for it to "
            "finish, then discard it.",
            title="Cannot discard yet",
        )

    _delete_records(batch, rows, invoices)
    # LAST: no rollback restores a stored object.
    delete_files({"attached_to_doctype": INVOICE_DOCTYPE, "attached_to_name": ["in", invoices or [""]]})
    delete_files({"attached_to_doctype": BATCH_DOCTYPE, "attached_to_name": batch})
    frappe.db.commit()
    return {"batch": batch}


def _delete_records(batch: str, rows: list[str], invoices: list[str]) -> None:
    """The lines, the Porter Invoices and the batch, with their Version and Comment rows."""
    for doctype, names in ((ROW_DOCTYPE, rows), (INVOICE_DOCTYPE, invoices), (BATCH_DOCTYPE, [batch])):
        if not names:
            continue
        frappe.db.delete("Version", {"ref_doctype": doctype, "docname": ["in", names]})
        frappe.db.delete("Comment", {"reference_doctype": doctype, "reference_name": ["in", names]})
        frappe.db.delete(doctype, {"name": ["in", names]})
