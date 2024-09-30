import frappe


def execute():
   """
   Patch to delete cancelled POs 
   """ 
   frappe.db.delete("Procurement Orders", {
      "status": ("=", "Cancelled")
   })