import frappe


def execute():
    # """
    # Backfill billing_status on existing line items from the Items master.

    # Targets the two child tables:
    #   - Procurement Request Item Detail  (one child doctype for BOTH Procurement
    #     Request order_list AND Sent Back Category order_list)
    #   - Purchase Order Item              (Purchase Order items child table)

    # Rule per row:
    #   billing_status = the item's master billing_category, OR
    #   'Billable' when the item is not in the master (legacy custom / Request items)
    #   or the master value is blank.

    # item_id is TRIM()'d before the master lookup so a handful of legacy rows with a
    # stray leading/trailing space (e.g. ' ITEM-001482') still resolve to their real
    # catalog value instead of falling back to Billable.

    # After the line items are fixed, the PO parent rollup (Procurement Orders.
    # billing_status) is recomputed from them: Billable if any item is Billable,
    # Non-Billable if items exist and all are Non-Billable, else blank.

    # Idempotent — safe to re-run. Uses bulk UPDATEs keyed by item_id / parent.
    # """
    for child in ("Procurement Request Item Detail", "Purchase Order Item"):
        frappe.db.sql(
            f"""
            UPDATE "tab{child}" t
            SET billing_status = COALESCE(
                NULLIF(
                    (SELECT i.billing_category FROM "tabItems" i WHERE i.name = TRIM(t.item_id)),
                    ''
                ),
                'Billable'
            )
            """
        )

    # Recompute the PO-level rollup from the (now corrected) PO items.
    frappe.db.sql(
        """
        UPDATE "tabProcurement Orders" po
        SET billing_status = CASE
            WHEN EXISTS (SELECT 1 FROM "tabPurchase Order Item" it
                         WHERE it.parent = po.name AND it.billing_status = 'Billable') THEN 'Billable'
            WHEN EXISTS (SELECT 1 FROM "tabPurchase Order Item" it
                         WHERE it.parent = po.name) THEN 'Non-Billable'
            ELSE ''
        END
        """
    )

    frappe.db.commit()

    # Print a result summary so the run is never "blind" (shows in `bench migrate` output).
    def _dist(table):
        rows = frappe.db.sql(
            f"""SELECT COALESCE(NULLIF(billing_status, ''), '(blank)') AS s, COUNT(*) AS n
                FROM "{table}" GROUP BY 1 ORDER BY s""",
            as_dict=True,
        )
        return {r.s: r.n for r in rows}

    pr = _dist("tabProcurement Request Item Detail")
    po = _dist("tabPurchase Order Item")
    parent = _dist("tabProcurement Orders")
    print("[backfill_billing_status] done — result counts:")
    print(f"    PR + SB line items : total={sum(pr.values())}  {pr}")
    print(f"    PO line items      : total={sum(po.values())}  {po}")
    print(f"    PO parent rollup   : total={sum(parent.values())}  {parent}")
