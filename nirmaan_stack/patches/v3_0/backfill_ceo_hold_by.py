import frappe

CEO_HOLD_AUTHORIZED_USER = "nitesh@nirmaan.app"

def execute():
	projects = frappe.get_all("Projects", filters={"status": "CEO Hold"}, pluck="name")
	for name in projects:
		frappe.db.set_value("Projects", name, "ceo_hold_by", CEO_HOLD_AUTHORIZED_USER, update_modified=False)
	if projects:
		frappe.db.commit()
