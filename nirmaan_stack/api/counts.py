# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""
Batch count endpoint — collapse N separate `get_count` / `useFrappeGetDocCount`
round-trips into ONE. Dashboards, summary cards, and status tabs currently fan out one
HTTP call per metric/status; `get_counts` answers them all in a single request.

Each spec is `{key, doctype, filters?, group_field?}`; the response is keyed by `key`.
Built on `frappe.db.count` / `frappe.get_all` (NOT raw SQL) so Frappe's implicit
permission query conditions AND the `is` / `is not set` operator semantics that the
call sites rely on (e.g. AssetsSummaryCard) are preserved exactly.

Consumed by frontend/src/hooks/useCounts.ts. See docs/adr/0010-module-residence-rules.md
("a count/aggregate over many rows belongs in the DB").
"""

import json

import frappe


@frappe.whitelist()
def get_counts(specs):
    """Return counts for a batch of specs in one round-trip.

    Args:
        specs: a JSON string or list of ``{"key", "doctype", "filters"?, "group_field"?}``.
            - ``group_field`` present  -> GROUP BY that field -> ``{value: count}``.
            - otherwise                -> a single integer count.

    Returns:
        dict keyed by each spec's ``key``. Malformed specs (missing key/doctype) are
        skipped rather than raising, so one bad spec can't blank the whole panel.
    """
    if isinstance(specs, str):
        specs = json.loads(specs)
    if not isinstance(specs, list):
        frappe.throw("`specs` must be a list of count specifications.")

    out = {}
    for spec in specs:
        if not isinstance(spec, dict):
            continue
        key = spec.get("key")
        doctype = spec.get("doctype")
        if not key or not doctype:
            continue

        filters = spec.get("filters") or None
        group_field = spec.get("group_field")

        if group_field:
            # GROUP BY in the DB; permission conditions still applied by get_all.
            rows = frappe.get_all(
                doctype,
                filters=filters,
                group_by=group_field,
                fields=[group_field, "count(name) as count"],
                limit_page_length=0,
            )
            out[key] = {row.get(group_field): row.get("count") for row in rows}
        else:
            # frappe.db.count applies the same permission query conditions the per-site
            # get_count calls inherited, and honors `is` / `is not set` operators.
            out[key] = frappe.db.count(doctype, filters=filters)

    return out
