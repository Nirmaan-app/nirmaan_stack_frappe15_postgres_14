import frappe

def execute():
   """
   Patch to delete previously generated approved quotations
   """ 
   frappe.db.delete("Approved Quotations")