# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Generated invoices on a GST-off Work Order: generate, void, and what the WO page shows (#1546,
spec #1528; GLOSSARY *Generated invoice*, *RA number*). The rules are in
`services/wo_generated_invoices.py`.

    get_generated_invoices(work_order)                          -> dict  the records, next RA, the limit
    generate_invoice(work_order, invoice_type, invoice_date, amount) -> dict  a new record
    void_invoice(name, reason)                                  -> dict  the record, Voided

Admin, PMO, service procurement and Project Lead only (`role_profiles.WO_GENERATED_INVOICE_PROFILES`),
on a Work Order the user may read. The doctype grants read only, so every write is here, with
`ignore_permissions`.

The print is the "WO Generated Invoice" print format (`PRINT_FORMAT`): it reads the record and nothing
from the link, so editing the link changes nothing. The doctype grants no `print`, so Desk offers no
print; the WO page fetches the PDF through `frappe.utils.print_format.download_pdf`, which needs read.

#1547 adds the signed upload here: it moves a record Generated -> Signed through `MOVES`.
"""

from contextlib import contextmanager

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate, today

from nirmaan_stack.api.sr_remarks import assert_can_read_work_order
from nirmaan_stack.services import wo_generated_invoices as gi
from nirmaan_stack.services.outflow_import.amounts import rupees
from nirmaan_stack.services.role_profiles import assert_generate_wo_invoice_access, can_generate_wo_invoice
from nirmaan_stack.services.work_order_gst import gst_is_explicitly_off

SR = "Service Requests"
PRINT_FORMAT = "WO Generated Invoice"
#: Only an Approved WO is billed (Finalized ones too: Finalize does not lock billing).
BILLABLE_STATUS = "Approved"

_ROW_FIELDS = ["name", "ra_number", "invoice_type", "invoice_no", "invoice_date", "amount", "status",
			   "void_reason", "vendor_invoice", "signed_attachment", "owner", "creation"]


@frappe.whitelist(methods=["GET"])
def get_generated_invoices(work_order: str) -> dict:
	"""A Work Order's generated invoices (newest first) and what Generate would do next.

	`blocked` says why Generate is not offered at all (None when it is); `left` is the most an RA
	may bill; `final_amount` is what a FINAL would bill, or None until the WO is fully paid."""
	sr = _readable(work_order)
	state = _billing_state(sr)
	return {
		"invoices": frappe.get_all(gi.DOCTYPE, filters={"work_order": sr.name}, fields=_ROW_FIELDS,
								   order_by="ra_number desc"),
		"can_generate": can_generate_wo_invoice(frappe.session.user),
		"blocked": _work_order_problem(sr) or _final_problem(state),
		"next_ra_number": state["next_ra_number"],
		"left": state["left"],
		"fully_paid": state["fully_paid"],
		"final_amount": state["left"] if state["fully_paid"] else None,
		"has_final": bool(state["final"]),
	}


@frappe.whitelist(methods=["POST"])
def generate_invoice(work_order: str, invoice_type: str, invoice_date: str | None = None, amount=None) -> dict:
	"""Save the next generated invoice of `work_order`: an RA of `amount`, or the FINAL (which bills
	what is left; `amount` is ignored). The RA number is assigned here, under a lock on the WO."""
	assert_generate_wo_invoice_access(frappe.session.user)
	_readable(work_order)
	with _billing_lock(work_order):
		sr = frappe.get_doc(SR, work_order)
		problem = _work_order_problem(sr)
		if problem:
			frappe.throw(problem)
		if invoice_type not in gi.INVOICE_TYPES:
			frappe.throw(_("Invoice type must be RA or FINAL."))

		state = _billing_state(sr)
		problem = _final_problem(state)
		if problem:
			frappe.throw(problem)

		if invoice_type == gi.FINAL:
			if not state["fully_paid"]:
				frappe.throw(_("FINAL can be generated only once the Work Order is fully paid. Amount Paid (incl. TDS) is "
							   "{0} of {1}.").format(rupees(sr.amount_paid), rupees(sr.total_amount)))
			bill = state["left"]
			if bill <= 0:
				frappe.throw(_("Nothing is left to bill on this Work Order."))
		else:
			bill = round(flt(amount), 2)
			if bill <= 0:
				frappe.throw(_("Enter an amount more than ₹0."))
			if bill > state["left"]:
				frappe.throw(_(
					"This invoice can bill at most {0}: the smaller of the Work Order amount ({1}) and its Amount Paid "
					"incl. TDS ({2}), less {3} already billed or waiting."
				).format(rupees(state["left"]), rupees(sr.total_amount), rupees(sr.amount_paid), rupees(state["billed"])))

		date = getdate(invoice_date or today())
		ra_number = state["next_ra_number"]
		doc = _new_record({
			"work_order": sr.name,
			"project": sr.project,
			"vendor": sr.vendor,
			"ra_number": ra_number,
			"invoice_type": invoice_type,
			"amount": bill,
			"invoice_date": date,
			"invoice_no": gi.invoice_number(date, sr.project, sr.name, invoice_type, ra_number),
			"status": gi.GENERATED,
		})
		frappe.db.commit()
	return _row(doc)


@frappe.whitelist(methods=["POST"])
def void_invoice(name: str, reason: str) -> dict:
	"""Void a generated invoice not yet uploaded, with a reason. Its RA number is never given again."""
	assert_generate_wo_invoice_access(frappe.session.user)
	work_order = frappe.db.get_value(gi.DOCTYPE, name, "work_order")
	if not work_order:
		raise frappe.DoesNotExistError(_("Generated invoice {0} not found.").format(name))
	_readable(work_order)
	with _billing_lock(work_order):
		doc = frappe.get_doc(gi.DOCTYPE, name)
		if doc.status != gi.GENERATED:
			frappe.throw(_("Only a generated invoice not yet uploaded can be voided. This one is {0}.").format(doc.status))
		if not cstr(reason).strip():
			frappe.throw(_("Give a reason for voiding the invoice."))
		doc.status = gi.VOIDED
		doc.void_reason = cstr(reason).strip()
		doc.save(ignore_permissions=True)
		frappe.db.commit()
	return _row(doc)


@contextmanager
def _billing_lock(work_order):
	"""Hold `work_order`'s billing lock, inside a transaction that started AFTER it was granted.

	Frappe runs PostgreSQL at REPEATABLE READ, so a transaction reads one snapshot, taken at its first
	statement: after waiting on a row lock, a second generate would still read the old highest RA
	number (the concurrency test saw it). So, as `api/tds/submit._project_send_lock` does, the lock is
	a session-level advisory lock and the commit right after it starts a fresh snapshot that holds
	everything the previous holder committed. The holder commits before it unlocks; a failure rolls
	back first, so the unlock runs on a usable transaction. The first commit also commits anything the
	caller wrote before: from the browser that is nothing.
	"""
	key = f"wo_generated_invoice:{work_order}"
	frappe.db.commit()
	frappe.db.sql("SELECT pg_advisory_lock(hashtext(%s))", (key,))
	try:
		frappe.db.commit()
		yield
	except Exception:
		frappe.db.rollback()
		raise
	finally:
		frappe.db.sql("SELECT pg_advisory_unlock(hashtext(%s))", (key,))


def _new_record(fields):
	doc = frappe.get_doc({"doctype": gi.DOCTYPE, **fields})
	doc.flags.made_by_generate = True
	doc.insert(ignore_permissions=True)
	return doc


def _readable(work_order):
	assert_can_read_work_order(work_order)
	return frappe.get_doc(SR, work_order)


def _work_order_problem(sr) -> str | None:
	"""Why no invoice may be generated on this WO at all, whatever its figures."""
	if sr.status != BILLABLE_STATUS:
		return _("Invoices are generated only on an Approved Work Order. This one is {0}.").format(sr.status)
	if not gst_is_explicitly_off(sr.gst):
		return _("Invoices are generated only on a GST-off Work Order. A GST vendor sends their own tax invoice.")
	if not cstr(sr.project_gst).strip():
		return _("Set the Work Order's Nirmaan GST before generating an invoice.")
	return None


def _final_problem(state) -> str | None:
	final = state["final"]
	if final:
		return _("This Work Order already has its FINAL invoice ({0}); nothing is generated after it.").format(final)
	return None


def _billing_state(sr) -> dict:
	"""What is billed on the WO, what is left, its next RA number and its live FINAL, if any."""
	records = frappe.get_all(gi.DOCTYPE, filters={"work_order": sr.name},
							 fields=["ra_number", "invoice_type", "invoice_no", "amount", "status"])
	invoices = frappe.get_all("Vendor Invoices", filters={"document_type": SR, "document_name": sr.name},
							  fields=["invoice_no", "invoice_amount", "status"])
	billed = sum(flt(i.invoice_amount) for i in invoices if i.status in gi.BILLED_INVOICE_STATUSES)
	billed += sum(flt(r.amount) for r in records if r.status in gi.NOT_UPLOADED)
	final = next((r.invoice_no for r in records if r.invoice_type == gi.FINAL and r.status != gi.VOIDED), None)
	return {
		"billed": round(billed, 2),
		"left": gi.billable_left(sr.total_amount, sr.amount_paid, billed),
		"fully_paid": gi.is_fully_paid(sr.total_amount, sr.amount_paid),
		"final": final,
		"next_ra_number": gi.next_ra_number(
			[r.ra_number for r in records], [sr.invoice_no] + [i.invoice_no for i in invoices]
		),
	}


def _row(doc) -> dict:
	row = {f: doc.get(f) for f in _ROW_FIELDS}
	row["ra_number"] = cint(row["ra_number"])
	row["amount"] = flt(row["amount"])
	return row
