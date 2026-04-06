import frappe
from frappe.utils import today

def execute():
    try:
        # 1. Fetch completed project names
        completed_projects = [p.name for p in frappe.get_all("Projects", filters={"status": "Completed"})]
        
        if not completed_projects:
            print("No completed projects found to update.")
            return

        # 2. Update Projects
        # Setting deactivation flags and dates to today's date
        frappe.db.set_value("Projects", completed_projects, {
            "disabled_dpr": 1,
            "disabled_dpr_date": today(),
            "disabled_inventory": 1,
            "disabled_inventory_date": today(),
            "disabled_pmo": 1
        }, update_modified=False)
        print(f"Disabled modules for {len(completed_projects)} Completed Projects.")

        # 3. Update Project Design Trackers linked to these projects
        dt_records = frappe.get_all("Project Design Tracker", filters={"project": ["in", completed_projects]}, fields=["name", "project"])
        design_trackers = [dt.name for dt in dt_records]

        if design_trackers:
            frappe.db.set_value("Project Design Tracker", design_trackers, "hide_design_tracker", 1, update_modified=False)
            print(f"Disabled {len(design_trackers)} linked Project Design Trackers.")
        else:
            print("No linked Project Design Trackers found to disable.")

        # 4. Update Project Commission Reports linked to these projects
        cr_records = frappe.get_all("Project Commission Report", filters={"project": ["in", completed_projects]}, fields=["name", "project"])
        commission_reports = [cr.name for cr in cr_records]

        if commission_reports:
            frappe.db.set_value("Project Commission Report", commission_reports, "hide_commission_report", 1, update_modified=False)
            print(f"Disabled {len(commission_reports)} linked Project Commission Reports.")
        else:
            print("No linked Project Commission Reports found to disable.")

        # Commit changes to database
        frappe.db.commit()

    except Exception as e:
        frappe.db.rollback()
        print(f"ERROR: disabled_module_completed_project patch failed. Rolling back changes. Error: {str(e)}")
        raise e
