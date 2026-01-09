# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe


def after_insert(doc, method):
    """Set current_assignee on Asset Master when assignment is created."""
    if doc.asset and doc.asset_assigned_to:
        frappe.db.set_value(
            "Asset Master",
            doc.asset,
            "current_assignee",
            doc.asset_assigned_to
        )


def on_update(doc, method):
    """Update current_assignee on Asset Master if assignment changes."""
    if doc.asset:
        frappe.db.set_value(
            "Asset Master",
            doc.asset,
            "current_assignee",
            doc.asset_assigned_to
        )


def on_trash(doc, method):
    """Clear current_assignee on Asset Master when assignment is deleted."""
    if doc.asset:
        frappe.db.set_value(
            "Asset Master",
            doc.asset,
            "current_assignee",
            None
        )
