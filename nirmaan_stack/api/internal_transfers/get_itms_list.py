"""
DataTable-backed list endpoint for Internal Transfer Memos.

Powers the 6-tab sidebar view (Pending Approval / Rejected / All Requests /
Approved / Dispatched / Delivered) via ``useServerDataTable`` on the frontend.
Accepts the same query envelope as the generic
``nirmaan_stack.api.data-table.get_list_with_count_enhanced`` so the hook can
be wired by overriding its ``apiEndpoint`` prop alone — and layers on SQL
joins against ``Projects`` + ``User`` to return the display names the list
columns need without N+1 fetches.

Respects the ``for_export`` escape hatch (capped at
``EXPORT_MAX_PAGE_LENGTH``) and defers Frappe-level read permissions to
``frappe.has_permission`` on the parent doctype.
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


DOCTYPE = "Internal Transfer Memo"

# Whitelist of sortable columns → SQL expression. Keeps ORDER BY clauses
# injection-safe while still letting the frontend sort by joined labels.
_ORDER_BY_FIELDS = {
	"name": "itm.name",
	"creation": "itm.creation",
	"modified": "itm.modified",
	"status": "itm.status",
	"source_project": "itm.source_project",
	"source_project_name": "src.project_name",
	"target_project": "itm.target_project",
	"target_project_name": "tgt.project_name",
	"estimated_value": "itm.estimated_value",
	"total_items": "itm.total_items",
	"total_quantity": "itm.total_quantity",
	"requested_by": "itm.requested_by",
	"requested_by_full_name": "usr.full_name",
	"approved_on": "itm.approved_on",
	"transfer_request": "itm.transfer_request",
}

# Frappe filter field → SQL expression, constrains which fields the
# frontend can push filters against (scalar-only; multi-value uses IN).
_FILTER_FIELDS = {
	"name": "itm.name",
	"status": "itm.status",
	"source_project": "itm.source_project",
	"target_project": "itm.target_project",
	"requested_by": "itm.requested_by",
	"approved_by": "itm.approved_by",
	"creation": "itm.creation",
	"modified": "itm.modified",
	"transfer_request": "itm.transfer_request",
}


@frappe.whitelist()
def get_itms_list(
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
	"""Return paginated ITM rows with joined project/user display names.

	Args mirror the generic ``get_list_with_count_enhanced`` envelope for
	drop-in compatibility with ``useServerDataTable``. Only fields relevant
	to ITMs are honoured; aggregates/group_by are accepted for signature
	parity but not implemented (no Phase 1 need).

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
			# Silently skip unknown fields rather than reject the whole request.
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
			# Frappe clients may already send %-wrapped value from converter; normalise.
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
			# Fallback to equality for unrecognised operators.
			conditions.append(f"{sql_expr} = %({value_key})s")
			values[value_key] = value

	# --- Search: ILIKE across ITM name + joined project names ---
	if search_term and isinstance(search_term, str) and search_term.strip():
		tokens = search_term.strip().split()
		for t_idx, token in enumerate(tokens):
			token_key = f"s_{t_idx}"
			conditions.append(
				f"(itm.name ILIKE %({token_key})s "
				f"OR src.project_name ILIKE %({token_key})s "
				f"OR tgt.project_name ILIKE %({token_key})s)"
			)
			values[token_key] = f"%{token}%"

	where_clause = " AND ".join(conditions)
	order_clause = _build_order_clause(order_by)

	# --- Main query ---
	data_sql = f"""
		SELECT
			itm.name,
			itm.creation,
			itm.modified,
			itm.status,
			itm.source_type,
			itm.source_project,
			CASE WHEN itm.source_type = 'Warehouse' THEN 'Warehouse' ELSE src.project_name END AS source_project_name,
			itm.target_type,
			itm.target_project,
			CASE WHEN itm.target_type = 'Warehouse' THEN 'Warehouse' ELSE tgt.project_name END AS target_project_name,
			itm.source_rir,
			itm.estimated_value,
			itm.total_items,
			itm.total_quantity,
			itm.requested_by,
			usr.full_name AS requested_by_full_name,
			itm.approved_by,
			appr.full_name AS approved_by_full_name,
			itm.approved_on,
			itm.rejection_reason,
			itm.dispatched_by,
			itm.dispatched_on,
			itm.latest_delivery_date,
			itm.owner,
			itm.transfer_request
		FROM "tabInternal Transfer Memo" itm
		LEFT JOIN "tabProjects" src ON src.name = itm.source_project
		LEFT JOIN "tabProjects" tgt ON tgt.name = itm.target_project
		LEFT JOIN "tabUser" usr ON usr.name = itm.requested_by
		LEFT JOIN "tabUser" appr ON appr.name = itm.approved_by
		WHERE {where_clause}
		{order_clause}
		LIMIT %(_limit)s OFFSET %(_offset)s
	"""
	values["_limit"] = page_length
	values["_offset"] = start

	data = frappe.db.sql(data_sql, values, as_dict=True)

	# --- Count query (share WHERE, drop pagination args) ---
	count_sql = f"""
		SELECT COUNT(*) AS total
		FROM "tabInternal Transfer Memo" itm
		LEFT JOIN "tabProjects" src ON src.name = itm.source_project
		LEFT JOIN "tabProjects" tgt ON tgt.name = itm.target_project
		LEFT JOIN "tabUser" usr ON usr.name = itm.requested_by
		LEFT JOIN "tabUser" appr ON appr.name = itm.approved_by
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

	Accepts:
	  - JSON string of a list
	  - list of ``[field, op, value]`` or ``[field, op, value, doctype]``
	  - list of ``[doctype, field, op, value]`` (Frappe's 4-tuple form)
	  - list of ``{"id": field, "value": ...}`` (TanStack column filter shape)
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
				# Either [doctype, field, op, value] or [field, op, value, doctype].
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
	default = 'ORDER BY itm.creation DESC'
	if not order_by or not isinstance(order_by, str):
		return default

	parts = order_by.strip().split()
	if not parts:
		return default

	# Strip backticks that Frappe sometimes prepends (e.g. `tabDoctype`.`field`).
	field_raw = parts[0].strip("`")
	# If the field includes a table prefix (``tabDoctype`.`field``), keep only the suffix.
	if "." in field_raw:
		field_raw = field_raw.rsplit(".", 1)[-1].strip("`")

	direction = "DESC"
	if len(parts) > 1 and parts[1].strip(",").upper() in ("ASC", "DESC"):
		direction = parts[1].strip(",").upper()

	sql_field = _ORDER_BY_FIELDS.get(field_raw)
	if not sql_field:
		return default
	return f"ORDER BY {sql_field} {direction}"
