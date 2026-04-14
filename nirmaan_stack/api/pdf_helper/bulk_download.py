import os
import uuid
import json
import io
import frappe
import requests
from pypdf import PdfWriter, PdfReader
from nirmaan_stack.api.pdf_helper.po_print import merge_pdfs
from nirmaan_stack.api.frappe_s3_attachment import get_s3_temp_url
from PIL import Image

def _merge_content(merger, content, name):
    """
    Tries to add content to merger. 
    Returns (success, pdf_bytes) where pdf_bytes is valid PDF content (converted if was image).
    """
    try:
        # 1. Try PDF
        try:
            PdfReader(io.BytesIO(content))
            merger.append(io.BytesIO(content))
            return True, content
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
            pdf_bytes = img_pdf.getvalue()
            merger.append(io.BytesIO(pdf_bytes))
            return True, pdf_bytes
        except Exception as e:
            print(f"Failed to convert image for {name}: {e}")
            return False, None

    except Exception as e:
        print(f"Failed to merge {name}: {e}")
        return False, None

def _fetch_attachment_content(original_url):
    if not original_url:
        return None
    try:
        file_url = get_s3_temp_url(original_url)
        
        # HTTP / Presigned URL
        if file_url.startswith("http"):
            res = requests.get(file_url, timeout=30, stream=True)
            res.raise_for_status()

            buffer = io.BytesIO()
            for chunk in res.iter_content(chunk_size=1024 * 1024):  # 1MB
                if chunk:
                    buffer.write(chunk)
            return buffer.getvalue()

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
                    return f.read()
            else:
                # fallback HTTP
                site_url = frappe.utils.get_site_url(frappe.local.site)
                full_url = f"{site_url}{file_url}"
                res = requests.get(full_url, timeout=30)
                if res.status_code == 200:
                    return res.content
        return None
    except Exception as e:
        print(f"Error fetching attachment {original_url}: {e}")
        return None



@frappe.whitelist()
def fetch_temp_file(token, filename):
    """
    Fetches a temporary file by token and deletes it immediately after reading.
    """
    if not token:
        frappe.throw("Invalid download token")

    temp_path = frappe.utils.get_site_path("public", "files", "temp_downloads", f"{token}.bin")
    
    if not os.path.exists(temp_path):
        frappe.throw("Download link expired or already used.")

    with open(temp_path, "rb") as f:
        file_content = f.read()

    # Immediate deletion
    try:
        os.remove(temp_path)
    except Exception as e:
        frappe.log_error(f"Failed to delete temp file {temp_path}: {e}")

    frappe.local.response.filename = filename
    frappe.local.response.filecontent = file_content
    frappe.local.response.type = "download"


def get_temp_path(token):
    return frappe.utils.get_site_path("public", "files", "temp_downloads", f"{token}.bin")


def ensure_temp_dir():
    temp_dir = frappe.utils.get_site_path("public", "files", "temp_downloads")
    if not os.path.exists(temp_dir):
        os.makedirs(temp_dir)


@frappe.whitelist()
def download_selected_pos(project, names, with_rate=1):
    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    frappe.enqueue(
        "nirmaan_stack.api.pdf_helper.bulk_download.run_bulk_download_job",
        project=project,
        doc_type="PO",
        names=names,
        with_rate=with_rate,
        user=frappe.session.user,
        custom_filename=f"{project_name}_Selected_POs.pdf",
        queue="long"
    )
    return {"message": "Job enqueued"}


@frappe.whitelist()
def download_selected_wos(project, names):
    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    frappe.enqueue(
        "nirmaan_stack.api.pdf_helper.bulk_download.run_bulk_download_job",
        project=project,
        doc_type="WO",
        names=names,
        user=frappe.session.user,
        custom_filename=f"{project_name}_Selected_WOs.pdf",
        queue="long"
    )
    return {"message": "Job enqueued"}


@frappe.whitelist()
def download_selected_dns(project, names):
    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    frappe.enqueue(
        "nirmaan_stack.api.pdf_helper.bulk_download.run_bulk_download_job",
        project=project,
        doc_type="DN",
        names=names,
        user=frappe.session.user,
        custom_filename=f"{project_name}_Selected_DNs.pdf",
        queue="long"
    )
    return {"message": "Job enqueued"}


@frappe.whitelist()
def download_selected_attachments(project, attachment_names, doc_type):
    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    frappe.enqueue(
        "nirmaan_stack.api.pdf_helper.bulk_download.run_bulk_download_job",
        project=project,
        doc_type=doc_type,
        attachment_names=attachment_names,
        user=frappe.session.user,
        custom_filename=f"{project_name}_Selected_{doc_type.replace(' ', '_')}.pdf",
        queue="long"
    )
    return {"message": "Job enqueued"}


@frappe.whitelist()
def download_all_pos(project, with_rate=1):
    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    names = frappe.get_all("Procurement Orders", filters={"project": project, "status": ["not in", ["Merged", "Cancelled", "PO Amendment", "Inactive"]]}, fields=["name"], order_by="creation asc")
    names = [n.name for n in names]
    frappe.enqueue(
        "nirmaan_stack.api.pdf_helper.bulk_download.run_bulk_download_job",
        project=project,
        doc_type="PO",
        names=json.dumps(names),
        with_rate=with_rate,
        user=frappe.session.user,
        custom_filename=f"{project_name}_All_POs.pdf",
        queue="long"
    )
    return {"message": "Job enqueued"}


@frappe.whitelist()
def download_all_wos(project):
    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    names = frappe.get_all("Service Requests", filters={"project": project, "status": "Approved"}, fields=["name"], order_by="creation asc")
    names = [n.name for n in names]
    frappe.enqueue(
        "nirmaan_stack.api.pdf_helper.bulk_download.run_bulk_download_job",
        project=project,
        doc_type="WO",
        names=json.dumps(names),
        user=frappe.session.user,
        custom_filename=f"{project_name}_All_WOs.pdf",
        queue="long"
    )
    return {"message": "Job enqueued"}


@frappe.whitelist()
def download_all_dns(project):
    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    names = frappe.get_all("Procurement Orders", filters={"project": project, "status": ["in", ["Delivered", "Partially Delivered", "Partially Dispatched"]]}, fields=["name"], order_by="creation asc")
    names = [n.name for n in names]
    frappe.enqueue(
        "nirmaan_stack.api.pdf_helper.bulk_download.run_bulk_download_job",
        project=project,
        doc_type="DN",
        names=json.dumps(names),
        user=frappe.session.user,
        custom_filename=f"{project_name}_All_DNs.pdf",
        queue="long"
    )
    return {"message": "Job enqueued"}


@frappe.whitelist()
def download_project_attachments(project, doc_type):
    # Enqueue with doc_type, the worker will resolve names if not provided
    project_name = frappe.db.get_value("Projects", project, "project_name") or project
    frappe.enqueue(
        "nirmaan_stack.api.pdf_helper.bulk_download.run_bulk_download_job",
        project=project,
        doc_type=doc_type,
        user=frappe.session.user,
        custom_filename=f"{project_name}_All_{doc_type.replace(' ', '_')}.pdf",
        queue="long"
    )
    return {"message": "Job enqueued"}


def run_bulk_download_job(project, doc_type, names=None, attachment_names=None, with_rate=1, user=None, custom_filename=None):
    """
    Worker function to process bulk downloads in a single unified flow.
    """
    frappe.set_user(user or "Administrator")
    ensure_temp_dir()
    
    import json
    if isinstance(names, str): names = json.loads(names)
    if isinstance(attachment_names, str): attachment_names = json.loads(attachment_names)
    if isinstance(with_rate, str): with_rate = with_rate.lower() in ("true", "1", "yes")

    # Resolve Document List if not provided
    if not names and not attachment_names:
        if doc_type == "PO":
            names = [n.name for n in frappe.get_all("Procurement Orders", filters={"project": project, "status": ["not in", ["Merged", "Cancelled", "PO Amendment", "Inactive"]]}, fields=["name"], order_by="creation asc")]
        elif doc_type == "WO":
            names = [n.name for n in frappe.get_all("Service Requests", filters={"project": project, "status": "Approved"}, fields=["name"], order_by="creation asc")]
        elif doc_type == "DN":
            names = [n.name for n in frappe.get_all("Procurement Orders", filters={"project": project, "status": ["in", ["Delivered", "Partially Delivered", "Partially Dispatched"]]}, fields=["name"], order_by="creation asc")]
        elif doc_type in ["PO Invoices", "WO Invoices", "All Invoices", "DC", "MIR"]:
            type_map = {
                "PO Invoices": {"filter": "po invoice"},
                "WO Invoices": {"filter": "sr invoice"},
                "All Invoices": {"filter": ["in", ["po invoice", "sr invoice"]]},
                "DC": {"filter": "po delivery challan"},
                "MIR": {"filter": "material inspection report"}
            }
            config = type_map.get(doc_type)
            if config:
                if doc_type in ["PO Invoices", "WO Invoices", "All Invoices"]:
                    vi_filters = {"project": project, "status": "Approved"}
                    if doc_type == "PO Invoices": vi_filters["document_type"] = "Procurement Orders"
                    elif doc_type == "WO Invoices": vi_filters["document_type"] = "Service Requests"
                    vendor_invoices = frappe.get_all("Vendor Invoices", filters=vi_filters, fields=["invoice_attachment"], order_by="creation asc")
                    attachment_names = [vi.invoice_attachment for vi in vendor_invoices if vi.invoice_attachment]
                else:
                    attachment_names = [d.name for d in frappe.get_all("Nirmaan Attachments", filters={"project": project, "attachment_type": config["filter"]}, fields=["name"], order_by="creation asc")]

    items_to_process = attachment_names if attachment_names else names
    if not items_to_process:
        frappe.publish_realtime("bulk_download_failed", {"message": f"No {doc_type} items found."}, user=user)
        return

    total_items = len(items_to_process)
    job_id = str(uuid.uuid4())
    
    final_merger = PdfWriter()
    count = 0

    # Unified Single-Flow Processing
    for i, item in enumerate(items_to_process):
        try:
            # Progress Reporting
            abs_index = i + 1
            progress = int((abs_index / total_items) * 100)
            frappe.publish_realtime(
                "bulk_download_progress",
                {"progress": progress, "message": f"Processing {doc_type} {abs_index} of {total_items}...", "label": doc_type},
                user=user
            )

            if attachment_names:
                # Attachment Logic
                if item.startswith("/files/") or item.startswith("http"):
                    content = _fetch_attachment_content(item)
                else:
                    content = _fetch_attachment_content_by_name(item)
                
                if content:
                    success, pdf_bytes = _merge_content(final_merger, content, item)
                    if success:
                        count += 1
            else:
                # Generic Doc Logic (PO, WO, DN)
                dt_map = {"PO": "Procurement Orders", "WO": "Service Requests", "DN": "Procurement Orders"}
                dt = dt_map.get(doc_type)
                pf_map = {"PO": "PO Orders" if with_rate else "PO Orders Without Rate", "WO": "Work Orders", "DN": "PO Delivery Histroy"}
                pf = pf_map.get(doc_type)
                
                pdf_content = frappe.get_print(dt, item, print_format=pf, as_pdf=True)
                
                if doc_type == "PO":
                    doc_attachment = frappe.db.get_value(dt, item, "attachment")
                    if doc_attachment:
                        pdf_content = merge_pdfs(pdf_content, [doc_attachment])
                
                if pdf_content:
                    final_merger.append(io.BytesIO(pdf_content))
                    count += 1
        except Exception as e:
            print(f"Error processing {doc_type} {item}: {e}")

    # Final Save and Notify
    if count > 0:
        final_token = str(uuid.uuid4())
        final_path = get_temp_path(final_token)
        with open(final_path, "wb") as f:
            final_merger.write(f)
        final_merger.close()
        
        project_name = frappe.db.get_value("Projects", project, "project_name") or project
        filename = custom_filename or f"{project_name}_All_{doc_type}.pdf"
        
        frappe.publish_realtime(
            "bulk_download_all_ready",
            {
                "job_id": job_id,
                "token": final_token,
                "filename": filename
            },
            user=user
        )
    else:
        frappe.publish_realtime("bulk_download_failed", {"message": "Failed to generate any documents."}, user=user)


def _fetch_attachment_content_by_name(attachment_record_name):
    doc = frappe.get_doc("Nirmaan Attachments", attachment_record_name)
    if doc.attachment:
        return _fetch_attachment_content(doc.attachment)
    return None

