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
    """Read indexes: rows-of-a-batch, the cross-batch duplicate probe, the master table, and stacks.

    EXPLICIT INDEX NAMES, and it is load-bearing: PostgreSQL index names are unique per SCHEMA, not
    per table, and Frappe generates them with no table prefix. `CREATE INDEX IF NOT EXISTS` matches
    by NAME ONLY, so a generic generated name that already exists on another table makes this a
    SILENT no-op -- the index simply never appears and nothing reports it.

    ⚠️ THE THIRD INDEX IS THE ONE X3 ADDED, AND ITS COLUMN ORDER IS THE WHOLE POINT. The master
    table queries ACROSS every import: it filters on `row_status` (the three tabs are status sets)
    and orders by `added_on`. The existing `(import_batch, row_status)` index cannot serve that --
    its leading column is the one the master query does NOT constrain. Equality column first,
    ordering column second, so the scope filter and the sort are one index scan.

    ⚠️ THE FOURTH INDEX SERVES THE STACK PASS (chunk E). `_resolve_stacks` asks for every OPEN row
    in the WHOLE table whose `(normalized_account, amount)` is one of this batch's -- a stack spans
    imports by design, so there is no `import_batch` to constrain on. The row-constructor `IN`
    reads both columns for equality, so they lead the index in that order; `row_status` trails
    because it is the narrowing filter, not the access path.

    ⚠️ A PLAIN `bench migrate` DOES NOT FIRE THIS for a controller-only change, so an
    already-deployed database needs a patch that CALLS this function rather than re-inlining the
    `add_index` -- one source of truth. TWO patches now do:
    `patches/v3_0/add_outflow_master_index.py` (the third index) and
    `patches/v3_0/add_outflow_stack_index.py` (the fourth). Either one applies all four, because
    both call this same hook -- which is the point of not re-inlining, and why a missed patch is
    survivable. A fresh site syncs all four here and both patches are no-ops.
    """
    frappe.db.add_index("Outflow Import Row", ["import_batch", "row_status"], "ofr_row_batch_status_idx")
    frappe.db.add_index("Outflow Import Row", ["transfer_id"], "ofr_row_transfer_idx")
    frappe.db.add_index("Outflow Import Row", ["row_status", "added_on"], "ofr_row_status_added_idx")
    frappe.db.add_index(
        "Outflow Import Row",
        ["normalized_account", "amount", "row_status"],
        "ofr_row_account_amount_idx",
    )
