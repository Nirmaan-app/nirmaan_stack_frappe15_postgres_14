# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Carry a ledger row's LIFECYCLE back to the request it came from -- paid, and deleted.

⚠️ THE LEDGER OWNS `Paid`, NOT THE REVIEWER. `Expense Request.status` reaches `Paid` through
this hook and NOWHERE else -- there is no endpoint, no button and no reviewer action that
sets it. Payment happens on the expense row, so the request can only ever be reporting what
the ledger already did; a second writer would let the two disagree about whether money moved.

SEPARATE FROM `expense_request_notify` DELIBERATELY, though both fire on the same transition.
This one changes STATE and rides the ledger's own transaction -- if the expense is Paid, the
request is Paid, atomically. That one only TELLS the requester and is self-swallowing, because
a bell message must never roll back a payment. Folding them together would force one policy
onto both.
"""

import frappe

from nirmaan_stack.api.expense_requests.access import APPROVED, PAID, REJECTED
from nirmaan_stack.api.approvals.expense_actions import FALLBACK_REJECTION_REASON, REJECTION_REASON_FLAG
from nirmaan_stack.api.payments.bulk_actions import REJECTED_STATUS as REJECTED_LEDGER_STATUS
from nirmaan_stack.services.notification_links import delete_notifications_for

PAID_LEDGER_STATUS = "Paid"


def on_expense_paid(doc, method=None) -> None:
	"""Ledger `on_update`: mark the originating request Paid.

	⚠️ NARROW ON PURPOSE. This fires on EVERY save of BOTH expense doctypes -- including the
	~3,300 rows that never came from a request -- so it exits on the cheapest checks first and
	only touches the database once all three have passed.

	It fires on the TRANSITION into Paid, not on the state, so a later edit of an
	already-Paid row does no work.

	NOT wrapped in a try/except, unlike the notification. The write rides the ledger's own
	transaction: if marking the expense Paid succeeds, the request is Paid too, and if it
	cannot be, the payment record should not land either. Silently swallowing a failure here
	would strand the request at `Approved` with nothing anywhere saying why.
	"""
	if doc.status != PAID_LEDGER_STATUS:
		return
	if not doc.has_value_changed("status"):
		return
	request = doc.get("request_id")
	if not request:
		return  # an ordinary expense, raised directly rather than through a request

	_mark_request_paid(request)


def _mark_request_paid(request: str) -> None:
	"""Flip ONE request `Approved` -> `Paid`.

	The guard is a whitelist of the only legal predecessor, not a blacklist. `Approved` is the
	single state a request can be in when its ledger row is paid -- `Pending Approval` has no
	row yet and `Rejected` never gets one -- so anything else means our assumption about the
	flow is wrong, and quietly overwriting it would erase the evidence. A row already `Paid`
	lands here too (a re-save that re-triggers the transition) and is a no-op.

	`set_value` rather than `doc.save`: this runs inside the ledger's save, so going through
	the document lifecycle would re-run the request's own `validate` for a field it does not
	govern. The trade-off is deliberate and worth stating -- `set_value` bypasses the
	lifecycle, so this transition writes NO `Version` row despite the doctype's
	`track_changes`. The audit lives on the ledger row, which carries the payment date,
	reference and attachment; the request is only mirroring it.
	"""
	current = frappe.db.get_value("Expense Request", request, "status")
	if current != APPROVED:
		return
	frappe.db.set_value("Expense Request", request, "status", PAID)


def on_expense_rejected(doc, method=None) -> None:
	"""Ledger `on_update`: a request whose expense is REJECTED in Payments becomes Rejected too, with the reason
	typed there (the engine puts it on `doc.flags[REJECTION_REASON_FLAG]`). An expense put back OUT of Rejected
	(a request-born expense is not frozen, unlike a reimbursement's) puts its request back to Approved, so a
	later Paid still reaches it through `on_expense_paid` (code review, 2026-10-23).

	Before this (code review, 2026-10-23) only Paid and delete reached the request, so a request whose expense
	L1 or the CEO rejected stayed Approved for good and its requester never learned why. Same narrowing as
	`on_expense_paid`: the transition into Rejected only, from an Approved request only.

	`set_value`, as `_mark_request_paid` does, for the same reason: the request is only mirroring the ledger.
	`review_comment` is written with the status, which is what the request's `validate` requires of a Rejected
	request.
	"""
	if not doc.has_value_changed("status"):
		return
	request = doc.get("request_id")
	if not request:
		return  # an ordinary expense, raised directly rather than through a request
	before = doc.get_doc_before_save()
	previous = before.status if before else None
	request_status = frappe.db.get_value("Expense Request", request, "status")
	if doc.status == REJECTED_LEDGER_STATUS:
		if request_status != APPROVED:
			return
		reason = (doc.flags.get(REJECTION_REASON_FLAG) or "").strip() or FALLBACK_REJECTION_REASON
		frappe.db.set_value("Expense Request", request, {"status": REJECTED, "review_comment": reason})
	elif previous == REJECTED_LEDGER_STATUS and request_status == REJECTED:
		# Only a rejection that came from the ledger can be undone here: a request rejected by its reviewer
		# never had an expense. The review comment stays, as the record of the rejection that was undone.
		frappe.db.set_value("Expense Request", request, "status", APPROVED)


def on_expense_deleted(doc, method=None) -> None:
	"""Ledger `after_delete`: delete the request the row was created from.

	⚠️ MUST BE `after_delete`, NEVER `on_trash`. `on_trash` fires BEFORE the row leaves the
	database, so the expense still exists and its `request_id` still points at the request --
	and Frappe refuses to delete a document anything links to (`LinkExistsError`). By
	`after_delete` the pointer is gone and the delete goes through. The cashflow recompute on
	this same doctype moved to `after_delete` for the same class of reason.

	FRAMEWORK WILL NOT DO THIS FOR US. A `Link` is a REFERENCE, not ownership: the same field
	type also points this row at its Project, Vendor and Expense Type, none of which should
	die with it. Only child tables cascade, because those rows live inside their parent.

	NOT wrapped in a try/except. The expense is already gone by the time this runs, so a
	failure rolls the whole transaction back and NEITHER is deleted -- which is the honest
	outcome. Swallowing would leave exactly the orphan this exists to prevent.
	"""
	request = doc.get("request_id")
	if not request:
		return  # an ordinary expense, raised directly rather than through a request
	if not frappe.db.exists("Expense Request", request):
		return  # already gone -- idempotent, and the other ledger may have got there first

	_delete_request_notifications(request)
	frappe.delete_doc("Expense Request", request, ignore_permissions=True)


def _delete_request_notifications(request: str) -> None:
	"""Clear the bell messages pointing at a request, so the request itself can be deleted.
	The rule and its reasons live in `services/notification_links`."""
	delete_notifications_for("Expense Request", request)
