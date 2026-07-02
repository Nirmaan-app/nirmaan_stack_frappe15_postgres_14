import frappe


def execute():
    """
    Backfill `status` on legacy Non Project Expenses.

    These rows predate the Requested -> Approved -> Paid workflow. When the `status`
    column was added, Frappe applied the field default ('Requested') to every existing
    row, so legacy rows read as 'Requested' (NOT blank). This patch therefore treats
    NULL / '' / 'Requested' as "unclassified legacy" and re-classifies them:
      - a payment attachment is present  -> Paid
      - otherwise                        -> Approved
    Rows already advanced to Approved / Paid are left untouched.

    Raw SQL is used deliberately so the `modified` timestamp is preserved.
    """
    # Legacy rows that already have a payment attachment -> Paid.
    frappe.db.sql(
        """
        UPDATE "tabNon Project Expenses"
        SET status = 'Paid'
        WHERE (status IS NULL OR status = '' OR status = 'Requested')
          AND payment_attachment IS NOT NULL
          AND payment_attachment != ''
        """
    )
    # Everything else still unclassified -> Approved.
    frappe.db.sql(
        """
        UPDATE "tabNon Project Expenses"
        SET status = 'Approved'
        WHERE status IS NULL OR status = '' OR status = 'Requested'
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
    print(f"[backfill_non_project_expenses_status] done — status distribution now: {dist}")
