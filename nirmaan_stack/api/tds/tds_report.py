import frappe
import json
from frappe.utils.pdf import get_pdf
from nirmaan_stack.api.pdf_helper.pdf_merger_api import merge_pdfs_interleaved

@frappe.whitelist()
def export_tds_report(settings_json: str, items_json: str, project_name: str = "TDS_Report"):
    """
    Main API endpoint for TDS PDF export with interleaved attachments.
    
    1. Generates base PDF using Frappe print format
    2. Merges each item's attachment after its approval form page
    3. Returns combined PDF for download
    
    Args:
        settings_json: JSON string of TDS settings (stakeholders etc)
        items_json: JSON string of selected items with tds_attachment field
        project_name: Name of the project for filename
    """
    try:
        settings = json.loads(settings_json) if isinstance(settings_json, str) else settings_json
        items = json.loads(items_json) if isinstance(items_json, str) else items_json
        
        # Build data for print format (same as frontend was sending)
        combined_data = json.dumps({
            "settings": settings,
            "history": items
        })
        
        # Generate base PDF using Frappe's print format
        # We need to render the Jinja template HTML first
        print_format = frappe.get_doc("Print Format", "Project TDS Report")
        
        if not print_format:
            frappe.throw("Print Format 'Project TDS Report' not found")
        
        # Render the HTML template
        html_template = print_format.html
        
        # Set form_dict for the template just in case
        frappe.form_dict.data = combined_data
        
        template = frappe.render_template(html_template, {
            "frappe": frappe,
            "json": json,
            # We must pass the data object implicitly if template uses frappe.form_dict.data or custom parsing
            # But render_template usually takes a context. 
            # If the template relies on "doc" or specific variables, we should pass them.
            # Based on previous context, the template likely parses `frappe.form_dict.data`.
        })
        
        # Convert HTML to PDF
        base_pdf = get_pdf(template)
        
        # Merge with attachments interleaved
        merged_pdf = merge_pdfs_interleaved(base_pdf, items)
        
        # Clean project name for filename
        clean_name = frappe.scrub(project_name).replace('_', ' ').title().replace(' ', '_')
        
        # Return as download
        frappe.local.response.filename = f"TDS_Report_{clean_name}_{frappe.utils.nowdate()}.pdf"
        frappe.local.response.filecontent = merged_pdf
        frappe.local.response.type = "download"
        
    except Exception as e:
        frappe.log_error(f"export_tds_report failed: {e}")
        frappe.throw(f"PDF export failed: {str(e)}")
