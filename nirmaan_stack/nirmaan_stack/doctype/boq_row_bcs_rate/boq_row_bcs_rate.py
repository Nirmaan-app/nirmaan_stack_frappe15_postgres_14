# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Row BCS Rate -- the per-row COST layer of a committed BoQ sheet (slice BCS-S1).

BCS is the cost side of the pricing editor: hand-typed cost rates per committed row,
representing what the work costs US, sitting against the BoQ amount we charge the CLIENT.

THREE cost inputs exist, and a sheet uses ONE SET of them (BCS-S2b, owner ruling
2026-08-02). A sheet whose original SPLITS its quote carries a Supply Rate and an
Installation Rate; a sheet quoting ONE undifferentiated figure carries a Combined Rate
instead, and whichever fields that sheet does not use stay 0.0. WHICH set is offered is
the SCREEN's decision -- storage imposes NO cross-field rule, so a sheet that changes
shape never strands a number it already holds.

IDENTITY = the durable Excel address + the committed version it costs:
  (boq, sheet_name [VERBATIM #152], excel_row, committed_version).
PER-ROW, with deliberately NO col_letter: the BCS columns are SCREEN-ONLY and have
no Excel origin, so a sentinel column letter would misrepresent the source workbook.
BoQ Row Category and BoQ Cell Remark are the established no-column precedent.

ONLY THE INPUT RATES PERSIST (owner-locked). Total Amount and % Profit are ALWAYS
computed downstream from the stored rates plus the sheet's confirmed quantity and amount
columns -- never stored, so a stored copy can never drift from the live sheet.

THE DOWNSTREAM FORMULA READS THE SET THE SHEET USES:

    split sheet     Total Amount = quantity x (supply_rate + install_rate)
    combined sheet  Total Amount = quantity x combined_rate

and NEVER the sum of all three. `combined_rate` is not a total of the two halves, nothing
derives it from them, and adding it to them would count the row's cost twice.

CORRECTED AT BCS-S2c, and this is the reason that slice could not be skipped. This
docblock gave the formula as `quantity x (supply + install)` FULL STOP -- written before
`combined_rate` existed, and therefore evaluating to ZERO on every combined-rate sheet,
where both halves are 0.0 BY DESIGN. BCS-S3 implements this formula against this
description, so the stale version was a bug waiting to be copied rather than a stale
comment. `api/boq/wizard/bcs.py`'s module docstring was updated at S2b; this one was
missed, which is exactly how a canonical description drifts out from under its schema.

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
