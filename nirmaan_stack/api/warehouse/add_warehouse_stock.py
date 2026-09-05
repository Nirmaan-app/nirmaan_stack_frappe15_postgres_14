"""
Manual warehouse stock entry (admin only).

This is deliberately OUTSIDE the ITM lifecycle: no Internal Transfer Memo is
created, no source/target project, no dispatch or delivery states. It is the
path for material that reaches the warehouse some other way — a direct
purchase, opening stock, a site return — and it writes the
``Warehouse Stock Item`` bucket straight, with one ``Increase`` ledger row
stamped ``Manual Entry`` so it is visibly distinct from ITM movement.
"""

import frappe
from frappe.utils import flt, nowdate

from nirmaan_stack.api.warehouse.get_item_estimated_rate import (
	get_item_estimated_rate,
)
from nirmaan_stack.integrations.controllers.warehouse_stock import (
	_get_or_create_stock_item,
)


ADMIN_ROLE = "Nirmaan Admin Profile"

# Stamped onto the ledger row's ``doctype_ref``. Not a real doctype — a manual
# entry has no source document, and the Ledger tab renders this verbatim.
MANUAL_LEDGER_REF = "Manual Entry"


def _require_admin():
	"""Permit the ``Administrator`` user or a Nirmaan Admin Profile user.

	Compares against the user's *role profile* — the same string the frontend
	reads via ``useUserData`` — NOT ``frappe.get_roles``. A Frappe role profile
	assigns underlying roles to a user and ``get_roles`` returns those, never
	the profile name itself, so a ``get_roles`` check here would silently deny
	everyone. Same reasoning as ``internal_transfer_memo._require_dispatcher``.
	"""
	user = frappe.session.user
	if user == "Administrator":
		return
	if frappe.db.get_value("User", user, "role_profile_name") == ADMIN_ROLE:
		return
	frappe.throw(
		"Only administrators may add warehouse stock manually.",
		frappe.PermissionError,
	)


@frappe.whitelist(methods=["POST"])
def add_warehouse_stock(
	item_id: str | None = None,
	make: str | None = None,
	quantity: float | str | None = None,
):
	"""Increase the (item_id, make) warehouse bucket by ``quantity``.

	The estimated rate is DERIVED here, never accepted from the caller. The
	dialog renders it read-only, so it is a computed fact rather than a human
	input — and a read-only field whose value still round-trips through the
	browser is spoofable. Deriving it server-side also makes the max-wins
	property unbreakable: the stored rate can never be lowered by this path.
	"""
	_require_admin()

	if not item_id:
		frappe.throw("item_id is required.", frappe.ValidationError)

	qty = flt(quantity)
	if qty <= 0:
		frappe.throw("Quantity must be greater than 0.", frappe.ValidationError)

	item = frappe.db.get_value(
		"Items",
		item_id,
		["name", "item_name", "unit_name", "category"],
		as_dict=True,
	)
	if not item:
		frappe.throw(f"Item {item_id} does not exist.", frappe.ValidationError)

	# max(highest live-PO quote for this item+make, rate already on the bucket).
	# Same call the dialog made to display the figure, so what the admin saw and
	# what gets stored cannot diverge.
	rate = flt(get_item_estimated_rate(item_id, make)["suggested_rate"])

	# `make` is normalised to None inside _get_or_create_stock_item — reuse
	# that helper rather than looking the row up here, so this path and the ITM
	# path can never disagree about which bucket a make-less item belongs to.
	wsi = _get_or_create_stock_item(
		item_id,
		make,
		{
			"item_name": item.item_name,
			"unit": item.unit_name,
			"category": item.category,
			"estimated_rate": rate,
		},
	)

	wsi.quantity = flt(wsi.quantity) + qty

	# Already the max of the PO rate and whatever the bucket carried, so this
	# only ever raises — matching apply_warehouse_delta's rule on the ITM
	# inward path. Guarded so a no-PO-history item can't zero an existing rate.
	if rate > 0:
		wsi.estimated_rate = rate

	wsi.append(
		"ledger",
		{
			"doctype_ref": MANUAL_LEDGER_REF,
			"docname_ref": frappe.session.user,
			"source_project": "",
			"target_project": "Warehouse",
			"impact": "Increase",
			"quantity": qty,
			"date": nowdate(),
		},
	)
	wsi.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"status": "success",
		"name": wsi.name,
		"item_id": wsi.item_id,
		"make": wsi.make,
		"quantity_added": qty,
		"new_quantity": flt(wsi.quantity),
		"estimated_rate": flt(wsi.estimated_rate),
	}
