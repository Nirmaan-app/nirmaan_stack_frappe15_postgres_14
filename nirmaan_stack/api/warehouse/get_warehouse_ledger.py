"""
List endpoint for Warehouse Stock Ledger entries.

Conforms to the standard envelope consumed by ``useServerDataTable`` so the
frontend can sort/filter/search/paginate server-side, matching the pattern
used by ``get_itms_list`` / ``get_itrs_list``.
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

_ORDER_BY_FIELDS = {
	"creation": "wsl.creation",
	"date": "wsl.date",
	"item_id": "wsl.parent",
	"item_name": "wsi.item_name",
	"impact": "wsl.impact",
	"quantity": "wsl.quantity",
	"docname_ref": "wsl.docname_ref",
	"source_project": "wsl.source_project",
	"target_project": "wsl.target_project",
}

_FILTER_FIELDS = {
	"item_id": "wsl.parent",
	"item_name": "wsi.item_name",
	"impact": "wsl.impact",
	"source_project": "wsl.source_project",
	"target_project": "wsl.target_project",
	"doctype_ref": "wsl.doctype_ref",
	"docname_ref": "wsl.docname_ref",
	"date": "wsl.date",
	"creation": "wsl.creation",
}


@frappe.whitelist()
def get_warehouse_ledger(
	doctype: str | None = None,
	fields: str | list | None = None,
	filters: str | list | None = "[]",
	order_by: str | None = "creation desc",
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
	"""Return paginated warehouse stock ledger rows.

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

	# --- Search: ILIKE across item id, item name, ref doc, impact ---
	if search_term and isinstance(search_term, str) and search_term.strip():
		tokens = search_term.strip().split()
		for t_idx, token in enumerate(tokens):
			token_key = f"s_{t_idx}"
			conditions.append(
				f"(wsl.parent ILIKE %({token_key})s "
				f"OR wsi.item_name ILIKE %({token_key})s "
				f"OR wsl.docname_ref ILIKE %({token_key})s)"
			)
			values[token_key] = f"%{token}%"

	where_clause = " AND ".join(conditions)
	order_clause = _build_order_clause(order_by)

	data_sql = f"""
		SELECT
			wsl.parent AS item_id,
			wsi.item_name,
			wsi.unit,
			wsl.doctype_ref,
			wsl.docname_ref,
			wsl.source_project,
			COALESCE(src.project_name, wsl.source_project) AS source_project_name,
			wsl.target_project,
			COALESCE(tgt.project_name, wsl.target_project) AS target_project_name,
			wsl.impact,
			wsl.quantity,
			wsl.date,
			wsl.creation,
			wsl.modified,
			wsl.name
		FROM "tabWarehouse Stock Ledger" wsl
		JOIN "tabWarehouse Stock Item" wsi ON wsi.name = wsl.parent
		LEFT JOIN "tabProjects" src ON src.name = wsl.source_project
		LEFT JOIN "tabProjects" tgt ON tgt.name = wsl.target_project
		WHERE {where_clause}
		{order_clause}
		LIMIT %(_limit)s OFFSET %(_offset)s
	"""
	values["_limit"] = page_length
	values["_offset"] = start

	data = frappe.db.sql(data_sql, values, as_dict=True)

	count_sql = f"""
		SELECT COUNT(*)
		FROM "tabWarehouse Stock Ledger" wsl
		JOIN "tabWarehouse Stock Item" wsi ON wsi.name = wsl.parent
		LEFT JOIN "tabProjects" src ON src.name = wsl.source_project
		LEFT JOIN "tabProjects" tgt ON tgt.name = wsl.target_project
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
	default = "ORDER BY wsl.creation DESC"
	if not order_by or not isinstance(order_by, str):
		return default

	parts = order_by.strip().split()
	if not parts:
		return default

	field_raw = parts[0].strip("`")
	if "." in field_raw:
		field_raw = field_raw.rsplit(".", 1)[-1].strip("`")

	direction = "DESC"
	if len(parts) > 1 and parts[1].strip(",").upper() in ("ASC", "DESC"):
		direction = parts[1].strip(",").upper()

	sql_field = _ORDER_BY_FIELDS.get(field_raw)
	if not sql_field:
		return default
	return f"ORDER BY {sql_field} {direction}"
