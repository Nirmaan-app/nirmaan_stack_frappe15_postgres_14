# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What may no longer change once a PAYMENT is Paid (owner, 2026-09-21).

    Project Payments       Amount, UTR, Payment Date, Cheque No, Cheque Date, payment proof

A Paid PO / Work Order payment has no edit surface in the app; this lock is what keeps Desk and
the REST API in step with that.

⚠️ THE EXPENSE LEDGERS ARE DELIBERATELY NOT HERE (owner, 2026-09-21). A Paid project / non-project
expense locks its Amount, Payment Date and Payment Ref in the app's edit dialogs ONLY: the owner
still corrects Paid expenses by hand in Desk, so a server lock would take that away. Do not add
`Project Expenses` / `Non Project Expenses` to `LOCKED_WHEN_PAID` without a new ruling.

⚠️ WHY A LOCK AND NOT A RECOMPUTE. Every stored figure that reads payments -- a PO / Work Order's
`amount_paid` / `amount_due` / `total_tds`, vendor credit, the CEO Hold cashflow gap -- counts
`Paid` rows only, and each is recomputed on a transition INTO or OUT OF Paid, never on an edit that
stays Paid (measured 2026-09-21: an amount edit on a Paid PO payment left the PO's `amount_paid`
stale). Refusing the edit means that stale state cannot be reached.

⚠️ ONLY A SAVE THAT STAYS PAID. A save that ARRIVES at Paid (Mark Reconciled, the bank import's
settle) or LEAVES it (unreconcile) writes exactly these fields on purpose, and is untouched.

The rule (`changed_locked_fields` / `paid_lock_refusal`) is PURE -- no database, no request
context. `guard_paid_record` is its ONE thin caller, from `Project Payments.validate`, and holds the
machine-path exemptions (`MACHINE_FLAGS`).
"""

import frappe
from frappe.utils import flt, getdate

from nirmaan_stack.services import settlement

PAID = settlement.STATUS_PAID

LOCKED_WHEN_PAID = {
	"Project Payments": (
		"amount",
		"utr",
		"payment_date",
		"cheque_no",
		"cheque_date",
		"payment_attachment",
	),
}

FIELD_LABELS = {
	"amount": "Amount",
	"utr": "UTR",
	"payment_date": "Payment Date",
	"cheque_no": "Cheque No",
	"cheque_date": "Cheque Date",
	"payment_attachment": "Payment proof",
}

#: Machine writers that set these fields deliberately. Each already flags itself on the way in
#: (the same flags `payment_tds.NO_RESTATE_FLAGS` reads); a human edit carries none of them.
MACHINE_FLAGS = ("from_outflow_import", "outflow_import_settling", "split_approval", "from_adjustment")

_AMOUNT_FIELDS = frozenset({"amount"})
_DATE_FIELDS = frozenset({"payment_date", "cheque_date"})


def _normalise(field, value):
	if field in _AMOUNT_FIELDS:
		return round(flt(value), 2)
	if field in _DATE_FIELDS:
		return str(getdate(value)) if value else None
	text = (str(value) if value is not None else "").strip()
	return text or None


def changed_locked_fields(doctype, before, after) -> list[str]:
	"""The locked fields this save changes on a row that was Paid and stays Paid.

	`before` / `after` are anything with `.get` (a Document, a dict). An empty list means the
	save is allowed -- including every save of a row that is not Paid on both sides, and every
	save of a doctype with no lock.
	"""
	fields = LOCKED_WHEN_PAID.get(doctype)
	if not fields or not before:
		return []
	if (before.get("status") or "").strip() != PAID or (after.get("status") or "").strip() != PAID:
		return []
	return [f for f in fields if _normalise(f, before.get(f)) != _normalise(f, after.get(f))]


def paid_lock_refusal(doctype, before, after) -> str | None:
	"""The message to refuse this save with, or None when it may proceed."""
	changed = changed_locked_fields(doctype, before, after)
	if not changed:
		return None
	names = ", ".join(FIELD_LABELS.get(f, f) for f in changed)
	return f"This payment is Paid, so {names} can no longer be changed."


def guard_paid_record(doc) -> None:
	"""Refuse a save that changes a locked field on a Paid payment. Called from `validate`."""
	if doc.is_new():
		return
	if any(doc.flags.get(f) for f in MACHINE_FLAGS) or frappe.flags.get("outflow_import_settling"):
		return
	refusal = paid_lock_refusal(doc.doctype, doc.get_doc_before_save(), doc)
	if refusal:
		frappe.throw(refusal, title="Paid payment")
