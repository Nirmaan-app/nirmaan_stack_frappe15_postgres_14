# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Seed `amount_invoiced` on every Procurement Order / Service Request.

The field is maintained going forward by the Vendor Invoices doc events
(`integrations/controllers/vendor_invoices.py`), but those only fire when an
invoice is touched — history would sit at the column default of 0 forever. This
patch writes the opening balance.

ONE grouped UPDATE per doctype, not a row loop: the full GROUP BY over Vendor
Invoices returns ~4,487 rows in ~18 ms, so there is no reason to walk documents
in Python. Documents with no approved invoice are left at the column default 0,
which is the correct value for them.

IDEMPOTENT — it derives from source, so re-running it is a no-op on unchanged
data. Safe to re-run at any time if the stored values are ever suspected stale.
"""

import frappe

_PARENTS = ("Procurement Orders", "Service Requests")


def execute():
    for doctype in _PARENTS:
        table = f"tab{doctype}"

        # COALESCE on the aggregate is not needed (the join guarantees a row) but
        # the inner COALESCE is: an invoice with a NULL amount must count as 0,
        # not poison the whole document's sum to NULL.
        frappe.db.sql(
            f"""
            UPDATE "{table}" AS parent
               SET amount_invoiced = totals.amt
              FROM (
                    SELECT vi.document_name AS name,
                           SUM(COALESCE(vi.invoice_amount, 0)) AS amt
                      FROM "tabVendor Invoices" vi
                     WHERE vi.document_type = %(dt)s
                       AND vi.status = 'Approved'
                     GROUP BY vi.document_name
                   ) AS totals
             WHERE parent.name = totals.name
               AND COALESCE(parent.amount_invoiced, 0) IS DISTINCT FROM totals.amt
            """,
            {"dt": doctype},
        )
        written = frappe.db.sql(
            f"""SELECT COUNT(*) FROM "{table}" WHERE COALESCE(amount_invoiced, 0) <> 0"""
        )[0][0]
        print(f"  {doctype}: {written} documents now carry a non-zero amount_invoiced")

    frappe.db.commit()
