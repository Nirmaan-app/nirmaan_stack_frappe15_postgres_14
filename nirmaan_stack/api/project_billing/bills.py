"""Add or update a bill (`Project Billing`)."""

import json

import frappe
from frappe import _

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
)


@frappe.whitelist(methods=["POST"])
def save_bill(bill) -> dict:
	"""Create a bill (needs `billing_tracker`) or update one (needs `name`)."""
	if isinstance(bill, str):
		bill = json.loads(bill)

	values = {k: (bill.get(k) if bill.get(k) != "" else None) for k in EDITABLE_FIELDS if k in bill}
	if "invoice_requested" in bill:
		values["invoice_requested"] = 1 if bill.get("invoice_requested") else 0

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

	frappe.db.commit()
	return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def delete_bill(name: str) -> dict:
	frappe.delete_doc("Project Billing", name)
	frappe.db.commit()
	return {"deleted": name}
