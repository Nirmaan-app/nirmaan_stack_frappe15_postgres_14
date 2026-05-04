# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Client-driven cleanup of attachments uploaded during an abandoned wizard
session.

Wizard uploads use the standard Frappe `File` doctype attached to the child
task row (mirrors `pages/inflow-payments`). The wizard tracks every File doc
it created; on Cancel / beforeunload it sends `keep_file_doc_names` (the names
referenced by the final committed `response_data`) and we delete the rest
scoped to this child row + the wizard's marker fieldname."""

from typing import Iterable, List, Union

import frappe

CHILD_DOCTYPE = "Commission Report Task Child Table"
WIZARD_FIELDNAME = "commission_report_image"


def _coerce_list(v: Union[str, Iterable[str], None]) -> List[str]:
    if not v:
        return []
    if isinstance(v, str):
        # Frappe transmits arrays as JSON strings.
        import json

        try:
            parsed = json.loads(v)
        except Exception:
            return []
        return [str(x) for x in parsed] if isinstance(parsed, list) else []
    return [str(x) for x in v]


@frappe.whitelist()
def delete_orphan_attachments(
    parent: str,
    task_row_name: str,
    keep_file_doc_names: Union[str, List[str], None] = None,
):
    """Deletes Frappe File rows attached to this child task row that are NOT
    in `keep_file_doc_names`. Best-effort — never raises on individual delete
    failures.

    `parent` is accepted for compatibility with the older API signature but is
    not used for the lookup — the File doctype's `attached_to_name` already
    pins us to the right child row."""
    if not parent or not task_row_name:
        frappe.throw("parent and task_row_name are required.")

    keep = set(_coerce_list(keep_file_doc_names))

    candidates = frappe.get_all(
        "File",
        filters={
            "attached_to_doctype": CHILD_DOCTYPE,
            "attached_to_name": task_row_name,
            "attached_to_field": WIZARD_FIELDNAME,
        },
        fields=["name"],
    )

    deleted = []
    for c in candidates:
        if c.name in keep:
            continue
        try:
            frappe.delete_doc("File", c.name, ignore_permissions=True)
            deleted.append(c.name)
        except Exception:
            # Best-effort — daily janitor will catch leftovers.
            continue

    if deleted:
        frappe.db.commit()

    return {"status": "success", "deleted_count": len(deleted), "deleted": deleted}
