
import frappe

def execute():
	"""
	Populate start_date in Project Design Tracker from linked Projects
	"""
	
	pdt_list = frappe.get_all("Project Design Tracker", 
		fields=["name", "project", "start_date"]	)
	
	updated_count = 0
	skipped_count = 0
	
	print("\n--- Starting Patch: Populate Project Design Tracker Start Date ---")

	skipped_records = []

	try:
		for pdt in pdt_list:
			if not pdt.project:
				skipped_count += 1
				skipped_records.append(f"{pdt.name} (No linked Project)")
				continue
			
			# Fetch project_start_date from linked Projects DocType
			project_start_date = frappe.db.get_value("Projects", pdt.project, "project_start_date")
			
			if project_start_date:
				frappe.db.set_value("Project Design Tracker", pdt.name, "start_date", project_start_date, update_modified=False)
				updated_count += 1
			else:
				skipped_count += 1
				skipped_records.append(f"{pdt.name} (Linked Project {pdt.project} has no project_start_date)")

	except Exception as e:
		frappe.db.rollback()
		print(f"\n!!! Error occurred. Rolling back changes. !!!")
		print(f"Error: {str(e)}")
		return

	print(f"\n--- Patch Summary ---")
	print(f"Total Fetched: {len(pdt_list)}")
	print(f"Total Updated: {updated_count}")
	print(f"Total Skipped: {skipped_count}")
	if skipped_records:
		print(f"Skipped Records: {skipped_records}")
	print(f"---------------------")
