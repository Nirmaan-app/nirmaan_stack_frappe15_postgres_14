# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class BoQCellDismissal(Document):
	"""Per-ROW review-flag/remark DISMISSAL ("reviewed / looks OK") that sits ON TOP of the
	committed tier (Phase 5 Slice 4b-ACKNOWLEDGE).

	A dismissal is an ACKNOWLEDGMENT, not a fix: it HIDES a review-strip entry (a computed
	flag or a remark) from the active view WITHOUT changing the underlying condition. The
	flag clears for real only when its condition clears (e.g. the row gets priced). Stored
	WITHOUT mutating the committed tier (BOQ Nodes / grid / BoQ Sheet stay capture-only).

	IDENTITY = the durable Excel ROW address + the dismissed entry's kind + the committed
	version it annotates:
	  (boq, sheet_name [VERBATIM #152], excel_row, flag_kind, committed_version).
	`flag_kind` is one of FIVE tokens -- the four computed ReviewFlagKind tokens
	(needs_rate / qty_anomaly / broken / not_yet) PLUS "remark" -- so one row can carry
	several independent dismissals. NO per-area dimension (a ReviewEntry's identity is
	(excel_row, kind); needs_rate/not_yet fold their per-area detail into ONE entry per
	row per kind before reaching the strip).
	`description` is a stored copy-forward MATCH GUARD (a future-slice carry, like
	BoQ Cell Pricing.description) -- NOT part of the identity key, never branched on.

	LIFECYCLE = its own freeze-and-supersede triple (dismissal_version / is_current /
	dismissed_at), mirroring the pricing tier. INVARIANT (enforced by the write path --
	api/boq/wizard/pricing.py save_cell_dismissal -- NOT in this controller): exactly one
	record with is_current=1 per (boq, sheet_name, excel_row, flag_kind, committed_version).
	`is_finalized` (Check, default 0) is declared but INERT this slice -- Slice 6
	(finalize/revert) will wire enforcement (mirrors BoQ Cell Pricing).

	RE-ARM (handled by the write path, not here): a successful rate write on the row
	(save_cell_price) freezes the row's current dismissals for the four COMPUTED kinds --
	but NOT the "remark" dismissal, which survives a rate edit.

	This controller is intentionally a bare stub (no compute, no cross-doc writes) per the
	project convention; autoname is the JSON series BDSM-.YY.-.#####.
	"""

	pass
