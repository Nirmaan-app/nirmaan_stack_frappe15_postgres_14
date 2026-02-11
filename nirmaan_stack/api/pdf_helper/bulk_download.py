
import frappe
from pypdf import PdfWriter, PdfReader
import io
import os
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

    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    _send_pdf_response(merger, f"{project_name}_All_POs.pdf")


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

    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    _send_pdf_response(merger, f"{project_name}_All_WOs.pdf")


def _send_pdf_response(merger, filename):
    output = io.BytesIO()
    merger.write(output)
    merger.close()

    frappe.local.response.filename = filename
    frappe.local.response.filecontent = output.getvalue()
    frappe.local.response.type = "download"


@frappe.whitelist()
def download_all_invoices(project, invoice_type="All"):
    """
    Download invoices based on type from Nirmaan Attachments.
    invoice_type options: "PO Invoices", "WO Invoices", "All Invoices"
    """
    import requests
    from nirmaan_stack.api.frappe_s3_attachment import get_s3_temp_url
    
    # Import PIL inside function
    try:
        from PIL import Image
    except ImportError:
        frappe.throw("Pillow (PIL) library is required for image to PDF conversion.")

    if not project:
        frappe.throw("Project is required")

    filters = {"project": project}
    
    if invoice_type == "PO Invoices":
        filters["attachment_type"] = ["in", ["po invoice"]]
    elif invoice_type == "WO Invoices":
        filters["attachment_type"] = ["in", ["sr invoice"]]
    elif invoice_type == "All Invoices":
        filters["attachment_type"] = ["in", ["po invoice", "sr invoice"]]
    
    docs = frappe.get_all("Nirmaan Attachments", filters=filters, fields=["name", "attachment", "attachment_type"], order_by="creation desc")

    if not docs:
        frappe.throw(f"No {invoice_type} found for project {project}")

    merger = PdfWriter()
    count = 0
    total_docs = len(docs)

    for i, doc in enumerate(docs):
        try:
            # Publish Progress
            progress = int(((i + 1) / total_docs) * 100)
            frappe.publish_realtime(
                "bulk_download_progress",
                {"progress": progress, "message": f"Processing {doc.attachment_type} {i+1} of {total_docs}...", "label": "Invoices"},
                user=frappe.session.user
            )

            if not doc.attachment:
                continue

            original_url = doc.attachment
            content = None

            # --- Fetch Content Logic (Adapted from po_print.py) ---
            try:
                # Resolve URL
                file_url = get_s3_temp_url(original_url)
                
                # HTTP / Presigned URL
                if file_url.startswith("http"):
                    res = requests.get(file_url, timeout=30, stream=True)
                    res.raise_for_status()
                    buffer = io.BytesIO()
                    for chunk in res.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            buffer.write(chunk)
                    content = buffer.getvalue()

                # Local filesystem
                else:
                    file_path = None
                    if original_url.startswith("/files/") or original_url.startswith("/private/files/"):
                        file_path = frappe.utils.get_files_path(
                            original_url.lstrip("/"),
                            is_private=original_url.startswith("/private/")
                        )

                    if file_path and os.path.exists(file_path):
                        with open(file_path, "rb") as f:
                            content = f.read()
                    else:
                        # Fallback to fetching via site URL if get_files_path fails
                        full_url = f"{frappe.utils.get_site_url(frappe.local.site)}{file_url}"
                        res = requests.get(full_url, timeout=30)
                        if res.status_code == 200:
                            content = res.content
            except Exception as e:
                print(f"Failed to fetch content for {doc.name} ({original_url}): {e}")
                continue
            
            if not content:
                continue

            # --- Merge Logic (PDF or Image) ---
            merged = False
            
            # 1. Try PDF
            try:
                PdfReader(io.BytesIO(content)) # Validate
                merger.append(io.BytesIO(content))
                merged = True
            except Exception:
                pass # Not a valid PDF, try image
            
            # 2. Try Image if PDF failed
            if not merged:
                try:
                    img = Image.open(io.BytesIO(content))
                    
                    if img.mode in ("P", "RGBA", "LA"):
                        img = img.convert("RGB")
                    elif img.mode != "RGB":
                         img = img.convert("RGB")

                    img_pdf = io.BytesIO()
                    img.save(img_pdf, format="PDF")
                    merger.append(io.BytesIO(img_pdf.getvalue()))
                    merged = True
                except Exception as e:
                    print(f"Failed to convert image for {doc.name}: {e}")

            if merged:
                count += 1

        except Exception as e:
            print(f"General error processing attachment {doc.name}: {e}")

    if count == 0:
        frappe.throw("Failed to generate any Invoice PDFs (fetched 0 valid files).")

    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    _send_pdf_response(merger, f"{project_name}_{invoice_type.replace(' ', '_')}.pdf")
