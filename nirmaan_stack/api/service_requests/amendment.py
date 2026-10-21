# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Revert a Work Order's amendment (#1540, GLOSSARY *Amendment (of a Work Order)*).

    revert_amendment(work_order) -> {"name"}

Writes back what the amend save changed, read from the amendment snapshot
(`services/work_order_amendment.pre_amendment_values`): items, vendor, categories and Nirmaan GST, and
moves the Work Order back to Approved. Accepting needs no endpoint: it is the plain status move, from the
approve screen, Desk or REST.

The save is the user's own (`doc.save()`, permission-checked), so the lifecycle guard decides who may
revert (Admin, Project Lead) and holds it to the amendment rules. `flags.amendment_outcome` = Reverted
marks the snapshot (`ServiceRequests.on_update`).
"""

import frappe
from frappe import _

from nirmaan_stack.services.work_order_amendment import REVERTED, pending_snapshot, pre_amendment_values

SR = "Service Requests"


@frappe.whitelist(methods=["POST"])
def revert_amendment(work_order: str) -> dict:
    doc = frappe.get_doc(SR, work_order)
    if doc.status != "Amendment":
        frappe.throw(_("{0} is not under amendment, so there is nothing to revert.").format(work_order))
    snapshot = pending_snapshot(work_order)
    if not snapshot:
        frappe.throw(
            _("{0} has no amendment snapshot on record, so it can't be reverted. Accept it, or amend it "
              "again by hand.").format(work_order)
        )
    doc.update(pre_amendment_values(snapshot["data"], [row.as_dict() for row in doc.work_order_items]))
    doc.status = "Approved"
    doc.flags.amendment_outcome = REVERTED
    doc.save()
    return {"name": doc.name}
