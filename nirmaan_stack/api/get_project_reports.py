import frappe
from frappe.utils import getdate, add_days
from frappe.model.document import Document

def _process_report_data(report_doc, work_header_order_map=None):
    """Helper function to calculate summary fields for a given report Document."""
    if not report_doc:
        return None

    report_dict = report_doc.as_dict()

    # Sort milestones based on Work Header order
    if report_dict.get("milestones") and work_header_order_map:
        report_dict["milestones"] = sorted(
            report_dict["milestones"],
            key=lambda m: (
                work_header_order_map.get(m.get("work_header"), 9999), # Primary sort: Order (defaults to 9999)
                m.get("work_header") # Secondary sort: Alphabetical by Name
            )
        )

    # Calculate total_completed_works
    total_completed_works = 0
    if report_dict.get("milestones"):
        for milestone in report_dict["milestones"]:
            if milestone.get("status") == "Completed":
                total_completed_works += 1
    report_dict["total_completed_works"] = total_completed_works

    # Calculate number_of_work_headers (unique work_header values)
    number_of_work_headers = 0
    if report_dict.get("milestones"):
        unique_work_headers = set()
        for milestone in report_dict["milestones"]:
            if milestone.get("work_header"):
                unique_work_headers.add(milestone["work_header"])
        number_of_work_headers = len(unique_work_headers)
    report_dict["number_of_work_headers"] = number_of_work_headers

    # Calculate total_manpower_used_till_date
    total_manpower_used_till_date = 0
    if report_dict.get("manpower"):
        for manpower_detail in report_dict["manpower"]:
            try:
                # Ensure count is converted to int, as it's a string in your JSON
                total_manpower_used_till_date += int(manpower_detail.get("count", 0))
            except (ValueError, TypeError):
                # Handle cases where count might not be a valid number
                frappe.log_error(f"Invalid manpower count: {manpower_detail.get('count')}", "Manpower Calculation Error")
                pass # or handle more robustly if needed
    report_dict["total_manpower_used_till_date"] = total_manpower_used_till_date

    return report_dict

@frappe.whitelist()
def get_project_progress_reports_comparison(project,report_zone):
    """
    Get three reports for comparison:
    1. Current report (latest available)
    2. Report from 7 days ago (or closest available)
    3. Report from 14 days ago (or closest available)
    """
    # Get all reports for the project, ordered by date descending
    reports = frappe.get_all(
        "Project Progress Reports",
        filters={"project": project,"report_zone": report_zone},
        fields=["name", "report_date"],
        order_by="report_date desc"
    )
    
    if not reports:
        return {
            "current": None,
            "seven_days": None,
            "fourteen_days": None
        }

    # Fetch Work Header orders for sorting
    work_headers = frappe.get_all("Work Headers", fields=["name", "order"])
    work_header_order_map = {wh.name: (wh.order if wh.order is not None else 9999) for wh in work_headers}
    
    # Current report is the latest one
    current_report_doc = frappe.get_doc("Project Progress Reports", reports[0].name)
    current_report = _process_report_data(current_report_doc, work_header_order_map)
    
    # Calculate target dates
    today = getdate()
    seven_days_ago = add_days(today, -7)
    fourteen_days_ago = add_days(today, -14)
    
    # Find closest report to 7 days ago (within 2 days)
    seven_days_report_doc = None
    for report in reports:
        report_date = getdate(report.report_date)
        if abs((report_date - seven_days_ago).days) <= 2:
            seven_days_report_doc = frappe.get_doc("Project Progress Reports", report.name)
            break
    seven_days_report = _process_report_data(seven_days_report_doc, work_header_order_map)

    # Find closest report to 14 days ago (within 2 days)
    fourteen_days_report_doc = None
    for report in reports:
        report_date = getdate(report.report_date)
        if abs((report_date - fourteen_days_ago).days) <= 2:
            fourteen_days_report_doc = frappe.get_doc("Project Progress Reports", report.name)
            break
    fourteen_days_report = _process_report_data(fourteen_days_report_doc, work_header_order_map)
    
    return {
        "current": current_report,
        "seven_days": seven_days_report,
        "fourteen_days": fourteen_days_report
    }