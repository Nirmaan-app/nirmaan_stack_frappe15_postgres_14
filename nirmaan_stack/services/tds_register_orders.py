# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The order value the TDS register shows beside a deduction: its Work Order's or Purchase Order's
total, in the "excl. GST" column or the "incl. GST" column, never both (owner ruling 2026-10-27).

PURE -- no database, no request context. `api/payments/tds_register_orders` reads the orders and
hands their fields here.

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not a Technical Data Sheet.
"""

from frappe.utils import flt

from nirmaan_stack.services.work_order_gst import gst_is_on


def _split(total, gst_on):
    """`{excl_gst, incl_gst}` with the total in the one column GST picks, None in the other."""
    total = flt(total)
    return {"excl_gst": None, "incl_gst": total} if gst_on else {"excl_gst": total, "incl_gst": None}


def work_order_value(gst, total_amount):
    """A Work Order's total. `total_amount` already carries 18% GST exactly when `gst` is on
    (`work_order_gst.work_order_total`), so the flag alone picks the column.

    Example: work_order_value("true", 3351.2) -> {"excl_gst": None, "incl_gst": 3351.2}
    """
    return _split(total_amount, gst_is_on(gst))


def purchase_order_value(amount, tax_amount, total_amount):
    """A Purchase Order's total. A PO has no GST flag: it carries GST when its items' tax is above
    zero, and then `total_amount` (= `amount` + `tax_amount`) is the figure; otherwise `amount`.

    Example: purchase_order_value(6800, 1224, 8024) -> {"excl_gst": None, "incl_gst": 8024.0}
    """
    if flt(tax_amount) > 0:
        return _split(total_amount, True)
    return _split(amount, False)
