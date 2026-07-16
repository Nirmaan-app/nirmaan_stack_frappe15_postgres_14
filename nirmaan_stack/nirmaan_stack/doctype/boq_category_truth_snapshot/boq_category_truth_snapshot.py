# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Category Truth Snapshot -- permanent per-(snapshot event x row) ground-truth labels.

The eval truth model is FREEZE SNAPSHOTS, not live human edits: live `BoQ Row Category`
rows are WORKING STATE (a re-classify supersedes them and human verdicts intentionally do
NOT carry forward), while ground truth is BANKED here at explicit events and is PERMANENT
(never deleted -- an unfreeze/reclassify never touches prior snapshots). Identity mirrors
`BoQ Row Category`'s durable Excel address (boq, sheet_name VERBATIM #152, excel_row,
discipline, committed_version) plus a `snapshot_batch` per event; the cockpit joins a snapshot
row to the current classification row by (boq, sheet_name, excel_row, discipline).

Controller stays minimal (per CLAUDE.md doctype convention): validate label_category_id
non-empty; declare the composite read index for the durable-address join. Batch/idempotence
policy lives in the loader (services/boq_category/harness/corpus_classify_and_label.py), not
here.
"""

import frappe
from frappe.model.document import Document


class BoQCategoryTruthSnapshot(Document):
    def validate(self):
        if not (self.label_category_id or "").strip():
            frappe.throw("label_category_id is required for a truth snapshot row.")


def on_doctype_update():
    """Composite read index for the cockpit's durable-address join + per-batch reads. Logical
    uniqueness (one row per address per snapshot_batch) is enforced by the loader, so this is a
    plain index, not a hard unique constraint (migrate-safe across environments)."""
    frappe.db.add_index(
        "BoQ Category Truth Snapshot",
        ["boq", "sheet_name", "excel_row", "discipline", "snapshot_batch"],
    )
