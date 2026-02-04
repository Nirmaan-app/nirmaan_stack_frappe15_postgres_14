"""
Patch: fix_empty_category_list

This patch fixes Procurement Requests where category_list was incorrectly
set to {"list": []} due to a frontend bug in ApproveNewPR.

Background:
-----------
In ApprovePRContainer.tsx, the code assumed prDoc.category_list was already
a parsed object, but Frappe returns it as a JSON string. This caused:
    prDoc?.category_list?.list || []
to always return [] when category_list was a string, resulting in data loss.

This patch:
1. Finds PRs created today with workflow_state in post-Pending states
2. Checks if their category_list is empty but order_list has items
3. Rebuilds category_list from order_list items
4. Updates WITHOUT modifying the modified/modified_by fields

Safe to re-run: Yes (idempotent - only affects PRs with empty category_list)

Usage:
------
Run via bench console:
    bench --site localhost console
    >>> from nirmaan_stack.patches.v3_0.fix_empty_category_list import execute
    >>> execute()

Or with dry_run to see what would be changed:
    >>> execute(dry_run=True)
"""

import frappe
import json
from frappe.utils import today, getdate


def execute(dry_run=False, date_filter=None):
    """
    Fix PRs with empty category_list.

    Args:
        dry_run: If True, only print what would be fixed without making changes
        date_filter: Date string (YYYY-MM-DD) to filter PRs. Defaults to today.
    """
    target_date = date_filter or today()

    # States that indicate PR has been approved/processed (after Pending)
    post_pending_states = [
        'Approved',
        'Vendor Selected',
        'Partially Approved',
        'RFQ Generated',
        'Quote Updated',
        'In Progress'
    ]

    print(f"{'[DRY RUN] ' if dry_run else ''}Searching for PRs created on {target_date} with empty category_list...")

    # Find PRs created on target date with post-Pending workflow states
    affected_prs = frappe.db.sql("""
        SELECT
            pr.name,
            pr.project,
            pr.work_package,
            pr.workflow_state,
            pr.category_list,
            pr.creation,
            pr.modified,
            pr.modified_by
        FROM `tabProcurement Requests` pr
        WHERE DATE(pr.creation) = %s
        AND pr.workflow_state IN %s
    """, (target_date, tuple(post_pending_states)), as_dict=True)

    if not affected_prs:
        print(f"✔ No PRs found created on {target_date} with states: {post_pending_states}")
        return

    print(f"Found {len(affected_prs)} PR(s) to check.")

    fixed_count = 0
    skipped_count = 0

    for pr in affected_prs:
        pr_name = pr['name']

        # Parse existing category_list
        category_list = parse_json_field(pr.get('category_list'))
        categories = category_list.get('list', []) if category_list else []

        # Check if category_list is empty
        if categories:
            print(f"  ⏭ {pr_name}: category_list already has {len(categories)} categories, skipping")
            skipped_count += 1
            continue

        # Fetch order_list items from child table
        order_items = frappe.db.get_all(
            "Procurement Request Item Detail",
            filters={"parent": pr_name},
            fields=["category", "status"]
        )

        if not order_items:
            print(f"  ⏭ {pr_name}: No items in order_list, skipping")
            skipped_count += 1
            continue

        # Build category_list from order_items
        new_category_list = build_category_list_from_items(order_items, pr)

        if not new_category_list['list']:
            print(f"  ⏭ {pr_name}: Could not build category_list from items, skipping")
            skipped_count += 1
            continue

        print(f"  {'[WOULD FIX]' if dry_run else '✓ Fixing'} {pr_name}: "
              f"Rebuilding category_list with {len(new_category_list['list'])} categories "
              f"from {len(order_items)} items")

        if not dry_run:
            # Update without modifying the modified timestamp
            frappe.db.sql("""
                UPDATE `tabProcurement Requests`
                SET category_list = %s
                WHERE name = %s
            """, (json.dumps(new_category_list), pr_name))

            fixed_count += 1

    if not dry_run:
        frappe.db.commit()

        if fixed_count > 0:
            # Log for audit purposes
            frappe.log_error(
                message=f"Fixed {fixed_count} Procurement Request(s) with empty category_list "
                        f"created on {target_date}. Affected PRs had category_list reset to empty "
                        f"due to frontend JSON parsing bug in ApproveNewPR.",
                title="Empty Category List Fix Applied"
            )

    print(f"\n{'[DRY RUN] ' if dry_run else ''}Summary:")
    print(f"  - Total PRs checked: {len(affected_prs)}")
    print(f"  - Fixed: {fixed_count}")
    print(f"  - Skipped (already had categories or no items): {skipped_count}")

    if dry_run:
        print(f"\nRun execute(dry_run=False) to apply fixes.")


def build_category_list_from_items(items, pr_data):
    """
    Build category_list from order_list items.

    Each unique (category, status) pair becomes an entry with makes derived
    from the project's work package configuration.
    """
    # Get unique (category, status) combinations
    seen = set()
    categories = []

    for item in items:
        cat_name = item.get('category')
        status = item.get('status', 'Pending')

        if not cat_name:
            continue

        key = (cat_name, status)
        if key in seen:
            continue

        seen.add(key)

        # Try to get makes for this category from project config
        makes = get_makes_for_category_safe(pr_data, cat_name)

        categories.append({
            'name': cat_name,
            'status': status,
            'makes': makes
        })

    return {'list': categories}


def get_makes_for_category_safe(pr_data, category):
    """
    Safely get makes for a category from project configuration.
    Returns empty list if anything fails.
    """
    try:
        project_name = pr_data.get('project')
        work_package_name = pr_data.get('work_package')

        if not project_name:
            return []

        # Fetch project's work package configuration
        project = frappe.get_doc("Projects", project_name)

        # Check Project Work Packages child table
        if hasattr(project, 'project_work_packages') and project.project_work_packages:
            for wp in project.project_work_packages:
                if wp.work_package_name == work_package_name:
                    # Parse category_list from the work package
                    wp_category_list = parse_json_field(wp.get('category_list'))
                    if wp_category_list:
                        for cat in wp_category_list.get('list', []):
                            if cat.get('name') == category:
                                return cat.get('makes', [])

        return []
    except Exception as e:
        print(f"    Warning: Could not fetch makes for category {category}: {e}")
        return []


def parse_json_field(value):
    """
    Parse a JSON field that may be string, dict, or None.
    """
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return None
