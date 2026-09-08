"""
Estimated-rate lookup for a manual warehouse stock entry.

Mirrors the basis the ITM inventory picker shows the user
(``get_inventory_picker_data.max_rates``): the highest ``quote`` on a live
Purchase Order line for the item, **keyed by make**. The warehouse has no
project, so the picker's project dimension simply drops out and the search
runs across every project.

NOTE the deliberate divergence from ``create_itms._build_metadata_snapshot``,
which keys its ``MAX(quote)`` on ``(project, item_id)`` only — dropping make
there lets a Tata-make line inherit a Jindal-make price. This endpoint follows
the picker, not that path.
"""

import frappe
from frappe.utils import flt


# A PO in one of these states is not a live price signal.
_DEAD_PO_STATUSES = ("Merged", "Inactive", "PO Amendment")


@frappe.whitelist()
def get_item_estimated_rate(item_id: str | None = None, make: str | None = None):
	"""Return the suggested estimated rate for an (item_id, make) bucket.

	Both the PO-derived rate and the rate already carried by the warehouse
	bucket are returned, plus the higher of the two as ``suggested_rate``.

	Taking the max means a manual entry can never silently devalue existing
	stock: it matches what ``warehouse_stock.apply_warehouse_delta`` would do
	on the ITM inward path, which only ever raises the stored rate. The caller
	renders it as an editable default, so an admin lowering it is doing so
	deliberately against a number they can see.
	"""
	if not item_id:
		frappe.throw("item_id is required.", frappe.ValidationError)

	# Empty-string make and NULL make are the same bucket everywhere else
	# (see warehouse_stock._get_or_create_stock_item) — keep that here.
	make = make or None

	po_row = frappe.db.sql(
		"""
		SELECT poi.quote AS rate, po.name AS po_name
		FROM "tabPurchase Order Item" poi
		JOIN "tabProcurement Orders" po ON poi.parent = po.name
		WHERE po.status NOT IN %(dead_statuses)s
		  AND poi.item_id = %(item_id)s
		  AND COALESCE(poi.make, '') = COALESCE(%(make)s, '')
		ORDER BY poi.quote DESC
		LIMIT 1
		""",
		{"dead_statuses": _DEAD_PO_STATUSES, "item_id": item_id, "make": make},
		as_dict=True,
	)

	po_rate = flt(po_row[0]["rate"]) if po_row else 0.0
	po_name = po_row[0]["po_name"] if po_row else None

	warehouse_rate = flt(
		frappe.db.get_value(
			"Warehouse Stock Item",
			{"item_id": item_id, "make": make},
			"estimated_rate",
		)
		or 0
	)

	suggested = max(po_rate, warehouse_rate)

	if suggested == po_rate and po_rate > 0:
		source = "po"
	elif suggested > 0:
		source = "warehouse"
	else:
		source = "none"

	return {
		"item_id": item_id,
		"make": make,
		"po_rate": po_rate,
		"po_name": po_name,
		"warehouse_rate": warehouse_rate,
		"suggested_rate": suggested,
		"source": source,
	}
