import json

import frappe

from nirmaan_stack.api.sidebar_count_parts import scope_for
from nirmaan_stack.services.sidebar_counts_cache import counts_for


@frappe.whitelist()
def sidebar_counts(user: str) -> str:
    """
    Return all counts needed for the sidebar in ONE http-roundtrip, as JSON with one key per part
    (po, po_revisions, po_adjustments, pr, sb, sr, pay, credits). Each part is counted by
    `api/sidebar_count_parts`, over the user's counting scope (full access, or their projects), and read back
    from Redis while no change to the record types it reads has been saved (`services/sidebar_counts_cache`).
    """
    scope = scope_for(user)
    # The site's date (IST), as the Credit Payments list's: the container clock is UTC, so `date.today()` lags
    # 00:00-05:30 IST.
    today = frappe.utils.today()
    return json.dumps(counts_for(scope, today))
