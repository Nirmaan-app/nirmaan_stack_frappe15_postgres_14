
import frappe
from nirmaan_stack.api.pdf_helper.pdf_merger_api import merge_pdfs

@frappe.whitelist()
def download_merged_pdf(doctype, docname, print_format="Standard"):
    """
    Generates the Standard PDF for the document and merges it with linked PDF attachments.
    """
    try:
        # 1. EXECUTION: Generate the Main PDF via Frappe's engine
        main_pdf_content = frappe.get_print(
            doctype, 
            docname, 
            print_format=print_format, 
            as_pdf=True
        )

        # 2. FETCH: Find Attachments
        # User specified: Fetch from 'attachment' field in the document itself
        attachment_urls = []
        
        # Get the specific field value
        doc_attachment = frappe.db.get_value(doctype, docname, "attachment")
        
        if doc_attachment:
            attachment_urls.append(doc_attachment)
            
        # Optional: Log if no attachment found, just in case
        if not doc_attachment:
             print(f"No attachment found in 'attachment' field for {docname}")
        
        # 3. MERGE: Combine them
        if not attachment_urls:
            final_pdf = main_pdf_content
        else:
            final_pdf = merge_pdfs(main_pdf_content, attachment_urls)

        # 4. RESPONSE: Return file to user
        frappe.local.response.filename = f"{docname}.pdf"
        frappe.local.response.filecontent = final_pdf
        frappe.local.response.type = "download"

    except Exception as e:
        frappe.log_error(f"Error in download_merged_pdf: {e}")
        frappe.throw(f"Failed to generate merged PDF: {str(e)}")
