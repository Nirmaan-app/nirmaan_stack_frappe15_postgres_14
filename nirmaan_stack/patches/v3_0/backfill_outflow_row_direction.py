# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Fill `Outflow Import Row.direction` on rows staged before the field existed (bank slice B3).

WHY IT IS NEEDED
    `direction` arrives with the ICICI bank-statement source, which is the first statement that says
    which way the money went. Every row already in the table predates the column and has it blank.
    Left that way, a Direction filter or split over the transactions table reports the entire
    existing history as "(blank)" -- the exact failure `v3_0.backfill_outflow_row_source` was
    written for one slice earlier, and the one `review.py` records from slice Q1 before that: a
    column shipped, drawn, and filtering nothing anybody wants.

WHY `Debit`, AND WHY THAT IS A FACT RATHER THAN A GUESS
    Both existing sources are OUTFLOW-ONLY exports. A Cashfree payout statement lists transfers we
    instructed out; a Cashbook wallet statement lists what a wallet spent. Neither can contain a
    receipt, so every row already staged really did leave the company. The module is called Bulk
    Import Outflow for this reason.

⚠️ SCOPED TO `Cashfree` AND `Cashbook`, AND THE SCOPE IS THE LOAD-BEARING PART
    `parser.py` states, in as many words, that a blank direction "must never be read as 'debit by
    default': a statement that did not say is not the same as one that said Debit". This patch is
    the one place that assertion is allowed, and only because those two sources' formats make it
    true -- so it names them.

    ⚠️ AN ICICI ROW WITH A BLANK DIRECTION MUST NEVER BE TOUCHED BY THIS. On a bank statement blank
    does not mean "the format has one column"; it means the parser found a figure in BOTH the
    Withdrawal and the Deposit column, refused to guess which was the transaction, blanked the
    amount and the direction together and warned about it. Stamping `Debit` on that row would
    manufacture exactly the answer the parser declined to invent -- and would do it invisibly, since
    the row would then look like every ordinary debit beside it. An unscoped `WHERE direction = ''`
    reads as harmless and is not: it is one migrate away from a lie, whenever this patch is re-run
    on a database that has since imported a statement.

    The two names are written out rather than imported from a policy constant on purpose. A patch is
    append-only history: it records what was true on the day it ran, and it must keep meaning that
    after any later set is edited or renamed.

⚠️ WHAT THIS DOES NOT DO, STATED SO THE NEXT READER DOES NOT READ IT AS A RULE
    It does not make Cashfree and Cashbook stage `Debit` GOING FORWARD. Those adapters have a single
    amount column and `parser.py` leaves the field blank for them by design, so after this patch a
    pre-B3 Cashfree row reads `Debit` and a post-B3 one reads blank. That inconsistency is real and
    is flagged for the owner: closing it means teaching the parser that a single-amount-column
    source states Debit, which is a `parser.py` change and out of this slice's scope. Nothing here
    depends on it -- the exclusion rules and the identity key only ever read a direction the
    statement actually stated.

RAW SQL, ONE STATEMENT
    The value is DERIVED -- it restates what the source format already guarantees -- so there is
    nothing to audit, and a `Version` row per transfer would record a change nobody made. Same
    reasoning as `v3_0.backfill_outflow_row_source` and `v3_0.merge_outflow_unmatched_status`, and
    the same shape: one UPDATE ... FROM rather than a per-row write across a thousand rows.

IDEMPOTENT
    `WHERE direction IS NULL OR direction = ''` means a re-run touches nothing, and a row whose
    direction was corrected by hand is left alone rather than overwritten.

The corresponding patches.txt wiring (`nirmaan_stack.patches.v3_0.backfill_outflow_row_direction`
under [post_model_sync]) is added separately by the maintainer -- it is intentionally not part of
this patch.
"""

import frappe


def execute():
    if not frappe.db.has_column("Outflow Import Row", "direction"):
        # The field ships with the same release as this patch; if a migrate somehow runs it before
        # the schema sync, doing nothing is right -- the next migrate will find the column.
        return

    frappe.db.sql(
        """
        UPDATE "tabOutflow Import Row" AS r
        SET direction = 'Debit'
        FROM "tabOutflow Import Batch" AS b
        WHERE b.name = r.import_batch
          AND b.source IN ('Cashfree', 'Cashbook')
          AND (r.direction IS NULL OR r.direction = '')
        """
    )
    frappe.db.commit()
