"""
API endpoint for cross-project item-wise inventory summary.

Aggregates items from the latest submitted Remaining Items Report
per project, joined with max PO rates for estimated cost calculation.
"""

import frappe


@frappe.whitelist()
def get_inventory_item_wise_summary():
    """Return flat per-project-per-item rows from latest submitted reports,
    enriched with max PO quote rates for estimated cost."""

    sql = """
    WITH latest_reports AS (
        SELECT DISTINCT ON (project)
            name, project, report_date
        FROM "tabRemaining Items Report"
        WHERE status = 'Submitted'
        ORDER BY project, report_date DESC
    ),
    report_items AS (
        SELECT
            lr.project,
            lr.report_date,
            ri.item_id,
            ri.item_name,
            ri.unit,
            ri.category,
            ri.remaining_quantity
        FROM latest_reports lr
        JOIN "tabRemaining Item Entry" ri ON ri.parent = lr.name
        WHERE ri.remaining_quantity != -1
          AND ri.remaining_quantity IS NOT NULL
    ),
    max_rates AS (
        SELECT DISTINCT ON (po.project, poi.item_id)
            po.project,
            poi.item_id,
            poi.quote AS max_quote,
            poi.tax AS max_quote_tax
        FROM "tabPurchase Order Item" poi
        JOIN "tabProcurement Orders" po ON poi.parent = po.name
        WHERE po.status NOT IN ('Merged', 'Inactive', 'PO Amendment')
        ORDER BY po.project, poi.item_id, poi.quote DESC
    )
    SELECT
        ri.project,
        p.project_name,
        ri.report_date,
        ri.item_id,
        ri.item_name,
        ri.unit,
        ri.category,
        ri.remaining_quantity,
        COALESCE(mr.max_quote, 0) AS max_rate,
        COALESCE(mr.max_quote_tax, 18) AS tax,
        ri.remaining_quantity * COALESCE(mr.max_quote, 0)
            * (1 + COALESCE(mr.max_quote_tax, 18) / 100.0) AS estimated_cost
    FROM report_items ri
    JOIN "tabProjects" p ON p.name = ri.project
    LEFT JOIN max_rates mr
        ON mr.project = ri.project AND mr.item_id = ri.item_id
    ORDER BY ri.item_id, ri.project
    """

    rows = frappe.db.sql(sql, as_dict=True)
    frappe.db.commit()

    return rows
