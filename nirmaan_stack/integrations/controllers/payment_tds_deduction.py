# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A deduction edited or deleted through the doc layer (Desk, the REST API, `frappe.delete_doc`).

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet family.

LOCKED ONCE DEPOSITED (#1535, spec #1528 stories 40-41). A deduction whose tax is in a challan can't be
changed or deleted: deposited tax never changes and never disappears. Before that its figures may be
corrected in Desk, and each correction recounts its order (`on_update`), so the order's Amount Paid,
`total_tds` and Amount Due, and its project's outflow, never disagree with the record. The payment's
own amount is left as it is: it says what went to the vendor.

`status` and `tds_challan` are never set by hand: only Pay TDS writes them (`api/tds_challan/pay_tds`,
by `set_value`, which fires none of these hooks), because it alone checks the challan's balance and that
the payment is Paid. A correction therefore never moves a challan's figures: before a challan there is
none to move, and after one the row is locked. `borne_by` is moved only by the Admin action *TDS paid by
company* (`payment_tds.mark_tds_paid_by_company`, #1537), which saves through here so its correction
recounts the order like any other.

A deduction on a PAID payment is part of its order's Amount Paid, `total_tds` and Amount Due (ADR-0034
Amendments A and B) and of its project's outflow (#1510), so a correction or a delete recounts the order
and re-checks the project's CEO Hold.

⚠️ HALF THE COVERAGE. These hooks fire only on the doc layer. Pay TDS and the payment's amount restate
write by `set_value`; the payment's delete and reject remove the row by raw SQL and handle their own
recount and challan rules (`controllers/project_payments`).
"""

import frappe
from frappe.utils import cstr, flt

from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import recheck_after_recount
from nirmaan_stack.services.amount_paid import write_amount_paid
from nirmaan_stack.services.payment_tds import PAID, PAYMENT_DOCTYPE, TDS_PAID_BY_COMPANY, challan_label

#: The deduction's own status before Pay TDS (not the payment's).
PENDING = "Pending"
#: Written only by Pay TDS, never by hand.
PAY_TDS_FIELDS = ("status", "tds_challan")
NUMBER_FIELDS = ("gross_amount", "tds_percentage", "tds_amount")
#: Every field a person could change in Desk; all of them freeze once the tax is in a challan.
LOCKED_FIELDS = (
	"project_payment", "document_type", "document_name", "vendor", "project",
	"gross_amount", "tds_percentage", "tds_amount", "borne_by", "payment_approved_on",
	*PAY_TDS_FIELDS,
)


def validate(doc, method=None):
	if doc.is_new():
		refuse_born_in_a_challan(doc)
		return
	before = doc.get_doc_before_save()
	if not before:
		return
	refuse_change_if_deposited(doc, before)
	refuse_hand_written_challan(doc, before)
	refuse_hand_written_borne_by(doc, before)


def _changed(doc, before, field) -> bool:
	"""Did this save change `field`? Read as Desk and REST send values: a number to 2 places, a date or
	text as its string, a blank status as `Pending` (the column default every screen assumes)."""
	old, new = before.get(field), doc.get(field)
	if field in NUMBER_FIELDS:
		return flt(old, 2) != flt(new, 2)
	if field == "status":
		old, new = old or PENDING, new or PENDING
	return cstr(old) != cstr(new)


def refuse_change_if_deposited(doc, before):
	"""Deposited tax never changes (#1535)."""
	if before.get("tds_challan") and any(_changed(doc, before, field) for field in LOCKED_FIELDS):
		frappe.throw(
			f"{doc.name} can't be changed: its tax is already deposited under TDS challan "
			f"{challan_label(before.tds_challan)}.",
			title="TDS already deposited",
		)


def refuse_born_in_a_challan(doc):
	"""A new deduction starts Pending, in no challan: one made in Desk with either filled would count as
	deposited tax that Pay TDS never checked (the payment Paid, the challan's balance) or counted."""
	if doc.get("tds_challan") or cstr(doc.get("status") or PENDING) != PENDING:
		frappe.throw(f"A new deduction starts {PENDING}, in no challan: the challan and status are set by Pay TDS, "
					 "not by hand.")


def refuse_hand_written_challan(doc, before):
	"""Only Pay TDS links a challan and marks tax Paid: it checks the balance and that the payment is Paid."""
	if any(_changed(doc, before, field) for field in PAY_TDS_FIELDS):
		frappe.throw(f"{doc.name}: the challan and status are set by Pay TDS, not by hand.")


def refuse_hand_written_borne_by(doc, before):
	"""Who bore the tax is set when the deduction is taken, and moved only by the Admin action *TDS paid
	by company* (`payment_tds.mark_tds_paid_by_company`, #1537), which checks the role and the challan."""
	if _changed(doc, before, "borne_by") and not doc.flags.get("tds_paid_by_company"):
		frappe.throw(
			f"{doc.name}: who bore the tax is not changed by hand. An Admin uses "
			f"\"{TDS_PAID_BY_COMPANY}\" on the payment instead."
		)


def on_update(doc, method=None):
	"""A correction made before any challan recounts the payment's order (`_recount_payment_order`).
	Nothing on insert: `write_deduction` nets the payment after the insert and recounts itself."""
	if doc.get_doc_before_save():
		_recount_payment_order(doc)


def on_trash(doc, method=None):
	"""Deposited tax never disappears (#1535). Nothing else: a deduction not in a challan counts in no
	challan's `reconciled_amount`, and its order is recounted in `after_delete`, once it is gone."""
	if doc.get("tds_challan"):
		frappe.throw(
			f"{doc.name} can't be deleted: its tax is already deposited under TDS challan "
			f"{challan_label(doc.tds_challan)}.",
			title="TDS already deposited",
		)


def after_delete(doc, method=None):
	"""Recount the order now the row is gone (the writer reads the deduction rows, so never in
	`on_trash`).

	This runs on a forced delete of the deduction (`frappe.delete_doc(..., force=True)`): a plain delete
	from Desk or REST is refused, because the payment's `Project Payments.payment_tds` links to it. The
	payment's own delete removes its deduction by raw SQL, so this never runs for it; that path recounts
	in `controllers/project_payments.on_trash`.
	"""
	_recount_payment_order(doc)


def _recount_payment_order(doc):
	"""Recount the order of this deduction's payment through the one writer when the payment is Paid
	(only a Paid payment's tax counts in its order's figures and its project's outflow), then re-check
	that project's CEO Hold (`recheck_after_recount`). Any other status moves nothing.

	Logged, not raised, like the payment's own recount, so a save or delete never fails on a bookkeeping
	total (the Amount Paid Mismatch report shows the order instead).
	"""
	payment = frappe.db.get_value(
		PAYMENT_DOCTYPE,
		doc.get("project_payment"),
		["status", "document_type", "document_name", "project"],
		as_dict=True,
	)
	if not payment or payment.status != PAID:
		return
	try:
		write_amount_paid(payment.document_type, payment.document_name)
	except Exception:
		frappe.log_error(
			title="Amount Paid recount failed after a deduction changed",
			message=f"deduction={doc.name} payment={doc.get('project_payment')}\n{frappe.get_traceback()}",
		)
		return
	recheck_after_recount(payment.project)
