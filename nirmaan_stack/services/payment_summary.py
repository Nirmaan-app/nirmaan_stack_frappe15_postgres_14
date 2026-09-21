# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Where a PO / Work Order's money stands, by payment status (owner, 2026-09-21).

Shown in the single Approve dialog and in both Request Payment dialogs, so an approver or a
requester sees what is already paid and what is already on its way before adding to it.

PURE -- no database, no request context. `api/payments/payment_summary.py` loads the rows and
hands them here.

⚠️ THE STATUSES COUNTED ARE EXACTLY THE REQUEST CAP'S. `create_project_payment` and
`create_payment_request_for_service` refuse a request above
    value - Paid - (Requested + CEO Pending + Approved + Rejected) - Reconciliation Pending
(`services/finance`), so every one of those statuses is a line here and "left" is that same
balance. A REJECTED payment is still counted -- it holds its share of the balance until it is
deleted -- which is why it gets a line of its own rather than disappearing into the total.

⚠️ A WORK ORDER'S PAYMENTS ARE COUNTED GROSS. Once TDS is withheld, `Project Payments.amount` is
the NET figure, yet the tax was still part of what was requested; the Work Order page's Request
Payment balance has always added it back (`approved-sr.tsx`, `grossRequested`), and this follows
it. EXCEPT on a company-borne Work Order (Miscellaneous / Transportation only), whose payments were
never reduced -- adding the tax there would count it twice. A PO carries no TDS.
"""

from frappe.utils import flt

from nirmaan_stack.services import settlement

#: Display order: money that has left, then money on its way, then money held by a rejection.
LINE_ORDER = ("paid", "reconciliation_pending", "approved", "ceo_pending", "requested", "rejected")

_LINE_OF_STATUS = {
	settlement.STATUS_PAID: "paid",
	settlement.STATUS_RECONCILIATION_PENDING: "reconciliation_pending",
	settlement.STATUS_APPROVED: "approved",
	settlement.STATUS_CEO_PENDING: "ceo_pending",
	settlement.STATUS_REQUESTED: "requested",
	settlement.STATUS_REJECTED: "rejected",
}


def gross_amount(payment, tds_by_payment, company_borne: bool) -> float:
	"""The figure a payment counts for: its amount, plus any tax withheld from it."""
	amount = flt(payment.get("amount"))
	if company_borne:
		return amount
	return amount + flt((tds_by_payment or {}).get(payment.get("name")))


def summarise(value, payments, tds_by_payment=None, company_borne=False, exclude_payment=None) -> dict:
	"""Sum a PO / Work Order's payments by status, gross, leaving `exclude_payment` out.

	`exclude_payment` is the payment being APPROVED: the dialog shows it as "This payment", so it
	must not also sit inside its own status line. A request dialog passes nothing -- the new
	payment does not exist yet.

	Returns `{value, lines, committed, left, payments}`: `lines` keyed by `LINE_ORDER`, `left` =
	value - committed (negative when the order is already over-committed), and `payments` the other
	payments on the order in the order given, each with its gross figure.
	"""
	lines = {key: 0.0 for key in LINE_ORDER}
	others = []
	for p in payments:
		name = p.get("name")
		if exclude_payment and name == exclude_payment:
			continue
		gross = gross_amount(p, tds_by_payment, company_borne)
		status = (p.get("status") or "").strip()
		line = _LINE_OF_STATUS.get(status)
		if line:
			lines[line] += gross
		others.append({**p, "status": status, "gross_amount": round(gross, 2)})

	lines = {key: round(total, 2) for key, total in lines.items()}
	committed = round(sum(lines.values()), 2)
	value = round(flt(value), 2)
	return {
		"value": value,
		"lines": lines,
		"committed": committed,
		"left": round(value - committed, 2),
		"payments": others,
	}
