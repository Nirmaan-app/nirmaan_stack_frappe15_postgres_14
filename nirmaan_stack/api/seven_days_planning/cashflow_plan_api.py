import frappe

@frappe.whitelist()
def get_active_vendors():
    vendors = frappe.get_all("Vendors", 
        fields=["name", "vendor_name"], 
        filters={"docstatus": 0}, 
        order_by="vendor_name asc"
    )
    return vendors
