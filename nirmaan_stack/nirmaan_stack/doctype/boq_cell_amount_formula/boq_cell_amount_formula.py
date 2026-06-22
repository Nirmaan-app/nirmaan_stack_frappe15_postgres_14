# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class BoQCellAmountFormula(Document):
	"""Per-COLUMN, per-committed-version USER-DECLARED amount FORMULA (Phase 5 Formula
	Builder F1). Sits ON TOP of the committed tier exactly like BoQ Cell Pricing -- it is
	ADDITIVE and never mutates the committed tier (BOQ Nodes / grid / BoQ Sheet stay
	capture-only).

	A formula is a per-COLUMN rule for how an AMOUNT column is computed from the sheet's
	qty / rate / amount columns (operators +, * and brackets; NO numeric literals;
	amount-refs-amount allowed within the row). F1 STORES + SERVES the formula; it does NOT
	evaluate it (the evaluator is F2, the grid display is F4).

	IDENTITY (the unique key, ENDPOINT-enforced -- NOT in this controller, mirroring the
	committed-tier convention):
	  (boq, sheet_name [VERBATIM #152], committed_version,
	   target_value_field, target_value_key, target_rate_subkey).

	DEFAULT-vs-OVERRIDE discriminator = target_value_key:
	  - NULL  -> the logical-column DEFAULT (area-wildcard) for a per-area column,
	            OR "scalar" (no area dimension) for a scalar amount column.
	  - a concrete area string -> a PER-AREA OVERRIDE that wins for that one area.
	NO extra field encodes this -- nullability IS the discriminator.

	target_col (the Excel letter) + description are stored copy-forward / re-resolve
	GUARDS -- NEITHER is part of the identity key (mirrors BoQ Cell Pricing.node /
	.description).

	FORMULA LIFECYCLE = its own freeze-and-supersede triple (formula_version / is_current /
	defined_at), mirroring the committed tier + an is_finalized lock. INVARIANT: exactly one
	is_current=1 record per identity, enforced by the write path (api/boq/wizard/pricing.py
	save_amount_formula), NOT in this controller.

	This controller is intentionally a bare stub (no compute, no cross-doc writes) per the
	project convention; autoname is the JSON series BAMF-.YY.-.#####.
	"""

	pass
