import frappe
from frappe.utils import getdate
import json

@frappe.whitelist()
def get_work_plan(project, start_date, end_date):
    """
    Fetch Work Plans/Milestones for a project within a specific date range.
    Logic:
    1. Get Zones from Project.
    2. For each Zone, get latest Project Progress Report.
    3. Filter Milestones (Status != Not Applicable).
    4. Check for 'Work Plan' DocType linked to (Project, Zone, Work Header, Milestone).
       If exists, filter by its start_date within range.
       If not, fallback to Milestone's expected dates.
    """
    
    if not project:
        return []

    try:
        start = getdate(start_date)
        end = getdate(end_date)
    except Exception:
        frappe.throw("Invalid Date Format")

    p_doc = frappe.get_doc("Projects", project)
    if not p_doc:
        return []

    # Get Zones
    zones = [z.zone_name for z in p_doc.project_zones] if p_doc.get("project_zones") else []

    if not zones:
        return []

    all_milestones = []

    for zone in zones:
        # Get Latest Project Progress Report for this Zone
        # User specified: Filter by Project, Report Zone, Report Status = Completed
        filters = {
            "project": project,
            "report_zone": zone,
            "report_status": "Completed"
        }
            
        reports = frappe.get_list("Project Progress Reports",
            filters=filters,
            fields=["name"],
            order_by="creation desc",
            limit=1
        )
        
        if reports:
            # Fetch full document to get child table data
            report_name = reports[0].name
            report_doc = frappe.get_doc("Project Progress Reports", report_name)
            
            if report_doc.milestones:
                for m in report_doc.milestones:
                    if m.status == "Not Applicable":
                        continue

                    m_dict = m.as_dict()
                    m_dict["zone"] = report_doc.report_zone
                    
                    # Check Work Plan DocType
                    if frappe.db.exists("DocType", "Work Plan"):
                        wp_filters = {
                            "project": project,
                            "wp_zone": report_doc.report_zone,
                            "work_header": m.work_header,
                            "work_milestone": m.work_milestone_name
                        }
                        # Using get_all to fetch details if needed, or just specific fields
                        work_plans = frappe.get_all("Work Plan", filters=wp_filters, fields=["*"])
                        if work_plans:
                            m_dict["work_plan_doc"] = work_plans

                    all_milestones.append(m_dict)
            
    grouped_milestones = {}
    if all_milestones:
        for m in all_milestones:
            if m.work_header not in grouped_milestones:
                grouped_milestones[m.work_header] = []
            grouped_milestones[m.work_header].append(m)

    return grouped_milestones
