# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Undo a Work Order payment's TDS: two Admin actions (owner 2026-10-27).

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet family.

Approval cuts an ordinary Work Order payment to the net (Rs 10,000 -> Rs 9,800 + Rs 200 TDS,
`payment_tds.write_deduction`). Two actions undo that:

  * *Company Bears TDS* (`company_bears_tds`) puts the payment back to its full request and keeps the
    deduction, `borne_by` Vendor -> Company: the company deposits the Rs 200 on top, as on a Misc /
    Transport Work Order at approval.
  * *Mark as Deposit* (`mark_as_deposit`) deletes the deduction: no tax is recorded or deposited.
    - On a CUT payment (`borne_by` Vendor) it also puts the payment back to its full request.
    - On a payment the company already bears the tax of (`borne_by` Company: after *Company Bears TDS*,
      or a Misc / Transport Work Order's) the payment already is the full request, so only the deduction
      goes.

WHEN. Raising a cut payment changes what the vendor is paid, so that needs the payment `Approved`, its
money not yet out, and not on a cheque (`refuse_unless_cut_undoable`): from `Reconciliation Pending` on
the money has left the bank (`settlement.SETTLED_STATUSES`), and a cheque is written for the net (its line
and total, which clearing checks). Removing a company-borne deduction changes no payment figure, so it is
allowed up to `Reconciliation Pending`; never on a `Paid` payment (owner 2026-10-27: a Paid payment shows
neither action). Either way the tax must not be paid yet: once its deduction is in a challan it is
deposited and stays (`refuse_if_tds_paid`, #1535). Replaces the #1537 action *TDS paid by
company*, which moved no figure and so left Amount Due = the tax on a cut payment.

WHY `db_set` ON THE PAYMENT. A doc-layer save of the payment would run its `validate`, which refuses
raising a cut payment (`payment_tds.refuse_raise_after_cut`, the very cut this undoes), and its
`on_update`, which restates the tax from the new amount. Neither applies: the deduction already holds the
gross and the tax. Same seam as `payment_tds.give_back_tax_on_reject`. The raise itself recounts nothing:
it happens only on an `Approved` payment, whose amount and tax count in no Work Order figure until it is
Paid (`amount_paid.amount_paid_of`), and the request caps read the payment and its vendor-borne tax
together (`order_payments.load_payments`), which add up to the gross before and after.

The deduction itself goes through the doc layer: its save writes a Version (who and when) and its delete
a Deleted Document; its own hooks refuse deposited tax and, on a Paid payment, recount the Work Order
(`total_tds`) and re-check CEO Hold (`controllers/payment_tds_deduction.after_delete`). Commits nothing;
the endpoints in `api/payments/tds_cut_undo` check the role and commit.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.services.payment_tds import (
    APPROVED,
    BORNE_BY_COMPANY,
    COMPANY_BEARS_TDS,
    COMPANY_BEARS_TDS_FLAG,
    DEDUCTIBLE_PARENTS,
    MARK_AS_DEPOSIT,
    PAID,
    PAYMENT_DOCTYPE,
    TDS_DOCTYPE,
    challan_label,
    existing_deduction,
)


def lock_deduction(payment_name: str, action: str):
    """Lock and return `(payment, deduction)` for `action`, or refuse: not a Work Order payment, no TDS, or
    its TDS already paid.

    The payment is locked first, as its own save locks it before its deduction (`write_deduction`), so its
    status is read inside that lock; the deduction before the challan check, so Pay TDS can't deposit the
    tax between the check and the change.
    """
    if not frappe.db.exists(PAYMENT_DOCTYPE, payment_name):
        frappe.throw(f"Payment {payment_name} not found.")
    payment = frappe.get_doc(PAYMENT_DOCTYPE, payment_name, for_update=True)
    if (payment.document_type or "").strip() not in DEDUCTIBLE_PARENTS:
        frappe.throw(f"{payment_name}: {action} is for Work Order payments only.")
    name = existing_deduction(payment_name)
    if not name:
        frappe.throw(f"{payment_name} carries no TDS.")
    row = frappe.get_doc(TDS_DOCTYPE, name, for_update=True)
    refuse_if_tds_paid(payment_name, row, action)
    return payment, row


def refuse_if_tds_paid(payment_name: str, row, action: str) -> None:
    """Paid tax stays (#1535): a deduction in a challan was deposited with the government."""
    if row.get("tds_challan"):
        frappe.throw(
            f"{payment_name}: this TDS is already paid (TDS challan {challan_label(row.tds_challan)}), "
            f"so {action} can't be used.",
            title="TDS already paid",
        )


def refuse_unless_cut_undoable(payment, row, action: str) -> None:
    """Raising a cut payment back to its full request: only an `Approved` payment not on a cheque, whose
    tax was cut from it (`borne_by` Vendor) and which still stands below its gross."""
    if row.borne_by == BORNE_BY_COMPANY:
        frappe.throw(f"{payment.name}: its TDS is already paid by the company.")
    if payment.status != APPROVED:
        frappe.throw(
            f"{payment.name} is {payment.status}: {action} is only for a payment not yet paid ({APPROVED})."
        )
    if payment.get("cheque"):
        frappe.throw(
            f"{payment.name} is on cheque {payment.cheque}, written for ₹{flt(payment.amount, 2):,.2f}: "
            f"{action} would leave the cheque short. Take it off the cheque first."
        )
    if flt(payment.amount, 2) >= flt(row.gross_amount, 2):
        frappe.throw(f"{payment.name} already stands at its full request: there is no TDS cut to undo.")


def company_bears_tds(payment_name: str) -> str:
    """*Company Bears TDS*: the payment back to its full request, its deduction kept with `borne_by`
    Company. Rs 9,800 + Rs 200 Vendor -> Rs 10,000 + Rs 200 Company. Returns the deduction's name."""
    payment, row = lock_deduction(payment_name, COMPANY_BEARS_TDS)
    refuse_unless_cut_undoable(payment, row, COMPANY_BEARS_TDS)
    row.borne_by = BORNE_BY_COMPANY
    row.flags[COMPANY_BEARS_TDS_FLAG] = True
    # `ignore_version=False`: the Version IS the record of who and when, so it is written even where
    # Frappe skips versions by default (a test run).
    row.save(ignore_permissions=True, ignore_version=False)
    # `db_set`, not a payment save: see the module docstring.
    payment.db_set("amount", flt(row.gross_amount, 2))
    return row.name


def mark_as_deposit(payment_name: str) -> str:
    """*Mark as Deposit*: the deduction deleted. A cut payment also goes back to its full request (Rs 9,800
    + Rs 200 -> Rs 10,000, no tax); a company-borne one already is (Rs 10,000 + Rs 200 -> Rs 10,000).
    Returns the name of the deduction deleted."""
    payment, row = lock_deduction(payment_name, MARK_AS_DEPOSIT)
    # The link goes in the same write: `Project Payments.payment_tds` would block the delete.
    # `db_set`: see the module docstring.
    if row.borne_by == BORNE_BY_COMPANY:
        if payment.status == PAID:
            frappe.throw(f"{payment.name} is {PAID}: {MARK_AS_DEPOSIT} is only for a payment not yet paid.")
        payment.db_set("payment_tds", None)
    else:
        refuse_unless_cut_undoable(payment, row, MARK_AS_DEPOSIT)
        payment.db_set({"amount": flt(row.gross_amount, 2), "payment_tds": None})
    # The doc layer, not a raw delete: it keeps a Deleted Document (who and when), its `on_trash` refuses
    # deposited tax once more, and its `after_delete` recounts the Work Order of a Paid payment.
    frappe.delete_doc(TDS_DOCTYPE, row.name, ignore_permissions=True)
    return row.name
