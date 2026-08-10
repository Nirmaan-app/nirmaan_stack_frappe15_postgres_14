# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Outflow Row Match -- one (bank row -> target record) link.

Identity: (transfer_id, target_doctype, target_name), enforced by a real DB unique constraint. That
constraint IS the idempotency guarantee for this feature: one bank transfer may never settle the
same record twice, whether the second attempt comes from a re-upload, an overlapping export, a
double-clicked commit, or a second accountant working the same period.

WHY NOT KEY ON THE UTR, which would be the obvious choice: `Project Payments.utr` cannot carry the
invariant. It is a plain Data field with NO unique constraint and NO index (pg_indexes on
tabProject Payments returns only the primary key); 226 stored values are whitespace-padded and so
invisible to the existing strip-on-read guard; 932 of 7,420 are not bank references at all (PO
numbers, short numbers, the literal string "refund"); and a second writer,
EditFulfilledPaymentDialog, sets it through a raw updateDoc with no strip and no dedup.

ONE ROW MAY LEGITIMATELY HAVE MANY MATCHES. A vendor working across several POs is paid one lump
sum, and Nirmaan records a payment per PO -- measured: 40 such transfers covering 99 payments and
2.53% of all settled value, the largest being one IMPS transfer of Rs 7,289,432 across 7 payments
and 6 projects. The unique constraint is deliberately on the (transfer, TARGET) pair, not on the
transfer alone, so fan-out is representable and only genuine double-settlement is refused.

⚠️ v3: THIS TABLE RECORDS SETTLEMENTS ONLY, and `match_kind` has the single value `Settled`. v2 also
minted a `Reconciled` row per matched target at match time, meaning "matched, nothing written". That
never collided with a settlement only because v2's payment branch could not write, so the two paths
always addressed DIFFERENT targets. Under the v3 spine they address the same one, and a suggestion
would take the unique key before the settlement that needs it -- failing the confirm on exactly the
happy path. Suggestions therefore live in `Outflow Import Row.outcome_note`, with full candidate
detail loaded on demand by `get_row_candidates`. A row in THIS table means money was written.

Immutable once written (track_changes 0) -- a correction supersedes rather than edits.
"""

import frappe
from frappe.model.document import Document


class OutflowRowMatch(Document):
    def validate(self):
        if not (self.transfer_id or "").strip():
            frappe.throw("transfer_id is required for an outflow row match.")
        if not (self.target_doctype or "").strip() or not (self.target_name or "").strip():
            frappe.throw("target_doctype and target_name are required for an outflow row match.")


def on_doctype_update():
    """The idempotency constraint plus the two read indexes.

    EXPLICIT NAMES throughout. PostgreSQL index names are unique per SCHEMA, not per table, and
    Frappe generates them with no table prefix; `CREATE INDEX IF NOT EXISTS` matches by NAME ONLY,
    so a generic generated name colliding with another table's index makes the call a SILENT no-op.

    `add_unique` is itself idempotent -- it probes information_schema for the constraint name before
    issuing the ALTER TABLE -- so re-running a migrate is safe.
    """
    frappe.db.add_index("Outflow Row Match", ["import_batch"], "ofm_match_batch_idx")
    frappe.db.add_index("Outflow Row Match", ["transfer_id"], "ofm_match_transfer_idx")
    frappe.db.add_unique(
        "Outflow Row Match",
        ["transfer_id", "target_doctype", "target_name"],
        "ofm_match_target_unique",
    )
