# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Fill `Outflow Import Row.settlement_reference` on rows staged before the field existed.

WHY IT IS NEEDED (ADR-0020 B9)
    `settlement_reference` is the ONE value every settlement write site now reads. A row staged
    before the column existed has it blank, so re-opening such a row and settling it would write
    the blank -- which is precisely the defect the field was added to close, preserved on exactly
    the rows most likely to be worked next.

    The defect is LATENT rather than live, and the numbers are worth writing down because they are
    what makes this patch safe to run at leisure (measured 2026-09-10): 61 Cashfree rows carry a
    blank `bank_reference_no`, ALL 61 are `Skipped`, and blank-`utr` payments in the database are
    ZERO out of 344 settled legs. Nothing on the ledger is wrong today; this stops it becoming
    wrong on the day one of those rows is re-decided.

THE LADDER, AND WHY IT IS SPELLED OUT HERE RATHER THAN IMPORTED
    `bank_reference_no` if present, else `reference_id` (the gateway's own reference, extracted
    since the first slice and until now unused), else -- for a source whose transfer id is its only
    reference -- `transfer_id`. That is `services/outflow_import/settlement_reference
    .resolve_settlement_reference`, restated in SQL.

    ⚠️ RESTATED, NOT IMPORTED, AND THE DUPLICATION IS DELIBERATE. A patch is append-only history:
    it records what was true on the day it ran and must keep meaning that after the resolver is
    later extended. Calling the live function would silently re-derive old rows under whatever the
    ladder says in a year's time. `v3_0.backfill_outflow_row_direction` writes out its two source
    names for the same reason.

⚠️ THE THIRD RUNG IS SCOPED TO `Cashbook`, AND THE SCOPE IS THE LOAD-BEARING PART
    Every source has a `transfer_id`. Only the petty-cash wallet has NOTHING ELSE -- its export
    maps neither reference column, deliberately and permanently -- which is what makes its
    transaction id a settlement reference rather than a fourth identifier nobody reconciles
    against. An unscoped third rung reads as harmless and is not: it would stamp a gateway's own
    transfer id into `Project Payments.utr` on 2,237 Cashfree rows that the owner never asked for,
    invisibly, in a column that already holds hundreds of non-bank strings.

    The source is read from the BATCH, not from the row's denormalised copy: `source` was itself
    added to rows late (`v3_0.backfill_outflow_row_source`) and the batch column is the original.

⚠️ THIS DOES NOT TOUCH ANY SETTLED RECORD
    It fills a column on import rows. It does not go back and write a reference onto a
    `Project Payment`, an expense or an inflow that settled with a blank one -- there are none
    (0 of 344), and rewriting a settled ledger row from a patch would be a change to money records
    with no human decision behind it.

RAW SQL, ONE STATEMENT -- AND `Outflow Import Row` CARRIES NO `doc_events`
    Root `CLAUDE.md` requires a raw `UPDATE` against a doctype with lifecycle hooks to say so at the
    call site and either invoke the affected recompute or state why skipping it is correct. Stated,
    because the absence is the answer and a reader should not have to go and check: this doctype has
    NO entry in `hooks.py` `doc_events` and no controller, so there is nothing for a raw write to
    bypass. Nothing anywhere is derived FROM this column either -- it is read at settlement and by
    nothing else.

    The value is itself DERIVED -- it restates fields already sitting on the same row -- so there is
    nothing to audit and a `Version` row per transfer would record a change nobody made. It is
    RECOMPUTED FROM SOURCE rather than incremented by a delta, so an ordinary re-run repairs it
    exactly. Same reasoning and same shape as `v3_0.backfill_outflow_row_direction`: one
    `UPDATE ... FROM` rather than a per-row write across thousands of rows.

IDEMPOTENT
    `WHERE settlement_reference IS NULL OR = ''` means a re-run touches nothing, and the trailing
    "at least one rung has something" clause keeps it from rewriting NULL over NULL on the rows
    that genuinely have no reference to offer.

⚠️ THE `patches.txt` WIRING IS PART OF THIS CHANGE, UNLIKE ITS TWO SIBLINGS
    `v3_0.backfill_outflow_row_direction` and `v3_0.backfill_outflow_row_source` each leave the
    wiring to the maintainer and say so. The maintainer asked for it inline here, so
    `nirmaan_stack.patches.v3_0.backfill_outflow_settlement_reference` sits under `[post_model_sync]`
    in `patches.txt` in the same commit.

    ⚠️ THAT REMOVES THE DEPLOY WINDOW ON THIS SITE, AND ONLY ON THIS SITE. The floor in
    `settlement_reference.settlement_reference_of_row` stays: a database that has not yet run this
    migrate -- another developer's, a staging copy restored from an older dump -- still has the
    column NULL on every row, and the floor is what keeps those settling correctly. Its removal
    condition is unchanged: the recompute goes when every database has run this patch.
"""

import frappe


def execute():
    if not frappe.db.has_column("Outflow Import Row", "settlement_reference"):
        # The field ships with the same release as this patch; if a migrate somehow runs it before
        # the schema sync, doing nothing is right -- the next migrate will find the column.
        return

    frappe.db.sql(
        """
        UPDATE "tabOutflow Import Row" AS r
        SET settlement_reference = COALESCE(
            NULLIF(btrim(r.bank_reference_no), ''),
            NULLIF(btrim(r.reference_id), ''),
            CASE
                WHEN b.source = 'Cashbook' THEN NULLIF(btrim(r.transfer_id), '')
            END
        )
        FROM "tabOutflow Import Batch" AS b
        WHERE b.name = r.import_batch
          AND (r.settlement_reference IS NULL OR r.settlement_reference = '')
          AND (
                NULLIF(btrim(r.bank_reference_no), '') IS NOT NULL
             OR NULLIF(btrim(r.reference_id), '') IS NOT NULL
             OR (b.source = 'Cashbook' AND NULLIF(btrim(r.transfer_id), '') IS NOT NULL)
          )
        """
    )
    frappe.db.commit()
