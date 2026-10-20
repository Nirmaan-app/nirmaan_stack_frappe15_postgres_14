# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Cheque payments — approved like any payment, then moved straight on to Reconciliation Pending,
and their Cheque Issued in the same write.

A cheque is already written when it is requested (its number and date are captured on the
request), so there is nothing for an accountant to pay: "Payment need to paid" (`Approved`) has
no work in it. The owner's rule (2026-09-19):

    < 15,000     auto-approve  -> Approved -> Reconciliation Pending
    15k - 50k    L1            -> Approved -> Reconciliation Pending
    > 50,000     L1 -> CEO     -> Approved -> Reconciliation Pending

⚠️ THE PAYMENT PASSES THROUGH `Approved`; IT DOES NOT SKIP IT (owner ruling, same day). Everything
that happens on approval -- the Work Order TDS deduction and its netting of the amount, the PO
term mirror, the approval dates -- happens exactly as for an online payment. Only AFTER that does
`move_to_reconciliation` make the same write the accountant's "Mark as Paid" makes today, and that
write is not an approval (`payment_tds.APPROVAL_SOURCE_STATUSES` has no `Approved`), so it can never
withhold tax a second time.

⚠️ CALL IT ONLY ONCE THE APPROVAL IS ON DISK. Bulk approve records its TDS after its own commit and
only for rows still at `Approved` (`bulk_actions._record_bulk_deductions`); moving a row before that
would leave a Work Order cheque with no deduction and its amount gross. That is why this is an
explicit call at the end of each approval route, never a hook inside the save.

THE MOVE ISSUES THE CHEQUE (#1479, spec #1477, ADR-0035). A Payment cheque starts Approval Pending; the save
that moves its last payment on to Reconciliation Pending also makes it Issued, dated the day of the
last approval (`services/cheques/status.issue`). One transaction, so a failed move leaves both the
payment at Approved and its cheque at Approval Pending: the two never disagree.
"""

import frappe

from nirmaan_stack.services import payment_tds, settlement
from nirmaan_stack.services.cheques.rules import ISSUED

MODE_ONLINE = "Online"
MODE_CHEQUE = "Cheque"


def is_cheque(doc) -> bool:
	"""Was this payment requested as a cheque? Blank (never set) reads as Online."""
	return (doc.get("mode_of_payment") or "").strip() == MODE_CHEQUE


def has_no_tds_to_wait_for(doc) -> bool:
	"""Can this cheque move on in the SAME pass as its approval?

	Only when its parent withholds no tax (a Procurement Order): there is no deduction to wait
	for, so bulk approve moves it inside the approval group and the group's one PO save writes
	the final term status (measured: a separate move re-saved the whole PO per cheque, doubling
	PO saves). Keyed on `payment_tds.DEDUCTIBLE_PARENTS`, never on a doctype name, so widening
	TDS to Procurement Orders sends these back through the after-TDS path automatically.
	"""
	return (doc.get("document_type") or "").strip() not in payment_tds.DEDUCTIBLE_PARENTS


def move_to_reconciliation(payment_name: str, *, sync_po_term: bool = True) -> bool:
	"""Move an `Approved` cheque payment on to `Reconciliation Pending`, and issue its Cheque once every
	payment on it has moved (`services/cheques/status.issue`). False when there was nothing to move.

	RAISES on failure; the caller owns the transaction (`commit_move_to_reconciliation`, or the bulk
	approval group). A payment that fails to move
	simply stays at `Approved`, where the accountant's "Mark as Paid" finishes the same job --
	nothing is lost.

	`sync_po_term=False` is for a caller that already holds the PO and writes every term of its
	group in one PO save (`bulk_actions._process_group`): the payment's own hook then leaves the
	PO alone, exactly as it does for the bulk approval itself.

	⚠️ THE TDS CALL IS A RETRY, NOT A SECOND DEDUCTION. `record_deduction` returns the existing row
	when there is one. It is here for the payment whose deduction FAILED during its approval
	(`record_deduction_if_eligible` swallows the error): once it leaves `Approved` nothing can record
	it any more (`is_deductible` needs `Approved`), so it is recorded now or the move is refused.
	"""
	pay = frappe.get_doc("Project Payments", payment_name)
	if not is_cheque(pay) or (pay.status or "").strip() != settlement.STATUS_APPROVED:
		return False
	# A held payment stays at Approved (`services/payment_hold.py`, whose `validate_hold` would
	# refuse the save anyway) -- returning here keeps a stray call from logging an error.
	if pay.get("on_hold"):
		return False

	if payment_tds.is_deductible(pay):
		payment_tds.record_deduction(pay)

	pay.status = settlement.STATUS_RECONCILIATION_PENDING
	if not sync_po_term:
		pay.flags.bulk_approval = True  # `_find_and_update_po_term` stays out; the caller writes the term
	pay.save(ignore_permissions=True)
	if pay.get("cheque"):
		# Local: the cheques service imports this module.
		from nirmaan_stack.services.cheques.status import issue
		from nirmaan_stack.services.cheques.writer import CHEQUES_CHANGED_EVENT

		if issue(pay.cheque, user=frappe.session.user):
			frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheque": pay.cheque}, after_commit=True)
	return True


def commit_move_to_reconciliation(payment_name: str) -> bool:
	"""Move an Approved cheque payment on to Reconciliation Pending, in its OWN transaction.

	⚠️ CALL IT ONLY AFTER THE APPROVAL HAS BEEN COMMITTED. It commits or rolls back by itself, so
	a failure here can never take the approval with it, and it NEVER raises: a payment it could
	not move stays at `Approved`, in "Payment need to paid", where the accountant's "Mark as Paid"
	makes the same move. The rule itself is `move_to_reconciliation`. Every approval route, a hold
	release and each cheques endpoint that puts a payment on a Cheque end with it.
	"""
	try:
		moved = move_to_reconciliation(payment_name)
		frappe.db.commit()
		return moved
	except Exception:
		frappe.db.rollback()
		frappe.log_error(
			title=f"Cheque payment not moved to Reconciliation Pending ({payment_name})",
			message=frappe.get_traceback(),
		)
		return False


def in_cheque_tracker_sql(status_col: str, cheque_status_col: str) -> tuple[str, dict]:
	"""`(condition, params)`: the SQL condition for a payment that waits in the Cheque Tracker, not in
	Project Payments' Reconciliation Pending (#1483, spec #1477): at Reconciliation Pending on an Issued
	cheque. `status_col` / `cheque_status_col` name the payment's status and its cheque's status in the
	caller's query. Both Reconciliation Pending counts (the tab strip, the sidebar badge) leave these out
	through here, so they cannot disagree. A blank status stays a blank: `COALESCE`, so `NOT (...)` keeps it."""
	return (
		f"COALESCE({status_col}, '') = %(tracker_status)s AND COALESCE({cheque_status_col}, '') = %(tracker_cheque)s",
		{"tracker_status": settlement.STATUS_RECONCILIATION_PENDING, "tracker_cheque": ISSUED},
	)
