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

# Statuses that mean the bill has gone to the client at least once; the first
# time a bill reaches one of these stamps its first submission date.
SUBMITTED_OR_LATER = frozenset({
	"Submitted",
	"Client Hold",
	"Certification Pending",
}) | APPROVED_STATUSES


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
