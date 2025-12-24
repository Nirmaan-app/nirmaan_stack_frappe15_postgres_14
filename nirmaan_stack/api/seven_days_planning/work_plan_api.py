import frappe
from frappe.utils import getdate
import json

@frappe.whitelist()
def get_work_plan(project, start_date=None, end_date=None):
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

    start = None
    end = None
    if start_date and end_date:
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

    # Get sorting metadata
    headers_meta = frappe.get_all("Work Headers", fields=["work_header_name as name", "order"])
    header_map = {h.name: (h.order or 9999) for h in headers_meta}

    milestones_meta = frappe.get_all("Work Milestones", fields=["work_milestone_name as name", "work_milestone_order"])
    milestone_map = {m.name: (m.work_milestone_order or 9999) for m in milestones_meta}

    all_milestones = []
    
    # Sort zones alphanumerically
    zones.sort()

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
                    m_dict["header_order"] = header_map.get(m.work_header, 9999)
                    m_dict["milestone_order"] = milestone_map.get(m.work_milestone_name, 9999)
                    
                    # Check Work Plan DocType
                    if frappe.db.exists("DocType", "Work Plan"):
                        wp_filters = {
                            "project": project,
                            "wp_zone": report_doc.report_zone,
                            "work_header": m.work_header,
                            "work_milestone": m.work_milestone_name,
                        }
                        # Fetch all relevant work plans first, then filter by date in Python
                        all_work_plans = frappe.get_all("Work Plan", filters=wp_filters, fields=["*"])

                        # Filter for date overlap in Python
                        # Overlap condition: task_start <= range_end AND task_end >= range_start
                        filtered_plans = []
                        if all_work_plans:
                            if start and end:
                                for wp in all_work_plans:
                                    # Ensure dates are present
                                    if wp.wp_start_date and wp.wp_end_date:
                                        wp_start = getdate(wp.wp_start_date)
                                        wp_end = getdate(wp.wp_end_date)
                                        # if wp.wp_status == "Completed":
                                        #     # Only show if it was completed within the selected range
                                        #     if wp_end >= start and wp_end <= end:
                                        #         filtered_plans.append(wp)
                                        # else:
                                        #     # For pending/WIP tasks, use the overlap logic
                                        #     if wp_start <= end and wp_end >= start:
                                        #         filtered_plans.append(wp)
                                        # This Will show overlap of start and end within this field"
                                        if wp_start <= end and wp_end >= start:
                                        # if wp_start >= start and wp_start <= end: // Standard this will focusing on start date
                                            filtered_plans.append(wp)

                            else:
                                # If no date range provided, include all
                                filtered_plans = all_work_plans
                        
                        if filtered_plans:
                            m_dict["work_plan_doc"] = filtered_plans

                    all_milestones.append(m_dict)
            
    # Sort all collected milestones
    if all_milestones:
        all_milestones.sort(key=lambda x: (
            x.get("header_order", 9999), 
            x.get("zone", ""), 
            x.get("milestone_order", 9999)
        ))

    grouped_milestones = {}
    if all_milestones:
        for m in all_milestones:
            if m.work_header not in grouped_milestones:
                grouped_milestones[m.work_header] = []
            grouped_milestones[m.work_header].append(m)

    return grouped_milestones
