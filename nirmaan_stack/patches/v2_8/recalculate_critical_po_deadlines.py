import frappe
from datetime import datetime, timedelta


def execute():
    """
    Recalculates po_release_date for all Critical PO Tasks based on their
    project's start date and the release_timeline_offset from Critical PO Items master.

    Formula: po_release_date = project_start_date + release_timeline_offset (days)

    Note: Uses raw SQL to update without modifying any timestamps or triggering hooks.
    """
    try:
        print("Starting Patch: Recalculate Critical PO Task Deadlines")

        # Get all Critical PO Tasks grouped by project
        critical_po_tasks = frappe.db.get_all(
            "Critical PO Tasks",
            fields=["name", "project", "critical_po_category", "item_name", "sub_category"],
            order_by="project asc"
        )

        if not critical_po_tasks:
            print("No Critical PO Tasks found. Patch complete.")
            return

        print(f"Found {len(critical_po_tasks)} Critical PO Tasks to process.")

        # Build lookup map from Critical PO Items master
        critical_po_items = frappe.db.get_all(
            "Critical PO Items",
            fields=["critical_po_category", "item_name", "sub_category", "release_timeline_offset"]
        )

        # Create lookup key: (category, item_name, sub_category) -> offset
        offset_map = {}
        for item in critical_po_items:
            key = (
                item.get("critical_po_category") or "",
                item.get("item_name") or "",
                item.get("sub_category") or ""
            )
            offset_map[key] = item.get("release_timeline_offset") or 0

        print(f"Loaded {len(offset_map)} offset mappings from Critical PO Items master.")

        # Cache project start dates to avoid repeated lookups
        project_start_dates = {}

        updated_count = 0
        skipped_count = 0
        skipped_tasks = []

        for task in critical_po_tasks:
            try:
                project_name = task.get("project")

                if not project_name:
                    skipped_count += 1
                    skipped_tasks.append(f"{task['name']} (no project)")
                    continue

                # Get project start date (cached)
                if project_name not in project_start_dates:
                    project = frappe.db.get_value(
                        "Projects",
                        project_name,
                        "project_start_date"
                    )
                    project_start_dates[project_name] = project

                project_start_date = project_start_dates[project_name]

                if not project_start_date:
                    skipped_count += 1
                    skipped_tasks.append(f"{task['name']} (project {project_name} has no start date)")
                    continue

                # Parse project_start_date
                if isinstance(project_start_date, str):
                    try:
                        start_date = datetime.strptime(project_start_date, "%Y-%m-%d %H:%M:%S").date()
                    except ValueError:
                        start_date = datetime.strptime(project_start_date, "%Y-%m-%d").date()
                else:
                    start_date = project_start_date

                # Find matching offset
                key = (
                    task.get("critical_po_category") or "",
                    task.get("item_name") or "",
                    task.get("sub_category") or ""
                )

                offset_days = offset_map.get(key)

                if offset_days is None:
                    skipped_count += 1
                    skipped_tasks.append(f"{task['name']} (no matching master item)")
                    continue

                # Calculate new release date
                new_release_date = start_date + timedelta(days=offset_days)

                # Use raw SQL to update ONLY po_release_date without touching modified/modified_by
                # This ensures the update is completely silent - no timestamps, no hooks, no versions
                frappe.db.sql(
                    """
                    UPDATE `tabCritical PO Tasks`
                    SET po_release_date = %s
                    WHERE name = %s
                    """,
                    (new_release_date.strftime("%Y-%m-%d"), task["name"])
                )
                updated_count += 1

            except Exception as e:
                print(f"Error processing task {task['name']}: {e}")
                skipped_count += 1
                skipped_tasks.append(f"{task['name']} (error: {str(e)})")

        print(f"\nPatch Complete:")
        print(f"  - Total tasks processed: {len(critical_po_tasks)}")
        print(f"  - Updated: {updated_count}")
        print(f"  - Skipped: {skipped_count}")

        if skipped_tasks and len(skipped_tasks) <= 20:
            print(f"  - Skipped tasks: {skipped_tasks}")
        elif skipped_tasks:
            print(f"  - First 20 skipped tasks: {skipped_tasks[:20]}")

        frappe.db.commit()
        print("Changes committed successfully.")

    except Exception as e:
        print(f"CRITICAL ERROR during patch execution: {e}")
        print("Rolling back database transaction.")
        frappe.db.rollback()
        raise
