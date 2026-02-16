
import frappe
from nirmaan_stack.api.frappe_s3_attachment import get_s3_temp_url
import requests
import io
import os
import concurrent.futures
from pypdf import PdfWriter, PdfReader
from PIL import Image

@frappe.whitelist()
def attachment_merged_pdf(doctype, docname, print_format="Standard"):
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
        attachment_urls = []
        
        # A) Fetch from 'attachment' field in the document itself
        doc_attachment = frappe.db.get_value(doctype, docname, "attachment")
        if doc_attachment:
            attachment_urls.append(doc_attachment)

        # Optional: Log if no attachment found
        if not attachment_urls:
             print(f"No attachments found for {docname}")
        
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
        # Return main PDF if merge fails, rather than crashing
        if 'main_pdf_content' in locals() and main_pdf_content:
             frappe.local.response.filename = f"{docname}.pdf"
             frappe.local.response.filecontent = main_pdf_content
             frappe.local.response.type = "download"
        else:
             frappe.throw(f"Failed to generate output: {str(e)}")


# // Po Merge fetch 
def fetch_content_worker(task):
    """
    Thread-safe worker.
    Returns (original_url, content_bytes | None)
    NOTE: Do NOT use frappe.db or frappe.log_error here as it runs in a thread 
    without a request context.
    """
    original_url = task.get("original_url")
    t_type = task.get("type")
    path = task.get("path")

    try:
        # -------- HTTP FETCH --------
        if t_type == "HTTP":
            res = requests.get(path, timeout=30, stream=True)
            res.raise_for_status()

            buffer = io.BytesIO()
            for chunk in res.iter_content(chunk_size=1024 * 1024):  # 1MB
                if chunk:
                    buffer.write(chunk)

            return original_url, buffer.getvalue()

        # -------- FILE FETCH --------
        elif t_type == "FILE":
            with open(path, "rb") as f:
                return original_url, f.read()

    except Exception as e:
        # Use print instead of frappe.log_error to avoid threading issues
        print(f"Attachment fetch failed [{original_url}]: {str(e)}")

    return original_url, None

# // Po Merge 
def merge_pdfs(main_pdf_content: bytes, attachment_urls: list = None) -> bytes:
    """
    Merge main PDF with attachment PDFs/images.
    Safe for large file counts and threaded I/O.
    """

    merger = PdfWriter()

    # -----------------------------
    # 1. Add Main PDF
    # -----------------------------
    try:
        if main_pdf_content:
            PdfReader(io.BytesIO(main_pdf_content))  # validate
            merger.append(io.BytesIO(main_pdf_content))
    except Exception as e:
        frappe.log_error(f"Main PDF invalid: {e}")
        return main_pdf_content

    # -----------------------------
    # 2. Prepare Attachment Tasks
    # -----------------------------
    tasks = []

    if attachment_urls:
        if len(attachment_urls) > 50:
             attachment_urls = attachment_urls[:50]

        for original_url in attachment_urls:
            try:
                file_url = get_s3_temp_url(original_url)
                task = {"original_url": original_url}

                # HTTP / Presigned URL
                if file_url.startswith("http"):
                    task["type"] = "HTTP"
                    task["path"] = file_url

                # Local filesystem
                else:
                    file_path = None
                    if original_url.startswith("/files/") or original_url.startswith("/private/files/"):
                        file_path = frappe.utils.get_files_path(
                            original_url.lstrip("/"),
                            is_private=original_url.startswith("/private/")
                        )

                    if file_path and os.path.exists(file_path):
                        task["type"] = "FILE"
                        task["path"] = file_path
                    else:
                        # fallback HTTP
                        task["type"] = "HTTP"
                        task["path"] = f"{frappe.utils.get_site_url(frappe.local.site)}{file_url}"

                tasks.append(task)

            except Exception as e:
                print(f"Task preparation failed: {original_url} - {e}")

    # -----------------------------
    # 3. Fetch + Merge Attachments
    # -----------------------------
    if tasks:
        # Use ThreadPoolExecutor for parallel fetching
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            for original_url, content in executor.map(fetch_content_worker, tasks):

                if not content:
                    continue

                # ---- Try PDF ----
                try:
                    PdfReader(io.BytesIO(content))  # validate
                    merger.append(io.BytesIO(content))
                    continue
                except Exception:
                    pass

                # ---- Try Image ----
                try:
                    img = Image.open(io.BytesIO(content))
                    
                    if img.mode in ("P", "RGBA", "LA"):
                        img = img.convert("RGB")
                    elif img.mode != "RGB":
                         img = img.convert("RGB")

                    img_pdf = io.BytesIO()
                    img.save(img_pdf, format="PDF")
                    merger.append(io.BytesIO(img_pdf.getvalue()))

                except Exception as e:
                    print(f"Attachment merge failed [{original_url}]: {str(e)}")

    # -----------------------------
    # 4. Output Final PDF
    # -----------------------------
    try:
        output = io.BytesIO()
        merger.write(output)
        merger.close()
        return output.getvalue()

    except Exception as e:
        frappe.log_error(f"Final PDF write failed: {e}")
        return main_pdf_content
