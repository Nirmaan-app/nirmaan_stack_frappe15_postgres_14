# In a Python file in your custom app, e.g., your_app/api/invoice_utils.py
import frappe
import random
import string
from frappe.utils import now_datetime

@frappe.whitelist()
def generate_next_invoice_number(service_request_name=None, project_name=None):
    """
    Generates a new invoice number.
    Can be enhanced to use Naming Series or check for uniqueness.
    For now, a random one with prefix.
    """
    # Example: INV-YYYYMMDD-PROJECT_PREFIX-XXXXX
    prefix = "INV"
    date_str = now_datetime().strftime("%Y%m%d")
    
    project_prefix = ""
    if project_name:
        # Try to get a short code from project name
        parts = project_name.split('-')
        if len(parts) > 1:
            project_prefix = "".join(p[0] for p in parts[:-1]).upper() + parts[-1][-2:] # e.g., GURPROJ-41 -> GP41
        else:
            project_prefix = project_name[:4].upper()
    
    random_suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=5))
    
    # A more robust approach would involve Frappe's Naming Series
    # or querying the DB to ensure uniqueness if not using a series.
    # For example, using a series "INV-.YYYY.-.#####":
    # return frappe.model.naming.make_autoname("INV-.YYYY.-.#####")

    return f"{prefix}-{date_str}-{project_prefix}-{random_suffix}" if project_prefix else f"{prefix}-{date_str}-{random_suffix}"