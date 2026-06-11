import frappe
import json
from frappe.utils import flt


def execute():
    """
    Backfill the `work_order_items` child table on every Service Requests
    document from the legacy `service_order_list` JSON field.

    JSON shape:
      {"list": [{"id", "category", "description", "uom", "quantity", "rate"}, ...]}

    Child rows store quantity and rate only — the line amount (qty × rate) is
    derived at read time wherever needed; no denormalized column.

    The JSON `id` UUID is intentionally NOT preserved — Frappe auto-generates
    each child row's `name` (primary key). This avoids primary-key collisions
    from duplicate UUIDs in historical data.

    Hooks bypass: rows are inserted via `Document.db_insert()` (direct SQL),
    so NONE of the following fire during this patch:
      - Service Requests `validate` / `on_update`
      - parent `save_version` (no Version records created)
      - the `Version.after_insert` hook in nirmaan_versions.py
      - any other doc-event hooks for Service Requests
    The parent's `modified` / `modified_by` are also left untouched because we
    never save the parent.

    Idempotent: skips SRs that already have child rows populated.
    """
    module_name = "Nirmaan Stack"
    frappe.reload_doc(module_name, "doctype", "service_requests", force=True)
    frappe.reload_doc(module_name, "doctype", "work_order_items", force=True)

    sr_doctype = "Service Requests"
    json_field = "service_order_list"
    child_doctype = "Work Order Items"
    parent_field = "work_order_items"

    sr_list = frappe.get_all(
        sr_doctype,
        fields=["name", json_field],
        order_by="creation asc",
    )

    if not sr_list:
        print("No Service Requests found. Patch complete.")
        return

    total = len(sr_list)
    migrated = 0
    skipped_already_done = 0
    skipped_empty_json = 0
    failed = 0
    failed_names = []

    print(f"Processing {total} Service Requests...")

    for sr in sr_list:
        sr_name = sr.get("name")
        try:
            existing_rows = frappe.db.count(
                child_doctype,
                {"parenttype": sr_doctype, "parent": sr_name},
            )
            if existing_rows:
                skipped_already_done += 1
                continue

            raw = sr.get(json_field)
            if not raw:
                skipped_empty_json += 1
                continue

            data = {}
            if isinstance(raw, str):
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    print(f"SR {sr_name}: invalid JSON in {json_field}, skipping.")
                    failed += 1
                    failed_names.append(sr_name)
                    continue
            elif isinstance(raw, dict):
                data = raw

            items = data.get("list", [])
            if not isinstance(items, list) or not items:
                skipped_empty_json += 1
                continue

            inserted_this_sr = 0
            for i, item in enumerate(items):
                if not isinstance(item, dict):
                    continue
                qty = flt(item.get("quantity"))
                rate = flt(item.get("rate"))

                child = frappe.new_doc(child_doctype)
                child.parent = sr_name
                child.parenttype = sr_doctype
                child.parentfield = parent_field
                child.idx = inserted_this_sr + 1
                child.item_name = item.get("description")
                child.category = item.get("category")
                child.uom = item.get("uom")
                child.quantity = qty
                child.rate = rate
                child.set_new_name()
                child.db_insert()   # raw SQL insert, no hooks, no version, no parent save
                inserted_this_sr += 1

            if inserted_this_sr == 0:
                skipped_empty_json += 1
                continue

            migrated += 1
            if migrated % 50 == 0:
                frappe.db.commit()
                print(f"Committed progress at {migrated}/{total}")

        except Exception:
            frappe.db.rollback()
            frappe.log_error(
                title=f"Backfill error: SR {sr_name}",
                message=frappe.get_traceback(),
            )
            failed += 1
            failed_names.append(sr_name)

    frappe.db.commit()
    print(
        f"Done. migrated={migrated}, already_populated={skipped_already_done}, "
        f"empty_json={skipped_empty_json}, failed={failed}, total={total}"
    )
    if failed:
        print(f"Failed SRs ({failed}): {', '.join(failed_names)}")
