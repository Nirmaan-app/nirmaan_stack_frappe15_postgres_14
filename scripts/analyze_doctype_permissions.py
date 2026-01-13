#!/usr/bin/env python3
"""
Standalone script to analyze Nirmaan Stack doctype permissions.

This script reads doctype JSON files directly and reports:
- Which doctypes have all 9 Nirmaan roles
- Which doctypes are missing some roles
- Which doctypes have no Nirmaan roles at all

Usage:
    python analyze_doctype_permissions.py [--fix]

Options:
    --fix    Actually update the JSON files to add missing permissions
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime

# Base path to doctypes
DOCTYPE_DIR = Path(__file__).parent.parent / "nirmaan_stack" / "nirmaan_stack" / "doctype"

# All Nirmaan roles that should exist on every doctype
NIRMAAN_ROLES = [
    "Nirmaan Accountant",
    "Nirmaan Design Executive",
    "Nirmaan Design Lead",
    "Nirmaan Estimates Executive",
    "Nirmaan HR Executive",
    "Nirmaan PMO Executive",
    "Nirmaan Procurement Executive",
    "Nirmaan Project Lead",
    "Nirmaan Project Manager",
]

# Child tables inherit permissions from parent - skip these
CHILD_TABLES = [
    "customer_po_child_table",
    "design_tracker_task_child_table",
    "design_tracker_zone",
    "po_payment_terms",
    "procurement_request_item_detail",
    "project_drive_link_child_table",
    "project_progress_report_attachments",
    "project_progress_report_manpower_details",
    "project_progress_report_work_milestones",
    "project_work_headers",
    "project_work_package_category_make",
    "project_zone_child_table",
    "purchase_order_item",
    "selected_quotations",
]

# Default read-only permission template
READ_ONLY_PERMISSION = {
    "email": 1,
    "export": 1,
    "print": 1,
    "read": 1,
    "report": 1,
    "share": 1,
}


def get_doctype_json_files():
    """Find all doctype JSON files."""
    json_files = []
    for doctype_dir in DOCTYPE_DIR.iterdir():
        if not doctype_dir.is_dir():
            continue
        if doctype_dir.name.startswith("__"):
            continue
        if doctype_dir.name in CHILD_TABLES:
            continue

        json_file = doctype_dir / f"{doctype_dir.name}.json"
        if json_file.exists():
            json_files.append(json_file)

    return sorted(json_files)


def analyze_doctype(json_path):
    """Analyze a single doctype's permissions."""
    with open(json_path, "r") as f:
        data = json.load(f)

    # Check if it's a child table (istable = 1)
    if data.get("istable"):
        return None

    permissions = data.get("permissions", [])
    existing_roles = {p.get("role") for p in permissions}
    existing_nirmaan_roles = [r for r in existing_roles if r and r.startswith("Nirmaan")]
    missing_roles = [r for r in NIRMAAN_ROLES if r not in existing_roles]

    return {
        "name": data.get("name"),
        "path": json_path,
        "existing_nirmaan_roles": existing_nirmaan_roles,
        "missing_roles": missing_roles,
        "total_permissions": len(permissions),
    }


def add_missing_permissions(json_path, missing_roles):
    """Add missing role permissions to a doctype JSON file."""
    with open(json_path, "r") as f:
        data = json.load(f)

    permissions = data.get("permissions", [])

    for role in missing_roles:
        new_perm = {"role": role}
        new_perm.update(READ_ONLY_PERMISSION)
        permissions.append(new_perm)

    data["permissions"] = permissions
    data["modified"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")

    with open(json_path, "w") as f:
        json.dump(data, f, indent=1)

    return len(missing_roles)


def main():
    fix_mode = "--fix" in sys.argv

    print("\n" + "=" * 70)
    print("NIRMAAN STACK DOCTYPE PERMISSIONS ANALYSIS")
    print("=" * 70)

    if fix_mode:
        print("\n⚠️  FIX MODE ENABLED - Will update JSON files\n")
    else:
        print("\n📊 ANALYSIS MODE - No changes will be made")
        print("   Run with --fix to apply changes\n")

    json_files = get_doctype_json_files()
    print(f"Found {len(json_files)} doctype JSON files to analyze\n")

    complete = []
    partial = {}
    no_roles = []

    for json_path in json_files:
        result = analyze_doctype(json_path)
        if result is None:
            continue

        if not result["missing_roles"]:
            complete.append(result["name"])
        elif len(result["existing_nirmaan_roles"]) == 0:
            no_roles.append(result)
        else:
            partial[result["name"]] = result

    # Print summary
    print("-" * 70)
    print(f"✅ COMPLETE (all 9 roles): {len(complete)} doctypes")
    print("-" * 70)
    for name in sorted(complete):
        print(f"   {name}")

    print("\n" + "-" * 70)
    print(f"⚠️  PARTIAL (some roles missing): {len(partial)} doctypes")
    print("-" * 70)
    for name, result in sorted(partial.items()):
        print(f"\n   {name}")
        print(f"   Has: {len(result['existing_nirmaan_roles'])}/9 Nirmaan roles")
        print(f"   Missing:")
        for role in result["missing_roles"]:
            print(f"      - {role}")

        if fix_mode:
            added = add_missing_permissions(result["path"], result["missing_roles"])
            print(f"   ✅ FIXED: Added {added} permissions")

    print("\n" + "-" * 70)
    print(f"❌ NO NIRMAAN ROLES: {len(no_roles)} doctypes")
    print("-" * 70)
    for result in sorted(no_roles, key=lambda x: x["name"]):
        print(f"\n   {result['name']}")
        print(f"   Path: {result['path']}")

        if fix_mode:
            added = add_missing_permissions(result["path"], result["missing_roles"])
            print(f"   ✅ FIXED: Added {added} permissions")

    # Final summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"   Complete:        {len(complete)}")
    print(f"   Partial:         {len(partial)}")
    print(f"   No Nirmaan roles: {len(no_roles)}")
    print(f"   Total analyzed:  {len(complete) + len(partial) + len(no_roles)}")

    if fix_mode:
        total_fixed = len(partial) + len(no_roles)
        print(f"\n✅ Fixed {total_fixed} doctypes")
        print("\n⚠️  Remember to run `bench migrate` after applying these changes!")
    else:
        total_to_fix = len(partial) + len(no_roles)
        if total_to_fix > 0:
            print(f"\n📝 {total_to_fix} doctypes need permission updates")
            print("   Run with --fix to apply changes")

    print()


if __name__ == "__main__":
    main()
