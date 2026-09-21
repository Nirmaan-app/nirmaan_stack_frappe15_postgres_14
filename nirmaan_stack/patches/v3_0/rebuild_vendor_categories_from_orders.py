"""One-time patch: REPLACE every vendor's category list with the categories on its POs and Work Orders.

Owner, 21/09/2026: hand-entered categories are discarded; a vendor with no qualifying order ends with an
empty list. From here the daily job `tasks.vendor_category_sync.sync_daily` only adds. The rule lives in
`services/vendor_categories.py`; this patch is the first, full run of the same code.
"""

from nirmaan_stack.tasks.vendor_category_sync import rebuild_all


def execute():
    summary = rebuild_all(apply=True)
    print(f"rebuild_vendor_categories_from_orders: {summary}")
