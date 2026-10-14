import frappe

from nirmaan_stack.services.payees.ifsc import fetch_ifsc


@frappe.whitelist()
def generate_bank_details(ifsc_code: str):
    """
    API to get bank details for a given IFSC code
    """
    return fetch_ifsc(ifsc_code) or {"error": "IFSC code not found"}
