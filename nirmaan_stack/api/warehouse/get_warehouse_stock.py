"""
List endpoint for per-item warehouse stock.

Conforms to the standard envelope consumed by ``useServerDataTable`` so the
frontend can sort/filter/search/paginate server-side, matching the pattern
used by ``get_itms_list`` / ``get_itrs_list``.

On-hand stock is read from ``Warehouse Stock Item`` (updated by ITM delivery
for inward, ITM dispatch for outward). Reservations come from Approved ITMs
not yet dispatched and Pending/Approved ITRs from warehouse.
"""

import json
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint

from nirmaan_stack.api.data_table.constants import (
	DEFAULT_PAGE_LENGTH,
	EXPORT_MAX_PAGE_LENGTH,
	MAX_PAGE_LENGTH,
)


DOCTYPE = "Warehouse Stock Item"

# Whitelist of sortable columns → SQL expression. Keeps ORDER BY clauses
# injection-safe while still letting the frontend sort by joined labels.
_ORDER_BY_FIELDS = {
	"item_id": "w.item_id",
	"item_name": "w.item_name",
	"category": "w.category",
	"unit": "w.unit",
	"make": "w.make",
	"current_stock": "w.current_stock",
	"total_reserved": "total_reserved",
	"available_quantity": "available_quantity",
	"estimated_rate": "w.estimated_rate",
	"estimated_value": "estimated_value",
	"creation": "w.creation",
	"modified": "w.modified",
}

# Whitelist of filter fields → SQL expression.
_FILTER_FIELDS = {
	"item_id": "w.item_id",
	"item_name": "w.item_name",
	"category": "w.category",
	"unit": "w.unit",
	"make": "w.make",
	"creation": "w.creation",
	"modified": "w.modified",
}


@frappe.whitelist()
def get_warehouse_stock(
	doctype: str | None = None,
	fields: str | list | None = None,
	filters: str | list | None = "[]",
	order_by: str | None = "item_name asc",
	limit_start: int | str = 0,
	limit_page_length: int | str | None = None,
	search_term: str | None = None,
	current_search_fields: str | None = None,
	is_item_search: bool | str = False,
	require_pending_items: bool | str = False,
	to_cache: bool | str = False,
	aggregates_config: str | None = None,
	group_by_config: str | None = None,
	for_export: bool | str = False,
	**kwargs: Any,
) -> dict:
	"""Return paginated warehouse stock rows.

	Returns:
	    ``{"data": [...rows...], "total_count": int, "aggregates": {},
	       "group_by_result": []}``
	"""

	if frappe.session.user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)

	if not frappe.has_permission(DOCTYPE, "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	for_export_bool = _to_bool(for_export)
	effective_max = EXPORT_MAX_PAGE_LENGTH if for_export_bool else MAX_PAGE_LENGTH
	start = cint(limit_start) or 0

	if for_export_bool and cint(limit_page_length or 0) == 0:
		page_length = EXPORT_MAX_PAGE_LENGTH
	else:
		page_length = min(
			cint(limit_page_length or DEFAULT_PAGE_LENGTH),
			effective_max,
		)

	# --- Build WHERE clauses ---
	conditions: list[str] = ["1=1"]
	values: dict[str, Any] = {}

	parsed_filters = _parse_filters(filters)
	for idx, (field, operator, value) in enumerate(parsed_filters):
		sql_expr = _FILTER_FIELDS.get(field)
		if not sql_expr:
			continue

		op = (operator or "=").lower()
		value_key = f"f_{idx}"

		if op == "in":
			if not isinstance(value, (list, tuple)) or len(value) == 0:
				continue
			conditions.append(f"{sql_expr} IN %({value_key})s")
			values[value_key] = tuple(value)
		elif op == "not in":
			if not isinstance(value, (list, tuple)) or len(value) == 0:
				continue
			conditions.append(f"{sql_expr} NOT IN %({value_key})s")
			values[value_key] = tuple(value)
		elif op == "like":
			conditions.append(f"{sql_expr} ILIKE %({value_key})s")
			values[value_key] = value if (isinstance(value, str) and "%" in value) else f"%{value}%"
		elif op in ("=", "!=", ">", ">=", "<", "<="):
			conditions.append(f"{sql_expr} {op} %({value_key})s")
			values[value_key] = value
		elif op == "is":
			if str(value).lower() in ("set",):
				conditions.append(f"{sql_expr} IS NOT NULL AND {sql_expr} != ''")
			else:
				conditions.append(f"({sql_expr} IS NULL OR {sql_expr} = '')")
		else:
			conditions.append(f"{sql_expr} = %({value_key})s")
			values[value_key] = value

	# --- Search: ILIKE across item_id / item_name / make / category ---
	if search_term and isinstance(search_term, str) and search_term.strip():
		tokens = search_term.strip().split()
		for t_idx, token in enumerate(tokens):
			token_key = f"s_{t_idx}"
			conditions.append(
				f"(w.item_id ILIKE %({token_key})s "
				f"OR w.item_name ILIKE %({token_key})s "
				f"OR w.make ILIKE %({token_key})s "
				f"OR w.category ILIKE %({token_key})s)"
			)
			values[token_key] = f"%{token}%"

	# Stock page never shows zero-stock rows
	conditions.append("w.current_stock > 0")

	where_clause = " AND ".join(conditions)
	order_clause = _build_order_clause(order_by)

	# --- Main query (data + computed columns) ---
	data_sql = f"""
		WITH itm_approved AS (
			SELECT itmi.item_id, itmi.make, SUM(itmi.transfer_quantity) AS reserved_itm
			FROM "tabInternal Transfer Memo Item" itmi
			JOIN "tabInternal Transfer Memo" itm ON itmi.parent = itm.name
			WHERE itm.source_type = 'Warehouse'
			  AND itm.status = 'Approved'
			GROUP BY itmi.item_id, itmi.make
		),
		itr_reserved AS (
			SELECT itri.item_id, itri.make, SUM(itri.transfer_quantity) AS reserved_itr
			FROM "tabInternal Transfer Request Item" itri
			JOIN "tabInternal Transfer Request" itr ON itri.parent = itr.name
			WHERE itr.source_type = 'Warehouse'
			  AND itri.status IN ('Pending', 'Approved')
			  AND NOT EXISTS (
			      SELECT 1 FROM "tabInternal Transfer Memo" itm_chk
			      WHERE itm_chk.name = itri.linked_itm
			        AND itm_chk.status IN ('Approved', 'Dispatched', 'Partially Delivered', 'Delivered')
			  )
			GROUP BY itri.item_id, itri.make
		),
		base AS (
			SELECT
				wsi.name,
				wsi.item_id,
				wsi.item_name,
				wsi.unit,
				wsi.category,
				wsi.make,
				wsi.quantity AS current_stock,
				wsi.estimated_rate,
				wsi.creation,
				wsi.modified,
				(COALESCE(a.reserved_itm, 0) + COALESCE(r.reserved_itr, 0)) AS total_reserved,
				GREATEST(wsi.quantity - COALESCE(a.reserved_itm, 0) - COALESCE(r.reserved_itr, 0), 0) AS available_quantity,
				(wsi.quantity * wsi.estimated_rate) AS estimated_value
			FROM "tabWarehouse Stock Item" wsi
			LEFT JOIN itm_approved a ON a.item_id = wsi.item_id AND a.make IS NOT DISTINCT FROM wsi.make
			LEFT JOIN itr_reserved r ON r.item_id = wsi.item_id AND r.make IS NOT DISTINCT FROM wsi.make
		)
		SELECT *
		FROM base w
		WHERE {where_clause}
		{order_clause}
		LIMIT %(_limit)s OFFSET %(_offset)s
	"""
	values["_limit"] = page_length
	values["_offset"] = start

	data = frappe.db.sql(data_sql, values, as_dict=True)

	# --- Count query (share WHERE, drop pagination args) ---
	count_sql = f"""
		WITH itm_approved AS (
			SELECT itmi.item_id, itmi.make, SUM(itmi.transfer_quantity) AS reserved_itm
			FROM "tabInternal Transfer Memo Item" itmi
			JOIN "tabInternal Transfer Memo" itm ON itmi.parent = itm.name
			WHERE itm.source_type = 'Warehouse'
			  AND itm.status = 'Approved'
			GROUP BY itmi.item_id, itmi.make
		),
		itr_reserved AS (
			SELECT itri.item_id, itri.make, SUM(itri.transfer_quantity) AS reserved_itr
			FROM "tabInternal Transfer Request Item" itri
			JOIN "tabInternal Transfer Request" itr ON itri.parent = itr.name
			WHERE itr.source_type = 'Warehouse'
			  AND itri.status IN ('Pending', 'Approved')
			  AND NOT EXISTS (
			      SELECT 1 FROM "tabInternal Transfer Memo" itm_chk
			      WHERE itm_chk.name = itri.linked_itm
			        AND itm_chk.status IN ('Approved', 'Dispatched', 'Partially Delivered', 'Delivered')
			  )
			GROUP BY itri.item_id, itri.make
		),
		base AS (
			SELECT
				wsi.name,
				wsi.item_id,
				wsi.item_name,
				wsi.unit,
				wsi.category,
				wsi.make,
				wsi.quantity AS current_stock,
				wsi.estimated_rate,
				wsi.creation,
				wsi.modified,
				(COALESCE(a.reserved_itm, 0) + COALESCE(r.reserved_itr, 0)) AS total_reserved,
				GREATEST(wsi.quantity - COALESCE(a.reserved_itm, 0) - COALESCE(r.reserved_itr, 0), 0) AS available_quantity,
				(wsi.quantity * wsi.estimated_rate) AS estimated_value
			FROM "tabWarehouse Stock Item" wsi
			LEFT JOIN itm_approved a ON a.item_id = wsi.item_id AND a.make IS NOT DISTINCT FROM wsi.make
			LEFT JOIN itr_reserved r ON r.item_id = wsi.item_id AND r.make IS NOT DISTINCT FROM wsi.make
		)
		SELECT COUNT(*)
		FROM base w
		WHERE {where_clause}
	"""
	count_values = {k: v for k, v in values.items() if k not in ("_limit", "_offset")}
	total_count = frappe.db.sql(count_sql, count_values)[0][0]

	return {
		"data": data,
		"total_count": total_count,
		"aggregates": {},
		"group_by_result": [],
	}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_bool(value: Any) -> bool:
	if isinstance(value, bool):
		return value
	if isinstance(value, str):
		return value.strip().lower() in ("true", "1", "yes")
	if isinstance(value, (int, float)):
		return bool(value)
	return False


def _parse_filters(filters: Any) -> list[tuple[str, str, Any]]:
	"""Parse the filter envelope into ``(field, operator, value)`` tuples.

	Accepts the same shapes as ``get_itms_list._parse_filters``.
	"""
	if not filters:
		return []

	parsed: Any = filters
	if isinstance(filters, str):
		try:
			parsed = json.loads(filters)
		except (json.JSONDecodeError, ValueError):
			return []

	if not isinstance(parsed, list):
		return []

	result: list[tuple[str, str, Any]] = []
	for item in parsed:
		if isinstance(item, list):
			if len(item) == 3:
				field, op, value = item[0], item[1], item[2]
			elif len(item) == 4:
				if isinstance(item[0], str) and frappe.db.exists("DocType", item[0]):
					field, op, value = item[1], item[2], item[3]
				else:
					field, op, value = item[0], item[1], item[2]
			else:
				continue
			if isinstance(field, str) and field.strip():
				result.append((field.strip(), str(op or "=").strip(), value))
		elif isinstance(item, dict) and "id" in item and "value" in item:
			field = item["id"]
			raw = item["value"]
			if isinstance(raw, list):
				if len(raw) > 0:
					result.append((field, "in", raw))
			elif isinstance(raw, dict) and "operator" in raw and "value" in raw:
				result.append((field, raw["operator"], raw["value"]))
			elif isinstance(raw, str):
				if raw.strip():
					result.append((field, "like", raw))
			else:
				result.append((field, "=", raw))
	return result


def _build_order_clause(order_by: str | None) -> str:
	default = "ORDER BY w.item_name ASC"
	if not order_by or not isinstance(order_by, str):
		return default

	parts = order_by.strip().split()
	if not parts:
		return default

	field_raw = parts[0].strip("`")
	if "." in field_raw:
		field_raw = field_raw.rsplit(".", 1)[-1].strip("`")

	direction = "ASC"
	if len(parts) > 1 and parts[1].strip(",").upper() in ("ASC", "DESC"):
		direction = parts[1].strip(",").upper()

	sql_field = _ORDER_BY_FIELDS.get(field_raw)
	if not sql_field:
		return default
	return f"ORDER BY {sql_field} {direction}"
