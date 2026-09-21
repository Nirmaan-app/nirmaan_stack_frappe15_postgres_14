# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Cheque payments — approved like any payment, then moved straight on to Reconciliation Pending.

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
"""

import frappe

from nirmaan_stack.services import payment_tds, settlement

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
	"""Move an `Approved` cheque payment on to `Reconciliation Pending`. False when there was nothing to move.

	RAISES on failure; the caller owns the transaction (`api/payments/project_payments.
	_move_cheque_to_reconciliation`, or the bulk approval group). A payment that fails to move
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

	if payment_tds.is_deductible(pay):
		payment_tds.record_deduction(pay)

	pay.status = settlement.STATUS_RECONCILIATION_PENDING
	if not sync_po_term:
		pay.flags.bulk_approval = True  # `_find_and_update_po_term` stays out; the caller writes the term
	pay.save(ignore_permissions=True)
	return True
