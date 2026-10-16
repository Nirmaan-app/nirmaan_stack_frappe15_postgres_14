# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cheque detail view: photo, header, lines and full status history (#1412, spec #1407).

Read-only. Who: `CHEQUE_ACCESS_PROFILES` (Project Managers are refused).
"""

import frappe

from nirmaan_stack.services.cheques.rules import bank_label
from nirmaan_stack.services.cheques.writer import CHEQUES
from nirmaan_stack.services.role_profiles import assert_cheque_access

_HEADER = ("name", "creation", "owner", "cheque_no", "bank", "bank_name", "cheque_date", "amount", "status",
           "vendor", "payee_name", "description", "attachment", "made_from", "cheque_type", "old_type")


def _name_map(doctype: str, field: str, names) -> dict:
    """`{name: field}` for the given `names` of `doctype`; empty when `doctype` has no `field`."""
    names = sorted({n for n in names if n})
    if not names or not frappe.db.has_column(doctype, field):
        return {}
    return dict(frappe.get_all(doctype, filters={"name": ["in", names]}, fields=["name", field], as_list=True))


@frappe.whitelist()
def get_cheque(name: str) -> dict:
    """One Cheque as the detail view shows it.

    `lines` carry each payment's current `payment_status` and the project's `project_name`; `history`
    is oldest first, each row with the changer's full name. `bank_label` is the typed name for an
    Others bank.
    """
    assert_cheque_access(frappe.session.user)
    doc = frappe.get_doc(CHEQUES, name)
    out = {field: doc.get(field) for field in _HEADER}
    out["bank_label"] = bank_label(doc.bank or "", doc.bank_name)
    out["vendor_name"] = frappe.db.get_value("Vendors", doc.vendor, "vendor_name") if doc.vendor else None

    lines = doc.get("lines") or []
    statuses = {}
    for doctype in {row.payment_doctype for row in lines if row.payment_doctype}:
        payments = [row.payment_name for row in lines if row.payment_doctype == doctype]
        statuses[doctype] = _name_map(doctype, "status", payments)
    project_names = _name_map("Projects", "project_name", (row.project for row in lines))
    out["lines"] = [
        {
            "idx": row.idx,
            "line_type": row.line_type,
            "project": row.project,
            "project_name": project_names.get(row.project),
            "record_doctype": row.record_doctype,
            "record_name": row.record_name,
            "payment_doctype": row.payment_doctype,
            "payment_name": row.payment_name,
            "payment_status": statuses.get(row.payment_doctype, {}).get(row.payment_name),
            "amount": row.amount,
        }
        for row in lines
    ]

    history = doc.get("status_history") or []
    names = _name_map("User", "full_name", [doc.owner] + [h.changed_by for h in history])
    out["owner_name"] = names.get(doc.owner)
    out["history"] = [
        {
            "from_status": h.from_status,
            "to_status": h.to_status,
            "changed_by": h.changed_by,
            "changed_by_name": names.get(h.changed_by),
            "changed_at": h.changed_at,
            "note": h.note,
        }
        for h in history
    ]
    return out
