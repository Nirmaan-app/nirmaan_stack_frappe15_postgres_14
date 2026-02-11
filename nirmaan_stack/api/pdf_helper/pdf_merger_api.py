import frappe
import requests
import io
import os
import concurrent.futures
from pypdf import PdfWriter, PdfReader
from PIL import Image
from nirmaan_stack.api.frappe_s3_attachment import get_s3_temp_url

# // TDS  interval Merge PDfs for All Select POS 

@frappe.whitelist()
def merge_pdfs_interleaved(main_pdf_content: bytes, items: list, progress_event: str = None) -> bytes:
    """
    Merge main PDF with attachments interleaved after each item's page.
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

        # Publish Progress AFTER processing this item
        if progress_event:
            progress = int(((idx + 1) / num_items) * 100)
            item_name = item.get('tds_item_name', f"Item {idx+1}")
            frappe.publish_realtime(
                progress_event,
                {"progress": progress, "message": f"Completed {item_name} ({idx + 1}/{num_items})", "total": num_items, "current": idx + 1},
                user=frappe.session.user
            )
    
    # Output merged PDF
    try:
        if progress_event:
            frappe.publish_realtime(
                progress_event,
                {"progress": 100, "message": "Finalizing PDF...", "total": num_items, "current": num_items},
                user=frappe.session.user
            )
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



