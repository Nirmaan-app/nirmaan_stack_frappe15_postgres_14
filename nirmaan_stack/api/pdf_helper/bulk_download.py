
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
    docs = frappe.get_all(dt, filters={"project": project, "status": ["not in", ["Merged", "Cancelled", "PO Amendment", "Inactive"]]}, fields=["name"], order_by="creation desc")

    if not docs:
        frappe.throw(f"No Procurement Orders found for project {project}")

    merger = PdfWriter()
    count = 0

    total_docs = len(docs)

    # Determine Print Format based on with_rate
    print_format = "PO Orders" if with_rate else "PO Orders Without Rate"

    merger = PdfWriter()
    count = 0
    failed_docs = []

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
            failed_docs.append(f"PO {doc.name} ({str(e)})")
            print(f"Failed to generate PDF for PO {doc.name}: {e}")

    if failed_docs:
        frappe.throw(f"Bulk download failed partially. Please check the following documents: {', '.join(failed_docs)}")

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
    docs = frappe.get_all(dt, filters={"project": project, "status": "Approved"}, fields=["name"], order_by="creation desc")

    if not docs:
        frappe.throw(f"No Work Orders found for project {project}")

    merger = PdfWriter()
    count = 0

    total_docs = len(docs)
    merger = PdfWriter()
    count = 0
    failed_docs = []

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
            failed_docs.append(f"WO {doc.name} ({str(e)})")
            print(f"Failed to generate PDF for WO {doc.name}: {e}")

    if failed_docs:
        frappe.throw(f"Bulk download failed partially. Please check the following documents: {', '.join(failed_docs)}")

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
    docs = frappe.get_all(
        dt, 
        filters={
            "project": project, 
            "status": ["in", ["Delivered", "Partially Delivered"]]
        }, 
        fields=["name"], 
        order_by="creation desc"
    )

    if not docs:
        frappe.throw(f"No Procurement Orders found for project {project}")

    merger = PdfWriter()
    count = 0
    failed_docs = []

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
            failed_docs.append(f"DN for PO {doc.name} ({str(e)})")
            print(f"Failed to generate DN PDF for PO {doc.name}: {e}")

    if failed_docs:
        frappe.throw(f"Bulk download failed partially. Please check the following documents: {', '.join(failed_docs)}")

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
    failed_docs = []
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
                failed_docs.append(f"{label} {doc.name} (No attachment linked)")
                continue

            content = _fetch_attachment_content(doc.attachment)
            if not content:
                failed_docs.append(f"{label} {doc.name} (Failed to fetch/download attachment)")
                continue

            try:
                if _merge_content(merger, content, doc.name):
                    count += 1
                else:
                    failed_docs.append(f"{label} {doc.name} (Invalid PDF/Image format)")
            except Exception as e:
                failed_docs.append(f"{label} {doc.name} ({str(e)})")

        except Exception as e:
            failed_docs.append(f"{label} {doc.name} ({str(e)})")
            print(f"Error processing {label} attachment {doc.name}: {e}")

    if failed_docs:
        frappe.msgprint(
            f"Some {label} could not be included: {', '.join(failed_docs)}",
            indicator="orange",
            title="Partial Download"
        )

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
        # Consider logging this or returning error reason if possible
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
        raise e # Re-raise so caller knows it failed
    return False


@frappe.whitelist()
def download_selected_pos(project, names, with_rate=1):
    """
    Download selected Procurement Orders (by name list) for a given project.
    `names` is a JSON-encoded list of PO names, e.g. '["PO-0001", "PO-0002"]'
    """
    import json

    if not project:
        frappe.throw("Project is required")
    if not names:
        frappe.throw("No POs selected")

    if isinstance(with_rate, str):
        with_rate = with_rate.lower() in ("true", "1", "yes")
    elif isinstance(with_rate, int):
        with_rate = bool(with_rate)

    if isinstance(names, str):
        names = json.loads(names)

    dt = "Procurement Orders"
    print_format = "PO Orders" if with_rate else "PO Orders Without Rate"

    merger = PdfWriter()
    count = 0
    failed_docs = []
    total_docs = len(names)

    for i, po_name in enumerate(names):
        try:
            progress = int(((i + 1) / total_docs) * 100)
            frappe.publish_realtime(
                "bulk_download_progress",
                {"progress": progress, "message": f"Processing PO {i+1} of {total_docs}: {po_name}", "label": "Procurement Orders"},
                user=frappe.session.user
            )

            main_pdf_content = frappe.get_print(dt, po_name, print_format=print_format, as_pdf=True)

            attachment_urls = []
            doc_attachment = frappe.db.get_value(dt, po_name, "attachment")
            if doc_attachment:
                attachment_urls.append(doc_attachment)

            if main_pdf_content:
                final_pdf_content = merge_pdfs(main_pdf_content, attachment_urls)
                merger.append(io.BytesIO(final_pdf_content))
                count += 1
        except Exception as e:
            failed_docs.append(f"PO {po_name} ({str(e)})")
            print(f"Failed to generate PDF for PO {po_name}: {e}")

    if failed_docs:
        frappe.throw(f"Bulk download failed partially: {', '.join(failed_docs)}")

    if count == 0:
        frappe.throw("Failed to generate any PO PDFs.")

    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    rate_label = "With_Rate" if with_rate else "Without_Rate"
    _send_pdf_response(merger, f"{project_name}_Selected_POs_{rate_label}.pdf")


@frappe.whitelist()
def download_selected_wos(project, names):
    """
    Download selected Work Orders / Service Requests (by name list) for a given project.
    `names` is a JSON-encoded list of SR names.
    """
    import json

    if not project:
        frappe.throw("Project is required")
    if not names:
        frappe.throw("No WOs selected")

    if isinstance(names, str):
        names = json.loads(names)

    dt = "Service Requests"
    print_format = "Work Orders"

    merger = PdfWriter()
    count = 0
    failed_docs = []
    total_docs = len(names)

    for i, wo_name in enumerate(names):
        try:
            progress = int(((i + 1) / total_docs) * 100)
            frappe.publish_realtime(
                "bulk_download_progress",
                {"progress": progress, "message": f"Processing WO {i+1} of {total_docs}: {wo_name}", "label": "Work Orders"},
                user=frappe.session.user
            )

            pdf_content = frappe.get_print(dt, wo_name, print_format=print_format, as_pdf=True)

            if pdf_content:
                merger.append(io.BytesIO(pdf_content))
                count += 1
        except Exception as e:
            failed_docs.append(f"WO {wo_name} ({str(e)})")
            print(f"Failed to generate PDF for WO {wo_name}: {e}")

    if failed_docs:
        frappe.throw(f"Bulk download failed partially: {', '.join(failed_docs)}")

    if count == 0:
        frappe.throw("Failed to generate any WO PDFs.")

    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    _send_pdf_response(merger, f"{project_name}_Selected_WOs.pdf")


@frappe.whitelist()
def download_selected_dns(project, names):
    """
    Download selected Delivery Notes for chosen POs (by name list).
    `names` is a JSON-encoded list of PO names.
    """
    import json

    if not project:
        frappe.throw("Project is required")
    if not names:
        frappe.throw("No POs selected for Delivery Notes")

    if isinstance(names, str):
        names = json.loads(names)

    dt = "Procurement Orders"
    print_format = "PO Delivery Histroy"

    merger = PdfWriter()
    count = 0
    failed_docs = []
    total_docs = len(names)

    for i, po_name in enumerate(names):
        try:
            progress = int(((i + 1) / total_docs) * 100)
            frappe.publish_realtime(
                "bulk_download_progress",
                {"progress": progress, "message": f"Processing DN {i+1} of {total_docs}: {po_name}", "label": "Delivery Notes"},
                user=frappe.session.user
            )

            pdf_content = frappe.get_print(dt, po_name, print_format=print_format, as_pdf=True)

            if pdf_content:
                merger.append(io.BytesIO(pdf_content))
                count += 1
        except Exception as e:
            failed_docs.append(f"DN for PO {po_name} ({str(e)})")
            print(f"Failed to generate DN PDF for PO {po_name}: {e}")

    if failed_docs:
        frappe.throw(f"Bulk download failed partially: {', '.join(failed_docs)}")

    if count == 0:
        frappe.throw("Failed to generate any Delivery Note PDFs.")

    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    _send_pdf_response(merger, f"{project_name}_Selected_DNs.pdf")


@frappe.whitelist()
def download_selected_attachments(project, attachment_names, doc_type):
    """
    Download selected Nirmaan Attachments by name list.
    `attachment_names` is a JSON-encoded list of Nirmaan Attachments record names.
    `doc_type` is used only for the filename label.
    """
    import json

    if not project:
        frappe.throw("Project is required")
    if not attachment_names:
        frappe.throw("No attachments selected")

    if isinstance(attachment_names, str):
        attachment_names = json.loads(attachment_names)

    label_map = {
        "PO Invoices": "PO_Invoices",
        "WO Invoices": "WO_Invoices",
        "All Invoices": "All_Invoices",
        "DC": "Delivery_Challans",
        "MIR": "Material_Inspection_Reports",
    }
    label = label_map.get(doc_type, doc_type.replace(" ", "_"))

    docs = frappe.get_all(
        "Nirmaan Attachments",
        filters={"name": ["in", attachment_names]},
        fields=["name", "attachment", "attachment_type"]
    )

    if not docs:
        frappe.throw(f"No attachments found for the selection.")

    merger = PdfWriter()
    count = 0
    failed_docs = []
    total_docs = len(docs)

    for i, doc in enumerate(docs):
        try:
            progress = int(((i + 1) / total_docs) * 100)
            frappe.publish_realtime(
                "bulk_download_progress",
                {"progress": progress, "message": f"Processing {i+1} of {total_docs}...", "label": label},
                user=frappe.session.user
            )

            if not doc.attachment:
                failed_docs.append(f"{doc.name} (No attachment linked)")
                continue

            content = _fetch_attachment_content(doc.attachment)
            if not content:
                failed_docs.append(f"{doc.name} (Failed to fetch attachment)")
                continue

            try:
                if _merge_content(merger, content, doc.name):
                    count += 1
                else:
                    failed_docs.append(f"{doc.name} (Invalid PDF/Image format)")
            except Exception as e:
                failed_docs.append(f"{doc.name} ({str(e)})")

        except Exception as e:
            failed_docs.append(f"{doc.name} ({str(e)})")
            print(f"Error processing attachment {doc.name}: {e}")

    if failed_docs:
        frappe.msgprint(
            f"Some items could not be included: {', '.join(failed_docs)}",
            indicator="orange",
            title="Partial Download"
        )

    if count == 0:
        frappe.throw(f"Failed to generate any {label} PDFs.")

    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    _send_pdf_response(merger, f"{project_name}_Selected_{label}.pdf")

