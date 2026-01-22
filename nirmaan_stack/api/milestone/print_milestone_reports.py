"""
API for generating and merging milestone report PDFs.
Provides endpoints for single zone and all zones PDF downloads.
"""
import frappe
import io
from pypdf import PdfWriter, PdfReader


# @frappe.whitelist()
# def get_single_zone_report_pdf(project_id: str, report_date: str, zone: str):
#     """
#     Get PDF for a single zone's progress report.
    
#     Args:
#         project_id: The project document name
#         report_date: Date in YYYY-MM-DD format
#         zone: Zone name
    
#     Returns:
#         PDF file download
#     """
#     try:
#         # Find the report document for this project/date/zone
#         report_name = frappe.db.get_value(
#             "Project Progress Reports",
#             {
#                 "project": project_id,
#                 "report_date": report_date,
#                 "report_zone": zone,
#                 "report_status": "Completed"
#             },
#             "name"
#         )
        
#         if not report_name:
#             frappe.throw(f"No completed report found for zone '{zone}' on {report_date}")
        
#         # Generate PDF using the Milestone Report print format
#         pdf_content = frappe.get_print(
#             "Project Progress Reports",
#             report_name,
#             print_format="Milestone Report",
#             as_pdf=True
#         )
        
#         # Return as download
#         frappe.local.response.filename = f"{project_id}_{zone}_{report_date}.pdf"
#         frappe.local.response.filecontent = pdf_content
#         frappe.local.response.type = "download"
        
#     except Exception as e:
#         frappe.log_error(f"Error in get_single_zone_report_pdf: {e}")
#         frappe.throw(f"Failed to generate PDF: {str(e)}")


@frappe.whitelist()
def get_merged_zone_reports_pdf(project_id: str, report_date: str):
    """
    Get all zone reports for a project on a given date,
    generate PDFs for each, merge them, and return combined PDF.
    
    Args:
        project_id: The project document name
        report_date: Date in YYYY-MM-DD format
    
    Returns:
        Merged PDF file download
    """
    try:
        # 1. Get all completed reports for this project on this date
        reports = frappe.get_all(
            "Project Progress Reports",
            filters={
                "project": project_id,
                "report_date": report_date,
                "report_status": "Completed"
            },
            fields=["name", "report_zone"],
            order_by="report_zone asc"
        )
        
        if not reports:
            frappe.throw(f"No completed reports found for project on {report_date}")
        
        # 2. Generate PDF for each report
        merger = PdfWriter()
        
        for report in reports:
            try:
                pdf_content = frappe.get_print(
                    "Project Progress Reports",
                    report.name,
                    print_format="Milestone Report",
                    as_pdf=True
                )
                
                # Add to merger
                reader = PdfReader(io.BytesIO(pdf_content))
                for page in reader.pages:
                    merger.add_page(page)
                    
            except Exception as e:
                frappe.log_error(
                    message=str(e),
                    title=f"PDF generation failed for report: {report.name}"
                )
                # Continue with other reports
        
        # 3. Output merged PDF
        output = io.BytesIO()
        merger.write(output)
        merger.close()
        
        merged_pdf = output.getvalue()
        
        if not merged_pdf:
            frappe.throw("Failed to merge PDFs")
        
        # 4. Return as download
        frappe.local.response.filename = f"{project_id}_all_zones_{report_date}.pdf"
        frappe.local.response.filecontent = merged_pdf
        frappe.local.response.type = "download"
        
    except Exception as e:
        frappe.log_error(f"Error in get_merged_zone_reports_pdf: {e}")
        frappe.throw(f"Failed to generate merged PDF: {str(e)}")


@frappe.whitelist()
def get_report_doc_name(project_id: str, report_date: str, zone: str):
    """
    Helper endpoint to get the report document name for a given project/date/zone.
    Used by frontend to construct single zone PDF download URL.
    
    Returns:
        JSON with report_name or null
    """
    report_name = frappe.db.get_value(
        "Project Progress Reports",
        {
            "project": project_id,
            "report_date": report_date,
            "report_zone": zone,
            "report_status": "Completed"
        },
        "name"
    )
    
    return {"report_name": report_name}


@frappe.whitelist()
def get_all_zones_overall_report_pdf(project_id: str):
    """
    Get 14-days (Overall) reports for all zones by iterating zone-by-zone,
    generating individual 'Overall Milestones Report' PDFs for the Project via zone filter,
    and merging them into one.
    
    Args:
        project_id: The project document name (ID)
    
    Returns:
        Merged PDF file download
    """
    try:
        # 1. Fetch project to get list of zones
        project = frappe.get_doc("Projects", project_id)
        if not project:
            frappe.throw(f"Project not found: {project_id}")
            
        # Get zones from child table 'project_zones'
        zones = [z.zone_name for z in project.project_zones]
        
        if not zones:
            frappe.throw("No zones found for this project")
            
        zones.sort() # Sort alphabetically
        
        merger = PdfWriter()
        
        # 2. Iterate each zone and generate PDF
        # We pass the modified 'doc' object with 'report_zone' set (in-memory) to get_print.
        # This allows the print format to pick up 'doc.report_zone' without patching global frappe.form_dict.
        
        for zone in zones:
            # Re-fetch the project doc for each iteration to avoid any potential
            # caching or reference issues in get_print / Jinja context.
            project_doc = frappe.get_doc("Projects", project_id)
            
            # Inject zone into the doc object
            project_doc.report_zone = zone
            print(f"CountZone:{zone}")
            
            try:
                pdf_content = frappe.get_print(
                    "Projects",
                    project_id,
                    print_format="Overall Milestones Report",
                    no_letterhead=0,
                    as_pdf=True,
                    doc=project_doc
                )
                
                # Add to merger
                reader = PdfReader(io.BytesIO(pdf_content))
                for page in reader.pages:
                    merger.add_page(page)
                    
            except Exception as e:
                frappe.log_error(
                    message=str(e),
                    title=f"PDF generation failed for zone: {zone}"
                )
        
        # 3. Output merged PDF
        output = io.BytesIO()
        merger.write(output)
        merger.close()
        
        merged_pdf = output.getvalue()
        
        if not merged_pdf:
            frappe.throw("Failed to merge PDFs")
        
        # 4. Return as download
        from frappe.utils import today
        date_str = today()
        
        frappe.local.response.filename = f"{project_id}_Overall_14Days_AllZones_{date_str}.pdf"
        frappe.local.response.filecontent = merged_pdf
        frappe.local.response.type = "download"
        
    except Exception as e:
        frappe.log_error(f"Error in get_all_zones_overall_report_pdf: {e}")
        frappe.throw(f"Failed to generate merged PDF: {str(e)}")
