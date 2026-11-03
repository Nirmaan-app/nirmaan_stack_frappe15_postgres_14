# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Rate Match Feedback -- "Not a match" and its Undo on a shown historical match (DEV2-B5 S3; owner R-H2AI: "Not a
match" with an optional reason and note, CAPTURED and stored to improve matching later, with Undo).

APPEND-ONLY: written only by api/boq/rate_match.mark_not_a_match / undo_not_a_match, one row per action; an Undo is
a new "undo" row, so the history stays whole. The latest row for (boq, sheet_name, excel_row, commit_version, match
key) is the match's current flag. A saved row is never edited and never deleted (both refused here)."""

import frappe
from frappe.model.document import Document

# Postgres index names are schema-wide: explicit and lower case (services/index_manifest.py lists it).
TARGET_ROW_INDEX = "boq_rate_match_feedback_boq_sheet_name_excel_row_idx"


class BoQRateMatchFeedback(Document):
	def validate(self):
		if not self.is_new():
			frappe.throw("Match feedback is append-only: a saved row is never changed (add an undo row instead).")
		for field in ("boq", "sheet_name", "match_boq", "match_sheet_name", "match_run", "action"):
			if not (self.get(field) or "").strip():
				frappe.throw(f"{field} is required for match feedback.")
		if self.excel_row is None or self.match_excel_row is None:
			frappe.throw("excel_row and match_excel_row are required for match feedback.")

	def on_trash(self):
		frappe.throw("Match feedback is append-only: it is never deleted.")


def on_doctype_update():
	# The flag read (get_match_results) and the mark / undo guard: one sheet's feedback by row.
	frappe.db.add_index("BoQ Rate Match Feedback", ["boq", "sheet_name", "excel_row"], TARGET_ROW_INDEX)
