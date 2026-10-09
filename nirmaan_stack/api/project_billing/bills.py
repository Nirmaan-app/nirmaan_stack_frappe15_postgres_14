"""Add or update a bill (`Project Billing`). Deleting is the standard document delete."""

import json

import frappe
from frappe import _

from nirmaan_stack.services.project_billing.rules import changed_to_past

# Fields a user may set from the bill drawer. Project and package are copied
# from the tracker and first_submission_date is stamped by the doctype.
EDITABLE_FIELDS = (
	"bill_type",
	"status",
	"bill_value",
	"payment_received",
	"invoice_requested",
	"eta_date",
	"approval_date",
	"bill_document_link",
	"bill_attachment",
)


@frappe.whitelist(methods=["POST"])
def save_bill(bill) -> dict:
	"""Create a bill (needs `billing_tracker`) or update one (needs `name`)."""
	if isinstance(bill, str):
		bill = json.loads(bill)

	values = {k: (bill.get(k) if bill.get(k) != "" else None) for k in EDITABLE_FIELDS if k in bill}
	if "invoice_requested" in bill:
		values["invoice_requested"] = 1 if bill.get("invoice_requested") else 0

	# From the app, ETA and approval dates are today or later when set or changed (owner,
	# 2026-10-03). Checked here, not in the doctype, so Desk can still set any date (owner, 2026-10-05).
	saved = (
		frappe.db.get_value("Project Billing", bill["name"], ["eta_date", "approval_date"], as_dict=True)
		if bill.get("name")
		else None
	)
	for field, label in (("eta_date", _("ETA date")), ("approval_date", _("Approval date"))):
		if field in values and changed_to_past(values[field], (saved or {}).get(field), frappe.utils.today()):
			frappe.throw(_("{0} cannot be before today.").format(label))

	if bill.get("name"):
		doc = frappe.get_doc("Project Billing", bill["name"])
		doc.update(values)
		doc.save()
	else:
		if not bill.get("billing_tracker"):
			frappe.throw(_("Pick a package for this bill."))
		doc = frappe.get_doc(
			dict(values, doctype="Project Billing", billing_tracker=bill["billing_tracker"])
		).insert()

	_link_attachment(doc)
	frappe.db.commit()
	return doc.as_dict()


def _link_attachment(doc) -> None:
	"""Attach the uploaded bill file to its bill, so everyone who can see the bill can open it.

	The drawer uploads the file before saving (a new bill has no name yet), so the File row
	starts unattached. Only the caller's own unattached upload of this URL is linked.
	Raw set_value on File, deliberately: it fills the three attached_to_* columns only,
	which nothing derives from, and a File save would re-run the storage upload hooks.
	"""
	if not doc.get("bill_attachment"):
		return
	files = frappe.get_all(
		"File",
		filters={
			"file_url": doc.get("bill_attachment"),
			"owner": frappe.session.user,
			"attached_to_name": ["is", "not set"],
		},
		pluck="name",
	)
	for name in files:
		frappe.db.set_value(
			"File",
			name,
			{"attached_to_doctype": "Project Billing", "attached_to_name": doc.name, "attached_to_field": "bill_attachment"},
			update_modified=False,
		)
