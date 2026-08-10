# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Outflow Import Batch -- one uploaded bank-outflow statement.

Identity: the uploaded file plus the period it covers. Holds the source statement (the file lives
HERE AND ONLY HERE -- owner ruling R3) and the denormalised progress counters the import list
renders.

LIFECYCLE: Draft -> In Review -> Partially Settled -> Completed / Completed with exceptions.
`status` and every counter are DERIVED by services/outflow_import/status.py and written by the
api/outflow_import write path; nothing else may set them.

THE FEATURE'S SPINE, restated here because it is the invariant most easily lost: the PAYMENT branch
is READ-ONLY and the EXPENSE branch WRITES. Nothing reachable from this doctype may write to
Project Payments, PO Payment Terms, or a Procurement Order's amount_paid. Accountants mark payments
Paid by hand at transfer time (owner decision R1, 2026-08-06), so by upload time a payment is
already settled and there is nothing left to fulfil -- only to reconcile and report.

Controller stays minimal; the write path in api/outflow_import owns the invariants.
"""

import frappe
from frappe.model.document import Document


class OutflowImportBatch(Document):
    def validate(self):
        if not (self.source or "").strip():
            frappe.throw("source is required for an outflow import batch.")


def on_doctype_update():
    """Read index for the import list (source + period) and the overlap probe.

    EXPLICIT INDEX NAME, and it is load-bearing: PostgreSQL index names are unique per SCHEMA, not
    per table, and Frappe generates them with no table prefix (`get_index_name` -> e.g.
    `source_period_from_index`). `CREATE INDEX IF NOT EXISTS` then matches by NAME ONLY, so a
    generic generated name that already exists elsewhere makes this a SILENT no-op.
    """
    frappe.db.add_index("Outflow Import Batch", ["source", "period_from"], "ofi_batch_source_period_idx")
