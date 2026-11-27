import json
import frappe

# Seed for walk_branch_planning_and_projects_info.py: the 11 made-up Cashflow Plan rows it needs on CTS Chennai (the copied database has none). Run with
# `devenv.sh script <env> <this file>` on both envs; every row's remarks end "(walk data)".
P = "KANCHIPURAM-PROJ-00107"
TAG = " (walk data)"
assert frappe.db.count("Cashflow Plan", {"project": P}) == 0, "project already has cashflow rows; seeded before"


def po_entry(po, date, planned):
    d = frappe.get_doc("Procurement Orders", po)
    cpo = d.critical_po_tasks[0] if d.get("critical_po_tasks") else None
    task = frappe.db.get_value("Critical PO Tasks", cpo.critical_po_task,
                               ["critical_po_category", "item_name", "sub_category"], as_dict=True) \
        if cpo and cpo.get("critical_po_task") else None
    items = [{"name": r.name, "item_id": r.item_id, "item_name": r.item_name, "category": r.category} for r in d.items]
    return dict(type="Existing PO", id_link=po, vendor=d.vendor, vendor_name=d.vendor_name,
                critical_po_category=task.critical_po_category if task else None,
                critical_po_task=task.item_name if task else None,
                critical_po_sub_category=(task.sub_category or None) if task else None,
                planned_date=date, planned_amount=planned, estimated_price=0,
                items=json.dumps({"list": items}), remarks="Balance payment after delivery" + TAG)


def wo_entry(sr, date, planned):
    v = frappe.db.get_value("Service Requests", sr, "vendor")
    items = frappe.get_all("Work Order Items", filters={"parent": sr, "parenttype": "Service Requests"},
                           fields=["item_name", "category"])
    return dict(type="Existing WO", id_link=sr, vendor=v, vendor_name=frappe.db.get_value("Vendors", v, "vendor_name"),
                planned_date=date, planned_amount=planned, estimated_price=0,
                items=json.dumps({"list": [{"description": i.item_name, "category": i.category} for i in items]}),
                remarks="Pay on bill submission" + TAG)


rows = [
    po_entry("PO/149/00107/26-27", "2026-12-05", 10350),
    po_entry("PO/145/00107/26-27", "2026-12-10", 15000),
    po_entry("PO/152/00107/26-27", "2026-12-12", 1032),
    dict(type="New PO", id_link="", vendor="", vendor_name="Havells India Ltd",
         critical_po_category="HVAC Piping", critical_po_task="Refnet", critical_po_sub_category=None,
         planned_date="2026-12-18", planned_amount=40000, estimated_price=85000,
         items=json.dumps({"list": [
             {"name": "manual-seed-0", "item_id": "TEMP-seed-0", "item_name": "Refnet joint kit", "category": ""},
             {"name": "manual-seed-1", "item_id": "TEMP-seed-1", "item_name": "Copper pipe 12.7mm", "category": ""}]}),
         remarks="Second floor VRF piping" + TAG),
    wo_entry("SR-00107-001159", "2026-12-06", 4150),
    wo_entry("SR-00107-001158", "2026-12-08", 7670),
    dict(type="New WO", id_link="", vendor="", vendor_name="Kumar Scaffolding Works",
         planned_date="2026-12-15", planned_amount=18000, estimated_price=36000,
         items=json.dumps({"list": [{"description": "Scaffolding rental for ceiling ducting - 2 weeks", "category": ""}]}),
         remarks="Scaffolding rental for ceiling ducting - 2 weeks" + TAG),
    dict(type="Misc", planned_date="2026-12-01", planned_amount=25000, remarks="Labour accommodation rent - December" + TAG),
    dict(type="Misc", planned_date="2026-12-20", planned_amount=8000, remarks="Diesel for DG set during power shutdown" + TAG),
    dict(type="Inflow", planned_date="2026-12-14", planned_amount=1500000, remarks="Client RA Bill 3 payment from CTS" + TAG),
    dict(type="Inflow", planned_date="2026-12-28", planned_amount=300000, remarks="Advance against variation order VO-02" + TAG),
]
for r in rows:
    frappe.get_doc({"doctype": "Cashflow Plan", "project": P, **r}).insert()
frappe.db.commit()
print("created:", len(rows), "| project now has:", frappe.db.count("Cashflow Plan", {"project": P}))
