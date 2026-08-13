# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Date the expenses the first Cashbook import created without a `payment_date`.

WHAT WENT WRONG
    `api/outflow_import/cashbook._write_one` passed a raw `frappe.get_doc` to
    `settle.create_expense_from_row`, which reads its argument BY ATTRIBUTE and wants
    `added_on_date` -- a value DERIVED by the `review._StagedRow` adapter that does not exist on a
    `Document`. `getattr(row, "added_on_date", None)` therefore returned None in silence and every
    expense was created undated. Every other field was correct and nothing raised.

    On the first production import that is 115 records. The fix is committed alongside this patch,
    and a regression test asserts the date against the row's own stored `added_on` -- proven red
    against the old code before it was made green.

WHY THE DATA CAN BE REPAIRED AT ALL
    Nothing was lost. `Outflow Import Row.added_on` holds the statement's own date for every row,
    and `Outflow Row Match` links each row to the expense it created, so the correct value is a
    join away. This restates what the import should have written; it invents nothing.

⚠️ IT ONLY EVER FILLS A BLANK
    `WHERE payment_date IS NULL` -- an expense somebody has since dated by hand keeps their date.
    That also makes it idempotent, so a re-run touches nothing.

⚠️ IT IS SCOPED TO CASHBOOK-CREATED EXPENSES
    Joined through `Outflow Row Match` on `match_basis = 'cashbook remark'`, so it cannot reach an
    expense this import never made. A blank `payment_date` elsewhere in the ledger is somebody
    else's business and may well be deliberate.

RAW SQL, TWO STATEMENTS
    The value is RESTORED rather than decided, so there is nothing to audit and a `Version` row per
    expense would record a change nobody made -- the same reasoning `merge_outflow_unmatched_status`
    and `backfill_outflow_row_source` give. Two statements because the two expense doctypes are
    separate tables.

The corresponding patches.txt wiring
(`nirmaan_stack.patches.v3_0.fix_cashbook_expense_payment_date` under [post_model_sync]) is added
separately by the maintainer -- it is intentionally not part of this patch.
"""

import frappe

MATCH_BASIS = "cashbook remark"


def execute():
    for doctype, table in (
        ("Project Expenses", "tabProject Expenses"),
        ("Non Project Expenses", "tabNon Project Expenses"),
    ):
        frappe.db.sql(
            f"""
            UPDATE "{table}" AS e
            SET payment_date = r.added_on::date
            FROM "tabOutflow Row Match" AS m
            JOIN "tabOutflow Import Row" AS r ON r.name = m.import_row
            WHERE m.target_doctype = %s
              AND m.target_name = e.name
              AND m.match_basis = %s
              AND r.added_on IS NOT NULL
              AND e.payment_date IS NULL
            """,
            (doctype, MATCH_BASIS),
        )
    frappe.db.commit()
