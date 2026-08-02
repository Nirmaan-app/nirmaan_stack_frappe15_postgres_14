# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Row BCS Rate -- the per-row COST layer of a committed BoQ sheet (slice BCS-S1).

BCS is the cost side of the pricing editor: two hand-typed rates per committed row --
a Supply Rate and an Installation Rate -- representing what the work costs US, sitting
against the BoQ amount we charge the CLIENT.

IDENTITY = the durable Excel address + the committed version it costs:
  (boq, sheet_name [VERBATIM #152], excel_row, committed_version).
PER-ROW, with deliberately NO col_letter: the two BCS columns are SCREEN-ONLY and have
no Excel origin, so a sentinel column letter would misrepresent the source workbook.
BoQ Row Category and BoQ Cell Remark are the established no-column precedent.

ONLY THE TWO RATES PERSIST (owner-locked). Total Amount (quantity x (supply + install))
and % Profit are ALWAYS computed downstream from these two rates plus the sheet's
confirmed quantity and amount columns -- never stored, so a stored copy can never drift
from the live sheet.

LIFECYCLE = its own freeze-and-supersede triple (bcs_version / is_current /
bcs_rated_at), mirroring BoQ Cell Pricing. INVARIANT (enforced by the write path --
api/boq/wizard/bcs.py save_row_bcs_rates -- NOT in this controller, mirroring the
pricing/classification/annotation convention): exactly one record with is_current=1 per
(boq, sheet_name, excel_row, committed_version). A cost row is never overwritten in
place; the prior current is frozen via frappe.db.set_value, never doc.save.

STRUCTURALLY OFF THE EXPORT PATH (owner-locked): the priced-workbook write-back
(api/boq/wizard/export_writeback.py) reads "BoQ Cell Pricing" and names three fields
explicitly (excel_row, col_letter, rate). BCS living in its OWN doctype is what keeps
internal cost and margin out of a client-facing workbook by CONSTRUCTION rather than by
convention -- and that construction is pinned by a standing test in
api/boq/wizard/test_export_writeback.py. Do NOT fold these fields onto BoQ Cell Pricing.

This controller is intentionally a bare stub (no compute, no cross-doc writes) plus the
read-index hook, per the practised convention for this doctype family (see
boq_row_category.py).
"""

import frappe
from frappe.model.document import Document


class BoQRowBCSRate(Document):
    pass


def on_doctype_update():
    # Composite read index matching BOTH BCS access shapes, all equality predicates:
    #   sheet read  (get_sheet_bcs_rates) -> the 4-column prefix
    #                (boq, sheet_name, committed_version, is_current)
    #   row lookup  (save_row_bcs_rates freeze-and-supersede) -> all 5 columns.
    # Mirrors BoQ Row Category's composite index (sheet-level prefix first). Idempotent:
    # add_index no-ops when the index already exists.
    frappe.db.add_index(
        "BoQ Row BCS Rate",
        ["boq", "sheet_name", "committed_version", "is_current", "excel_row"],
    )
