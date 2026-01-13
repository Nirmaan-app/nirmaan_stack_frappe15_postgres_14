"""
Add missing Nirmaan role permissions to all Nirmaan Stack doctypes.

This patch ensures all 9 Nirmaan roles have permissions on all non-child-table doctypes:
- Nirmaan Accountant
- Nirmaan Design Executive
- Nirmaan Design Lead
- Nirmaan Estimates Executive
- Nirmaan HR Executive
- Nirmaan PMO Executive
- Nirmaan Procurement Executive
- Nirmaan Project Lead
- Nirmaan Project Manager

HR Executive and PMO Executive get read-only access by default.
Other roles get read-only access unless they already have write permissions.
"""

import frappe


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
    "Customer PO Child Table",
    "Design Tracker Task Child Table",
    "Design Tracker Zone",
    "PO Payment Terms",
    "Procurement Request Item Detail",
    "Project Drive Link Child Table",
    "Project Progress Report Attachments",
    "Project Progress Report Manpower Details",
    "Project Progress Report Work Milestones",
    "Project Work Headers",
    "Project Work Package Category Make",
    "Project Zone Child Table",
    "Purchase Order Item",
    "Selected Quotations",
]

# Default read-only permission template
READ_ONLY_PERMISSION = {
    "read": 1,
    "email": 1,
    "export": 1,
    "print": 1,
    "report": 1,
    "share": 1,
}


def execute():
    """Main patch execution function."""
    # Get all Nirmaan Stack doctypes
    doctypes = frappe.get_all(
        "DocType",
        filters={"module": "Nirmaan Stack", "istable": 0},
        pluck="name"
    )

    print(f"\nAnalyzing {len(doctypes)} Nirmaan Stack doctypes...")

    changes_made = 0

    for doctype in doctypes:
        if doctype in CHILD_TABLES:
            continue

        # Get existing permissions
        existing_permissions = frappe.get_all(
            "DocPerm",
            filters={"parent": doctype},
            fields=["role", "read", "write", "create", "delete"]
        )

        existing_roles = {p["role"] for p in existing_permissions}

        # Find missing Nirmaan roles
        missing_roles = [r for r in NIRMAAN_ROLES if r not in existing_roles]

        if not missing_roles:
            continue

        print(f"\n{doctype}: Adding {len(missing_roles)} missing roles")

        for role in missing_roles:
            # Create new permission entry
            perm = frappe.new_doc("DocPerm")
            perm.parent = doctype
            perm.parenttype = "DocType"
            perm.parentfield = "permissions"
            perm.role = role

            # Apply read-only permissions
            for key, value in READ_ONLY_PERMISSION.items():
                setattr(perm, key, value)

            perm.insert(ignore_permissions=True)
            changes_made += 1
            print(f"  + {role}")

    if changes_made:
        frappe.db.commit()
        print(f"\n✓ Added {changes_made} permission entries")

        # Clear cache to reflect changes
        frappe.clear_cache()
        print("✓ Cache cleared")
    else:
        print("\n✓ All doctypes already have complete permissions")


def get_analysis_report():
    """
    Generate a detailed analysis report of missing permissions.
    Run from bench console:
        from nirmaan_stack.patches.v2_8.add_missing_nirmaan_role_permissions import get_analysis_report
        get_analysis_report()
    """
    doctypes = frappe.get_all(
        "DocType",
        filters={"module": "Nirmaan Stack", "istable": 0},
        pluck="name"
    )

    report = {
        "complete": [],
        "partial": {},
        "no_nirmaan_roles": []
    }

    for doctype in doctypes:
        if doctype in CHILD_TABLES:
            continue

        existing_permissions = frappe.get_all(
            "DocPerm",
            filters={"parent": doctype},
            pluck="role"
        )

        existing_nirmaan_roles = [r for r in existing_permissions if r.startswith("Nirmaan")]
        missing_roles = [r for r in NIRMAAN_ROLES if r not in existing_nirmaan_roles]

        if not missing_roles:
            report["complete"].append(doctype)
        elif len(existing_nirmaan_roles) == 0:
            report["no_nirmaan_roles"].append(doctype)
        else:
            report["partial"][doctype] = missing_roles

    # Print report
    print("\n" + "=" * 60)
    print("NIRMAAN ROLE PERMISSIONS ANALYSIS REPORT")
    print("=" * 60)

    print(f"\n✓ Complete (all 9 roles): {len(report['complete'])} doctypes")
    for dt in sorted(report["complete"]):
        print(f"  - {dt}")

    print(f"\n⚠ Partial permissions: {len(report['partial'])} doctypes")
    for dt, missing in sorted(report["partial"].items()):
        print(f"  - {dt}")
        for role in missing:
            print(f"      Missing: {role}")

    print(f"\n✗ No Nirmaan roles: {len(report['no_nirmaan_roles'])} doctypes")
    for dt in sorted(report["no_nirmaan_roles"]):
        print(f"  - {dt}")

    return report
