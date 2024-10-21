import frappe


def execute():
   """
   Patch to generate nirmaan user permissions 
   """ 
   ups = frappe.get_all(doctype="User Permission")
   for up in ups:
      doc = frappe.get_doc("User Permission", up)
      nup = frappe.new_doc("Nirmaan User Permissions")
      nup.user = doc.user
      nup.allow = doc.allow
      nup.for_value = doc.for_value
      nup.insert(ignore_permissions=True)

