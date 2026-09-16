# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""How much Work Order value one vendor may take in a financial year.

PURE MODULE -- no `frappe`, no database, no request context. The database sum lives in
`api/service_requests/vendor_fy_limit.py`; this file only owns the numbers and the comparison.

THE RULE (owner, 16/09/2026)
----------------------------
    vendor FY total = sum(quantity * rate) of the vendor's Work Orders where
                        gst      == "false"      (GST switched off on the WO)
                        status   != "Rejected"
                        creation inside the current financial year (1 April -> 31 March)
    A NEW Work Order is refused when  vendor FY total + its own amount  >  Rs 15,00,000.

⚠️ THE EDGE IS `>`, NOT `>=`. The owner wrote "> 15 lakhs", so a total of exactly Rs 15,00,000
is still allowed.

⚠️ `gst` IS A STRING ("true" / "false"), NOT A CHECK. A new WO is inserted with the field default
"true" and approval flips it to "false", so a WO still waiting for approval is NOT counted in the
vendor total. The WO being created is counted separately, by the caller, from its own lines.

⚠️ THE AMOUNT IS PRE-GST. quantity * rate, never `total_amount` (which adds 18% when gst is on).
"""

from __future__ import annotations

from datetime import date

WO_VENDOR_FY_LIMIT = 1_500_000.0
GST_OFF = "false"
EXCLUDED_STATUS = "Rejected"
FY_START_MONTH = 4  # April


def financial_year_bounds(today: date) -> tuple[date, date]:
    """(start, end_exclusive) of the Indian financial year containing `today`."""
    start_year = today.year if today.month >= FY_START_MONTH else today.year - 1
    return date(start_year, FY_START_MONTH, 1), date(start_year + 1, FY_START_MONTH, 1)


def exceeds_limit(vendor_fy_total, new_wo_amount=0.0) -> bool:
    """True when the vendor's FY total plus the new WO goes ABOVE the limit."""
    return float(vendor_fy_total or 0) + float(new_wo_amount or 0) > WO_VENDOR_FY_LIMIT
