# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Storing bytes our code holds as a `File`, and deleting uploaded `File`s without deleting bytes another
`File` still serves. CODING_STANDARDS § Storing an uploaded File, § Deleting an uploaded File.

`store_file` is the one way this app writes bytes it holds (a downloaded bill, a merged PDF, a statement
read off the request) as a File; `services/test_stored_files_guard` refuses Frappe's legacy
`frappe.utils.file_manager.save_file` anywhere else, because that helper wrote the bytes to disk itself
and then inserted a File whose own `before_insert` wrote them again under a suffixed name. Only the second
copy is the one `file_url` names, so only it was uploaded and removed by the storage app, and the first
stayed on the server's disk with no File row: 1,301 orphans from one Cashbook import on 2026-11-07.

The storage app keys a stored object by `content_hash` (`frappe_gcp_attachment` `delete_from_cloud`, the
`File` `on_trash` hook), with no check for other File rows: the same PDF uploaded twice is ONE stored
object behind two File rows, and trashing either through the document layer removes the bytes the other
still serves. `delete_files` is used by the TDS datasheet delete (`api/tds/submit.delete_row_datasheet`),
the Porter import's Discard (`api/outflow_import/porter_discard`) and every expense delete
(`integrations/controllers/expense_files`).
"""

import frappe
from frappe.utils.file_manager import check_max_file_size


def store_file(fname: str, content: bytes | str, dt: str | None = None, dn: str | None = None, *,
               df: str | None = None, is_private: int = 1):
    """Store `content` as a File named `fname`, attached to `dt` / `dn` (its field `df`) when given, and return
    the File. The File writes the bytes to disk ONCE, in its own `before_insert`; the storage app's
    `after_insert` hook then uploads that file, rewrites `file_url` on the row and on the returned doc, commits,
    and removes the local copy.

    ⚠️ NOT ROLLBACK-ABLE: the hook commits inside the call, so every refusal runs before it.

    The size limit is the legacy helper's (`site_config` `max_file_size`, else 10 MB), kept so no caller
    accepts a file it refused before; the File's own limit is looser (System Settings, else 25 MB).
    """
    check_max_file_size(content)
    doc = frappe.get_doc(
        {
            "doctype": "File",
            "file_name": fname,
            "content": content,
            "is_private": is_private,
            "attached_to_doctype": dt,
            "attached_to_name": dn,
            "attached_to_field": df,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc


def delete_files(filters: dict) -> int:
    """Delete every `File` matching `filters`. Returns how many File rows went.

    A File whose `content_hash` another File shares loses only its record, by a raw delete that skips the
    storage hook on purpose; the last File of a hash is trashed through the document layer, which removes
    its bytes. Files are taken one at a time, so two Files of the same hash in `filters` leave the bytes
    to the second, which then deletes them.

    ⚠️ No rollback restores storage: call this LAST, after every other write of the transaction. The one
    exception is an expense's own Files, deleted from its `after_delete` hook where Frappe's `remove_all`
    would trash them at the same point anyway (`integrations/controllers/expense_files`).
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
