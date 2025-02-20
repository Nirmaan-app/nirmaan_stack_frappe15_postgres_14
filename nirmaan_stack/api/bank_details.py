import frappe
from frappe import _
import requests


@frappe.whitelist()
def generate_bank_details(ifsc_code: str):
    """
    API to get bank details for a given IFSC code
    """
    external_response = requests.get(f"https://ifsc.razorpay.com/{ifsc_code}")
    if external_response.ok:
        return external_response.json()
    else:
        return {"error": "IFSC code not found"}
