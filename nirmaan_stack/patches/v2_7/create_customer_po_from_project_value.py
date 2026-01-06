import frappe
from frappe.utils import flt

def execute():
	frappe.reload_doc("nirmaan_stack", "doctype", "projects")
	frappe.reload_doc("nirmaan_stack", "doctype", "customer_po_child_table")

	projects = frappe.get_all("Projects", fields=["name"])

	updated_count = 0
	skipped_projects = []

	for project in projects:
		doc = frappe.get_doc("Projects", project.name)
		
		# Check if customer_po_details is empty
		if not doc.get("customer_po_details"):
			# Only proceed if there is a legacy project value to migrate
			# We check if project_value or project_value_gst has any value > 0
			if flt(doc.project_value) > 0 or flt(doc.project_value_gst) > 0:
				
				print(f"Migrating Project Value to PO for: {doc.name}")
				
				row = doc.append("customer_po_details", {})
				
				# Map existing legacy values to the new PO row
				row.customer_po_value_exctax = flt(doc.project_value)
				row.customer_po_value_inctax = flt(doc.project_value_gst)
				row.customer_po_number = "Opening-PO"
				row.customer_po_creation_date = doc.project_start_date

				original_modified = doc.modified
				
				# Save the document. 
				# This triggers the new 'before_save' logic we added, 
				# which will sum up this new PO and set doc.project_value again.
				# This confirms the data is preserved and the structure is valid.
				doc.save(ignore_permissions=True)

				frappe.db.set_value("Projects", doc.name, "modified", original_modified, update_modified=False)
				updated_count += 1
			else:
				skipped_projects.append({'name': doc.name, 'reason': 'Zero Project Value'})
		else:
			skipped_projects.append({'name': doc.name, 'reason': 'PO Details Already Exist'})

	print(f"\n--- Migration Summary ---")
	print(f"Total Projects: {len(projects)}")
	print(f"Projects Updated: {updated_count}")
	print(f"Projects Skipped: {len(skipped_projects)}")
	if skipped_projects:
		print("Skipped Projects Details:")
		for item in skipped_projects:
			print(f" - {item['name']}: {item['reason']}")
