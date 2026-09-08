import frappe
from frappe.utils import flt

# `Project Inflows.amount` is a Data (varchar) column, so it has to be coerced in SQL.
# This mirrors `frappe.utils.flt`: strip commas + surrounding whitespace, take the value
# when what remains is numeric, and fall back to 0 for anything else (flt returns 0.0 for
# junk rather than raising, and a bare ::numeric cast would error the whole query instead).
_INFLOW_AMOUNT_SQL = r"""
    CASE
        WHEN btrim(replace(COALESCE(amount, ''), ',', '')) ~ '^-?([0-9]+\.?[0-9]*|\.[0-9]+)$'
        THEN btrim(replace(amount, ',', ''))::numeric
        ELSE 0
    END
"""


@frappe.whitelist()
def get_customer_receivables_report():
    """
    Invoices vs inflows per CUSTOMER, for the Customer Receivable report.

    One row per customer -- not per project. A customer's outstanding balance is a
    property of the customer, so projects are rolled up rather than listed.

    Rows are NOT filtered on `project` being set: this is a customer-level total, so an
    invoice or inflow with no project still belongs in it. That also makes these totals
    equal the customer ledger's (`api/customers/customer_ledger`) by construction -- the
    ledger is customer-scoped and has no project requirement either.

    Aggregated in the DATABASE (one GROUP BY over a UNION ALL) rather than by looping
    every row in Python -- ADR-0010 rule B5.
    """
    rows = frappe.db.sql(
        f"""
        SELECT
            t.customer                                       AS customer,
            COALESCE(
                NULLIF(c.company_name, ''),
                NULLIF(c.customer_nickname, ''),
                t.customer
            )                                                AS customer_name,
            SUM(t.invoiced)                                  AS total_invoices,
            SUM(t.inflow)                                    AS total_inflow
        FROM (
            SELECT customer, COALESCE(amount, 0) AS invoiced, 0 AS inflow
            FROM "tabProject Invoices"
            WHERE COALESCE(customer, '') <> ''

            UNION ALL

            SELECT customer, 0 AS invoiced, {_INFLOW_AMOUNT_SQL} AS inflow
            FROM "tabProject Inflows"
            WHERE COALESCE(customer, '') <> ''
        ) t
        LEFT JOIN "tabCustomers" c ON c.name = t.customer
        GROUP BY t.customer, c.company_name, c.customer_nickname
        """,
        as_dict=True,
    )

    result = []
    for row in rows:
        # SUM() comes back as Decimal on PostgreSQL; flt() keeps the payload plain floats,
        # which is what the report's numeric column sort relies on.
        total_invoices = flt(row.get("total_invoices"))
        total_inflow = flt(row.get("total_inflow"))
        result.append({
            "customer": row.get("customer"),
            "customer_name": row.get("customer_name") or row.get("customer"),
            "total_invoices": total_invoices,
            "total_inflow": total_inflow,
            "total_receivable": total_invoices - total_inflow,
        })

    # Sorted in Python, not SQL: `.lower()` and the database's collation can disagree on
    # non-ASCII names.
    result.sort(key=lambda x: str(x["customer_name"]).lower())

    return result
