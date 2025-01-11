import frappe
import json

def execute():
   """
    Adds relevant categories with makes to every wp object within project_work_package field for every existing project.
   """ 
   projects = frappe.get_all("Projects")
   categories = frappe.db.get_all("Category", fields=['name', 'work_package'])
   for project in projects:
         doc = frappe.get_doc("Projects", project.name)
         new_pwp = {'work_packages' : []}
         for wp in doc.project_work_packages['work_packages']:
            category_list = {"list" : []}
            wp_cat = []
            for cat in categories:
                if cat['work_package'] == wp['work_package_name']:
                    wp_cat.append(cat['name'])
            for cat in wp_cat:
                category_list['list'].append({"name": cat, "makes": []})
            new_pwp['work_packages'].append({'work_package_name': wp['work_package_name'], 'category_list': category_list })
         doc.project_work_packages = new_pwp
         doc.save(ignore_permissions=True)