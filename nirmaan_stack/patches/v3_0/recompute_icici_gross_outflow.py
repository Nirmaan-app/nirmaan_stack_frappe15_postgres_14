# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Recompute `Outflow Import Batch.gross_amount` on ICICI imports staged before #1287.

WHY IT IS NEEDED
    `gross_amount` is the figure the upload screen and the Import History list both call
    **Gross Outflow**. Until ticket #1287 the parser summed EVERY successful row into it, whatever
    direction the statement gave. That was harmless while both sources were outflow-only exports, and
    wrong the moment a passbook arrived: an ICICI statement has no status column and no sign, so its
    stored "Gross Outflow" is its withdrawals PLUS its deposits. The one local ICICI import reads
    Rs 4.52 Cr, which is Rs 2.02 Cr out plus Rs 2.50 Cr in.

    New imports are already correct -- `parser.gross_by_direction` is the fix. This patch is only for
    the ones already in the table, so Import History stops showing a number that is roughly double.

WHAT IT RECOMPUTES, AND FROM WHERE
    From the batch's OWN staged rows: the sum of `amount` over rows the statement called a `Debit`.
    RECOMPUTED FROM SOURCE, never adjusted by a delta -- the standing rule for a derived field (root
    `CLAUDE.md`), and here it is what makes the patch provable: run it twice and the second run finds
    the same answer, and an ordinary re-import would land on it too.

⚠️ THE ROW SUM MIRRORS `gross_by_direction`, AND THE TWO HALVES THAT LOOK MISSING ARE NOT
    `gross_by_direction` filters on `is_success` as well as on direction. There is deliberately no
    status term here, because an ICICI row's status is SYNTHETIC: `parser._ICICI_SYNTHETIC_STATUS`
    stamps `SUCCESS` on every row of a passbook, since a passbook only ever lists postings that
    already settled. Adding `AND status_raw = 'SUCCESS'` would be true of every row and would read as
    a guard against a case that cannot occur; leaving it out is the honest spelling. It is also why
    this patch cannot be widened to another source without re-reading that question.

    `TRIM(direction) = 'Debit'` is the same normalisation `status.is_received_direction`, the review
    screen's direction facet and the client's `isCreditRow` all apply, for the reason recorded in the
    domain doc: no stored row carries padding today, which is exactly why every spelling trims.
    A row whose direction the statement never stated is in NEITHER total and so contributes nothing
    here -- on ICICI that is the both-columns-populated row, which the parser blanked deliberately.

⚠️ SCOPED TO `ICICI Bank Statement`, AND THE SCOPE IS LOAD-BEARING
    Cashfree and Cashbook are outflow-only exports, so their stored figure was never wrong -- but
    their rows may still read blank on `direction` (`parser.py` leaves a single-amount-column source
    blank on a row it never saw a figure in, and `v3_0.backfill_outflow_row_direction` only stamped
    the rows that predate the column). A `Debit`-only row sum over those batches would therefore
    silently SHRINK a correct total. The source name is written out rather than imported from a
    constant, on the same reasoning `backfill_outflow_row_direction` records: a patch is append-only
    history and must keep meaning what it meant on the day it ran.

RAW SQL, AND WHY NO DOCUMENT SAVE
    `Outflow Import Batch` has no controller and no `doc_events` (checked: nothing for it under
    `integrations/controllers/`), so there is no lifecycle to skip and nothing derived from this field
    to leave stale. `update_modified` is deliberately NOT bumped: the batch was not edited, a stale
    derivation was corrected, and moving `modified` would make an audit read as a change someone made.

IDEMPOTENT
    It writes only where the stored figure actually differs from the recomputed one, so a second run
    updates zero rows. A batch with no staged rows at all is left alone rather than zeroed -- an
    absent row set is not evidence that nothing was paid out.

⚠️ `batches=` IS FOR THE TEST SUITE, AND THE REASON IS NOT TIDINESS
    The suites for this module run against the LIVE site database. A test that called `execute()`
    would recompute every real ICICI import on the developer's site as a side effect of asserting one
    fixture. So the work is a function that takes an optional scope, exactly as
    `v3_0.backfill_outflow_skip_origin.backfill_skip_origin` does, and `execute()` is the unscoped
    call. It returns the batches it changed, so a caller can prove the second run changed nothing.
"""

import frappe

_SOURCE = "ICICI Bank Statement"


def recompute_gross_outflow(batches: list[str] | None = None) -> dict[str, float]:
    """Correct `gross_amount` on ICICI batches. Returns `{batch: new_total}` for what it CHANGED.

    `batches=None` means every ICICI batch on the site -- what `execute()` wants and what a test must
    never ask for. An EMPTY list means nothing, and returns `{}` without touching the database; that
    distinction matters, because a scoped caller with no rows must not fall through to "all".
    """
    for column in ("gross_amount", "source"):
        if not frappe.db.has_column("Outflow Import Batch", column):
            # Nothing to correct on a database that has not synced this doctype yet; the next
            # migrate will find it.
            return {}
    if not frappe.db.has_column("Outflow Import Row", "direction"):
        return {}
    if batches is not None and not batches:
        return {}

    scope = "" if batches is None else " AND b.name IN %(batches)s"
    changed = frappe.db.sql(
        f"""
        UPDATE "tabOutflow Import Batch" AS b
        SET gross_amount = d.debit_total
        FROM (
            SELECT r.import_batch AS batch,
                   SUM(CASE WHEN TRIM(COALESCE(r.direction, '')) = 'Debit'
                            THEN COALESCE(r.amount, 0) ELSE 0 END) AS debit_total
              FROM "tabOutflow Import Row" AS r
             GROUP BY r.import_batch
        ) AS d
        WHERE d.batch = b.name
          AND b.source = %(source)s
          AND COALESCE(b.gross_amount, 0) <> d.debit_total{scope}
        RETURNING b.name, b.gross_amount
        """,
        {"source": _SOURCE, "batches": tuple(batches) if batches else ()},
        as_dict=True,
    )
    frappe.db.commit()
    return {row["name"]: float(row["gross_amount"]) for row in changed}


def execute():
    recompute_gross_outflow()
