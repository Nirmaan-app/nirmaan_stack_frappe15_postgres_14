import frappe


def execute():
    """
    Backfill `status` on legacy Project Expenses.

    Older Project Expenses rows predate the Requested -> Approved -> Paid workflow,
    so their `status` is blank (NULL / '') — and a few legacy rows still carry the
    old 'Pending' value. Treat all of these as already settled: set them to 'Paid'.

    Rows already in Requested / Approved / Paid are left untouched.

    `modified` is intentionally NOT updated (raw SQL leaves the timestamp as-is),
    so the historical audit trail on these rows is preserved.

    Idempotent — safe to re-run.
    """
    frappe.db.sql(
        """
        UPDATE "tabProject Expenses"
        SET status = 'Paid'
        WHERE status IS NULL OR status = '' OR status = 'Requested'
        """
    )

    frappe.db.commit()

    # Summary so the run is never "blind" (shows in `bench migrate` output).
    rows = frappe.db.sql(
        """SELECT COALESCE(NULLIF(status, ''), '(blank)') AS s, COUNT(*) AS n
           FROM "tabProject Expenses" GROUP BY 1 ORDER BY s""",
        as_dict=True,
    )
    dist = {r.s: r.n for r in rows}
    print(f"[backfill_project_expenses_status] done — status distribution now: {dist}")
