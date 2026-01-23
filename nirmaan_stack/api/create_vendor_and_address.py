import frappe
from frappe import _
from typing import List, Dict, Union

@frappe.whitelist()
def create_vendor_and_address(
    values: Dict[str, Union[str, None]],
    vendorType: str,
    category_json: List[str],
    service_categories: List[str],
    dynamicCategories: List[str],
    renderCategorySelection: bool,
    service: bool,
) -> Dict[str, Union[int, str]]:
    """
    Create New Vendor and Associated New Address entries.

    Args:
        values (Dict[str, Union[str, None]]): A dictionary mapping field names to values.
        vendorType (str): Vendor Type : Service | Material | Material & Service.
        category_json (List[str]): A list of selected item names.
        service_categories (List[str]): A list of default service categories.
        dynamicCategories (List[str]): A list of dynamically added categories.
        renderCategorySelection (bool): A flag indicating if category selection is rendered.
        service (bool): A flag indicating if the vendor is a service vendor.

    Returns:
        Dict[str, Union[int, str]]: A dictionary containing the result of the operation.
            - "message": A success message if the operation was successful.
            - "error": An error message if the operation failed.
            - "status": 200 if the operation was successful, 400 otherwise.
    """
    try:
        frappe.db.begin()
        addressDoc = frappe.new_doc("Address")
        addressDoc.address_title = values.get("vendor_name")
        addressDoc.address_type = "Shop"
        addressDoc.address_line1 = values.get("address_line_1")
        addressDoc.address_line2 = values.get("address_line_2")
        addressDoc.city = values.get("vendor_city")
        addressDoc.state = values.get("vendor_state")
        addressDoc.country = "India"
        addressDoc.pincode = values.get("pin")
        addressDoc.email_id = values.get("vendor_email")
        addressDoc.phone = values.get("vendor_mobile")
        addressDoc.insert(ignore_permissions=True)

        vendorDoc = frappe.new_doc("Vendors")
        vendorDoc.vendor_name = values.get("vendor_name")
        vendorDoc.vendor_nickname = values.get("vendor_nickname")
        vendorDoc.vendor_type = vendorType
        vendorDoc.vendor_address = addressDoc.name
        vendorDoc.vendor_city = addressDoc.city
        vendorDoc.vendor_state = addressDoc.state
        vendorDoc.vendor_contact_person_name = values.get("vendor_contact_person_name")
        vendorDoc.vendor_mobile = values.get("vendor_mobile")
        vendorDoc.vendor_email = values.get("vendor_email")
        vendorDoc.vendor_gst = values.get("vendor_gst")
        vendorDoc.account_number = values.get("account_number")
        vendorDoc.account_name = values.get("account_name")
        vendorDoc.bank_name = values.get("bank_name")
        vendorDoc.bank_branch = values.get("bank_branch")
        vendorDoc.ifsc = values.get("ifsc")

        if vendorType == "Service":
            vendorDoc.vendor_category = {"categories": service_categories}
        elif vendorType == "Material":
            if not renderCategorySelection and dynamicCategories:
                vendorDoc.vendor_category = {"categories": dynamicCategories}
            else:
                vendorDoc.vendor_category = {"categories": category_json}
        else:
            if not renderCategorySelection and dynamicCategories:
                vendorDoc.vendor_category = {"categories": dynamicCategories + service_categories}
            else:
                vendorDoc.vendor_category = {"categories": category_json + service_categories}

        vendorDoc.insert(ignore_permissions=True)
        frappe.db.commit()

        return {"message": "Vendor created successfully.", "status": 200}

    except frappe.ValidationError as e:
        frappe.db.rollback()
        return {"error": str(e), "status": 400}
    except Exception as e:
        frappe.db.rollback()
        return {"error": str(e), "status": 400}