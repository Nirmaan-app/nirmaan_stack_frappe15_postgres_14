# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Rate Category Config -- per-(discipline, category) config blob (RM-1).

Holds the attribute definitions (pickable dimensions), the derivation pipelines (structured
steps with conditions + rounding), the normalization_rule, and display metadata for one
category (e.g. Electrical / wiring_cabling). Config is a read-whole, UI-driven JSON blob per
the app's stated JSON-vs-child-table rule. The pipelines are STORED CONFIG -- RM-1 persists
them faithfully; no interpreter ships this slice (the pricing helper interprets them later).

Controller stays minimal (per CLAUDE.md doctype convention): validate required identity;
declare the composite read index [discipline, category_id]. Import/batch policy lives in the
loader (services/boq_rate_master/loader.py), not here.
"""

import frappe
from frappe.model.document import Document


class BoQRateCategoryConfig(Document):
    def validate(self):
        if not (self.discipline or "").strip():
            frappe.throw("discipline is required for a rate category config.")
        if not (self.category_id or "").strip():
            frappe.throw("category_id is required for a rate category config.")


def on_doctype_update():
    """Composite read index for the (discipline, category_id) config read (import_batch gets its
    own single-column index via search_index on the field)."""
    frappe.db.add_index("BoQ Rate Category Config", ["discipline", "category_id"])
