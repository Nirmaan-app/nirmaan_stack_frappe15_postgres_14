import frappe
import json

def execute():
   """
    Creates category list with empty makes for existing projects
   """ 
   projects = frappe.get_all("Projects")
   categories = frappe.db.get_all("Category", fields=['name', 'work_package'])
   for project in projects:
         doc = frappe.get_doc("Projects", project.name)
         category_list = {"list" : []}
         for wp in doc.project_work_packages['work_packages']:
            wp_cat = []
            for cat in categories:
                if cat['work_package'] == wp['work_package_name']:
                    wp_cat.append(cat['name'])
            for cat in wp_cat:
                category_list['list'].append({"name": cat, "makes": []})
         doc.project_category_list = category_list
         doc.save(ignore_permissions=True)