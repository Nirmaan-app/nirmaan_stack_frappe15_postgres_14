"""
API endpoints for the Remaining Items Report feature.

Provides endpoints to submit, retrieve, and manage remaining items reports
for projects. These reports track the remaining quantities of items
against their delivered quantities.
"""

import json

import frappe
from frappe.utils import today


@frappe.whitelist()
def submit_remaining_items_report(project, report_date, items):
    """Create or update a remaining items report for a project on a given date."""

    # Enforce report_date == today
    if str(report_date) != today():
        frappe.throw("Reports can only be submitted for today's date")

    # Parse items if string (from frontend)
    if isinstance(items, str):
        items = json.loads(items)

    # Check for existing report (same project + date)
    existing = frappe.db.get_value(
        "Remaining Items Report",
        {"project": project, "report_date": report_date},
        "name",
    )

    if existing:
        # Update existing report
        doc = frappe.get_doc("Remaining Items Report", existing)
        doc.items = []  # Clear existing child items
        for item in items:
            doc.append("items", {
                "item_id": item.get("item_id"),
                "item_name": item.get("item_name"),
                "unit": item.get("unit"),
                "category": item.get("category"),
                "dn_quantity": item.get("dn_quantity"),
                "remaining_quantity": item.get("remaining_quantity") if item.get("remaining_quantity") is not None else None,
            })
        doc.submitted_by = frappe.session.user
        doc.status = "Submitted"
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        return {"status": "success", "name": doc.name, "action": "updated"}
    else:
        # Create new report
        doc = frappe.new_doc("Remaining Items Report")
        doc.project = project
        doc.report_date = report_date
        doc.submitted_by = frappe.session.user
        doc.status = "Submitted"
        for item in items:
            doc.append("items", {
                "item_id": item.get("item_id"),
                "item_name": item.get("item_name"),
                "unit": item.get("unit"),
                "category": item.get("category"),
                "dn_quantity": item.get("dn_quantity"),
                "remaining_quantity": item.get("remaining_quantity") if item.get("remaining_quantity") is not None else None,
            })
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return {"status": "success", "name": doc.name, "action": "created"}


@frappe.whitelist()
def get_latest_remaining_quantities(project):
    """Get the latest submitted report's remaining quantities for a project."""
    latest = frappe.get_all(
        "Remaining Items Report",
        filters={"project": project, "status": "Submitted"},
        fields=["name", "report_date"],
        order_by="report_date desc",
        limit=1,
    )

    if not latest:
        return {"report_date": None, "submitted_by": None, "submitted_by_full_name": None, "items": {}}

    doc = frappe.get_doc("Remaining Items Report", latest[0].name)
    submitted_by_full_name = None
    if doc.submitted_by:
        submitted_by_full_name = frappe.db.get_value("User", doc.submitted_by, "full_name") or doc.submitted_by
    items_dict = {}
    for item in doc.items:
        key = f"{item.category}_{item.item_id}"
        items_dict[key] = {
            "remaining_quantity": item.remaining_quantity,
            "dn_quantity": item.dn_quantity,
        }

    return {"report_date": str(doc.report_date), "submitted_by": doc.submitted_by, "submitted_by_full_name": submitted_by_full_name, "items": items_dict}


@frappe.whitelist()
def get_remaining_reports_for_project(project, limit=5):
    """Get the last N submitted reports with all child items for pivot table display."""
    limit = int(limit)
    reports = frappe.get_all(
        "Remaining Items Report",
        filters={"project": project, "status": "Submitted"},
        fields=["name", "report_date", "submitted_by"],
        order_by="report_date desc",
        limit=limit,
    )

    result = []
    for report in reports:
        doc = frappe.get_doc("Remaining Items Report", report.name)
        items_list = []
        for item in doc.items:
            items_list.append({
                "item_id": item.item_id,
                "item_name": item.item_name,
                "unit": item.unit,
                "category": item.category,
                "dn_quantity": item.dn_quantity,
                "remaining_quantity": item.remaining_quantity,
            })
        result.append({
            "name": doc.name,
            "report_date": str(doc.report_date),
            "submitted_by": doc.submitted_by,
            "items": items_list,
        })

    return result


@frappe.whitelist()
def get_today_report_for_project(project):
    """Check if today's report exists for a project (for edit mode)."""
    existing = frappe.db.get_value(
        "Remaining Items Report",
        {"project": project, "report_date": today()},
        ["name", "status", "submitted_by", "modified"],
        as_dict=True,
    )

    if not existing:
        return {"exists": False}

    doc = frappe.get_doc("Remaining Items Report", existing.name)
    items_list = []
    for item in doc.items:
        items_list.append({
            "item_id": item.item_id,
            "item_name": item.item_name,
            "unit": item.unit,
            "category": item.category,
            "dn_quantity": item.dn_quantity,
            "remaining_quantity": item.remaining_quantity,
        })

    return {
        "exists": True,
        "name": doc.name,
        "status": doc.status,
        "submitted_by": existing.submitted_by,
        "modified": str(existing.modified),
        "items": items_list,
    }
