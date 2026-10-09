"""Daily Supply DC entry for one package tracker."""

import frappe
from frappe import _


@frappe.whitelist(methods=["POST"])
def add_dc_entry(tracker: str, amount, dc_date: str | None = None) -> dict:
	"""Append one row to the tracker's DC log.

	0 means no delivery that day; a negative amount corrects an earlier row.
	The tracker row is locked first, so two people logging DC for the same
	package queue instead of overwriting each other. The tracker's validate
	recomputes supply_dc / dc_updated_on and checks who may write.
	"""
	try:
		amount = float(amount)
	except (TypeError, ValueError):
		frappe.throw(_("Enter the delivered value as a number."))

	frappe.db.get_value("Project Billing Tracker", tracker, "name", for_update=True)
	doc = frappe.get_doc("Project Billing Tracker", tracker)
	doc.append("dc_log", {"dc_date": dc_date or frappe.utils.today(), "amount": amount})
	doc.save()
	frappe.db.commit()
	return {
		"name": doc.name,
		"supply_dc": doc.supply_dc,
		"dc_updated_on": doc.dc_updated_on,
	}
