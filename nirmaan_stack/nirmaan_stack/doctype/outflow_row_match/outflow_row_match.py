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

IMMUTABLE EXCEPT FOR ONE ONE-WAY STAMP (narrowed at ADR-0020 D3, not dropped). `match_kind` may go
`Settled -> Reversed` exactly once, together with `reversed_at` / `reversed_by` /
`reversal_reason`; every other field stays frozen, and `Reversed -> Settled` is refused. Re-allocating
that payment mints a NEW record, which the PARTIAL unique index permits -- so a correction still
supersedes rather than edits. `track_changes` stays 0: these rows would flood the Version table, and
the reversal stamp IS the audit.
"""

import frappe
from frappe.model.document import Document

_SETTLED = "Settled"
_REVERSED = "Reversed"

# The fields a reversal is allowed to touch. Everything else is frozen after insert.
_REVERSAL_FIELDS = ("match_kind", "reversed_at", "reversed_by", "reversal_reason")


class OutflowRowMatch(Document):
    def validate(self):
        if not (self.transfer_id or "").strip():
            frappe.throw("transfer_id is required for an outflow row match.")
        if not (self.target_doctype or "").strip() or not (self.target_name or "").strip():
            frappe.throw("target_doctype and target_name are required for an outflow row match.")
        self._assert_kind_is_legal()

    def _assert_kind_is_legal(self):
        """The one-way stamp, and the freeze around it (ADR-0020 D3)."""
        if self.is_new():
            if (self.match_kind or "") != _SETTLED:
                frappe.throw(
                    "A match record is created as 'Settled'. A row here means money was written; "
                    "'Reversed' is a stamp applied later, never an initial state."
                )
            return

        before = self.get_doc_before_save()
        if not before:
            return

        if before.match_kind == _REVERSED and self.match_kind == _SETTLED:
            frappe.throw(
                "A reversed settlement cannot be un-reversed. Allocate the payment again -- that "
                "mints a new match record, which the partial unique index permits."
            )

        # ⚠️ EVERY OTHER FIELD IS FROZEN, and the set is DERIVED rather than hand-typed: a field
        # is frozen unless it is explicitly one of the four reversal fields. A hand-typed tuple
        # here is exactly the bug this replaced -- it silently leaves a newly added field (this
        # task's own target_project/target_vendor, plus the pre-existing settlement_origin) fully
        # editable after insert, contradicting both this docstring and their own "SNAPSHOT ...
        # never recomputed" field descriptions. `self.meta.fields` yields only the doctype's OWN
        # fields, so standard `modified`/`modified_by`/`owner` are excluded automatically.
        frozen = [
            f.fieldname
            for f in self.meta.fields
            if f.fieldname not in _REVERSAL_FIELDS
            and f.fieldtype not in ("Section Break", "Column Break")
        ]
        for field in frozen:
            if (before.get(field) or "") != (self.get(field) or ""):
                frappe.throw(
                    f"'{field}' is immutable on a match record. A correction supersedes rather "
                    f"than edits: reverse this record and allocate again."
                )


def on_doctype_update():
    """Three read indexes, one target lookup index, and the PARTIAL unique constraint.

    EXPLICIT NAMES throughout. PostgreSQL index names are unique per SCHEMA, not per table, and
    Frappe generates them with no table prefix; `CREATE INDEX IF NOT EXISTS` matches by NAME ONLY,
    so a generic generated name colliding with another table's index makes the call a SILENT no-op.

    ⚠️ `frappe.db.add_unique` IS DELIBERATELY NO LONGER CALLED HERE (ADR-0020 D4). It issues
    `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE(...)`, and a PostgreSQL table CONSTRAINT can never
    carry a `WHERE` clause -- only `CREATE UNIQUE INDEX ... WHERE` can. Leaving the call in place
    would re-add the non-partial constraint on every migrate, beside the partial index, and a
    correctly-reversed payment could then never be re-allocated to its transfer. The old constraint
    is dropped by `patches/v3_0/outflow_match_partial_unique.py`.

    ⚠️ `ofm_match_target_idx` SERVES A READ THAT DOES NOT EXIST YET AND CANNOT WITHOUT IT. The
    unique index leads with `transfer_id`, so PostgreSQL cannot use it to answer "which transfer
    paid this payment?" -- every reverse-lookup view would be a sequential scan.
    """
    frappe.db.add_index("Outflow Row Match", ["import_batch"], "ofm_match_batch_idx")
    frappe.db.add_index("Outflow Row Match", ["transfer_id"], "ofm_match_transfer_idx")
    frappe.db.add_index("Outflow Row Match", ["import_row"], "ofm_match_import_row_idx")
    frappe.db.add_index(
        "Outflow Row Match", ["target_doctype", "target_name"], "ofm_match_target_idx"
    )
    ensure_settled_target_unique()


def ensure_settled_target_unique():
    """The idempotency guarantee, as a PARTIAL unique index.

    One bank transfer may never settle the same record twice -- but a REVERSED leg must release the
    key, or a corrected mistake could never be re-made correctly. `IF NOT EXISTS` makes re-running
    a migrate safe; the patch calls this function rather than re-inlining the SQL, so the controller
    stays the single source of truth for the index shape.
    """
    frappe.db.sql(
        """CREATE UNIQUE INDEX IF NOT EXISTS ofm_match_settled_target_unique
           ON "tabOutflow Row Match" (transfer_id, target_doctype, target_name)
           WHERE match_kind = 'Settled'"""
    )
