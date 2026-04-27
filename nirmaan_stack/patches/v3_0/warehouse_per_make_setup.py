import frappe


def execute():
    """One-shot setup for the per-(item, make) warehouse-stock keying.

    Step 1: Drop the legacy UNIQUE(item_id) constraint on
            tabWarehouse Stock Item so multiple rows can share an item_id
            as long as their `make` differs.

    Step 2: Backfill `make` on existing Submitted Remaining Item Entry
            rows from the latest Purchase Order Item per (project, item_id).
            Going forward, RemainingItemsReport.validate keeps this
            populated automatically; this step only matters for historical
            rows submitted before that hook existed.

    Both steps are idempotent — safe to re-run.
    """
    _drop_wsi_item_id_unique()
    _backfill_rir_make()


# ---------------------------------------------------------------------------
# Step 1 — drop the legacy WSI UNIQUE(item_id) constraint
# ---------------------------------------------------------------------------

def _drop_wsi_item_id_unique():
    frappe.db.sql_ddl(
        'ALTER TABLE "tabWarehouse Stock Item" '
        'DROP CONSTRAINT IF EXISTS "tabWarehouse Stock Item_item_id_key"'
    )
    # Some Postgres versions leave the backing index even after the
    # constraint is dropped — belt-and-suspenders.
    frappe.db.sql_ddl(
        'DROP INDEX IF EXISTS "tabWarehouse Stock Item_item_id_key"'
    )
    print("warehouse_per_make_setup: legacy UNIQUE(item_id) dropped (if present)")


# ---------------------------------------------------------------------------
# Step 2 — backfill `make` on historical Submitted RIR rows
# ---------------------------------------------------------------------------

def _backfill_rir_make():
    targets = frappe.db.sql(
        """
        SELECT rir.name AS rir_name, rie.name AS child_name,
               rir.project, rie.item_id
        FROM "tabRemaining Items Report" rir
        JOIN "tabRemaining Item Entry" rie ON rie.parent = rir.name
        WHERE rir.status = 'Submitted'
          AND (rie.make IS NULL OR rie.make = '')
          AND rie.item_id IS NOT NULL AND rie.item_id != ''
          AND rir.project IS NOT NULL
        """,
        as_dict=True,
    )
    if not targets:
        print("warehouse_per_make_setup: no RIR rows needed make backfill")
        return

    projects = tuple({t["project"] for t in targets})
    item_ids = tuple({t["item_id"] for t in targets})

    po_rows = frappe.db.sql(
        """
        WITH ranked AS (
            SELECT po.project, poi.item_id, poi.make,
                   ROW_NUMBER() OVER (
                       PARTITION BY po.project, poi.item_id
                       ORDER BY poi.creation DESC
                   ) AS rn
            FROM "tabPurchase Order Item" poi
            JOIN "tabProcurement Orders" po ON poi.parent = po.name
            WHERE po.status NOT IN ('Merged', 'Inactive', 'PO Amendment')
              AND po.project IN %(projects)s
              AND poi.item_id IN %(item_ids)s
        )
        SELECT project, item_id, make FROM ranked WHERE rn = 1
        """,
        {"projects": projects, "item_ids": item_ids},
        as_dict=True,
    )
    lookup = {(r["project"], r["item_id"]): r["make"] for r in po_rows}

    updated = 0
    for t in targets:
        make = lookup.get((t["project"], t["item_id"]))
        if make:
            frappe.db.set_value(
                "Remaining Item Entry",
                t["child_name"],
                "make",
                make,
                update_modified=False,
            )
            updated += 1

    frappe.db.commit()
    print(f"warehouse_per_make_setup: backfilled make on {updated} RIR rows")
