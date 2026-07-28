# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rate-master READ endpoints (RM-1).

Two login-required, active-only read endpoints over the RM-1 doctypes:
  - get_rate_master_items(discipline, kind=None) -> active items for the discipline (+kind).
  - get_rate_category_config(discipline, category_id) -> the active per-category config.

RM-1 ships NO write endpoint -- the import runs service-side (services/boq_rate_master/loader.py)
and the editors are RM-4. (Deliberately avoids `from frappe import _` to sidestep translator
shadowing; user-facing strings are passed plain.)
"""

import json

import frappe

ITEM_DOCTYPE = "BoQ Rate Master Item"
CONFIG_DOCTYPE = "BoQ Rate Category Config"


def _require_login():
    """Reject unauthenticated (Guest) callers. The HTTP layer already blocks Guest for a
    non-allow_guest whitelist method; this makes the guard explicit + unit-testable."""
    if frappe.session.user in (None, "", "Guest"):
        frappe.throw("Login required.", frappe.PermissionError)


def _parse_json(value, default):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


@frappe.whitelist()
def get_rate_master_items(discipline=None, kind=None):
    """Active rate-master items for a discipline, optionally narrowed to a kind. Attributes +
    rates are returned as parsed objects."""
    _require_login()
    if not discipline:
        frappe.throw("discipline is required.")

    filters = {"discipline": discipline, "active": 1}
    if kind:
        filters["kind"] = kind

    rows = frappe.get_all(
        ITEM_DOCTYPE,
        filters=filters,
        fields=[
            "name",
            "discipline",
            "kind",
            "brand",
            "unit",
            "attributes",
            "rates",
            "source_sheet",
            "source_row",
            "import_batch",
        ],
        order_by="kind asc, source_row asc",
    )
    for r in rows:
        r["attributes"] = _parse_json(r.get("attributes"), {})
        r["rates"] = _parse_json(r.get("rates"), {})

    return {
        "discipline": discipline,
        "kind": kind,
        "count": len(rows),
        "items": rows,
    }


@frappe.whitelist()
def get_rate_category_config(discipline=None, category_id=None):
    """The active per-category config for (discipline, category_id). config is parsed. Returns
    config=None when no active config exists."""
    _require_login()
    if not discipline or not category_id:
        frappe.throw("discipline and category_id are required.")

    rows = frappe.get_all(
        CONFIG_DOCTYPE,
        filters={"discipline": discipline, "category_id": category_id, "active": 1},
        fields=["name", "discipline", "category_id", "config", "source_workbook", "import_batch"],
        order_by="modified desc",
        limit=1,
    )
    if not rows:
        return {"discipline": discipline, "category_id": category_id, "config": None}

    row = rows[0]
    row["config"] = _parse_json(row.get("config"), None)
    return row
