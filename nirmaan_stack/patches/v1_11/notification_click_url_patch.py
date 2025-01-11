import frappe

def execute():
    """
    Patch to update notification documents' action_url based on updated frontend routes.
    """
    # Mapping of event_ids to the new route patterns
    update_map = {
        "pr:rejected": {
            "old_pattern": "procurement-request",
            "new_pattern": "procurement-requests"
        },
        "pr:new": {
            "old_pattern": "approve-order",
            "new_pattern": "approve-new-pr"
        },
        "pr:approved": {
            "old_pattern": "procure-request",
            "new_pattern": "new-procure-request"
        },
        "pr:vendorSelected": {
            "old_pattern": "approve-vendor",
            "new_pattern": "approve-po"
        },
        "po:new": {
            "old_pattern": "release-po",
            "new_pattern": "approved-po"
        },
    }

    # Fetch all notifications matching the event_ids
    notification_docs = frappe.get_all(
        "Nirmaan Notifications",
        filters={"event_id": ["in", list(update_map.keys())]},
        fields=["name", "event_id", "action_url"]
    )

    for notification in notification_docs:
        event_id = notification.get("event_id")
        action_url = notification.get("action_url")

        # Get the mapping for the current event_id
        if event_id in update_map:
            old_pattern = update_map[event_id]["old_pattern"]
            new_pattern = update_map[event_id]["new_pattern"]

            # Update the action_url if it contains the old pattern
            if old_pattern in action_url:
                updated_url = action_url.replace(old_pattern, new_pattern)

                # Update the document in the database
                frappe.db.set_value(
                    "Nirmaan Notifications",
                    notification["name"],
                    "action_url",
                    updated_url
                )

                print(
                    f"Updated Notification {notification['name']}: "
                    f"{action_url} -> {updated_url}"
                )

    # Commit the changes to the database
    frappe.db.commit()
    print("Patch execution completed successfully.")