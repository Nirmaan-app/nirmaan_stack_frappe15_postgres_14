import frappe

def execute():
   """
   Patch to refresh approved quotations from dispatched POs 
   """ 
   pos = frappe.get_all(doctype="Procurement Orders", filters={'status': ['in', 'Partially Delivered, Delivered, Dispatched']})
   for po in pos:
      doc = frappe.get_doc("Procurement Orders", po)
      try:
         vendor = frappe.get_doc("Vendors", doc.vendor)
         orders = doc.order_list
         for order in orders['list']:
            aq = frappe.new_doc('Approved Quotations')
            try:
               item = frappe.get_doc("Items", order['name'])
               cat = frappe.get_doc("Category", item.category)
               aq.item_id=order['name']
               aq.vendor=doc.vendor
               aq.procurement_order=doc.name
               aq.category=item.category
               aq.procurement_package=cat.work_package
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
         continue 
         