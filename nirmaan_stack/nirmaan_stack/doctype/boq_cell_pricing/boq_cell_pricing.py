# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class BoQCellPricing(Document):
	"""Per-cell PRICING LAYER that sits ON TOP of the committed tier (Phase 5 Slice 1b).

	One record per priced committed Excel cell. Stores the RATE a user fills into a
	specific committed cell WITHOUT mutating the committed tier (BOQ Nodes / grid /
	BoQ Sheet stay capture-only).

	IDENTITY = the durable Excel address + the committed version it prices:
	  (boq, sheet_name [VERBATIM #152], excel_row, col_letter, committed_version).
	col_letter is STORED here (it is derived from BoQ Sheet.column_role_map by
	(role, area) -> letter, NOT carried on the node). `description` is a stored
	copy-forward MATCH GUARD, and `node` is a SETTABLE, re-resolvable per-version
	pointer -- NEITHER is part of the identity key.

	PRICING LIFECYCLE = its own freeze-and-supersede triple (pricing_version /
	is_current / priced_at), mirroring the committed tier, plus an is_finalized lock.
	INVARIANT (enforced by the pricing write path -- api/boq/wizard/pricing.py -- NOT
	in this controller, mirroring the committed-tier convention): exactly one record
	with is_current=1 per (boq, sheet_name, excel_row, col_letter, committed_version).

	This controller is intentionally a bare stub (no compute, no cross-doc writes) per
	the project convention; autoname is the JSON series BPRC-.YY.-.#####.
	"""

	pass
