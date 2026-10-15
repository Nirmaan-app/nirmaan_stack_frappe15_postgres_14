# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ AI Run Log -- one record per Claude review run of a BoQ sheet (S2).

Status, heartbeat, chunk and token progress, examples-library status and the failure reason of a
run, manual or automatic. Written only by api/boq/wizard/ai_run_log.py (raw field writes: the
record has no hook and nothing derived from it); read-only in the desk, System Manager only. It
never holds an API key. Controller stays minimal.
"""

import frappe
from frappe.model.document import Document


class BoQAIRunLog(Document):
	pass


def on_doctype_update():
	"""The two read indexes, under names of their own. On PostgreSQL an index name is unique per
	schema and Frappe names a field-level index after the field alone, so the search_index flag on
	"boq" / "status" creates nothing here (another table already owns that name). The flags STAY ON
	all the same: with a flag off, a later alteration of this table would run a nameless
	DROP INDEX "boq" / "status" and remove ANOTHER table's index. For the same reason an index here
	never covers a column that has no flag. add_index no-ops when the index already exists."""
	frappe.db.add_index("BoQ AI Run Log", ["boq"], "boq_ai_run_log_boq")
	frappe.db.add_index("BoQ AI Run Log", ["status"], "boq_ai_run_log_status")
