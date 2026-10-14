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
           "vendor", "payee_name", "description", "attachment", "made_from")


def _full_names(users) -> dict:
    users = sorted({u for u in users if u})
    if not users:
        return {}
    return dict(frappe.get_all("User", filters={"name": ["in", users]}, fields=["name", "full_name"], as_list=True))


def _project_names(projects) -> dict:
    projects = sorted({p for p in projects if p})
    if not projects:
        return {}
    return dict(frappe.get_all("Projects", filters={"name": ["in", projects]}, fields=["name", "project_name"], as_list=True))


def _statuses(doctype: str, names) -> dict:
    names = sorted({n for n in names if n})
    if not names or not frappe.db.has_column(doctype, "status"):
        return {}
    return dict(frappe.get_all(doctype, filters={"name": ["in", names]}, fields=["name", "status"], as_list=True))


@frappe.whitelist()
def get_cheque(name: str) -> dict:
    """One Cheque as the detail view shows it.

    `lines` carry each payment's current `payment_status` and the project's `project_name`; `history` is oldest first, each row with
    the changer's full name. `bank_label` is the typed name for an Others bank.
    """
    assert_cheque_access(frappe.session.user)
    doc = frappe.get_doc(CHEQUES, name)
    out = {field: doc.get(field) for field in _HEADER}
    out["bank_label"] = bank_label(doc.bank or "", doc.bank_name)
    out["vendor_name"] = frappe.db.get_value("Vendors", doc.vendor, "vendor_name") if doc.vendor else None

    lines = doc.get("lines") or []
    statuses = {}
    for doctype in {row.payment_doctype for row in lines if row.payment_doctype}:
        statuses[doctype] = _statuses(doctype, [row.payment_name for row in lines if row.payment_doctype == doctype])
    project_names = _project_names(row.project for row in lines)
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
    names = _full_names([doc.owner] + [h.changed_by for h in history])
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
