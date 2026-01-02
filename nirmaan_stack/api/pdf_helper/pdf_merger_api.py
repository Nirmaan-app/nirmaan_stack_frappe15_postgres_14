import frappe
import requests
import io
import os
from pypdf import PdfWriter
from PIL import Image
from nirmaan_stack.api.frappe_s3_attachment import get_s3_temp_url

@frappe.whitelist()
def merge_pdfs(main_pdf_content: bytes, attachment_urls: list = None) -> bytes:
    """
    Merges a main PDF with multiple attachment PDFs/Images.
    Uses S3 resolver for cloud files, and direct FS access for local files.
    """
    
    merger = PdfWriter()
    
    # 1. Adds Main PDF
    try:
        if main_pdf_content:
            merger.append(io.BytesIO(main_pdf_content))
    except Exception as e:
        frappe.log_error(f"Error adding main PDF: {e}")
        print(f"Error adding main PDF: {e}")

    # 2. Add Attachments
    if attachment_urls:
        for original_url in attachment_urls:
            try:
                # 1. Resolve S3 / Remote URL
                # This converts internal S3 proxy URLs to real presigned URLs if applicable
                file_url = get_s3_temp_url(original_url)
                
                file_content = None
                
                # CASE A: Remote/Presigned URL (S3)
                if file_url.startswith("http"):
                    print(f"Fetching Remote/S3: {file_url}")
                    res = requests.get(file_url)
                    if res.status_code == 200:
                        file_content = res.content
                    else:
                        print(f"Fetch failed {res.status_code} for {file_url}")
                
                # CASE B: Local File System (Fallback for standard local files)
                if not file_content:
                    # Use original URL to determine local path
                    check_url = original_url
                    if check_url.startswith("/files/") or check_url.startswith("/private/files/"):
                        file_path = frappe.utils.get_files_path(check_url.lstrip("/"), is_private=check_url.startswith("/private/"))
                        if os.path.exists(file_path):
                            with open(file_path, "rb") as f:
                                file_content = f.read()
                            print(f"Read local file: {file_path}")
                
                # CASE C: General HTTP Fallback (if not handled above and relative url passed)
                if not file_content and not file_url.startswith("http"):
                     full_url = f"{frappe.utils.get_site_url(frappe.local.site)}{file_url}"
                     print(f"Fetching local fallback HTTP: {full_url}")
                     res = requests.get(full_url)
                     if res.status_code == 200:
                         file_content = res.content

                # SKIP if still no content
                if not file_content:
                    print(f"Could not retrieve content for {original_url}")
                    continue

                # --- PROCESS CONTENT ---
                
                # A. Try as PDF
                if file_content[:4] == b"%PDF":
                    merger.append(io.BytesIO(file_content))
                    print(f"Merged PDF attachment: {original_url}")
                
                # B. Try as Image
                else:
                    try:
                        img = Image.open(io.BytesIO(file_content))
                        if img.mode != "RGB":
                            img = img.convert("RGB")
                        
                        img_pdf_bytes = io.BytesIO()
                        img.save(img_pdf_bytes, format="PDF")
                        merger.append(io.BytesIO(img_pdf_bytes.getvalue()))
                        print(f"Converted and merged image attachment: {original_url}")
                    except Exception as img_err:
                        # Only log if it really looked like an image/file we wanted
                        print(f"Failed to process attachment {original_url}: {img_err}")

            except Exception as e:
                print(f"Failed to process attachment {original_url}: {e}")
                frappe.log_error(f"Merge Error for {original_url}: {e}")

    # 3. Output
    try:
        output_stream = io.BytesIO()
        merger.write(output_stream)
        merger.close()
        return output_stream.getvalue()
        
    except Exception as e:
        frappe.log_error(f"Error saving merged PDF: {e}")
        return main_pdf_content
