import frappe
from collections import defaultdict
import urllib.parse

def po_sr(doc_type):
    return "SR" if doc_type == "Service Requests" else "PO"

def format_rupee(val):
    if val is None or val == "":
        return ""
    try:
        fval = float(val)
        return "₹" + "{:,.0f}".format(fval)
    except:
        return ""

@frappe.whitelist()
def get_pending_finance_items():
    expenses = []
    payments = []
    invoices = []

    # 1. Project Expenses
    pe = frappe.get_all(
        "Project Expenses",
        filters={"status": "Approved"},
        fields=["name", "type", "description", "amount", "vendor", "vendor.vendor_name", "projects", "projects.project_name"]
    )
    for e in pe:
        expenses.append({
            "key": f"pe-{e.name}",
            "category": "Expense",
            "tag": "Project",
            "title": e.type or e.description or e.name,
            "subtitle": e.get("vendor_name") or e.vendor,
            "amount": e.amount,
            "amount_str": format_rupee(e.amount),
            "linkTo": "/expense/project",
            "project": e.get("project_name") or e.projects,
        })

    # 2. Non Project Expenses
    npe = frappe.get_all(
        "Non Project Expenses",
        filters={"status": "Approved"},
        fields=["name", "type", "description", "amount"]
    )
    for e in npe:
        expenses.append({
            "key": f"npe-{e.name}",
            "category": "Expense",
            "tag": "Non-Project",
            "title": e.type or e.description or e.name,
            "subtitle": e.description,
            "amount": e.amount,
            "amount_str": format_rupee(e.amount),
            "linkTo": "/expense/non-project",
            "project": "Non-Project",
        })

    # 3. Project Payments
    pp = frappe.get_all(
        "Project Payments",
        filters={"status": "Approved"},
        fields=["name", "document_type", "document_name", "amount", "vendor", "vendor.vendor_name", "project", "project.project_name"]
    )
    for p in pp:
        payments.append({
            "key": p.name,
            "category": "Payment",
            "tag": po_sr(p.document_type),
            "title": p.document_name or p.name,
            "subtitle": p.get("vendor_name") or p.vendor,
            "amount": p.amount,
            "amount_str": format_rupee(p.amount),
            "linkTo": f"/project-payments/{urllib.parse.quote(p.name)}",
            "project": p.get("project_name") or p.project,
        })

    # 4. Vendor Invoices
    vi = frappe.get_all(
        "Vendor Invoices",
        filters={"status": "Pending"},
        fields=[
            "name", "invoice_no", "invoice_amount", "vendor", "vendor.vendor_name",
            "project", "project.project_name", "document_type", "document_name"
        ]
    )
    for v in vi:
        parts = [p for p in [v.get("vendor_name") or v.vendor, v.document_name] if p]
        invoices.append({
            "key": v.name,
            "category": "Invoice",
            "tag": po_sr(v.document_type),
            "title": f"Invoice {v.invoice_no}" if v.invoice_no else v.name,
            "subtitle": " · ".join(parts) if parts else None,
            "amount": v.invoice_amount,
            "amount_str": format_rupee(v.invoice_amount),
            "linkTo": "/invoice-reconciliation?tab=pending",
            "project": v.get("project_name") or v.project,
        })

    all_items = expenses + payments + invoices

    def group_and_sort(items_list):
        groups = defaultdict(list)
        for it in items_list:
            proj = it.get("project") or "General"
            groups[proj].append(it)
        
        # Sort keys: Normal projects first alphabetically, then "General"/"Non-Project"
        def sort_key(k):
            if k == "General": return (1, k)
            if k == "Non-Project": return (1, k)
            return (0, k)
            
        sorted_keys = sorted(groups.keys(), key=sort_key)
        return [[k, groups[k]] for k in sorted_keys]

    return {
        "counts": {
            "all": len(all_items),
            "expenses": len(expenses),
            "payments": len(payments),
            "invoices": len(invoices),
        },
        "groups": {
            "all": group_and_sort(all_items),
            "expenses": group_and_sort(expenses),
            "payments": group_and_sort(payments),
            "invoices": group_and_sort(invoices),
        }
    }
