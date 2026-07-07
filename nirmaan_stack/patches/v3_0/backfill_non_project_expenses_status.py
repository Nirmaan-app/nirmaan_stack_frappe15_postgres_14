import frappe


def execute():
    """
    Settle legacy Non Project Expenses -> `Paid` (attachment check removed).

    Originally this patch split legacy rows by payment attachment (attachment ->
    Paid, none -> Approved). Per the owner's decision the attachment distinction
    is dropped and every non-`Paid` row is settled: any row in `Approved`,
    `Requested`, or unclassified (NULL/blank) is moved straight to `Paid`. In
    effect every Non Project Expense ends up `Paid`.

    This patch has only ever run on the local/dev site, so it is edited in place
    and its version tag bumped (#v2 -> #v3) to force a re-run instead of shipping
    a separate patch.

    Raw SQL is used deliberately so the `modified` timestamp is preserved.
    """
    frappe.db.sql(
        """
        UPDATE "tabNon Project Expenses"
        SET status = 'Paid'
        WHERE status = 'Approved'
           OR status IS NULL
           OR status = ''
           OR status = 'Requested'
        """
    )

    frappe.db.commit()

    # Summary so the run is never "blind" (shows in `bench migrate` output).
    rows = frappe.db.sql(
        """SELECT COALESCE(NULLIF(status, ''), '(blank)') AS s, COUNT(*) AS n
           FROM "tabNon Project Expenses" GROUP BY 1 ORDER BY s""",
        as_dict=True,
    )
    dist = {r.s: r.n for r in rows}
    print(
        "[backfill_non_project_expenses_status] done — "
        f"status distribution now: {dist}"
    )
