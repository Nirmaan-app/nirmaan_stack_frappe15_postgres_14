# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The date a money row counts on, and the SQL that keeps it in a date range (ADR-0034). Pure.

A payment, a Vendor Refund, an expense and an inflow each count on their OWN `payment_date` (a refund on
the refund's, not its order's), falling back to the day the row was created when it is blank. Project
money (`services/project_money`) and vendors' dated paid figures (`services/vendor_paid`) both scope by it.
"""

#: The day a money row counts on.
ON_PAYMENT_DATE = "COALESCE(payment_date, creation::date)"


def date_range_clauses(date_expr: str, from_date=None, to_date=None) -> list[str]:
    """SQL clauses keeping `date_expr` inside an inclusive range, one per bound given (none without).

    They bind `%(from_date)s` and `%(to_date)s`: the caller passes both in the query's values.
    """
    clauses = []
    if from_date:
        clauses.append(f"{date_expr} >= %(from_date)s")
    if to_date:
        clauses.append(f"{date_expr} <= %(to_date)s")
    return clauses
