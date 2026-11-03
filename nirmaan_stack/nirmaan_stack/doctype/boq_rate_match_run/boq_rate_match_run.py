# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Rate Match Run -- one historical-match pass over a sheet, after its Suggest run (DEV2-B4; owner SEQUENCE G1).

Written only by api/boq/rate_match.py (the trigger and the worker) and tasks/match_run_healer.py. A COMPLETE run is
the sheet's live one (active=1) and retires the prior active run (kept, never deleted), as BoQ Rate Suggestion Run
does. Controller stays minimal: validate + the two indexes."""

import frappe
from frappe.model.document import Document

# Postgres index names are schema-wide, so both names are explicit and lower case (services/index_manifest.py lists
# them; the DEV2 lesson "lower-case index names", as BoQ Row Spec Card's unique name).
BOQ_SHEET_ACTIVE_INDEX = "boq_rate_match_run_boq_sheet_name_active_idx"
SUGGEST_RUN_INDEX = "boq_rate_match_run_suggest_run_idx"


class BoQRateMatchRun(Document):
	def validate(self):
		if not (self.boq or "").strip():
			frappe.throw("boq is required for a rate match run.")
		if not (self.sheet_name or "").strip():
			frappe.throw("sheet_name is required for a rate match run.")


def on_doctype_update():
	# The active-run read (get_match_results, the carry) and the run a Suggest run started.
	frappe.db.add_index("BoQ Rate Match Run", ["boq", "sheet_name", "active"], BOQ_SHEET_ACTIVE_INDEX)
	frappe.db.add_index("BoQ Rate Match Run", ["suggest_run"], SUGGEST_RUN_INDEX)
