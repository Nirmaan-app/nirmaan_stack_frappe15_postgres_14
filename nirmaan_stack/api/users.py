import frappe

@frappe.whitelist()
def get_user_role_counts():
	"""
	Get counts of users by role in a single database query.
	Returns: {role_value: count, ...}
	"""
	user_role_options = [
		"Nirmaan Admin Profile",
		"Nirmaan Project Lead Profile",
		"Nirmaan Project Manager Profile",
		"Nirmaan Procurement Executive Profile",
		"Nirmaan Accountant Profile",
		"Nirmaan Estimates Executive Profile",
		"Nirmaan Design Executive Profile",
		"Nirmaan Design Lead Profile",
	]
	
	role_counts = {}
	for role in user_role_options:
		count = frappe.db.count('Nirmaan Users', filters={'role_profile': role})
		role_counts[role] = count
	
	return role_counts
