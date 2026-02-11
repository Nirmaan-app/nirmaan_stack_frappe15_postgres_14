
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
def download_all_dns(project):
    """
    Download all Delivery Notes (PO Delivery Histroy) for a given project.
    """
    if not project:
        frappe.throw("Project is required")

    dt = "Procurement Orders"
    docs = frappe.get_all(dt, filters={"project": project}, fields=["name"], order_by="creation desc")

    if not docs:
        frappe.throw(f"No Procurement Orders found for project {project}")

    merger = PdfWriter()
    count = 0

    total_docs = len(docs)
    for i, doc in enumerate(docs):
        try:
            # Publish Progress BEFORE processing
            progress = int(((i + 1) / total_docs) * 100)
            frappe.publish_realtime(
                "bulk_download_progress",
                {"progress": progress, "message": f"Processing DN {i+1} of {total_docs}...", "label": "Delivery Notes"},
                user=frappe.session.user
            )

            # Print Format for DN
            print_format = "PO Delivery Histroy"
            
            # Generate PDF
            pdf_content = frappe.get_print(dt, doc.name, print_format=print_format, as_pdf=True)
            
            if pdf_content:
                merger.append(io.BytesIO(pdf_content))
                count += 1
        except Exception as e:
            print(f"Failed to generate DN PDF for PO {doc.name}: {e}")

    if count == 0:
        frappe.throw("Failed to generate any Delivery Note PDFs.")

    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    _send_pdf_response(merger, f"{project_name}_All_DNs.pdf")


# // her this is they common print of using they PO Invoices ,WO inoices , ALL Inovoices, DC, MIR
@frappe.whitelist()
def download_project_attachments(project, doc_type):
    """
    Unified function to download project attachments from Nirmaan Attachments.
    doc_type options: "PO Invoices", "WO Invoices", "All Invoices", "DC", "MIR"
    """
    if not project:
        frappe.throw("Project is required")

    # Map doc_type to filter and labels
    type_map = {
        "PO Invoices": {"filter": "po invoice", "label": "PO Invoices"},
        "WO Invoices": {"filter": "sr invoice", "label": "WO Invoices"},
        "All Invoices": {"filter": ["in", ["po invoice", "sr invoice"]], "label": "All Invoices"},
        "DC": {"filter": "po delivery challan", "label": "Delivery Challans"},
        "MIR": {"filter": "material inspection report", "label": "Material Inspection Reports"}
    }

    if doc_type not in type_map:
        frappe.throw(f"Invalid document type: {doc_type}")

    config = type_map[doc_type]
    label = config["label"]
    
    docs = frappe.get_all("Nirmaan Attachments", 
        filters={"project": project, "attachment_type": config["filter"]}, 
        fields=["name", "attachment", "attachment_type"], 
        order_by="creation desc"
    )

    if not docs:
        frappe.throw(f"No {label} found for project {project}")

    merger = PdfWriter()
    count = 0
    total_docs = len(docs)

    for i, doc in enumerate(docs):
        try:
            progress = int(((i + 1) / total_docs) * 100)
            frappe.publish_realtime(
                "bulk_download_progress",
                {"progress": progress, "message": f"Processing {label} {i+1} of {total_docs}...", "label": label},
                user=frappe.session.user
            )

            if not doc.attachment:
                continue

            content = _fetch_attachment_content(doc.attachment)
            if not content:
                continue

            if _merge_content(merger, content, doc.name):
                count += 1

        except Exception as e:
            print(f"Error processing {label} attachment {doc.name}: {e}")

    if count == 0:
        frappe.throw(f"Failed to generate any {label} PDFs.")

    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    _send_pdf_response(merger, f"{project_name}_{label.replace(' ', '_')}.pdf")


def _fetch_attachment_content(attachment_url):
    import requests
    from nirmaan_stack.api.frappe_s3_attachment import get_s3_temp_url
    try:
        file_url = get_s3_temp_url(attachment_url)
        if file_url.startswith("http"):
            res = requests.get(file_url, timeout=30, stream=True)
            res.raise_for_status()
            buffer = io.BytesIO()
            for chunk in res.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    buffer.write(chunk)
            return buffer.getvalue()
        else:
            file_path = None
            if attachment_url.startswith("/files/") or attachment_url.startswith("/private/files/"):
                file_path = frappe.utils.get_files_path(
                    attachment_url.lstrip("/"),
                    is_private=attachment_url.startswith("/private/")
                )
            if file_path and os.path.exists(file_path):
                with open(file_path, "rb") as f:
                    return f.read()
            else:
                full_url = f"{frappe.utils.get_site_url(frappe.local.site)}{file_url}"
                res = requests.get(full_url, timeout=30)
                if res.status_code == 200:
                    return res.content
    except Exception as e:
        print(f"Failed to fetch content for {attachment_url}: {e}")
    return None


def _merge_content(merger, content, doc_name):
    from PIL import Image
    # 1. Try PDF
    try:
        PdfReader(io.BytesIO(content))
        merger.append(io.BytesIO(content))
        return True
    except Exception:
        pass
    
    # 2. Try Image
    try:
        img = Image.open(io.BytesIO(content))
        if img.mode in ("P", "RGBA", "LA"):
            img = img.convert("RGB")
        elif img.mode != "RGB":
            img = img.convert("RGB")
        img_pdf = io.BytesIO()
        img.save(img_pdf, format="PDF")
        merger.append(io.BytesIO(img_pdf.getvalue()))
        return True
    except Exception as e:
        print(f"Failed to convert image for {doc_name}: {e}")
    return False

