# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class BoQCellReconciliationChoice(Document):
	"""Per-CELL formula-vs-document reconciliation CHOICE that sits ON TOP of the committed
	tier (Phase 5 Cluster B).

	When a committed (document) amount and the formula-computed amount DIVERGE for the same
	amount cell, the user may CHOOSE per cell which value wins. This record stores that choice
	stickily, anchored to the committed version. The committed tier (BOQ Nodes / grid / BoQ
	Sheet) is NEVER mutated -- the tendering document is client-owned; we highlight and let the
	user decide, we never auto-fix it.

	IDENTITY = the durable Excel CELL address + the committed version it annotates:
	  (boq, sheet_name [VERBATIM #152], excel_row, col_letter, committed_version).
	This is PER-CELL -- it carries `col_letter` (unlike BoQ Cell Dismissal, which is per-ROW
	with no col_letter), because a divergence + its resolution is specific to one amount column.
	`description` is a stored copy-forward MATCH GUARD (like BoQ Cell Pricing.description) --
	NOT part of the identity key, never branched on.

	CHOICE (`choice` Select): keep_document | take_formula. "Unset" is the ABSENCE of a current
	record (the default), and per the locked design D1 the DOCUMENT value wins while unset.

	LIFECYCLE = its own freeze-and-supersede triple (choice_version / is_current / chosen_at +
	chosen_by), mirroring the pricing tier. INVARIANT (enforced by the write path --
	api/boq/wizard/pricing.py save_cell_reconciliation_choice -- NOT in this controller):
	exactly one record with is_current=1 per (boq, sheet_name, excel_row, col_letter,
	committed_version). `is_finalized` (Check, default 0) is declared but INERT this slice --
	a later finalize/revert slice will wire enforcement (mirrors BoQ Cell Pricing).

	RE-ARM / INVALIDATION (handled by the write path, not here -- the locked design D3, AUTO-
	RESET, SURGICAL, PER-CELL, COLUMN-AWARE):
	  - a RATE save (save_cell_price) clears the current choice on an amount cell ONLY IF that
	    cell's formula references the edited rate operand (column-specific -- NOT the whole row);
	  - a FORMULA save (save_amount_formula) clears the current choices on that amount column's
	    cells; a FORMULA REMOVE clears them silently (no number left to choose between);
	  - a RE-COMMIT mints a new committed_version -> old choices are naturally orphaned (keyed
	    by version, no live invalidation code).

	This controller is intentionally a bare stub (no compute, no cross-doc writes) per the
	project convention; autoname is the JSON series BRCC-.YY.-.#####.
	"""

	pass
