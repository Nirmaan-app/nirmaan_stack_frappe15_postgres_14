# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""BCS -- the per-row COST layer of a committed BoQ sheet (business rules).

BCS records what the work costs US (a Supply Rate + an Installation Rate per row),
against the amount we charge the CLIENT. This package holds the DECISIONS the business
names -- what counts as a valid quantity source, what counts as the amount denominator,
and which combinations are refused -- so they live in one place rather than inside a
whitelisted endpoint (ADR-0010 B1; the `boq_category.persist.node_is_qty_bearing` /
`resolve_row_ladder` relocations are the precedent).

Dependency direction is ONE WAY: `api/boq/wizard/bcs.py` imports UP into this package.
Nothing here may import from `api/`, touch `frappe.db`, or read request context.

Entry point: nirmaan_stack.services.boq_bcs.sources.build_qty_source / build_amount_source
"""
