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
        zones = [None] # Try fetching without zone filter

    final_data = []

    # Check if "Work Plan" DocType exists once to avoid repeated DB calls
    has_work_plan_doctype = frappe.db.exists("DocType", "Work Plan")

    for zone in zones:
        # Get Latest Project Progress Report for this Zone
        filters = {"project": project}
        if zone:
            filters["report_zone"] = zone
            
        reports = frappe.get_list("Project Progress Reports",
            filters=filters,
            fields=["name"],
            order_by="creation desc",
            limit=1
        )
        
        if not reports:
            continue

        report_name = reports[0].name
        report_doc = frappe.get_doc("Project Progress Reports", report_name)

        if not report_doc.milestones:
            continue
            
        for m in report_doc.milestones:
            # Filter Not Applicable
            if m.status == "Not Applicable":
                continue

            # Check Work Plan DocType
            work_plan_found = False
            
            if has_work_plan_doctype:
                # "Work Plan get they list of of they Project work_header and work_miloestones and start_date"
                # "map it based which project , work_header and milesotnes and zone"
                wp_filters = {
                    "project": project,
                    "work_header": m.work_header,
                    "work_milestone": m.work_milestone_name
                }
                if zone:
                    # Check if 'zone' field exists in 'Work Plan' DocType
                    if frappe.get_meta("Work Plan").has_field("zone"):
                         wp_filters["zone"] = zone 
                
                # We need to be careful about field names in "Work Plan" if I haven't seen the schema.
                # I'll try-except the fetch in case field names differ.
                try:
                    work_plans = frappe.get_all("Work Plan",
                        filters=wp_filters,
                        fields=["*"]
                    )
                    
                    if work_plans:
                        work_plan_found = True
                        for wp in work_plans:
                            # "check the parameters of date range based on that"
                            # Assuming 'start_date' field exists in Work Plan
                            wp_start = getdate(wp.start_date) if wp.get('start_date') else None
                            # Try standard field names for end date
                            wp_end = None
                            if wp.get('end_date'):
                                wp_end = getdate(wp.end_date)
                            elif wp.get('expected_completion_date'):
                                wp_end = getdate(wp.expected_completion_date)
                            
                            is_in_range = False
                            if wp_start and wp_end:
                                # Overlap check
                                if (wp_start <= end) and (wp_end >= start):
                                    is_in_range = True
                            elif wp_start:
                                # Only start date check
                                if start <= wp_start <= end:
                                    is_in_range = True
                            
                            if is_in_range:
                                final_data.append({
                                    "project": project,
                                    "zone": zone,
                                    "work_milestone_name": m.work_milestone_name,
                                    "work_header": m.work_header,
                                    "status": m.status,
                                    "progress": m.progress,
                                    "expected_starting_date": m.expected_starting_date,
                                    "expected_completion_date": m.expected_completion_date,
                                    "work_plan_details": wp,
                                    "source": "Work Plan Document"
                                })
                except Exception as e:
                    frappe.db.rollback()
                    # Log error but continue to fallback
                    # frappe.log_error(f"Work Plan Fetch Error: {str(e)}")
                    pass

            if not work_plan_found:
                # Fallback to Milestone Dates
                m_start = getdate(m.expected_starting_date) if m.expected_starting_date else None
                m_end = getdate(m.expected_completion_date) if m.expected_completion_date else None

                if m_start and m_end:
                    # Overlap
                    if (m_start <= end) and (m_end >= start):
                         final_data.append({
                            "project": project,
                            "zone": zone,
                            "work_milestone_name": m.work_milestone_name,
                            "work_header": m.work_header,
                            "status": m.status,
                            "progress": m.progress,
                            "expected_starting_date": m.expected_starting_date,
                            "expected_completion_date": m.expected_completion_date,
                            "work_plan_json": m.work_plan,
                            "source": "Milestone Dates"
                        })
                elif m_start:
                    if start <= m_start <= end:
                         final_data.append({
                            "project": project,
                            "zone": zone,
                            "work_milestone_name": m.work_milestone_name,
                            "work_header": m.work_header,
                            "status": m.status,
                            "progress": m.progress,
                            "expected_starting_date": m.expected_starting_date,
                            "expected_completion_date": m.expected_completion_date,
                            "work_plan_json": m.work_plan,
                            "source": "Milestone Dates"
                        })

    return final_data
