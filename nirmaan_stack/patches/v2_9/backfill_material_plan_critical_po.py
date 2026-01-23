import frappe
import json


def execute():
    """
    Backfill critical_po_category and critical_po_task in Material Delivery Plan
    by checking if the plan's po_link exists in any Critical PO Task's associated_pos.
    """
    frappe.reload_doc("nirmaan_stack", "doctype", "material_delivery_plan")

    # Step 1: Build a map of PO Name -> { category, task_name }
    po_to_task_map = {}

    # Fetch all Critical PO Tasks
    critical_tasks = frappe.get_all(
        "Critical PO Tasks",
        fields=["name", "critical_po_category","item_name", "associated_pos"]
    )

    for task in critical_tasks:
        if not task.associated_pos:
            continue

        associated_pos = task.associated_pos

        # Handle JSON parsing if it's a string
        if isinstance(associated_pos, str):
            try:
                associated_pos = json.loads(associated_pos)
            except json.JSONDecodeError:
                continue

        # Handle the actual format: {"pos": ["PO/...", "PO/..."]}
        if isinstance(associated_pos, dict) and "pos" in associated_pos:
            po_list = associated_pos.get("pos", [])
        elif isinstance(associated_pos, list):
            po_list = associated_pos
        else:
            continue

        # Ensure it's a list
        if not isinstance(po_list, list):
            continue

        # Map each PO to this task's details
        for po_name in po_list:
            if isinstance(po_name, str) and po_name:
                po_to_task_map[po_name] = {
                    "category": task.critical_po_category,
                    "task": task.item_name
                }

    if not po_to_task_map:
        print("No PO to Task mappings found")
        return

    # Step 2: Get all Material Delivery Plans with a po_link
    mdps_with_po = frappe.get_all(
        "Material Delivery Plan",
        fields=["name", "po_link"],
        filters={"po_link": ["is", "set"]}
    )

    # Step 3: Get all Material Delivery Plans WITHOUT po_link
    mdps_without_po = frappe.get_all(
        "Material Delivery Plan",
        fields=["name"],
        filters={"po_link": ["is", "not set"]}
    )

    updated_list = []
    not_updated_list = []
    no_po_link_list = [mdp.name for mdp in mdps_without_po]

    for mdp in mdps_with_po:
        if mdp.po_link in po_to_task_map:
            task_info = po_to_task_map[mdp.po_link]

            # Use set_value with update_modified=False
            frappe.db.set_value(
                "Material Delivery Plan",
                mdp.name,
                {
                    "critical_po_category": task_info["category"],
                    "critical_po_task": task_info["task"]
                },
                update_modified=False
            )
            updated_list.append({
                "mdp": mdp.name,
                "po_link": mdp.po_link,
                "category": task_info["category"],
                "task": task_info["task"]
            })
        else:
            not_updated_list.append({
                "mdp": mdp.name,
                "po_link": mdp.po_link,
                "reason": "PO not found in any Critical PO Task's associated_pos"
            })

    frappe.db.commit()

    # Print results
    print(f"\n{'='*60}")
    print(f"UPDATED Material Delivery Plans: {len(updated_list)}")
    print(f"{'='*60}")
    for item in updated_list:
        print(f"  - {item['mdp']} | PO: {item['po_link']} | Category: {item['category']} | Task: {item['task']}")

    print(f"\n{'='*60}")
    print(f"NOT UPDATED (PO not in Critical Tasks): {len(not_updated_list)}")
    print(f"{'='*60}")
    for item in not_updated_list:
        print(f"  - {item['mdp']} | PO: {item['po_link']} | Reason: {item['reason']}")

    print(f"\n{'='*60}")
    print(f"NO PO_LINK (Empty): {len(no_po_link_list)}")
    print(f"{'='*60}")
    for mdp_name in no_po_link_list:
        print(f"  - {mdp_name}")

    print(f"\n{'='*60}")
    print(f"Summary: Updated {len(updated_list)}, Skipped {len(not_updated_list)}, No PO Link {len(no_po_link_list)}")
    print(f"{'='*60}")
