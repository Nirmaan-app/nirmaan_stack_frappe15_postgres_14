# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class BoQCellRemark(Document):
	"""Per-ROW REMARK annotation that sits ON TOP of the committed tier (Phase 5 Slice 4a).

	One record per committed Excel row carrying a user-authored free-text note, stored
	WITHOUT mutating the committed tier (BOQ Nodes / grid / BoQ Sheet stay capture-only).
	A remark is annotation, NOT a price -- it has its own doctype, NOT folded onto
	BoQ Cell Pricing (whose per-cell key carries rate/priceability/lock semantics a note
	must not inherit), and is NEVER written onto BOQ Nodes.remarks (committed-tier
	provenance, barred for the pricing phase, and absent on grid-only sheets).

	IDENTITY = the durable Excel ROW address + the committed version it annotates:
	  (boq, sheet_name [VERBATIM #152], excel_row, committed_version).
	`description` is a stored copy-forward MATCH GUARD (a future-slice carry, like
	BoQ Cell Pricing.description) -- NOT part of the identity key, never branched on.

	LIFECYCLE = its own freeze-and-supersede triple (remark_version / is_current /
	remarked_at), mirroring the pricing tier. INVARIANT (enforced by the write path --
	api/boq/wizard/pricing.py save_row_remark -- NOT in this controller): exactly one
	record with is_current=1 per (boq, sheet_name, excel_row, committed_version).

	This controller is intentionally a bare stub (no compute, no cross-doc writes) per
	the project convention; autoname is the JSON series BRMK-.YY.-.#####.
	"""

	pass
