# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Rate Suggestion Run -- one committed extraction run per sheet (RM-3).

Holds the terminal per-row extraction payload (attributes + confidences + corroborated flags) for a
committed sheet at a commit_version. FREEZE-AND-SUPERSEDE: a new run deactivates the prior active run
for the sheet (retained, never deleted); get_active_suggestion_run reads the active one. VERSION
KEYING: the run only re-shows on load when committed_version equals the sheet's current version.
Values are always recomputed client-side from the CURRENT master/config -- only the extracted
ATTRIBUTES persist here. Runs are immutable once written (track_changes 0). Controller stays minimal.
"""

import frappe
from frappe.model.document import Document


class BoQRateSuggestionRun(Document):
    def validate(self):
        if not (self.boq or "").strip():
            frappe.throw("boq is required for a rate suggestion run.")
        if not (self.sheet_name or "").strip():
            frappe.throw("sheet_name is required for a rate suggestion run.")


def on_doctype_update():
    """Composite read index for the active-run read ((boq, sheet_name, active); run_id gets its own
    index via search_index on the field)."""
    frappe.db.add_index("BoQ Rate Suggestion Run", ["boq", "sheet_name", "active"])
