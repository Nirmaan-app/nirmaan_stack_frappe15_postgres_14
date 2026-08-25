# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tell the requester what happened to their expense request.

TWO moments reach the requester: REJECTED and PAID. Rejection fires from the review
endpoint; Paid has to be caught on the LEDGER, because that is where the transition happens
and the request knows nothing about it.

⚠️ APPROVAL IS DELIBERATELY SILENT (owner ruling). An approval is not an outcome the
requester has to act on -- the money has not moved yet -- and telling them twice for one
request made the bell noisy enough to be ignored, which costs them the message that DOES
matter. Approve and Paid are one story to a requester; only its ending is worth a message.

Bell + realtime only, no Firebase push — following the Reminders precedent, where push was
deliberately dropped in favour of an on-screen surface.

⚠️ A NOTIFICATION MUST NEVER BREAK THE THING IT IS REPORTING. Every entry point here is
wrapped so a failure is logged and swallowed: an approval that succeeded must not roll back
because a bell message could not be written.
"""

import frappe

from nirmaan_stack.api.expense_requests.access import REJECTED

PAID = "Paid"
EXPENSE_DOCTYPES = ("Project Expenses", "Non Project Expenses")


def _notify(recipient: str, title: str, description: str, request_name: str,
            event_id: str, kind: str = "info") -> None:
	"""Write one in-app notification and publish it.

	Commit BEFORE publishing (the house rule): the socket must never arrive before the row
	the client will fetch.
	"""
	if not recipient or recipient == "Administrator":
		return
	if not frappe.db.exists("Nirmaan Users", recipient):
		# Notifications are addressed to a Nirmaan Users row; a plain Frappe user has none.
		return

	note = frappe.new_doc("Nirmaan Notifications")
	note.update({
		"recipient": recipient,
		"recipient_role": frappe.db.get_value("Nirmaan Users", recipient, "role_profile"),
		"sender": frappe.session.user if frappe.session.user != "Administrator" else None,
		"title": title,
		"description": description,
		"document": "Expense Request",
		"docname": request_name,
		"seen": "false",
		"type": kind,
		"event_id": event_id,
		# The requester can only see the Requests tab -- never link them at the ledger row,
		# which they have no access to.
		"action_url": "expense/requests",
	})
	note.insert(ignore_permissions=True)
	frappe.db.commit()

	frappe.publish_realtime(
		event=event_id,
		message={"title": title, "description": description, "docname": request_name},
		user=recipient,
	)


def _safe(fn, *args, **kwargs) -> None:
	try:
		fn(*args, **kwargs)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Expense Request notification failed")


def notify_decided(req, decision: str) -> None:
	"""Called from the review endpoint, after the decision has been committed.

	ONLY `Rejected` produces anything. The signature still takes the decision so an APPROVED
	call is a documented no-op rather than a crash -- the safe direction, since the rule is
	"approval says nothing" and a silent fall-through enforces it wherever it is called from.
	"""
	if decision == REJECTED:
		title = "Expense request rejected"
		reason = (req.review_comment or "").strip()
		desc = f"{req.name} ({req.type}) was rejected." + (f" Reason: {reason}" if reason else "")
		kind = "warning"
	else:
		return
	_safe(_notify, req.owner, title, desc, req.name, f"expense_request:{decision.lower()}", kind)


def on_expense_update(doc, method=None) -> None:
	"""Ledger `on_update` hook: report the moment an expense created by a request goes Paid.

	⚠️ Narrow ON PURPOSE. This fires on EVERY save of BOTH expense doctypes — including the
	~3,300 rows that have nothing to do with a request — so it exits on the cheapest possible
	check first, and only then reads `request_id` off the row.

	TELLS ONLY. The request's own `Paid` state is set by `expense_request_status`, which is a
	separate hook precisely so a failure here cannot roll back that one.

	It fires on the TRANSITION into Paid, not on the state: `has_value_changed` keeps a later
	edit of an already-Paid row from re-notifying.
	"""
	if doc.status != PAID:
		return
	if not doc.has_value_changed("status"):
		return
	_safe(_notify_paid, doc)


def _notify_paid(doc) -> None:
	name = doc.get("request_id")
	if not name:
		return  # an ordinary expense, not one born from a request
	request = frappe.db.get_value(
		"Expense Request", name, ["name", "owner", "type"], as_dict=True,
	)
	if not request:
		return
	_notify(
		request.owner,
		"Expense paid",
		f"{request.name} ({request.type}) has been paid.",
		request.name,
		"expense_request:paid",
	)
