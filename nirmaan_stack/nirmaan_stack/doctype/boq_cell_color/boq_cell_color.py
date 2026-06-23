# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class BoQCellColor(Document):
	"""Per-CELL COLOR HIGHLIGHT annotation that sits ON TOP of the committed tier
	(Phase 5 Slice 4a).

	One record per committed Excel cell carrying a user-chosen background-fill tag (an
	8-value token enum), stored WITHOUT mutating the committed tier (BOQ Nodes / grid /
	BoQ Sheet stay capture-only). A color is pure visual annotation, NOT a price -- it
	has its own doctype (NOT folded onto BoQ Cell Pricing, which carries rate/
	priceability/lock semantics a color must not inherit), and is allowed on ANY cell
	(non-priceable / zero-rate / any) -- the write path applies NO priceability gate.

	IDENTITY = the durable Excel CELL address + the committed version it annotates:
	  (boq, sheet_name [VERBATIM #152], excel_row, col_letter, committed_version).
	`description` is a stored copy-forward MATCH GUARD (a future-slice carry, like
	BoQ Cell Pricing.description) -- NOT part of the identity key, never branched on.
	A whole-ROW apply is N cell records (the frontend fans out; the endpoint takes one
	cell).

	LIFECYCLE = its own freeze-and-supersede triple (color_version / is_current /
	colored_at), mirroring the pricing tier. INVARIANT (enforced by the write path --
	api/boq/wizard/pricing.py save_cell_color -- NOT in this controller): exactly one
	record with is_current=1 per (boq, sheet_name, excel_row, col_letter, committed_version).

	This controller is intentionally a bare stub (no compute, no cross-doc writes) per
	the project convention; autoname is the JSON series BCLR-.YY.-.#####.
	"""

	pass
