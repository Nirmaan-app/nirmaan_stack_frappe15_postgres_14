# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Outflow Import Row -- one transfer from an uploaded bank-outflow statement.

Identity: (import_batch, transfer_id). The raw statement columns are stored VERBATIM and are never
rewritten; everything the matcher computes lands in the derived section beside them, so the original
is always recoverable and a re-match never destroys evidence.

WHY THIS IS A SEPARATE DOCTYPE AND NOT A CHILD TABLE OF THE BATCH -- the two decisive reasons:
reading a child table loads the WHOLE parent on every access, and this row's matches would then be
GRANDCHILDREN, which Frappe never hydrates (get_doc / the REST resource API go one level deep only).
Matches therefore live in their own linked doctype, Outflow Row Match.

`row_status` is DERIVED by services/outflow_import/status.py -- the single deriver -- and written by
the api/outflow_import write path. Nothing else may set it.

Controller stays minimal; the write path owns the invariants.
"""

import frappe
from frappe.model.document import Document


class OutflowImportRow(Document):
    def validate(self):
        if not (self.import_batch or "").strip():
            frappe.throw("import_batch is required for an outflow import row.")
        if not (self.transfer_id or "").strip():
            frappe.throw("transfer_id is required for an outflow import row.")


def on_doctype_update():
    """Read indexes: rows-of-a-batch (the review screen) and the cross-batch duplicate probe.

    EXPLICIT INDEX NAMES, and it is load-bearing: PostgreSQL index names are unique per SCHEMA, not
    per table, and Frappe generates them with no table prefix. `CREATE INDEX IF NOT EXISTS` matches
    by NAME ONLY, so a generic generated name that already exists on another table makes this a
    SILENT no-op -- the index simply never appears and nothing reports it.
    """
    frappe.db.add_index("Outflow Import Row", ["import_batch", "row_status"], "ofr_row_batch_status_idx")
    frappe.db.add_index("Outflow Import Row", ["transfer_id"], "ofr_row_transfer_idx")
