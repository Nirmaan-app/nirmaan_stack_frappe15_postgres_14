# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""How much GST-off Work Order value one vendor may carry in a financial year -- the GST Hold rule.

PURE MODULE -- no `frappe`, no database, no request context. The database sums live in
`api/service_requests/vendor_fy_limit.py`; the jobs that act on them in `tasks/vendor_gst_hold.py`.
This file only owns the numbers and the comparison.

THE RULE (owner, 16/09/2026; repurposed as GST Hold 19/09/2026 -- ADR-0028)
---------------------------------------------------------------------------
    vendor FY total = sum(total_amount) of the vendor's Work Orders where
                        gst      == "false"      (GST switched off on the WO)
                        status   != "Rejected"
                        creation inside the current financial year (1 April -> 31 March)
    The daily job puts a vendor on GST Hold when ALL THREE hold (owner, 19/09/2026):
        1. the vendor has NO GST number (blank or whitespace)
        2. vendor_type is Service or Material & Service       (GST_HOLD_VENDOR_TYPES)
        3. its FY total is ABOVE Rs 15,00,000
    A vendor on GST Hold cannot get a new Work Order. Until 19/09/2026 the same total refused the WO
    at creation instead; that amount check is gone.

⚠️ THE JOB ONLY EVER TURNS GST HOLD ON. It never releases a vendor -- not when the total drops, not
at a new financial year, not when a GST number is added. Only an Admin removes it
(`api/vendor/gst_hold.remove_gst_hold`).

⚠️ THE EDGE IS `>`, NOT `>=`. Exactly Rs 15,00,000 is not on hold; Rs 15,00,001 is.

⚠️ `gst` IS A STRING ("true" / "false"), NOT A CHECK. A new WO is inserted with the field default
"true" and approval sets it from the vendor's GST number ("false" when the vendor has none --
`ServiceRequests.set_gst_from_vendor_on_approval`), so a WO still waiting for approval is NOT counted.

⚠️ THE AMOUNT IS PRE-GST. On a GST-off WO `total_amount` IS qty * rate -- the 18% is only added
when gst is "true" (`ServiceRequests.calculate_total_amount`). Checked equal on all 684 GST-off
WOs, 19/09/2026.
"""

from __future__ import annotations

from datetime import date

WO_VENDOR_FY_LIMIT = 1_500_000.0
GST_OFF = "false"
GST_ON = "true"
EXCLUDED_STATUS = "Rejected"
FY_START_MONTH = 4  # April
GST_HOLD_VENDOR_TYPES = ("Service", "Material & Service")


def financial_year_bounds(today: date) -> tuple[date, date]:
    """(start, end_exclusive) of the Indian financial year containing `today`."""
    start_year = today.year if today.month >= FY_START_MONTH else today.year - 1
    return date(start_year, FY_START_MONTH, 1), date(start_year + 1, FY_START_MONTH, 1)


def exceeds_limit(vendor_fy_total) -> bool:
    """True when the vendor's FY total goes ABOVE the limit -- the GST Hold condition."""
    return float(vendor_fy_total or 0) > WO_VENDOR_FY_LIMIT
