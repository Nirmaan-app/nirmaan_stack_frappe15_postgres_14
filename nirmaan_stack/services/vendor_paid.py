# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What reached each vendor in a date range: the Amount Paid rule, dated (#1461, ADR-0034).

An order's Amount Paid is its Paid Project Payments less its Received Vendor Refunds (`GLOSSARY.md`
*Amount Paid*). Amount Paid carries no date, so a figure for a period (the Vendor report's Total Paid in a
range, its Current FY Paid, and the cash behind its Balance Payable since the ledger start) applies the
same rule to the rows themselves: a payment on its `payment_date`, a refund on the refund's own
`payment_date`, each falling back to its creation date when blank. With no dates it is the vendor's
orders' Amount Paid added up, worked out from source.

Only PO and Work Order money counts, as for Amount Paid; a payment or refund is the vendor's by its own
`vendor` field, as in the Vendor Ledger.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.services.vendor_refunds import LOWERS_PAID_STATUSES, REFUND_DOCUMENT_FIELDS


def vendors_paid(from_date=None, to_date=None) -> dict[str, float]:
    """`{vendor: paid}` for every vendor with money in the range, in ONE grouped query.

    `from_date` and `to_date` are optional and inclusive, each on its own. A vendor with no rows in the
    range is missing from the result; read it as 0.
    """
    values = {
        "refund_statuses": tuple(LOWERS_PAID_STATUSES),
        "order_doctypes": tuple(REFUND_DOCUMENT_FIELDS),
        "from_date": from_date,
        "to_date": to_date,
    }
    on_date = "COALESCE(payment_date, creation::date)"
    scope = ["COALESCE(vendor, '') <> ''", "document_type IN %(order_doctypes)s"]
    if from_date:
        scope.append(f"{on_date} >= %(from_date)s")
    if to_date:
        scope.append(f"{on_date} <= %(to_date)s")
    where = " AND ".join(scope)

    rows = frappe.db.sql(
        f"""
        SELECT vendor, SUM(paid) AS paid
        FROM (
            SELECT vendor, amount AS paid
            FROM "tabProject Payments"
            WHERE status = 'Paid' AND {where}
            UNION ALL
            SELECT vendor, -amount
            FROM "tabVendor Refunds"
            WHERE status IN %(refund_statuses)s AND {where}
        ) AS money
        GROUP BY vendor
        """,
        values,
        as_dict=True,
    )
    return {row.vendor: flt(row.paid) for row in rows}
