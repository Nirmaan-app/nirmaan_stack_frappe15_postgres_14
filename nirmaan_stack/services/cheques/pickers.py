# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What the cheque dialogs' pickers offer (spec #1407, #1477). Reads only.

A Payment cheque's lines are never picked: it is made with its one payment on the PO page, and its Edit
leaves its lines alone (spec #1514).

A Security Deposit cheque's "Secures" picker (#1486): `securable_records` -- the Vendor's open POs, then its
open Work Orders, each with its project. A Work Order is paid Online, never by cheque, but its Vendor may hold
a deposit for it (ADR-0035 Amendment C).

The same rules are enforced on save (`lines.lines_problem`); these lists only spare the user a refusal.
"""

import frappe

from nirmaan_stack.services.cheques.rules import PO_DOCTYPE, WORK_ORDER_DOCTYPE

#: A PO in these statuses holds no payment of its own any more.
PO_CLOSED_STATUSES = ("Merged", "Cancelled")
#: A Work Order is a live order of its Vendor once approved (amended ones too).
WO_OPEN_STATUSES = ("Approved", "Amendment")


def _project_names(projects) -> dict:
    projects = sorted({p for p in projects if p})
    return dict(
        frappe.get_all("Projects", filters={"name": ["in", projects]}, fields=["name", "project_name"], as_list=True)
    ) if projects else {}


def securable_records(vendor: str) -> list[dict]:
    """`[{doctype, name, project, project_name, status}]`: the Vendor's open POs, then its open Work Orders,
    each newest first. What a Security Deposit cheque may name as secured (#1486, ADR-0035 Amendment C)."""
    pos = frappe.get_all(
        PO_DOCTYPE, filters={"vendor": vendor, "status": ["not in", PO_CLOSED_STATUSES]},
        fields=["name", "project", "status"], order_by="creation desc",
    )
    wos = frappe.get_all(
        WORK_ORDER_DOCTYPE, filters={"vendor": vendor, "status": ["in", WO_OPEN_STATUSES]},
        fields=["name", "project", "status"], order_by="creation desc",
    )
    names = _project_names(r.project for r in pos + wos)
    return [
        {"doctype": doctype, "name": r.name, "project": r.project,
         "project_name": names.get(r.project) or r.project, "status": r.status}
        for doctype, rows in ((PO_DOCTYPE, pos), (WORK_ORDER_DOCTYPE, wos))
        for r in rows
    ]
