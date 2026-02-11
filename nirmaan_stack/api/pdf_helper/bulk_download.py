
import frappe
from pypdf import PdfWriter, PdfReader
import io
from nirmaan_stack.api.pdf_helper.po_print import merge_pdfs

@frappe.whitelist()
def download_all_pos(project, with_rate=1):
    """
    Download all Procurement Orders for a given project with attachments.
    """
    if not project:
        frappe.throw("Project is required")

    # Convert with_rate to boolean if it comes as string/int
    if isinstance(with_rate, str):
        with_rate = with_rate.lower() in ("true", "1", "yes")
    elif isinstance(with_rate, int):
        with_rate = bool(with_rate)

    dt = "Procurement Orders"
    docs = frappe.get_all(dt, filters={"project": project}, fields=["name"], order_by="creation desc")

    if not docs:
        frappe.throw(f"No Procurement Orders found for project {project}")

    merger = PdfWriter()
    count = 0

    total_docs = len(docs)

    # Determine Print Format based on with_rate
    print_format = "PO Orders" if with_rate else "PO Orders Without Rate"

    merger = PdfWriter()
    count = 0

    total_docs = len(docs)
    for i, doc in enumerate(docs):
        try:
            # Publish Progress
            progress = int(((i + 1) / total_docs) * 100)
            frappe.publish_realtime(
                "bulk_download_progress",
                {"progress": progress, "message": f"Processing PO {i+1} of {total_docs}: {doc.name}", "label": "Procurement Orders"},
                user=frappe.session.user
            )

            # 1. Main PDF
            main_pdf_content = frappe.get_print(dt, doc.name, print_format=print_format, as_pdf=True)
            
            # 2. Attachments
            attachment_urls = []
            doc_attachment = frappe.db.get_value(dt, doc.name, "attachment")
            if doc_attachment:
                attachment_urls.append(doc_attachment)
            
            # 3. Merge
            if main_pdf_content:
                final_pdf_content = merge_pdfs(main_pdf_content, attachment_urls)
                merger.append(io.BytesIO(final_pdf_content))
                count += 1
        except Exception as e:
            print(f"Failed to generate PDF for PO {doc.name}: {e}")

    if count == 0:
        frappe.throw("Failed to generate any PO PDFs.")

    _send_pdf_response(merger, f"{project}_All_POs.pdf")


@frappe.whitelist()
def download_all_wos(project):
    """
    Download all Work Orders (Service Requests) for a given project.
    """
    if not project:
        frappe.throw("Project is required")

    dt = "Service Requests"
    docs = frappe.get_all(dt, filters={"project": project}, fields=["name"], order_by="creation desc")

    if not docs:
        frappe.throw(f"No Work Orders found for project {project}")

    merger = PdfWriter()
    count = 0

    total_docs = len(docs)
    merger = PdfWriter()
    count = 0

    total_docs = len(docs)
    for i, doc in enumerate(docs):
        try:
            # Publish Progress
            progress = int(((i + 1) / total_docs) * 100)
            frappe.publish_realtime(
                "bulk_download_progress",
                {"progress": progress, "message": f"Processing WO {i+1} of {total_docs}...", "label": "Work Orders"},
                user=frappe.session.user
            )

            # Custom Print Format for WO
            print_format = "Work Orders"
            
            # Generate PDF
            pdf_content = frappe.get_print(dt, doc.name, print_format=print_format, as_pdf=True)
            
            if pdf_content:
                merger.append(io.BytesIO(pdf_content))
                count += 1
        except Exception as e:
            print(f"Failed to generate PDF for WO {doc.name}: {e}")

    if count == 0:
        frappe.throw("Failed to generate any WO PDFs.")

    _send_pdf_response(merger, f"{project}_All_WOs.pdf")


def _send_pdf_response(merger, filename):
    output = io.BytesIO()
    merger.write(output)
    merger.close()

    frappe.local.response.filename = filename
    frappe.local.response.filecontent = output.getvalue()
    frappe.local.response.type = "download"
