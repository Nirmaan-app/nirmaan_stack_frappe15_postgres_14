# nirmaan_stack/nirmaan_stack/api/customers/customer_ledger.py

import frappe
from frappe.utils import flt, getdate


@frappe.whitelist()
def get_customer_ledger_data(customer_id):
    """
    Flat, chronologically sorted receivable ledger for one customer.

    Two transaction sources, both already carrying a `customer` link (verified
    non-null on every live row), so neither needs a project-scoped IN list:
      * Project Invoices -> money billed TO the customer
      * Project Inflows  -> money received FROM the customer

    Unlike the vendor ledger this has NO opening balance and NO start-date
    cutoff: the running receivable is seeded at 0 and covers full history.

    Amounts are in rupees. Invoice amount is `amount` (INCL. GST) so it is
    comparable with inflows, which are actual cash received incl. GST.
    """
    if not customer_id:
        frappe.throw("Customer ID is a required parameter.")

    transactions = []

    # --- Step 1: Invoices raised on the customer ---
    invoices = frappe.get_all(
        "Project Invoices",
        filters={"customer": customer_id},
        fields=[
            "name", "project", "invoice_no", "invoice_date",
            "amount", "creation",
        ],
    )

    # --- Step 2: Inflows received from the customer ---
    # `amount` is a Data (varchar) field on this doctype -- flt() is mandatory,
    # a raw compare/sum would be lexicographic.
    inflows = frappe.get_all(
        "Project Inflows",
        filters={"customer": customer_id},
        fields=["name", "project", "utr", "payment_date", "amount", "creation"],
    )

    # --- Step 3: Resolve project id -> project_name in one query ---
    project_ids = {row.get("project") for row in invoices + inflows if row.get("project")}
    project_name_map = {}
    if project_ids:
        project_docs = frappe.get_all(
            "Projects",
            filters={"name": ["in", list(project_ids)]},
            fields=["name", "project_name"],
        )
        project_name_map = {p.name: p.project_name for p in project_docs}

    def resolve_project(project_id):
        return project_name_map.get(project_id, project_id or "N/A")

    def txn_date(explicit, creation):
        """
        Neither `invoice_date` nor `payment_date` is a required field, and
        `getdate(None)` silently returns TODAY -- which would park an undated
        row at the end of the ledger under a date it never had. Fall back to
        the row's creation date instead: the amount still counts toward the
        receivable, at a position that is at least defensible.
        """
        return getdate(explicit) if explicit else getdate(creation)

    for inv in invoices:
        transactions.append({
            "type": "Invoice Raised",
            "date": txn_date(inv.get("invoice_date"), inv.get("creation")),
            "creation": inv.get("creation"),
            "project": resolve_project(inv.get("project")),
            "project_id": inv.get("project") or "",
            "details": f"Invoice No: {inv.get('invoice_no') or 'N/A'}\nRef: {inv.get('name')}",
            "invoice": flt(inv.get("amount")),
            "inflow": 0,
        })

    for inf in inflows:
        transactions.append({
            "type": "Inflow Received",
            "date": txn_date(inf.get("payment_date"), inf.get("creation")),
            "creation": inf.get("creation"),
            "project": resolve_project(inf.get("project")),
            "project_id": inf.get("project") or "",
            "details": f"UTR: {inf.get('utr') or 'N/A'}\nRef: {inf.get('name')}",
            "invoice": 0,
            "inflow": flt(inf.get("amount")),
        })

    # --- Step 4: Sort ---
    # invoice_date / payment_date are date-only, so same-day rows would order
    # arbitrarily; `creation` is the stable tiebreak.
    transactions.sort(key=lambda t: (t["date"], t["creation"]))

    for t in transactions:
        t["date"] = t["date"].strftime("%Y-%m-%d")
        t.pop("creation", None)

    return transactions
