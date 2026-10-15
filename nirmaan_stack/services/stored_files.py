# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Deleting uploaded `File`s without deleting bytes another `File` still serves.

The storage app keys a stored object by `content_hash` (`frappe_gcp_attachment` `delete_from_cloud`, the
`File` `on_trash` hook), with no check for other File rows: the same PDF uploaded twice is ONE stored
object behind two File rows, and trashing either through the document layer removes the bytes the other
still serves. CODING_STANDARDS § Deleting an uploaded File.

Used by the TDS datasheet delete (`api/tds/submit.delete_row_datasheet`) and the Porter import's Discard
(`api/outflow_import/porter_discard`).
"""

import frappe


def delete_files(filters: dict) -> int:
    """Delete every `File` matching `filters`. Returns how many File rows went.

    A File whose `content_hash` another File shares loses only its record, by a raw delete that skips the
    storage hook on purpose; the last File of a hash is trashed through the document layer, which removes
    its bytes. Files are taken one at a time, so two Files of the same hash in `filters` leave the bytes
    to the second, which then deletes them.

    ⚠️ No rollback restores storage: call this LAST, after every other write of the transaction.
    """
    files = frappe.get_all("File", filters=filters, fields=["name", "content_hash"], order_by="name asc")
    for file in files:
        shared = file.content_hash and frappe.db.exists(
            "File", {"content_hash": file.content_hash, "name": ["!=", file.name]}
        )
        if shared:
            frappe.db.delete("File", {"name": file.name})
        else:
            frappe.delete_doc("File", file.name, ignore_permissions=True)
    return len(files)
