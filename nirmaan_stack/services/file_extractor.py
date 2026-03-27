import frappe
from frappe.utils import get_files_path
import os
import io

def process_file_in_background(file_name):
    try:
        file_doc = frappe.get_doc("File", file_name)
        if not file_doc.file_name:
            return

        file_ext = file_doc.file_name.split('.')[-1].lower()
        supported_exts = ['pdf', 'png', 'jpg', 'jpeg']
        
        frappe.log_error(title=f"Extraction Start: {file_name}", message=f"Starting extraction for file: {file_doc.file_name} with extension: {file_ext}")

        if file_ext not in supported_exts:
            frappe.log_error(title=f"Extraction Unsupported: {file_name}", message=f"Extension {file_ext} is not supported.")
            return

        # Don't process if it's already indexed
        if frappe.db.exists("File Text Search Index", {"file": file_doc.name}):
            return

        try:
            if file_doc.file_url and "/api/method/frappe_s3_attachment" in file_doc.file_url:
                try:
                    import requests
                    import urllib.parse
                    from frappe_s3_attachment.controller import S3Operations
                    
                    s3 = S3Operations()
                    s3_key = file_doc.content_hash
                    if not s3_key:
                        s3_key = urllib.parse.parse_qs(urllib.parse.urlparse(file_doc.file_url).query)['key'][0]
                    
                    # Unquote just in case it was url encoded in DB
                    s3_key = urllib.parse.unquote(s3_key)
                    
                    presigned_url = s3.get_url(s3_key)
                    resp = requests.get(presigned_url, timeout=30)
                    resp.raise_for_status()
                    content = resp.content
                except Exception as e:
                    frappe.log_error(title=f"Extraction S3 Error: {file_name}", message=str(e) + "\n" + frappe.get_traceback())
                    return
            else:
                content = file_doc.get_content()

            if not content:
                frappe.log_error(title=f"Extraction Empty Content: {file_name}", message=f"File {file_doc.file_name} has no content bytes returned from get_content(). URL: {file_doc.file_url}")
                return
            frappe.log_error(title=f"Extraction File Downloaded: {file_name}", message=f"Successfully downloaded {len(content)} bytes.")
        except Exception:
            frappe.log_error(title=f"File Extraction Failed Download: {file_name}", message=frappe.get_traceback())
            return

        extracted_text = ""
        file_stream = io.BytesIO(content)

        if file_ext == 'pdf':
            import pdfplumber
            with pdfplumber.open(file_stream) as pdf:
                pages = []
                for page in pdf.pages:
                    text = page.extract_text()
                    if text: pages.append(text)
                extracted_text = "\n".join(pages)
                        
        elif file_ext in ['png', 'jpg', 'jpeg']:
            import pytesseract
            from PIL import Image
            extracted_text = pytesseract.image_to_string(Image.open(file_stream))
            


        if not extracted_text or not extracted_text.strip():
            frappe.log_error(title=f"Extraction Empty Result: {file_name}", message=f"The libraries ran, but returned no text for {file_doc.file_name}.")
            return

        if extracted_text and extracted_text.strip():
            # ------ DEBUG CONSOLE ADDED HERE ------
            frappe.log_error(title=f"DEBUG TEXT EXTRACTION: {file_name}", message=extracted_text)
            print(f"\n\n--- EXTRACTED DATA FOR {file_name} ---\n{extracted_text}\n---------------------------\n\n")
            # --------------------------------------

            doc = frappe.get_doc({
                "doctype": "File Text Search Index",
                "file": file_doc.name,
                "attached_to_doctype": file_doc.attached_to_doctype,
                "attached_to_name": file_doc.attached_to_name,
                "extracted_text": extracted_text.lower()
            })
            doc.insert(ignore_permissions=True)
            frappe.db.commit()

    except Exception as e:
        frappe.log_error(title=f"File Extraction Error: {file_name}", message=frappe.get_traceback())

def process_file(doc, method):
    # Only enqueue if it's an uploaded file
    if not doc.file_name:
        return
        
    ext = doc.file_name.split('.')[-1].lower()
    if ext in ['pdf', 'png', 'jpg', 'jpeg']:
        frappe.enqueue("nirmaan_stack.services.file_extractor.process_file_in_background", queue="long", file_name=doc.name)


@frappe.whitelist()
def search_document_text(keyword):
    if not keyword:
        return []
        
    keyword = keyword.lower()
    
    # Using frappe.db.sql for ILIKE performance (case insensitive)
    query = """
        SELECT 
            idx.file,
            f.file_name,
            f.file_url,
            idx.attached_to_doctype,
            idx.attached_to_name,
            idx.extracted_text
        FROM `tabFile Text Search Index` idx
        LEFT JOIN `tabFile` f ON idx.file = f.name
        WHERE idx.extracted_text ILIKE %(kw)s
        LIMIT 50
    """
    
    results = frappe.db.sql(query, {"kw": f"%{keyword}%"}, as_dict=True)
    
    # Generate contextual snippets from the matched text
    for res in results:
        text = res.get("extracted_text", "")
        idx = text.find(keyword)
        if idx != -1:
            start = max(0, idx - 50)
            end = min(len(text), idx + 50 + len(keyword))
            res["snippet"] = "..." + text[start:end] + "..."
        else:
            res["snippet"] = "Match found."
            
        # Remove the massive block of text to save network bandwidth to the frontend
        del res["extracted_text"]
        
    return results
