# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class BoQCommittedGeneralSpecs(Document):
	"""Committed home for a general-specs sheet's faithful cell grid.

	Top-level (istable=0), Links UP to BOQs, and carries the per-sheet commit
	version dimension (commit_version + is_current) alongside one child table of
	faithful rows (`rows` -> BoQ Committed General Specs Row), each row holding an
	arbitrary-width {col_letter: value} `cells` JSON map.

	INVARIANT (NOT enforced here -- deferred to the Phase-5 commit pipeline,
	Slice 3): exactly one row with is_current=1 per (boq, source_sheet_name) at
	any time. Slice 1 only defines the fields; the pipeline owns the write-time
	enforcement. This controller is intentionally a bare stub (no compute, no
	cross-doc writes) per the project convention.
	"""

	pass
