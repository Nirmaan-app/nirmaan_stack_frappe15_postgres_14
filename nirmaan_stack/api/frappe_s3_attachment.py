import frappe
import urllib.parse
from frappe_s3_attachment.controller import S3Operations

@frappe.whitelist()
def get_s3_temp_url(file_url):
    """
    Returns a direct, presigned S3 URL for a given file_url (if it's an S3 file).
    Used for Print Formats to bypass local proxy issues.
    """
    if not file_url:
        return ""
    
    # Check if it's our specific S3 proxy URL
    if "frappe_s3_attachment.controller.generate_file" in file_url:
        try:
            parsed = urllib.parse.urlparse(file_url)
            params = urllib.parse.parse_qs(parsed.query)
            key = params.get("key", [None])[0]
            file_name = params.get("file_name", [None])[0]
            
            if key:
                s3 = S3Operations()
                return s3.get_url(key, file_name)
        except Exception:
            pass

    return file_url
