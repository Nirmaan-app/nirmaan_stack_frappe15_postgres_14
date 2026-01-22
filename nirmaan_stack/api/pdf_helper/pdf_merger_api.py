import frappe
import requests
import io
import os
import concurrent.futures
from pypdf import PdfWriter, PdfReader
from PIL import Image
from nirmaan_stack.api.frappe_s3_attachment import get_s3_temp_url
# // Po Merge fetch 
def fetch_content_worker(task):
    """
    Thread-safe worker.
    Returns (original_url, content_bytes | None)
    """
    original_url = task["original_url"]
    t_type = task["type"]
    path = task["path"]

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
        frappe.log_error(
            message=str(e),
            title=f"Attachment fetch failed: {original_url}"
        )

    return original_url, None

# // Po Merge 
@frappe.whitelist()
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
            frappe.throw("Too many attachments. Please merge in smaller batches.")

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
                frappe.log_error(
                    message=str(e),
                    title=f"Task preparation failed: {original_url}"
                )

    # -----------------------------
    # 3. Fetch + Merge Attachments
    # -----------------------------
    if tasks:
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
                    img.verify()

                    img = Image.open(io.BytesIO(content))
                    if img.mode != "RGB":
                        img = img.convert("RGB")

                    img_pdf = io.BytesIO()
                    img.save(img_pdf, format="PDF")
                    merger.append(io.BytesIO(img_pdf.getvalue()))

                except Exception as e:
                    frappe.log_error(
                        message=str(e),
                        title=f"Attachment merge failed: {original_url}"
                    )

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



# // TDS  interval Merge PDfs

@frappe.whitelist()
def merge_pdfs_interleaved(main_pdf_content: bytes, items: list) -> bytes:
    """
    Merge main PDF with attachments interleaved after each item's page.
    
    Expected structure of main PDF:
    - Page 0: Stakeholder cards
    - Page 1: Summary table
    - Page 2: Item 0 approval form
    - Page 3: Item 1 approval form
    - ... etc
    
    Output structure:
    - Page 0: Stakeholder cards
    - Page 1: Summary table
    - Page 2: Item 0 approval form
    - Page 3-N: Item 0 attachment (if exists)
    - Page N+1: Item 1 approval form
    - Page N+2-M: Item 1 attachment (if exists)
    - ... etc
    
    Args:
        main_pdf_content: The base PDF bytes (from print format)
        items: List of items with 'tds_attachment' field
    """
    writer = PdfWriter()
    
    # Parse items if string
    if isinstance(items, str):
        items = frappe.parse_json(items)
    
    # Read main PDF
    try:
        main_reader = PdfReader(io.BytesIO(main_pdf_content))
        total_pages = len(main_reader.pages)
        num_items = len(items)
        
        # Calculate number of "Start Pages" (Stakeholders + Summary)
        # We assume each item generates exactly 1 Approval Form page at the end of the document
        # So: Start Pages = Total Pages - Item Pages
        num_start_pages = max(0, total_pages - num_items)
        
    except Exception as e:
        frappe.log_error(f"Main PDF invalid: {e}")
        return main_pdf_content
    
    # Add all Start Pages (Stakeholders + Summary Table pages)
    for i in range(num_start_pages):
        writer.add_page(main_reader.pages[i])
    
    # Process each item
    for idx, item in enumerate(items):
        # Calculate where this item's approval page is located
        item_page_index = num_start_pages + idx
        
        # Add item's approval form page
        if item_page_index < total_pages:
            writer.add_page(main_reader.pages[item_page_index])
        
        # Get attachment URL
        attachment_url = item.get('tds_attachment') if isinstance(item, dict) else None
        
        if attachment_url:
            try:
                # Fetch attachment content
                attachment_content = fetch_attachment_content(attachment_url)
                
                if attachment_content:
                    # Try as PDF
                    try:
                        attach_reader = PdfReader(io.BytesIO(attachment_content))
                        for page in attach_reader.pages:
                            writer.add_page(page)
                    except Exception:
                        # Try as Image
                        try:
                            img = Image.open(io.BytesIO(attachment_content))
                            if img.mode != "RGB":
                                img = img.convert("RGB")
                            
                            img_pdf = io.BytesIO()
                            img.save(img_pdf, format="PDF")
                            img_reader = PdfReader(io.BytesIO(img_pdf.getvalue()))
                            for page in img_reader.pages:
                                writer.add_page(page)
                        except Exception as e:
                            frappe.log_error(f"Attachment convert failed for item {idx}: {e}")
                            
            except Exception as e:
                frappe.log_error(f"Attachment fetch failed for item {idx}: {e}")
    
    # Output merged PDF
    try:
        output = io.BytesIO()
        writer.write(output)
        writer.close()
        return output.getvalue()
    except Exception as e:
        frappe.log_error(f"Interleaved PDF merge failed: {e}")
        return main_pdf_content

# // TDS fetch they file from s3url 

def fetch_attachment_content(original_url: str) -> bytes:
    """Fetch attachment content from URL or filesystem."""
    try:
        file_url = get_s3_temp_url(original_url)
        
        # HTTP / Presigned URL
        if file_url.startswith("http"):
            res = requests.get(file_url, timeout=30, stream=True)
            res.raise_for_status()
            
            buffer = io.BytesIO()
            for chunk in res.iter_content(chunk_size=1024 * 1024):
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
                # Fallback HTTP
                url = f"{frappe.utils.get_site_url(frappe.local.site)}{file_url}"
                res = requests.get(url, timeout=30)
                res.raise_for_status()
                return res.content
                
    except Exception as e:
        frappe.log_error(f"fetch_attachment_content failed: {original_url} - {e}")
        return None



