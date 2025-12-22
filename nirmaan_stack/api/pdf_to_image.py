import frappe
import requests
import base64
import io
from urllib.parse import urlparse

# Try importing pdf2image, log error if missing
try:
    from pdf2image import convert_from_bytes
    PDF_TOOLS_AVAILABLE = True
except ImportError:
    PDF_TOOLS_AVAILABLE = False
    print("pdf2image import failed. PDF to Image conversion will not work. Install with: pip install pdf2image")

@frappe.whitelist()
def get_attachments_for_print(file_url):
    """
    Accepts a single file URL (S3 or local).
    Resolves S3 URL, Downloads content,
    Converts (PDF -> Images) OR (Image -> Base64),
    Returns a list of base64 image strings suitable for <img src="...">.
    """
    if not PDF_TOOLS_AVAILABLE:
        print("PDF Tools not available (pdf2image/poppler missing)")
        return []
    
    if not file_url:
        return []

    processed_images = []
    
    try:
        # DBG: Trace Start
        print(f"Processing Attachments for URL: {file_url} - PDF Debug Start")

        # 1. Resolve URL if it's an internal S3/proxy URL
        resolved_url = file_url
        try:
            # Assuming your S3 utility exists here
            res = frappe.get_attr("nirmaan_stack.api.frappe_s3_attachment.get_s3_temp_url")(file_url=file_url)
            if res:
                resolved_url = res
        except Exception as resolve_err:
             print(f"URL Resolution Failed: {resolve_err}")
             pass

        # 2. Handle Relative URLs (e.g., /files/test.pdf -> https://site.com/files/test.pdf)
        if not resolved_url.startswith("http") and not resolved_url.startswith("data:"):
            base_url = frappe.utils.get_site_url(frappe.local.site)
            if resolved_url.startswith("/"):
                resolved_url = f"{base_url}{resolved_url}"
            else:
                resolved_url = f"{base_url}/{resolved_url}"

        # DBG: Resolved URL
        print(f"Resolved URL: {resolved_url} - PDF Debug URL")

        # 3. Detect File Type
        file_type = "unknown"
        
        # Method A: Check query params (common in signed S3 urls)
        if "file_name" in resolved_url:
            try:
                parsed = urlparse(resolved_url)
                qp = {k: v for k, v in [p.split('=') for p in parsed.query.split('&') if '=' in p]}
                if "file_name" in qp:
                    file_type = qp["file_name"].split(".")[-1].lower()
            except: pass
        
        # Method B: Fallback to extension in path
        if file_type == "unknown":
            path = resolved_url.split("?")[0]
            if "." in path:
                file_type = path.split(".")[-1].lower()
        
        # 4. Fetch Content
        file_content = None
        try:
            # Stream=True allows reading large files without crashing memory immediately
            res = requests.get(resolved_url, stream=True)
            if res.status_code == 200:
                file_content = res.content
                print(f"Fetched {len(file_content)} bytes - PDF Debug Fetch")
            else:
                print(f"Failed to fetch attachment. Status: {res.status_code}, URL: {resolved_url}")
                return []
        except Exception as e:
            print(f"Request failed for {resolved_url}: {e}")
            return []

        if not file_content:
            return []

        # 5. Convert based on Type
        
        # CASE A: PDF -> Convert pages to JPEGs
        if file_type == "pdf":
            try:
                # Convert PDF bytes to images
                images = convert_from_bytes(file_content)
                print(f"Converted {len(images)} pages - PDF Debug PDF Conversion")
                for img in images:
                    buffered = io.BytesIO()
                    img.save(buffered, format="JPEG")
                    img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
                    processed_images.append(f"data:image/jpeg;base64,{img_str}")
            except Exception as pdf_err:
                print(f"PDF Conversion failed for {file_url}: {pdf_err}")
        
        # CASE B: Image -> Convert to Base64
        elif file_type in ["png", "jpg", "jpeg", "gif", "webp"]:
            img_str = base64.b64encode(file_content).decode("utf-8")
            # Normalize mime type
            mime = f"image/{file_type}" 
            if file_type == "jpg": mime = "image/jpeg"
            processed_images.append(f"data:{mime};base64,{img_str}")
            print("Processed Single Image - PDF Debug Image")

    except Exception as e:
        print(f"Error processing PO attachment url {file_url}: {e}")

    return processed_images