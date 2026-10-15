# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""An expense's `File`s, and the one stored PDF many Porter Expenses share (spec #1442 story 52, ADR-0032).

Every Porter Expense of one Porter Invoice carries that invoice's PDF URL in `invoice_attachment`; the
PDF itself is ONE `File`, attached to its Porter Invoice. The storage app deletes a stored object by its
key with no check for other rows (CODING_STANDARDS § Deleting an uploaded File), so a second `File` row
for the PDF -- owned by an expense -- would let deleting that expense take the PDF from every expense of
the invoice and from the Porter Invoice itself. Two hooks keep that from happening:

  * `refuse_invoice_pdf_copy` (`File` `before_insert`): no expense ever owns a `File` for the shared PDF.
    Frappe's `"*"` `on_update` hook (`file.utils.attach_files_to_document`) mints one for any Attach value
    under `/files` or `/private/files` on EVERY save -- on a local-disk site, a description edit is
    enough. That hook catches the refusal and records an Error Log titled "Error Attaching File"; the
    save itself goes through. (On a cloud site the URL is an `/api/method/...` link and no copy is ever
    attempted.)
  * `delete_attached_files` (`after_delete`, both expense doctypes): an expense's own Files go through
    `services/stored_files.delete_files`, so a File sharing its bytes with another loses only its record.
    Every delete of an expense goes through here: the list pages' delete, Unreconcile's
    `delete_created`, and Rectify (which deletes the replaced expense through `delete_created`). It runs
    AFTER the link checks (`after_delete`, not `on_trash`), so a refused delete deletes no bytes, and
    before Frappe's own `remove_all`, which then finds nothing left to trash.
"""

import frappe

from nirmaan_stack.api.outflow_import.porter_expense import is_invoice_pdf
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.stored_files import delete_files

INVOICE_PDF_COPY_REFUSAL = (
    "A Porter invoice PDF stays attached to its Porter Invoice only; an expense carries its link, never a "
    "File of its own."
)


def refuse_invoice_pdf_copy(doc, method=None):
    """`File` `before_insert`: refuse a File that would attach a Porter invoice PDF to an expense.

    Raised directly, not through `frappe.throw`: the caller that tries it is Frappe's attach hook, which
    swallows the error, and a `msgprint` would pop a red dialog on an ordinary expense save.
    """
    if doc.attached_to_doctype in EXPENSE_DOCTYPES and is_invoice_pdf(doc.file_url):
        raise frappe.ValidationError(INVOICE_PDF_COPY_REFUSAL)


def delete_attached_files(doc, method=None):
    """`after_delete` of both expense doctypes: their Files, through the shared-bytes-safe delete."""
    delete_files({"attached_to_doctype": doc.doctype, "attached_to_name": doc.name})
