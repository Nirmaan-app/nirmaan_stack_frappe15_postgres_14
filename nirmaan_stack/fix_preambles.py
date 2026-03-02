import frappe
import json

def execute():
    records = frappe.db.sql("""SELECT name, preambles FROM "tabBOQ" """, as_dict=True)
    for row in records:
        val = row.get('preambles')
        
        # If it's a string looking like a list
        if isinstance(val, str) and val.strip().startswith('['):
            try:
                parsed = json.loads(val)
                # update with wrapper
                wrapped = json.dumps({'data': parsed})
                frappe.db.sql("""UPDATE "tabBOQ" SET preambles=%s::json WHERE name=%s""", (wrapped, row.get('name')))
                print(f"Converted {row.get('name')} from string list to wrapped dict")
            except Exception as e:
                print(f"Error {row.get('name')}: {e}")
                
        # If it's already a native list (parsed JSON by postgres)
        elif isinstance(val, list):
            try:
                wrapped = json.dumps({'data': val})
                frappe.db.sql("""UPDATE "tabBOQ" SET preambles=%s::json WHERE name=%s""", (wrapped, row.get('name')))
                print(f"Converted {row.get('name')} from native list to wrapped dict")
            except Exception as e:
                print(f"Error {row.get('name')}: {e}")
                
        # Handle dicts which might already be wrapped
        elif isinstance(val, dict):
            print(f"Already converted {row.get('name')}: {val.keys()}")
            
    frappe.db.commit()
    print('DB fixing script complete.')
