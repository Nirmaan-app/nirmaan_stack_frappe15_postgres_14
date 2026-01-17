import frappe

def execute():
	attachments = frappe.get_all(
		"Project Progress Report Attachments",
		filters={
			"attach_type": ["in", [None, ""]]
		},
		fields=["name"]
	)

	updated_count = 0
	skipped_count = 0

	print(f"Found {len(attachments)} attachments to update.")

	if attachments:
		for attachment in attachments:
			try:
				frappe.db.set_value(
					"Project Progress Report Attachments",
					attachment.name,
					"attach_type",
					"Work",
					update_modified=False
				)
				updated_count += 1
			except Exception as e:
				skipped_count += 1
				print(f"Failed to update {attachment.name}: {e}")

	print(f"Patch Complete. Updated: {updated_count}, Skipped: {skipped_count}")
