import frappe

def on_update(doc, method):
    """
    Manage Approved Quotations and Deletion of PO
    """
    doc = frappe.get_doc("Procurement Orders", doc.name)
    if(doc.status=="Dispatched"):
        try:
            vendor = frappe.get_doc("Vendors", doc.vendor)
            orders = doc.order_list
            for order in orders['list']:
                aq = frappe.new_doc('Approved Quotations')
                try:
                    item = frappe.get_doc("Items", order['name'])
                    aq.item_id=order['name']
                    aq.vendor=doc.vendor
                    aq.procurement_order=doc.name
                    aq.item_name=order['item']
                    aq.unit=order['unit']
                    aq.quantity=order['quantity']
                    aq.quote=order['quote']
                    aq.tax=order['tax']
                    aq.city=vendor.vendor_city
                    aq.state=vendor.vendor_state
                    aq.insert()
                except frappe.DoesNotExistError:
                    continue
        except frappe.DoesNotExistError:
            print("VENDOR NOT AVAILABLE IN DB")
    if(doc.status=="Cancelled"):
        frappe.delete_doc("Procurement Orders", doc.name)