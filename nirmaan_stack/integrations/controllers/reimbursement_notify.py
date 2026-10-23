# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tell the claimant what happened to their reimbursement: Approved, or Rejected with the reason.

Only the claimant is told (owner, 2026-10-22). Unlike an Expense Request, approval is NOT silent. The claim's
later endings -- its expense Paid, or Rejected in the Payments queue (ADR-0040) -- send nothing (owner,
2026-10-23: a bell for them was added and then removed the same day).

Bell + realtime only, no Firebase push, the `expense_request_notify` shape. ⚠️ A NOTIFICATION MUST NEVER
BREAK THE THING IT IS REPORTING: it runs after the decision is committed, and a failure is logged and
swallowed.
"""

import frappe

from nirmaan_stack.services.reimbursements.rules import APPROVED, REJECTED

DOCTYPE = "Reimbursement"
ACTION_URL = "reimbursements"


def _notify(claim, decision: str) -> None:
	recipient = claim.owner
	if not recipient or recipient == frappe.session.user or not frappe.db.exists("Nirmaan Users", recipient):
		# Your own decision needs no message; a plain Frappe user has no Nirmaan Users row to address.
		return
	amount = frappe.utils.fmt_money(claim.amount, currency="INR")
	if decision == APPROVED:
		title = "Reimbursement approved"
		description = f"{claim.name} ({claim.title}, {amount}) was approved."
		kind = "info"
	else:
		title = "Reimbursement rejected"
		description = f"{claim.name} ({claim.title}, {amount}) was rejected. Reason: {claim.rejection_reason}"
		kind = "warning"
	event_id = f"reimbursement:{decision.lower()}"

	note = frappe.new_doc("Nirmaan Notifications")
	note.update({
		"recipient": recipient,
		"recipient_role": frappe.db.get_value("Nirmaan Users", recipient, "role_profile"),
		"sender": frappe.session.user if frappe.session.user != "Administrator" else None,
		"title": title,
		"description": description,
		"document": DOCTYPE,
		"docname": claim.name,
		"seen": "false",
		"type": kind,
		"event_id": event_id,
		"action_url": ACTION_URL,
	})
	note.insert(ignore_permissions=True)
	frappe.db.commit()  # before publishing: the client must find the row the event tells it about
	frappe.publish_realtime(
		event=event_id,
		message={"title": title, "description": description, "docname": claim.name},
		user=recipient,
	)


def notify_decided(claim, decision: str) -> None:
	"""Called by the review endpoints after the decision is committed."""
	if decision not in (APPROVED, REJECTED):
		return
	try:
		_notify(claim, decision)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Reimbursement notification failed")

