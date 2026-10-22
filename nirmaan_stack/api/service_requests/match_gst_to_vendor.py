# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Match GST to vendor, and the list of Work Orders it is for (#1538, ADR-0028 Amendment A).

GST follows the vendor: a Work Order's GST flag is on exactly when its vendor has a GST number. New
work gets it at approval; an existing Work Order never changes by itself. Accounts review the ones
that disagree and bring each into line here, one at a time, after seeing what it does to the money.

    get_gst_mismatch_work_orders()          -> [row]   Approved WOs whose flag disagrees with the vendor
    preview_match_gst_to_vendor(work_order) -> dict    before / after total and Amount Due; writes nothing
    match_gst_to_vendor(work_order)         -> dict    the same figures, after the change; commits

Admin and Accountants only (`role_profiles.MATCH_GST_TO_VENDOR_PROFILES`), checked here: the save
runs with `ignore_permissions`. The action only ever moves a WO towards its vendor's status. It
works on a Finalized WO too (owner decision). It meets the GST payment guard
(`integrations/controllers/service_requests.validate_gst_not_switched_off_with_gst_payments`):
GST can't go off while a GST payment exists. Each use writes an undeletable system remark on the WO,
beside the Version row the save leaves.
"""

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.services.outflow_import.amounts import rupees
from nirmaan_stack.services.role_profiles import assert_match_gst_to_vendor_access
from nirmaan_stack.services.work_order_gst import (
    GST_ON_SPELLINGS,
    gst_flag_for_vendor,
    gst_is_on,
    items_value,
    work_order_total,
)

SR = "Service Requests"
#: Only an Approved WO is matched. One waiting for approval gets its flag at approval; one in
#: Amendment is matched once its amendment is decided.
MATCHABLE_STATUS = "Approved"


@frappe.whitelist(methods=["GET"])
def get_gst_mismatch_work_orders() -> list:
    """Every Approved Work Order (Finalized included) whose GST flag disagrees with its vendor, both
    directions: GST off with a vendor that has a GST number, and GST on with one that has none.
    `gst_payments` counts the GST payments that would stop turning one off."""
    assert_match_gst_to_vendor_access(frappe.session.user)
    rows = frappe.db.sql(
        """
        SELECT s.name, s.project, p.project_name, s.vendor, v.vendor_name, v.vendor_gst, s.gst,
               COALESCE(s.is_finalized, 0) AS is_finalized,
               COALESCE(s.total_amount, 0) AS total_amount,
               COALESCE(s.amount_paid, 0) AS amount_paid,
               COALESCE(s.amount_due, 0) AS amount_due,
               s.creation,
               (SELECT COUNT(*) FROM "tabProject Payments" pp
                 WHERE pp.document_type = %(sr)s AND pp.document_name = s.name
                   AND pp.is_gst_payment = 1) AS gst_payments
        FROM "tabService Requests" s
        JOIN "tabVendors" v ON v.name = s.vendor
        LEFT JOIN "tabProjects" p ON p.name = s.project
        WHERE s.status = %(status)s
          AND (COALESCE(TRIM(v.vendor_gst), '') != '')
              != (LOWER(TRIM(COALESCE(s.gst, ''))) IN %(gst_on)s)
        ORDER BY s.creation, s.name
        """,
        {"sr": SR, "status": MATCHABLE_STATUS, "gst_on": GST_ON_SPELLINGS},
        as_dict=True,
    )
    for row in rows:
        row["target_gst"] = gst_flag_for_vendor(row.vendor_gst)
    return rows


@frappe.whitelist(methods=["GET"])
def preview_match_gst_to_vendor(work_order: str) -> dict:
    """What Match GST to vendor would do to `work_order`. Writes nothing."""
    assert_match_gst_to_vendor_access(frappe.session.user)
    return _figures(_load(work_order))


@frappe.whitelist(methods=["POST"])
def match_gst_to_vendor(work_order: str) -> dict:
    """Set `work_order`'s GST flag from its vendor's GST number, recount it, and record who did it."""
    user = frappe.session.user
    assert_match_gst_to_vendor_access(user)
    doc = _load(work_order, for_update=True)
    before = _figures(doc)
    if before["matches"]:
        frappe.throw(_("{0} already matches its vendor: GST Applicable is {1}.").format(
            work_order, _on_off(before["gst"])))
    if doc.status != MATCHABLE_STATUS:
        frappe.throw(_("Only an Approved Work Order can be matched; {0} is {1}.").format(work_order, doc.status))

    doc.gst = before["target_gst"]
    doc.flags.gst_set_from_vendor = True  # the lock in `controllers/service_requests` lets this one through
    doc.save(ignore_permissions=True)     # recounts total_amount and amount_due (`ServiceRequests.on_update`)
    after = _figures(_load(work_order))
    _record(work_order, user, before, after)
    frappe.db.commit()
    return after


def _load(work_order, *, for_update=False):
    if not work_order or not frappe.db.exists(SR, work_order):
        frappe.throw(_("Work Order {0} not found.").format(work_order), frappe.DoesNotExistError)
    return frappe.get_doc(SR, work_order, for_update=for_update)


def _figures(doc) -> dict:
    """The WO now and with its flag set from the vendor. Totals are recomputed from the items the way
    `ServiceRequests.calculate_total_amount` does; Amount Paid does not move."""
    vendor_gst = frappe.db.get_value("Vendors", doc.vendor, "vendor_gst") if doc.vendor else None
    target = gst_flag_for_vendor(vendor_gst)
    sub_total = items_value(doc.work_order_items)
    amount_paid = flt(doc.amount_paid)
    total_before = flt(doc.total_amount)
    total_after = flt(work_order_total(sub_total, target), 2)
    matches = gst_is_on(doc.gst) == gst_is_on(target)
    if matches:
        total_after = total_before
    blocked_by = []
    if gst_is_on(doc.gst) and not gst_is_on(target):
        blocked_by = frappe.get_all(
            "Project Payments",
            filters={"document_type": SR, "document_name": doc.name, "is_gst_payment": 1},
            pluck="name",
            order_by="creation asc",
        )
    return {
        "work_order": doc.name,
        "status": doc.status,
        "is_finalized": int(doc.is_finalized or 0),
        "vendor": doc.vendor,
        "vendor_name": frappe.db.get_value("Vendors", doc.vendor, "vendor_name") if doc.vendor else None,
        "vendor_gst": (vendor_gst or "").strip(),
        "gst": "true" if gst_is_on(doc.gst) else "false",
        "target_gst": target,
        "matches": matches,
        "total_before": total_before,
        "total_after": total_after,
        "amount_paid": amount_paid,
        "amount_due_before": flt(total_before - amount_paid, 2),
        "amount_due_after": flt(total_after - amount_paid, 2),
        "blocked_by": blocked_by,
    }


def _on_off(flag) -> str:
    return "ON" if gst_is_on(flag) else "OFF"


def _record(work_order, user, before, after):
    """An undeletable system remark, the same kind Finalize writes (`api/sr_finalize`)."""
    remark = frappe.new_doc("Nirmaan Comments")
    remark.update({
        "comment_type": "sr_remark",
        "reference_doctype": SR,
        "reference_name": work_order,
        "subject": "admin_remark",
        "comment_by": user,
        "is_system_generated": 1,
        # `content` is a 140-character Data field: who did it is `comment_by`, shown beside the remark.
        "content": _("Match GST to vendor: GST turned {0}. Total {1} → {2}; Amount Due {3} → {4}.").format(
            _on_off(after["gst"]),
            rupees(before["total_before"]), rupees(after["total_before"]),
            rupees(before["amount_due_before"]), rupees(after["amount_due_before"]),
        ),
    })
    remark.insert(ignore_permissions=True)
