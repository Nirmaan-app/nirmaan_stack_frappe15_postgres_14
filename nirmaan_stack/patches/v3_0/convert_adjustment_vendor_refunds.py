# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Turn the old "Adjust Payments" vendor refunds into Vendor Refunds (#1404, ADR-0032).

WHY THIS PATCH EXISTS
    Before #1400, "Adjust Payments" -> Vendor refund recorded money a vendor sent back as THREE
    records: a NEGATIVE Paid Project Payment on the PO, its "RA Vendor" Return term, and a
    `Vendor Refund` entry on the PO Adjustment pointing at that payment. ADR-0032 makes the Vendor
    Refund the only refund record, so these become ordinary Vendor Refunds. On the live site there
    are three (₹16,643): PO/393/00074/25-26, PO/104/00102/26-27, PO/124/00102/26-27.

WHAT EACH ONE BECOMES
    A Vendor Refund, Received with no bank line (`services/vendor_refunds.no_bank_line_values`,
    reason "migrated from Adjust Payments", the "No bank proof" badge until Bulk Import matches a bank
    line to it), on the payment's vendor, project and PO, for the entry's amount, dated the entry's
    refund date. Its UTR is the payment's, unless that is the `VR-<po>` placeholder the old flow wrote
    when proof was uploaded. Its proof is the entry's `refund_attachment`, else the payment's
    `payment_attachment` (accounts attached proof to the payment itself, e.g. PO/393/00074/25-26); the
    payment's File rows are moved onto the refund, because deleting the payment deletes its files. A
    refund with no proof anywhere keeps a blank `refund_attachment`: the refund row shows "No proof
    attached" under its "No bank proof" badge, so accounts can find it and attach one.
    The entry then points at the refund (`vendor_refund`) instead of the payment, and the payment and
    its term are removed.

WHY NOTHING MOVES
    The -X payment leaves (paid +X) and the +X Received refund arrives (paid -X), so the paid amount
    and amount due are unchanged. The entry keeps its +X: the refund sync step
    (`api/po_adjustments/refund_links.sync_po_refund_links`) links min(refund, unsettled balance),
    which is X here, so the adjustment balance is unchanged. Per PO, the paid amount, amount due and
    adjustment balance are read before and after; if any differs at the paisa, the patch throws and
    the migration rolls back, writing nothing.

IDEMPOTENT
    Only entries still in the old shape are read (`project_payment` set to a negative Paid payment, no
    `vendor_refund`); converting one clears `project_payment` and sets `vendor_refund`, so a second run
    finds nothing. One transaction, committed by `execute` only after every PO passed its check.

HOOKS SKIPPED ON PURPOSE (root CLAUDE.md rule 1), each recomputed from source here instead:
  * The RA Vendor term is deleted by raw DELETE, before the payment. A PO save would fire every PO
    hook for a 0 % Return row nothing derives from (percentages skip Return terms). Deleting the
    payment first would let its `on_trash` flip the term to a NEGATIVE Created term.
  * The payment is deleted with `ignore_on_trash`. Its on_trash would recompute `amount_paid` and
    COMMIT mid-patch (`ProjectPayments.update_parent_amount_paid`), recount vendor credit as "Payment
    Deleted", and touch TDS rows and comments. Here: `_recalculate_amount_paid` right after, the
    refund insert's hook recounts credit once ("Vendor Refund Recorded"), comments and notifications
    are deleted below, and a TDS row (adjustment payments never have one) or any other link makes
    Frappe's link check refuse the delete, which stops the patch. A Deleted Document row is kept.
  * The entry is re-pointed with `set_value`; the sync step then saves the adjustment if a link row
    changed, which recalculates its balance.
  * File rows are re-attached with `set_value`; a File save would re-run upload validation.

The `patches.txt` line sits under [post_model_sync], after the sync that adds `vendor_refund` and the
no-bank-line fields.
"""

import frappe
from frappe.utils import flt, now_datetime

from nirmaan_stack.api.po_adjustments._payment_utils import _recalculate_amount_paid
from nirmaan_stack.api.po_adjustments.refund_links import ENTRY_TYPE, PO_ADJUSTMENTS, sync_po_refund_links
from nirmaan_stack.services.vendor_refunds import (
    PROCUREMENT_ORDERS,
    VENDOR_REFUNDS,
    money,
    no_bank_line_values,
)

MIGRATION_REASON = "migrated from Adjust Payments"
ADJ_ITEM = "PO Adjustment Items"
PAYMENT = "Project Payments"
TERMS = "PO Payment Terms"


def execute():
    if not frappe.db.has_column(ADJ_ITEM, "vendor_refund") or not frappe.db.has_column(
        VENDOR_REFUNDS, "no_bank_line"
    ):
        print("convert_adjustment_vendor_refunds: vendor_refund / no_bank_line columns absent, skipping")
        return
    results = convert_adjustment_refunds()
    frappe.db.commit()
    for result in results:
        message = f"convert_adjustment_vendor_refunds: {result}"
        print(message)
        frappe.logger("vendor_refunds").info(message)
    print(f"convert_adjustment_vendor_refunds: {sum(len(r['refunds']) for r in results)} converted")


def convert_adjustment_refunds(pos: list[str] | None = None) -> list[dict]:
    """Convert every old-shape refund entry -- or only those on `pos`, which is what the tests pass so
    they never touch a PO they did not create. Returns one `{po, refunds, before, after}` per PO.
    Throws (and the caller rolls back) when a PO's paid amount, amount due or balance would move.
    Commits nothing."""
    by_po: dict[str, list] = {}
    for entry in _old_entries(pos):
        by_po.setdefault(entry.po, []).append(entry)

    results = []
    for po, entries in sorted(by_po.items()):
        before = _figures(po)
        refunds = [_convert(entry) for entry in entries]
        # The insert hook synced before the entry pointed at the refund; this lands the final links.
        sync_po_refund_links([po])
        after = _figures(po)
        if after != before:
            frappe.throw(
                f"Converting the Adjust Payments refund(s) on {po} would change its figures: "
                f"before {before}, after {after}. Nothing was converted."
            )
        results.append({"po": po, "refunds": refunds, "before": before, "after": after})
    return results


def _old_entries(pos: list[str] | None) -> list:
    if pos is not None and not pos:
        return []
    scope = "AND a.po_id IN %(pos)s" if pos is not None else ""
    return frappe.db.sql(
        f"""
        SELECT i.name, i.parent AS adjustment, i.amount, i.refund_date, i.refund_attachment,
               a.po_id AS po, p.name AS payment, p.vendor, p.project, p.utr,
               p.payment_attachment, p.payment_date
        FROM "tab{ADJ_ITEM}" i
        JOIN "tab{PO_ADJUSTMENTS}" a ON a.name = i.parent
        JOIN "tab{PAYMENT}" p ON p.name = i.project_payment
        WHERE i.parenttype = %(parenttype)s
          AND i.entry_type = %(entry_type)s
          AND COALESCE(i.vendor_refund, '') = ''
          AND p.document_type = %(po_doctype)s AND p.document_name = a.po_id
          AND p.status = 'Paid' AND p.amount < 0
          {scope}
        ORDER BY a.po_id, i.idx
        """,
        {
            "parenttype": PO_ADJUSTMENTS,
            "entry_type": ENTRY_TYPE,
            "po_doctype": PROCUREMENT_ORDERS,
            "pos": tuple(pos or ()),
        },
        as_dict=True,
    )


def _figures(po: str) -> dict:
    paid, due = frappe.db.get_value(PROCUREMENT_ORDERS, po, ["amount_paid", "amount_due"])
    balance = frappe.db.get_value(PO_ADJUSTMENTS, {"po_id": po}, "remaining_impact")
    return {"amount_paid": money(paid), "amount_due": money(due), "balance": money(balance)}


def _convert(entry) -> str:
    """One old entry -> one Vendor Refund. Returns the refund's name."""
    # 1. The term first: deleting the payment while the term links it would make it a Created term.
    frappe.db.delete(TERMS, {"parenttype": PROCUREMENT_ORDERS, "parent": entry.po, "project_payment": entry.payment})
    frappe.db.set_value(ADJ_ITEM, entry.name, "project_payment", None, update_modified=False)

    # 2. The payment, with the paid amount recomputed at once so the refund's cap reads true figures.
    proof = entry.refund_attachment or entry.payment_attachment
    files = frappe.get_all(
        "File", filters={"attached_to_doctype": PAYMENT, "attached_to_name": entry.payment}, pluck="name"
    )
    for file in files:  # detached while the payment goes (its delete removes its files); re-attached below
        frappe.db.set_value("File", file, {"attached_to_doctype": None, "attached_to_name": None})
    frappe.db.delete("Nirmaan Comments", {"reference_name": entry.payment})
    frappe.db.delete("Nirmaan Notifications", {"docname": entry.payment})
    frappe.delete_doc(PAYMENT, entry.payment, ignore_permissions=True, ignore_on_trash=True)
    _recalculate_amount_paid(entry.po)

    # 3. The refund. Its insert hook runs the sync step: paid amount, links, vendor credit.
    refund = frappe.get_doc({
        "doctype": VENDOR_REFUNDS,
        "vendor": entry.vendor,
        "project": entry.project,
        "document_type": PROCUREMENT_ORDERS,
        "document_name": entry.po,
        "amount": flt(entry.amount, 2),
        "payment_date": entry.refund_date or entry.payment_date,
        "utr": None if (entry.utr or "") == f"VR-{entry.po}" else entry.utr,
        "refund_attachment": proof,
        "description": f"Recorded in Adjust Payments as payment {entry.payment} ({entry.adjustment})",
        **no_bank_line_values(frappe.session.user, MIGRATION_REASON, now_datetime()),
    })
    refund.insert(ignore_permissions=True)
    for file in files:
        frappe.db.set_value("File", file, {
            "attached_to_doctype": VENDOR_REFUNDS,
            "attached_to_name": refund.name,
            "attached_to_field": "refund_attachment",
        })

    # 4. The entry now points at the refund.
    frappe.db.set_value(ADJ_ITEM, entry.name, "vendor_refund", refund.name, update_modified=False)
    return refund.name
