# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Fill `Outflow Import Row.source` on rows staged before the field existed (Cashbook slice 7).

WHY IT IS NEEDED
    The Source funnel on the transactions table filters `r.source`, a column denormalised from the
    batch. Both staging paths write it now -- but every row imported before the field existed has
    it blank, which on this deployment is ALL 1,043 of them. Without this the control ships, draws
    itself, offers one option reading "(blank)", and filters nothing anybody wants.

    That is the failure this feature has recorded once already, in `review.py`'s own comment beside
    the row payload: at slice Q1 a column was added to `_FACET_COLUMNS` and not to the SELECT, so
    "Settled via" rendered an em dash on 849 rows while the summary beside it reported 843. Every
    suite was green; the browser caught it. A backfill is the third leg of the same lesson.

WHY THE BATCH IS THE SOURCE OF TRUTH
    `Outflow Import Batch.source` has been `reqd` since the doctype shipped, so every row has a
    batch that knows the answer. Nothing is inferred here and nothing can be got wrong.

RAW SQL, ONE STATEMENT
    The value is DERIVED -- it restates what the batch already says -- so there is nothing to audit
    and a `Version` row per transfer would record a change nobody made. That is the same reasoning
    `v3_0.merge_outflow_unmatched_status` gives for the same shape. One UPDATE ... FROM rather than
    1,043 per-row writes.

IDEMPOTENT
    `WHERE source IS NULL OR source = ''` means a re-run touches nothing, and a row whose source was
    corrected by hand is left alone rather than overwritten from the batch.

The corresponding patches.txt wiring (`nirmaan_stack.patches.v3_0.backfill_outflow_row_source`
under [post_model_sync]) is added separately by the maintainer -- it is intentionally not part of
this patch.
"""

import frappe


def execute():
    if not frappe.db.has_column("Outflow Import Row", "source"):
        # The field ships with the same release as this patch; if a migrate somehow runs it before
        # the schema sync, doing nothing is right -- the next migrate will find the column.
        return

    frappe.db.sql(
        """
        UPDATE "tabOutflow Import Row" AS r
        SET source = b.source
        FROM "tabOutflow Import Batch" AS b
        WHERE b.name = r.import_batch
          AND b.source IS NOT NULL
          AND (r.source IS NULL OR r.source = '')
        """
    )
    frappe.db.commit()
