# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class BoQCommittedSheetGrid(Document):
	"""Committed home for a committed sheet's faithful cell grid.

	Top-level (istable=0), Links UP to BOQs, and carries the per-sheet commit
	version dimension (commit_version + is_current) alongside one child table of
	faithful rows (`rows` -> BoQ Committed Sheet Grid Row), each row holding an
	arbitrary-width {col_letter: value} `cells` JSON map.

	EVERY committable sheet commits its complete original here as a faithful grid
	(all 6 row classifications, in original position), regardless of disposition.
	`sheet_disposition` records whether the sheet is grid_only (general-specs) or
	grid_and_nodes (a Finalized sheet that ALSO commits a node tree -- the node
	layer lands in Slice 3b).

	INVARIANT (enforced by the Phase-5 commit pipeline -- Slice 3a,
	commit_pipeline.py -- NOT in this controller): exactly one row with
	is_current=1 per (boq, source_sheet_name) at any time. This controller is
	intentionally a bare stub (no compute, no cross-doc writes) per the project
	convention.
	"""

	pass
