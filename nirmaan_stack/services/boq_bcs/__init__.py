# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""BCS -- the per-row COST layer of a committed BoQ sheet (business rules).

BCS records what the work costs US (a Supply Rate + an Installation Rate per row),
against the amount we charge the CLIENT. This package holds the DECISIONS the business
names -- what counts as a valid quantity source, what counts as the amount denominator,
and which combinations are refused -- so they live in one place rather than inside a
whitelisted endpoint (ADR-0010 B1; the `boq_category.persist.node_is_qty_bearing` /
`resolve_row_ladder` relocations are the precedent).

⚠️ DEPENDENCY DIRECTION IS ONE WAY, AND IT IS THE LOAD-BEARING RULE OF THIS PACKAGE:
`api/boq/wizard/bcs.py` and `api/boq/wizard/committed_carry.py` import UP into here.
**NOTHING HERE MAY IMPORT FROM `api/`, AND NOTHING HERE MAY READ REQUEST CONTEXT.** Both bars
still hold exactly as written and are not negotiable -- `readiness.py` exists at all because
importing the sibling api module from `committed_carry` closes a verified ring
(`committed_carry -> bcs -> pricing -> committed_carry`), and no placement inside `api/` avoids
it. Reaching back into `api/` from here would re-close that ring from the other side.

⚠️ CORRECTED AT BCS-S7 -- THE `frappe.db` CLAUSE IS GONE, DELIBERATELY, AND MUST NOT COME BACK.
This sentence used to read "Nothing here may import from `api/`, touch `frappe.db`, or read
request context." That was true when the package held only `sources.py`, a pure rule builder,
and BCS-S6 made it FALSE by adding `readiness.py` -- which MUST read `frappe.db`, since
readiness is a fact about a stored `BoQ Sheet` row, exactly as `services/boq_category/persist.py`
reads one. S6 reported the contradiction rather than fixing it (out of its file scope) and left
a long restatement inside `readiness.py`; this is the correction it was owed.

    A DB READ IS ALLOWED HERE. A DB read is not the same thing as a dependency on `api/`, and
    collapsing the two is what made the original sentence overreach.

PURITY IS PER-MODULE, NOT PER-PACKAGE. `sources.py` is still pure and is the one registered in
`scripts/residence_check.py` `PURE_MODULES` (its only framework touch is `frappe.throw`, which
that check does not count); `readiness.py` is deliberately NOT registered, because it would fail
that check by design. Do not "restore consistency" by adding it -- the ratchet would go red on a
module that is correct.

Entry points:
  nirmaan_stack.services.boq_bcs.sources.build_qty_source / build_amount_source   (pure)
  nirmaan_stack.services.boq_bcs.readiness.bcs_is_ready                           (reads frappe.db)
"""
