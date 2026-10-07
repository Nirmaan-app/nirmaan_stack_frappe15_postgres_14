# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Lifecycle controller for the Material Test Certificate (MTC) doctype.

An MTC is one certificate file plus the Billable PO lines it covers. This controller
is the ENFORCEMENT boundary for every write path -- the SDK create, the
`update_mtc` endpoint, Desk and the delete -- because the doctype's Role rows
cannot express "Procurement, PMO, Admin only" (`System Manager` and
`Nirmaan Procurement Executive` also ride on the Project Lead profile).

The line rules live in `services/mtc_rules.py`.
"""

import frappe
from frappe import _
from frappe.utils import getdate, today

from nirmaan_stack.services import mtc_rules
from nirmaan_stack.services.role_profiles import can_manage_mtc

MTC = "Material Test Certificate"
MTC_ITEM = "Material Test Certificate Item"

_COPIED_FIELDS = ("item_name", "make", "category", "procurement_package")


def validate(doc, method=None):
    if not can_manage_mtc(frappe.session.user):
        frappe.throw(
            _("Only Procurement, PMO or Admin can upload or change a Material Test Certificate."),
            frappe.PermissionError,
        )

    po = _locked_po(doc.procurement_order)
    reason = mtc_rules.po_block_reason(po.billing_status, po.status)
    if reason:
        frappe.throw(_(reason))

    doc.project = po.project
    doc.vendor = po.vendor

    date_problem = mtc_rules.certificate_date_problem(
        getdate(doc.certificate_date) if doc.certificate_date else None, getdate(today())
    )
    if date_problem:
        frappe.throw(_(date_problem))

    rows = doc.get("items") or []
    if not rows:
        frappe.throw(_("Tick at least one item for this certificate."))

    lines = mtc_rules.billable_lines(po.get("items"))
    saved = _saved_rows(doc)
    taken = _lines_on_other_mtcs(po.name, doc.name)

    seen = set()
    for row in rows:
        key = mtc_rules.line_key(row.item_id, row.make)
        label = row.item_name or row.item_id
        if key in seen:
            frappe.throw(_("{0} is ticked twice.").format(label))
        seen.add(key)

        if key in taken:
            # No certificate number in the message: MTC ids are never shown to users (owner).
            frappe.throw(
                _("{0} is already on another certificate of this PO. An item can be on only one "
                  "certificate per PO.").format(label)
            )

        line = lines.get(key)
        if line:
            for field in _COPIED_FIELDS:
                row.set(field, line.get(field))
        elif key in saved:
            # Kept from an earlier save although a revision has since removed the line
            # (or made it Non-Billable): the row stays as it was saved (owner ruling Q14).
            for field in _COPIED_FIELDS:
                row.set(field, saved[key].get(field))
        else:
            frappe.throw(_("{0} is not a Billable item on this PO.").format(label))


def on_trash(doc, method=None):
    if not doc.flags.from_po_cleanup:
        if not can_manage_mtc(frappe.session.user):
            frappe.throw(
                _("Only Procurement, PMO or Admin can delete a Material Test Certificate."),
                frappe.PermissionError,
            )
        po = frappe.db.get_value(
            "Procurement Orders", doc.procurement_order, ["billing_status", "status"], as_dict=True
        )
        if po:
            reason = mtc_rules.po_block_reason(po.billing_status, po.status)
            if reason:
                frappe.throw(_(reason))

    # Same as the DC/MIR delete (`api/po_delivery_documentss.delete_po_delivery_documents`):
    # drop the File row with a raw delete. It deliberately does NOT fire File.on_trash, so
    # the cloud object is kept (owner ruling Q34). Scoped by url + PO so a file shared with
    # another document is never touched.
    if doc.attachment and doc.procurement_order:
        frappe.db.delete(
            "File", {"file_url": doc.attachment, "attached_to_name": doc.procurement_order}
        )


def delete_mtcs_for_po(po_name):
    """Delete every MTC of a PO that is being cancelled, deleted or merged (owner ruling Q21/Q28).

    Must run BEFORE the PO itself is deleted, so Frappe's link check does not block it.
    Skips the role / status checks in `on_trash` via `flags.from_po_cleanup`.
    """
    for name in frappe.get_all(MTC, filters={"procurement_order": po_name}, pluck="name"):
        frappe.delete_doc(
            MTC, name, force=True, ignore_permissions=True, flags={"from_po_cleanup": True}
        )


def _locked_po(po_name):
    """The PO, with its row locked for this transaction.

    Two uploads at the same moment would otherwise both pass the "line already on another
    MTC" check and claim the same line. The lock makes the second wait for the first.
    """
    if not po_name or not frappe.db.exists("Procurement Orders", po_name):
        frappe.throw(_("Purchase Order {0} not found.").format(po_name))
    frappe.db.sql('SELECT name FROM "tabProcurement Orders" WHERE name = %s FOR UPDATE', (po_name,))
    return frappe.get_doc("Procurement Orders", po_name)


def _saved_rows(doc) -> dict:
    """This MTC's rows as currently stored, keyed by line. Empty for a new MTC."""
    if doc.is_new():
        return {}
    rows = frappe.get_all(
        MTC_ITEM,
        filters={"parent": doc.name, "parenttype": MTC},
        fields=["item_id", *_COPIED_FIELDS],
    )
    return {mtc_rules.line_key(r.item_id, r.make): r for r in rows}


def _lines_on_other_mtcs(po_name, own_name) -> dict:
    """Lines of this PO already on another MTC, keyed by line -> that MTC's name."""
    rows = frappe.db.sql(
        """
        SELECT i.item_id, i.make, m.name
        FROM "tabMaterial Test Certificate Item" i
        JOIN "tabMaterial Test Certificate" m ON m.name = i.parent
        WHERE i.parenttype = %s AND m.procurement_order = %s AND m.name != %s
        """,
        (MTC, po_name, own_name or ""),
        as_dict=True,
    )
    return {mtc_rules.line_key(r.item_id, r.make): r.name for r in rows}
