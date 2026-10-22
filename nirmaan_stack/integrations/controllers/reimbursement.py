# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who may see a Reimbursement, and the one way anyone writes one.

Every Nirmaan role holds READ on the doctype; these hooks narrow it by role PROFILE: Admin, HR and Accounts
(`REIMBURSEMENT_VIEW_ALL_PROFILES`) see every claim, everyone else only the claims they raised. A
`has_permission` hook can only deny, never grant, and Frappe never calls it for a list, so the list is
narrowed separately below.

Writes: only the `api/reimbursements` endpoints write a claim (with `ignore_permissions`, after their own
checks). System Manager rides on several profiles and carries full rights on the doctype, so any other
write -- Desk, REST, bulk edit -- is refused here for everyone but `Administrator`.
"""

import frappe

from nirmaan_stack.services.reimbursements.access import sees_all_claims

READ_PTYPES = ("read", "select", "print", "export", "report", "email", "share")


def has_permission(doc, ptype=None, user=None, debug=False):
	user = user or frappe.session.user
	if user == "Administrator":
		return None
	if (ptype or "read") not in READ_PTYPES:
		return False
	if doc.owner == user or sees_all_claims(user):
		return None
	return False


def get_permission_query_conditions(user=None, doctype=None):
	user = user or frappe.session.user
	if sees_all_claims(user):
		return ""
	return f'"tabReimbursement".owner = {frappe.db.escape(user)}'
