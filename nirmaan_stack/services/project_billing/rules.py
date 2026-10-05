# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Client billing tracker rules (Project Billing Package / Project Bill).

Pure module: no frappe.db, no request context. Every count, total and
"next bill" pick in the billing APIs reads these, never a re-derived
string match.
"""

# Owner grouping, 2026-10-03. "NA" is in neither group: an NA bill counts as
# neither pending nor approved, and its value stays out of every money total.
APPROVED_STATUSES = frozenset({
	"Client Approved",
	"Invoice Sent",
	"Payment Received",
	"Partial Payment Received",
})
PENDING_STATUSES = frozenset({
	"Not Started",
	"Prepared",
	"Submission Pending",
	"Internally Approved",
	"Revision Pending",
	"Submitted",
	"Client Hold",
	"Certification Pending",
})
NA_STATUS = "NA"

# The one status that stamps a bill's first submission date (owner, 2026-10-05).
SUBMITTED_STATUS = "Submitted"

# Statuses that mean the bill has gone to the client at least once; from these on the
# bill document is required (decision 24).
SUBMITTED_OR_LATER = frozenset({
	"Submitted",
	"Client Hold",
	"Certification Pending",
}) | APPROVED_STATUSES


def first_submission_date(current, status, today):
	"""A bill's first submission date after a save (owner, 2026-10-05).

	Stamped with `today` only when the bill is saved as Submitted and has none yet; never moved or
	cleared after that. A bill that skips Submitted (e.g. Prepared → Client Approved) keeps it empty.
	"""
	if current:
		return current
	return today if status == SUBMITTED_STATUS else None


def counts_in_totals(status):
	"""An NA bill is left out of every count and money total."""
	return status != NA_STATUS


def next_bill(bills):
	"""The pending bill with the earliest ETA (owner, 2026-10-03).

	`bills` are dicts carrying at least `status` and `eta_date` (a date, an
	ISO string or empty). Bills without an ETA come after every dated one;
	ties keep the input order. Returns None when nothing is pending.
	"""
	pending = [b for b in bills if b.get("status") in PENDING_STATUSES]
	if not pending:
		return None
	return min(pending, key=lambda b: (not b.get("eta_date"), str(b.get("eta_date") or "")))


# Columns of the manager summary grid on the Billing Trackers page, in display
# order. Together they cover every pending and approved status exactly once;
# NA is left out like everywhere else.
SUMMARY_COLUMNS = (
	("not_started", "Not Started", ("Not Started",)),
	("submission", "Submission", ("Prepared", "Submission Pending")),
	("certification", "Cert. Pending", ("Internally Approved", "Submitted", "Certification Pending")),
	("hold", "On Hold", ("Client Hold", "Revision Pending")),
	("approved", "Approved", ("Client Approved",)),
	("invoiced", "Invoiced", ("Invoice Sent",)),
	("paid", "Paid", ("Payment Received", "Partial Payment Received")),
)


DEADLINE_CHOICES = ("week", "overdue", "none")


def deadline_window(choice, today):
	"""The ETA window of a Bill Wise "Deadline" choice. Only PENDING bills ever match one.

	Returns {"eta_from", "eta_to", "eta_unset"}: inclusive date bounds (either may be
	None) and whether the bill must have no ETA. Mirrors `deadlineFilters` in the
	frontend's billingFormat.ts. `today` is a date; raises ValueError for any other choice.
	"""
	from datetime import timedelta

	if choice == "overdue":
		return {"eta_from": None, "eta_to": today - timedelta(days=1), "eta_unset": False}
	if choice == "week":
		return {"eta_from": today, "eta_to": today + timedelta(days=7), "eta_unset": False}
	if choice == "none":
		return {"eta_from": None, "eta_to": None, "eta_unset": True}
	raise ValueError(f"Unknown deadline choice: {choice!r}")


def summary_column(status):
	"""The manager-summary column key for a status, or None for NA / unknown."""
	for key, _label, statuses in SUMMARY_COLUMNS:
		if status in statuses:
			return key
	return None


def can_edit_package_bills(user, managers, is_admin):
	"""May `user` add or edit this package's bills and log its Supply DC?

	Admin may for every package; anyone else only for a package they are one of the
	billing managers of (owner, 2026-10-03). Viewing is not limited by this.
	"""
	return bool(is_admin) or user in set(managers or ())


def clean_package_name(name):
	"""A typed billing package name: outer spaces dropped, inner runs of spaces made one."""
	return " ".join(str(name or "").split())


def raises_over_po(po_value, old_total, new_total):
	"""Does a save push a package's total (billed, or Supply DC) above its PO value? (owner, 2026-10-05)

	Only an increase past the PO is refused. With no PO value set there is nothing to check, and a
	package already over its PO can still be saved unchanged or corrected down.
	"""
	po = round(float(po_value or 0), 2)
	old = round(float(old_total or 0), 2)
	new = round(float(new_total or 0), 2)
	return po > 0 and new > po and new > old


def format_inr(amount):
	"""Rupees with Indian digit grouping and no paise, for messages: 9200000 -> ₹92,00,000."""
	n = round(float(amount or 0))
	digits = str(abs(n))
	if len(digits) > 3:
		head, tail = digits[:-3], digits[-3:]
		groups = []
		while len(head) > 2:
			groups.insert(0, head[-2:])
			head = head[:-2]
		groups.insert(0, head)
		digits = ",".join(groups) + "," + tail
	return f"{'-' if n < 0 else ''}₹{digits}"


def missing_bill_fields(status, bill_type, bill_value, eta_date, has_document, payment_received):
	"""What a bill still lacks for its status, as labels; [] when it can be saved (owner, 2026-10-05).

	An NA bill (NA status or NA bill type) needs nothing more. Every other bill needs a bill value
	greater than 0; an ETA date while it is pending; the bill document (a link or an attachment)
	from Submitted on; and the amount received, greater than 0, when it is Partial Payment Received.
	"""
	if status == NA_STATUS or bill_type == NA_STATUS:
		return []
	missing = []
	if not float(bill_value or 0) > 0:
		missing.append("Bill value (greater than 0)")
	if status in PENDING_STATUSES and not eta_date:
		missing.append("ETA date")
	if status in SUBMITTED_OR_LATER and not has_document:
		missing.append("Bill document (a link or an attachment)")
	if status == "Partial Payment Received" and not float(payment_received or 0) > 0:
		missing.append("Payment received (greater than 0)")
	return missing
