"""
Inventory picker data for the Create Internal Transfer Memo flow.

Aggregates the latest submitted Remaining Items Report (RIR) per project,
joined with the max Purchase Order quote rate per (project, item_id, make), and
subtracts both pending ITR reservations and approved ITM transfer deductions
to produce a live ``available_quantity`` per (item, make, source) triple.

Reservation = Pending/Approved ITR items whose linked ITM is not yet dispatched.
Deduction   = Dispatched ITMs dispatched after the latest RIR date.

The response is tree-shaped: one node per ``item_id`` with aggregated totals
and a ``sources`` array listing each contributing (source project, make) pair.
Items with no pickable availability anywhere (``available_quantity <= 0`` in
every source) are excluded, as is the "Additional Charges" pseudo-category.

Reuses the CTE pattern from :mod:`nirmaan_stack.api.inventory_item_wise`.
"""

from collections import OrderedDict

import frappe


@frappe.whitelist()
def get_inventory_picker_data(search: str = "") -> list:
	"""Return tree-structured inventory rows for the ITM create picker.

	Args:
	    search: Optional case-insensitive substring to filter item names on.

	Returns:
	    List of item nodes ``[ { item_id, item_name, ..., sources: [...] }, ... ]``
	    sorted alphabetically by item name, with sources sorted by
	    ``available_quantity`` descending. Frappe's whitelist layer wraps
	    this as ``{"message": [...]}`` on the wire.
	"""

	search_term = (search or "").strip()
	like_pattern = f"%{search_term}%" if search_term else None

	sql = """
	WITH latest_reports AS (
		SELECT DISTINCT ON (project)
			name, project, report_date, modified
		FROM "tabRemaining Items Report"
		WHERE status = 'Submitted'
		ORDER BY project, report_date DESC
	),
	report_items AS (
		SELECT
			lr.name AS rir_name,
			lr.project,
			lr.report_date,
			ri.item_id,
			ri.item_name,
			ri.unit,
			ri.category,
			ri.make,
			ri.remaining_quantity
		FROM latest_reports lr
		JOIN "tabRemaining Item Entry" ri ON ri.parent = lr.name
		WHERE ri.remaining_quantity > 0
		  AND COALESCE(ri.category, '') <> 'Additional Charges'
	),
	max_rates AS (
		SELECT DISTINCT ON (po.project, poi.item_id, poi.make)
			po.project,
			poi.item_id,
			poi.make,
			poi.quote AS max_quote
		FROM "tabPurchase Order Item" poi
		JOIN "tabProcurement Orders" po ON poi.parent = po.name
		WHERE po.status NOT IN ('Merged', 'Inactive', 'PO Amendment')
		ORDER BY po.project, poi.item_id, poi.make, poi.quote DESC
	),
	po_numbers AS (
		SELECT po.project, poi.item_id, poi.make,
			array_agg(DISTINCT po.name ORDER BY po.name DESC) AS po_list
		FROM "tabPurchase Order Item" poi
		JOIN "tabProcurement Orders" po ON poi.parent = po.name
		WHERE po.status NOT IN ('Merged', 'Inactive', 'PO Amendment')
		GROUP BY po.project, poi.item_id, poi.make
	),
	reserved_qty AS (
		SELECT
			itr.source_project AS project,
			itri.item_id,
			itri.make,
			SUM(itri.transfer_quantity) AS reserved
		FROM "tabInternal Transfer Request Item" itri
		JOIN "tabInternal Transfer Request" itr ON itri.parent = itr.name
		WHERE itri.status IN ('Pending', 'Approved')
		  AND NOT EXISTS (
		      SELECT 1 FROM "tabInternal Transfer Memo" itm_chk
		      WHERE itm_chk.name = itri.linked_itm
		        AND itm_chk.status IN ('Dispatched', 'Partially Delivered', 'Delivered')
		  )
		GROUP BY itr.source_project, itri.item_id, itri.make
	),
	dispatched_itm_deductions AS (
		-- Dispatches AFTER the latest RIR was last saved (modified) are not
		-- yet reflected in the PM's recorded remaining_quantity, so deduct
		-- them. Grouped by (project, item_id, make) so a Tata-make dispatch
		-- never reduces a Jindal-make row.
		SELECT
			itm.source_project AS project,
			itmi.item_id,
			itmi.make,
			SUM(itmi.transfer_quantity) AS deducted_qty
		FROM "tabInternal Transfer Memo Item" itmi
		JOIN "tabInternal Transfer Memo" itm ON itmi.parent = itm.name
		JOIN latest_reports lr ON lr.project = itm.source_project
		WHERE itm.status IN ('Dispatched', 'Partially Delivered', 'Delivered')
		  AND itm.dispatched_on > lr.modified
		GROUP BY itm.source_project, itmi.item_id, itmi.make
	)
	SELECT
		ri.project AS source_project,
		p.project_name AS source_project_name,
		ri.rir_name AS latest_rir,
		ri.item_id,
		ri.item_name,
		ri.unit,
		ri.category,
		ri.make,
		ri.remaining_quantity,
		COALESCE(rq.reserved, 0) AS reserved_quantity,
		GREATEST(ri.remaining_quantity - COALESCE(rq.reserved, 0) - COALESCE(dd.deducted_qty, 0), 0) AS available_quantity,
		COALESCE(mr.max_quote, 0) AS estimated_rate,
		COALESCE(pn.po_list, ARRAY[]::text[]) AS po_refs
	FROM report_items ri
	JOIN "tabProjects" p ON p.name = ri.project
	LEFT JOIN max_rates mr
		ON mr.project = ri.project
		AND mr.item_id = ri.item_id
		AND mr.make IS NOT DISTINCT FROM ri.make
	LEFT JOIN po_numbers pn
		ON pn.project = ri.project
		AND pn.item_id = ri.item_id
		AND pn.make IS NOT DISTINCT FROM ri.make
	LEFT JOIN reserved_qty rq
		ON rq.project = ri.project
		AND rq.item_id = ri.item_id
		AND rq.make IS NOT DISTINCT FROM ri.make
	LEFT JOIN dispatched_itm_deductions dd
		ON dd.project = ri.project
		AND dd.item_id = ri.item_id
		AND dd.make IS NOT DISTINCT FROM ri.make
	WHERE GREATEST(ri.remaining_quantity - COALESCE(rq.reserved, 0) - COALESCE(dd.deducted_qty, 0), 0) > 0
	  {search_clause}
	ORDER BY ri.item_name ASC, available_quantity DESC
	"""

	params: dict = {}
	if like_pattern:
		search_clause = "AND ri.item_name ILIKE %(search)s"
		params["search"] = like_pattern
	else:
		search_clause = ""

	rows = frappe.db.sql(sql.format(search_clause=search_clause), params, as_dict=True)

	# Group flat rows into a tree keyed by `item_id` (clubbed view): one
	# parent node per item, with each `(source_project, make)` pair as a
	# separate source underneath. The frontend renders a small badge on the
	# parent row indicating how many distinct makes are clubbed.
	#
	# Note: the SQL above already keys availability / reservations / dispatch
	# deductions / max-rates / po_numbers by `(project, item, make)`, so the
	# numbers per source are make-correct even though the parent clubs them.
	tree: "OrderedDict[str, dict]" = OrderedDict()
	for row in rows:
		available = float(row.get("available_quantity") or 0)
		if available <= 0:
			# Defense in depth; SQL already filters these out.
			continue

		estimated_rate = float(row.get("estimated_rate") or 0)
		estimated_cost = available * estimated_rate
		po_refs = list(row.get("po_refs") or [])

		source = {
			"source_project": row["source_project"],
			"source_project_name": row.get("source_project_name") or row["source_project"],
			"make": row.get("make"),
			"remaining_quantity": float(row.get("remaining_quantity") or 0),
			"reserved_quantity": float(row.get("reserved_quantity") or 0),
			"available_quantity": available,
			"estimated_rate": estimated_rate,
			"estimated_cost": estimated_cost,
			"po_refs": po_refs,
			"latest_rir": row.get("latest_rir"),
		}

		node = tree.get(row["item_id"])
		if node is None:
			node = {
				"item_id": row["item_id"],
				"item_name": row.get("item_name") or row["item_id"],
				"unit": row.get("unit"),
				"category": row.get("category"),
				"projects_count": 0,
				"pos_count": 0,
				"total_remaining_qty": 0.0,
				"total_estimated_cost": 0.0,
				"sources": [],
				"_po_set": set(),
			}
			tree[row["item_id"]] = node

		node["sources"].append(source)
		node["projects_count"] += 1
		node["total_remaining_qty"] += available
		node["total_estimated_cost"] += estimated_cost
		node["_po_set"].update(po_refs)

	result = []
	for node in tree.values():
		node["pos_count"] = len(node.pop("_po_set"))
		result.append(node)

	return result
