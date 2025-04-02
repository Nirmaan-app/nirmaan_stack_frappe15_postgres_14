import frappe

def execute():
    """
    Creates Approved Quotations documents for Procurement Orders that are in
    "Partially Delivered", "Delivered", or "Dispatched" status and don't have
    any Approved Quotations linked to them.
    """
    po_docs = frappe.get_all(
        "Procurement Orders",
        filters={"status": ("in", ["Partially Delivered", "Delivered", "Dispatched"])},
        fields=["name", "vendor", "order_list"]
    )

    for po_doc in po_docs:
        po_name = po_doc.name
        approved_quotations_count = frappe.db.count(
            "Approved Quotations",
            filters={"procurement_order": po_name}
        )

        if approved_quotations_count == 0:
            try:
                doc = frappe.get_doc("Procurement Orders", po_name)
                custom = doc.custom == "true"
                vendor = frappe.get_doc("Vendors", po_doc.vendor)

                if doc.order_list and doc.order_list.get('list'):
                    for order in doc.order_list['list']:
                        try:
                            aq = frappe.new_doc('Approved Quotations')
                            if not custom:
                              aq.item_id = order.get('name')
                            aq.vendor = doc.vendor
                            aq.procurement_order = doc.name
                            aq.item_name = order.get('item')
                            aq.unit = order.get('unit')
                            aq.quantity = order.get('quantity')
                            aq.quote = order.get('quote')
                            aq.tax = order.get('tax')
                            if "makes" in order and order.get('makes') and 'list' in order['makes']:
                                enabled_make = next((make['make'] for make in order['makes']['list'] if make['enabled'] == "true"), None)
                                aq.make = enabled_make
                            aq.city = vendor.vendor_city
                            aq.state = vendor.vendor_state
                            aq.insert()
                        except frappe.exceptions.ValidationError as ve:
                            frappe.log_error(f"Validation Error creating Approved Quotation for PO {po_name}, item {order.get('item')}: {ve}", title="Approved Quotation Validation Error")
                        except frappe.exceptions.DuplicateEntryError as de:
                            frappe.log_error(f"Duplicate Entry Error creating Approved Quotation for PO {po_name}, item {order.get('item')}: {de}", title="Approved Quotation Duplicate Entry Error")
                        except Exception as e:
                            frappe.log_error(f"Unexpected Error creating Approved Quotation for PO {po_name}, item {order.get('item')}: {e}", title="Approved Quotation Creation Error")
                else:
                  frappe.log_error(f"Procurement Order {po_name} order_list is empty or invalid.", title="Procurement Order order_list Error")

            except frappe.exceptions.DoesNotExistError as dne:
                print("error", dne)
                frappe.log_error(f"Document Not Found Error: {dne}", title="Document Not Found Error")
            except Exception as e:
                print("error 2", e)
                frappe.log_error(f"Unexpected Error processing PO {po_name}: {e}", title="Procurement Order Processing Error")