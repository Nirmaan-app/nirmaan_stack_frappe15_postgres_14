# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Rate Master Item -- discipline-wide priced-item master (RM-1).

One row per source workbook item (e.g. a Polycab cable row or a termination row),
addressed by (discipline, kind) with a keyed `attributes` JSON used to match a row for
a selected line and a keyed `rates` JSON holding the raw list/base rates the category's
derivation pipelines interpret. JSON fields (not exploded columns / child tables) per the
app's stated rule -- flexible, UI-driven, read-whole data (mirrors BoQ Committed Sheet
Grid Row.cells / BoQ Sheet.column_role_map). The per-category pipelines + attribute
definitions live in BoQ Rate Category Config.

Controller stays minimal (per CLAUDE.md doctype convention): validate required identity;
declare the composite read index [discipline, kind, brand]. Import/batch/idempotence policy
lives in the loader (services/boq_rate_master/loader.py), not here.
"""

import frappe
from frappe.model.document import Document


class BoQRateMasterItem(Document):
    def validate(self):
        if not (self.discipline or "").strip():
            frappe.throw("discipline is required for a rate master item.")
        if not (self.kind or "").strip():
            frappe.throw("kind is required for a rate master item.")


def on_doctype_update():
    """Composite read index for the discipline+kind read endpoint (import_batch gets its own
    single-column index via search_index on the field). Plain index -- logical uniqueness of a
    row within a batch is a loader concern, not a hard DB constraint (migrate-safe)."""
    frappe.db.add_index("BoQ Rate Master Item", ["discipline", "kind", "brand"])
