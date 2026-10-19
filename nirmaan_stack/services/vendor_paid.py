# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What was paid to each vendor in a date range: the Amount Paid rule, dated (#1461, ADR-0034).

An order's Amount Paid is its Paid Project Payments, plus (a Work Order's) the TDS withheld from the
vendor on them, less its Received Vendor Refunds (`GLOSSARY.md` *Amount Paid*, ADR-0034 Amendment A).
Amount Paid carries no date, so a figure for a period (the Vendor report's Total Paid in a range, its
Current FY Paid, and the cash behind its Balance Payable since the ledger start) applies the same rule to
the rows themselves: a payment and the tax withheld on it on the payment's `payment_date`, a refund on
the refund's own `payment_date`, each falling back to its creation date when blank. With no dates it is
the vendor's orders' Amount Paid added up, worked out from source. Tax the company paid on top
(`borne_by` Company) was never the vendor's and counts nothing (`payment_tds.paid_borne_tds_sql`).

Only PO and Work Order money counts, as for Amount Paid; a payment or refund is the vendor's by its own
`vendor` field, as in the Vendor Ledger.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.services.money_dates import ON_PAYMENT_DATE, date_range_clauses
from nirmaan_stack.services.payment_tds import paid_borne_tds_sql
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
    scope = [
        "COALESCE(vendor, '') <> ''",
        "document_type IN %(order_doctypes)s",
        *date_range_clauses(ON_PAYMENT_DATE, from_date, to_date),
    ]
    where = " AND ".join(scope)

    rows = frappe.db.sql(
        f"""
        SELECT vendor, SUM(paid) AS paid
        FROM (
            SELECT vendor, amount AS paid
            FROM "tabProject Payments"
            WHERE status = 'Paid' AND {where}
            UNION ALL
            SELECT vendor, vendor_borne_tds
            FROM ({paid_borne_tds_sql()}) AS withheld
            WHERE {where}
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
