"""
Repair two classes of wrong line-item billing_status.

1. Custom PO items a PO Revision flipped to Non-Billable.
   A custom PO item is typed in, so it is never in the Items master. Revision
   approval (api/po_revisions/revision_logic.sync_original_po_items) re-sourced New /
   Replace rows from the master with a Non-Billable fallback, so every such row went
   Non-Billable -- even a pure rename, which keeps the same item_id. Creation makes
   them Billable (procurement_requests.validate: custom PR -> Billable), and no other
   path writes Non-Billable onto a custom, non-master, non-Additional-Charges row, so
   every row matching that shape is this defect. Fixed in code in the same change.

2. Additional Charges rows stored Billable.
   Additional Charges are always Non-Billable. The v3_0 backfill_billing_status patch
   set every non-master row to Billable with no Additional Charges check, which left
   these on custom POs and their PRs.

Raw SQL, so no doc_events fire. The two things derived from these rows are
recomputed here explicitly instead:
  - Procurement Orders.billing_status (the rollup) -- RECOMPUTED FROM THE ITEMS for
    every PO touched, with the same rule as procurement_orders._set_po_billing_status.
  - The Action Center projection (DN / DC pending, and the delivery-pending CEO Hold
    it drives) -- the same deduplicated after-commit reconcile the PO on_update hook
    enqueues, once per affected project. The nightly sweep would also catch it.

Idempotent: a second run matches no rows and changes nothing.
"""

import frappe

from nirmaan_stack.services.action_items.doc_hooks import enqueue_project_reconcile

# Custom PO rows a revision wrongly made Non-Billable.
_CUSTOM_REVISION_ROWS = """
    FROM "tabPurchase Order Item" poi
    JOIN "tabProcurement Orders" po ON po.name = poi.parent
    WHERE po.custom = 'true'
      AND COALESCE(poi.category, '') <> 'Additional Charges'
      AND poi.billing_status = 'Non-Billable'
      AND NOT EXISTS (SELECT 1 FROM "tabItems" i WHERE i.name = TRIM(poi.item_id))
"""

_ADDITIONAL_CHARGES_ROWS = """
    WHERE category = 'Additional Charges'
      AND COALESCE(billing_status, '') <> 'Non-Billable'
"""


def execute():
    stats = apply_fix()
    for project in stats["projects"]:
        enqueue_project_reconcile(project)
    frappe.db.commit()
    _print_summary(stats)


def apply_fix():
    """Write the fix without committing. Returns what it touched (the dry run reads this)."""
    custom_rows = frappe.db.sql(
        f"SELECT poi.name, poi.parent {_CUSTOM_REVISION_ROWS}", as_dict=True
    )
    ac_po_rows = frappe.db.sql(
        f'SELECT name, parent FROM "tabPurchase Order Item" {_ADDITIONAL_CHARGES_ROWS}',
        as_dict=True,
    )
    ac_pr_count = frappe.db.sql(
        f'SELECT COUNT(*) FROM "tabProcurement Request Item Detail" {_ADDITIONAL_CHARGES_ROWS}'
    )[0][0]

    frappe.db.sql(
        f"""UPDATE "tabPurchase Order Item" SET billing_status = 'Billable'
            WHERE name IN (SELECT poi.name {_CUSTOM_REVISION_ROWS})"""
    )
    for child in ("Purchase Order Item", "Procurement Request Item Detail"):
        frappe.db.sql(
            f"""UPDATE "tab{child}" SET billing_status = 'Non-Billable' {_ADDITIONAL_CHARGES_ROWS}"""
        )

    parents = sorted({r.parent for r in custom_rows} | {r.parent for r in ac_po_rows})
    for po in parents:
        # Same rule as procurement_orders._set_po_billing_status: Billable if ANY item is
        # Billable; Non-Billable only if items exist and ALL are Non-Billable; else blank.
        frappe.db.sql(
            """
            UPDATE "tabProcurement Orders" po
            SET billing_status = CASE
                WHEN EXISTS (SELECT 1 FROM "tabPurchase Order Item" it
                             WHERE it.parent = po.name AND it.billing_status = 'Billable')
                    THEN 'Billable'
                WHEN EXISTS (SELECT 1 FROM "tabPurchase Order Item" it WHERE it.parent = po.name)
                 AND NOT EXISTS (SELECT 1 FROM "tabPurchase Order Item" it
                                 WHERE it.parent = po.name
                                   AND COALESCE(it.billing_status, '') <> 'Non-Billable')
                    THEN 'Non-Billable'
                ELSE ''
            END
            WHERE po.name = %s
            """,
            po,
        )

    projects = sorted(
        {p for p in frappe.get_all(
            "Procurement Orders", filters={"name": ["in", parents]}, pluck="project"
        ) if p}
    ) if parents else []

    return {
        "custom_rows": len(custom_rows),
        "custom_pos": sorted({r.parent for r in custom_rows}),
        "ac_po_rows": len(ac_po_rows),
        "ac_pr_rows": ac_pr_count,
        "parents": parents,
        "projects": projects,
    }


def _print_summary(stats):
    print("[fix_revision_and_additional_charges_billing_status] done:")
    print(f"    custom PO items reset to Billable        : {stats['custom_rows']} "
          f"on {len(stats['custom_pos'])} PO(s) {stats['custom_pos']}")
    print(f"    Additional Charges -> Non-Billable (PO)  : {stats['ac_po_rows']}")
    print(f"    Additional Charges -> Non-Billable (PR/SB): {stats['ac_pr_rows']}")
    print(f"    PO rollups recomputed                    : {len(stats['parents'])}")
    print(f"    projects queued for Action Center refresh: {len(stats['projects'])}")
