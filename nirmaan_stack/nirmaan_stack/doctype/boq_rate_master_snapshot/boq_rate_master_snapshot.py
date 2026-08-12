# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Rate Master Snapshot -- every export retained, so the catalog's state on a past date can be
inspected or restored.

Modelled on `Pricing Workbook Version` (the existing versioned-blob-plus-prune precedent), with two
deliberate departures learned from that doctype's scars:

  1. `payload` is LONG TEXT, not JSON. A snapshot exists to be RESTORED, so byte-fidelity of the
     stored text is the whole point -- Frappe must never hydrate and re-serialise it. It also
     sidesteps the list-valued-JSON wall that forces that module's prune to use a raw
     `frappe.db.delete`.
  2. `track_changes` is 0. A snapshot is already immutable evidence; a Version row per snapshot
     would double the storage of the largest column in the app for nothing.

⚠️ RETENTION IS KEEP-NEWEST-10 PER DISCIPLINE (owner-ruled), pruned on write. `version` is NOT
reused after a prune -- it is assigned as (max existing) + 1, so a version number identifies one
snapshot for the life of the site even once its row is gone.

Controller stays minimal per the app's doctype convention: validate identity, declare the read index.
The writing and pruning policy lives with the export, not here.
"""

import frappe
from frappe.model.document import Document


class BoQRateMasterSnapshot(Document):
    def validate(self):
        if not (self.discipline or "").strip():
            frappe.throw("discipline is required for a rate master snapshot.")


def on_doctype_update():
    """The one query this table serves: the newest snapshots for a discipline (the read, and the
    prune). `discipline` and `import_batch` each carry their own single-column index via
    search_index on the field."""
    frappe.db.add_index("BoQ Rate Master Snapshot", ["discipline", "version"])
