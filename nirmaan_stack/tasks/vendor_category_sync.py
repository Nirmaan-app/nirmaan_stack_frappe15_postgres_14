# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Vendor categories from the POs and Work Orders a vendor actually supplied.

    sync_daily     the daily job, hooks.py `scheduler_events["cron"]` at 03:30. Orders touched since
                   yesterday 00:00 ADD their categories to their vendor -- nothing is ever removed.
    rebuild_all    run ONCE by the patch `v3_0.rebuild_vendor_categories_from_orders`: every vendor's
                   list REPLACED by what all its orders give (a vendor with no orders ends empty).
                   Dry run unless `apply=True`.

Which orders and which names count is `services/vendor_categories.py`.

⚠️ 03:30, BEFORE 04:00 (GST Hold) AND 04:30. The Vendor Hold credit job (`vendor_credit_update`)
loads and saves every vendor as a full row. This job does not move `modified`, so a write landing
between that job's load and its save would be silently put back -- no timestamp conflict to catch it.

⚠️ THE DAILY WINDOW IS THE ORDER'S `modified`, NOT `creation`. A WO is approved days after it is
created and a PO revision adds items after the PO exists; a creation window would miss both for good.
Re-reading an order is harmless because the daily run only adds.

The write is `frappe.db.set_value(update_modified=False)` -- owner ruling: this job must not move a
vendor's modified date. It therefore skips the Vendors doc_events, and the one thing they maintain,
the `Vendor Category` rows, is synced explicitly right after through the same `update_vendor_category`.
"""

import json

import frappe
from frappe.utils import add_days, today

from nirmaan_stack.nirmaan_stack.doctype.vendor_category.vendor_category import update_vendor_category
from nirmaan_stack.services.vendor_categories import (
    PO,
    PO_STATUSES,
    WO,
    WO_STATUSES,
    categories_by_vendor,
    merged,
)


def sync_daily(since=None, apply=True) -> dict:
    """The daily job: orders touched since `since` (default yesterday 00:00) add their categories."""
    return _run(since=since or add_days(today(), -1), replace=False, apply=apply)


def rebuild_all(apply=False) -> dict:
    """Every vendor's list := what all its orders give. Dry run unless `apply=True`."""
    return _run(since=None, replace=True, apply=apply)


def _run(since, replace, apply) -> dict:
    po_valid = set(frappe.get_all("Category", pluck="name"))
    wo_valid = po_valid | set(frappe.get_all("WO Service Category", pluck="name"))
    found, dropped = categories_by_vendor(_order_pairs(since), po_valid, wo_valid)

    vendors = {
        v.name: v
        for v in frappe.db.sql(
            'select name, vendor_name, vendor_category::text as vendor_category from "tabVendors"', as_dict=True
        )
    }
    targets = vendors if replace else [name for name in found if name in vendors]

    summary = {"mode": "rebuild" if replace else "daily", "since": since, "applied": bool(apply),
               "vendors_checked": len(targets), "changed": 0, "gained": 0, "lost": 0, "emptied": 0,
               "categories_added": 0, "dropped_names": dict(sorted(dropped.items(), key=lambda kv: -kv[1]))}
    for name in sorted(targets):
        old = _stored_categories(vendors[name].vendor_category)
        new = merged(old, found.get(name, ()), replace)
        if set(new) == set(old):
            continue
        summary["changed"] += 1
        summary["gained"] += bool(set(new) - set(old))
        summary["lost"] += bool(set(old) - set(new))
        summary["emptied"] += not new
        summary["categories_added"] += len(set(new) - set(old))
        if apply:
            _write(vendors[name], new)

    if apply:
        frappe.db.commit()
    frappe.logger("vendor_category_sync").info(summary)
    return summary


def _order_pairs(since):
    """Distinct (vendor, category, source) over qualifying PO and WO item rows."""
    window = {"po": "", "wo": ""}
    if since:
        window = {"po": "and p.modified >= %(since)s", "wo": "and s.modified >= %(since)s"}
    return frappe.db.sql(
        f"""
        select distinct p.vendor, i.category, %(po_source)s
          from "tabPurchase Order Item" i
          join "tabProcurement Orders" p on p.name = i.parent
         where i.parenttype = 'Procurement Orders'
           and p.status in %(po_statuses)s
           and coalesce(p.vendor, '') <> ''
           {window["po"]}
        union
        select distinct s.vendor, w.category, %(wo_source)s
          from "tabWork Order Items" w
          join "tabService Requests" s on s.name = w.parent
         where w.parenttype = 'Service Requests'
           and s.status in %(wo_statuses)s
           and coalesce(s.vendor, '') <> ''
           {window["wo"]}
        """,
        {"po_source": PO, "wo_source": WO, "po_statuses": PO_STATUSES, "wo_statuses": WO_STATUSES, "since": since},
    )


def _stored_categories(raw) -> list:
    try:
        data = json.loads(raw) if raw else {}
    except ValueError:
        return []
    return list(data.get("categories") or []) if isinstance(data, dict) else []


def _write(vendor, categories):
    value = {"categories": categories}
    # set_value skips the Vendors doc_events -- run their one job, the Vendor Category row sync, by hand.
    frappe.db.set_value("Vendors", vendor.name, "vendor_category", json.dumps(value), update_modified=False)
    update_vendor_category(frappe._dict(name=vendor.name, vendor_name=vendor.vendor_name, vendor_category=value))
