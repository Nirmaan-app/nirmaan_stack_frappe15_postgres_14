"""
One-time patch: reconcile stale vendor_category JSON with Vendor Category records.

When a Category was renamed, Frappe auto-updated the Link field on Vendor Category
records but left the vendor_category JSON on Vendors with the old name.

This patch:
  1. Finds vendors whose JSON contains category names that no longer exist
  2. Uses the Vendor Category records (correct post-rename names) to fix the JSON
  3. Logs warnings for any categories that can't be resolved
"""
import json

import frappe


def execute():
    valid_categories = set(frappe.get_all("Category", pluck="name"))
    vendors = frappe.get_all("Vendors", fields=["name", "vendor_category"])

    fixed = 0

    for v in vendors:
        if not v.vendor_category:
            continue

        try:
            cats = json.loads(v.vendor_category) if isinstance(v.vendor_category, str) else v.vendor_category
        except (json.JSONDecodeError, TypeError):
            print(f"  SKIP {v.name}: malformed vendor_category JSON")
            continue

        json_cats = cats.get("categories", [])
        if not json_cats:
            continue

        stale = [c for c in json_cats if c not in valid_categories]
        if not stale:
            continue

        # Vendor Category Link records have the correct (post-rename) names
        vc_cats = set(frappe.get_all("Vendor Category", {"vendor": v.name}, pluck="category"))

        valid_json = [c for c in json_cats if c in valid_categories]
        corrected = list(set(valid_json) | vc_cats)

        lost = [c for c in stale if c not in vc_cats]
        if lost:
            print(f"  WARNING {v.name}: stale categories {lost} have no Vendor Category record — dropped")

        frappe.db.set_value(
            "Vendors", v.name, "vendor_category",
            json.dumps({"categories": corrected}),
            update_modified=False,
        )
        fixed += 1

    frappe.db.commit()
    print(f"fix_stale_vendor_category_json: reconciled {fixed} vendor(s)")
