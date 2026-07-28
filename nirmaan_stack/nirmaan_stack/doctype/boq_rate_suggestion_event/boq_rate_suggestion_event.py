# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Rate Suggestion Event -- immutable per-use telemetry (RM-3).

One row per "Use this value" in the rate helper: the extracted vs corrected attributes and the
computed vs used value, joined to its run via run_id. Feeds the corroborator's earned weight and
extraction-accuracy measurement. Events are IMMUTABLE (track_changes 0 -- we never edit an event;
a correction is a new interaction). Controller stays minimal (validate + composite read index).
"""

import frappe
from frappe.model.document import Document


class BoQRateSuggestionEvent(Document):
    def validate(self):
        if not (self.boq or "").strip():
            frappe.throw("boq is required for a rate suggestion event.")
        if not (self.sheet_name or "").strip():
            frappe.throw("sheet_name is required for a rate suggestion event.")
        if self.excel_row is None:
            frappe.throw("excel_row is required for a rate suggestion event.")


def on_doctype_update():
    """Composite read index for the used-state restore read (fetch this run's events by
    (boq, sheet_name, excel_row); run_id gets its own index via search_index on the field)."""
    frappe.db.add_index("BoQ Rate Suggestion Event", ["boq", "sheet_name", "excel_row"])
