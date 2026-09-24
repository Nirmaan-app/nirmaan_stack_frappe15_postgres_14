# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `vendor_category_sync.py` -- the write and the daily window, on fixture rows only.

These suites run against the LIVE site DB, so nothing here calls `rebuild_all(apply=True)` or
`sync_daily(apply=True)`: both would rewrite every real vendor. The write and the query are exercised
directly on throwaway vendors / WOs that `purge` removes.

Run:  bench --site localhost run-tests --module nirmaan_stack.tasks.test_vendor_category_sync
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from nirmaan_stack.tasks.vendor_category_sync import _order_pairs, _write

U = "Administrator"
PREFIX = "TEST-VCS-"
PAST = "2025-01-01 10:00:00"


class _Fixture:
    def __init__(self):
        self.projects, self.vendors, self.srs = [], [], []

    def _name(self, kind):
        return f"{PREFIX}{kind}-{frappe.generate_hash(length=8)}"

    def project(self):
        name = self._name("PROJ")
        frappe.db.sql(
            """INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner, docstatus, idx,
                   project_name, status, tendering_status)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 'Created', 'Won')""",
            (name, U, U, name),
        )
        self.projects.append(name)
        return name

    def vendor(self, categories):
        name = self._name("VEN")
        frappe.db.sql(
            """INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner, docstatus, idx,
                   vendor_name, vendor_type, vendor_category)
               VALUES (%s, %s, %s, %s, %s, 0, 0, %s, 'Service', %s)""",
            (name, PAST, PAST, U, U, name, json.dumps({"categories": categories})),
        )
        self.vendors.append(name)
        return frappe._dict(name=name, vendor_name=name)

    def work_order(self, project, vendor, category, status="Approved"):
        name = self._name("SR")
        frappe.db.sql(
            """INSERT INTO "tabService Requests" (name, creation, modified, modified_by, owner, docstatus,
                   idx, project, vendor, status, gst, total_amount, amount_paid)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, 'true', 100, 0)""",
            (name, U, U, project, vendor, status),
        )
        frappe.db.sql(
            """INSERT INTO "tabWork Order Items" (name, creation, modified, modified_by, owner, docstatus,
                   idx, parent, parenttype, parentfield, item_name, category, uom, quantity, rate)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 1, %s, 'Service Requests', 'work_order_items',
                   'Test work', %s, 'Nos', 1, 100)""",
            (self._name("WOI"), U, U, name, category),
        )
        self.srs.append(name)
        return name

    def purge(self):
        if self.srs:
            frappe.db.delete("Work Order Items", {"parent": ("in", self.srs)})
            frappe.db.delete("Service Requests", {"name": ("in", self.srs)})
        if self.vendors:
            frappe.db.delete("Vendor Category", {"vendor": ("in", self.vendors)})
            frappe.db.delete("Vendors", {"name": ("in", self.vendors)})
        if self.projects:
            frappe.db.delete("Projects", {"name": ("in", self.projects)})
        frappe.db.commit()


def _stored(vendor):
    raw = frappe.db.sql('select vendor_category::text from "tabVendors" where name = %s', vendor)[0][0]
    return json.loads(raw)["categories"]


def _rows(vendor):
    return set(frappe.get_all("Vendor Category", filters={"vendor": vendor}, pluck="category"))


class VendorCategorySyncTestCase(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user(U)
        self.fx = _Fixture()
        self.addCleanup(self.fx.purge)

    def test_write_stores_the_list_and_leaves_modified_alone(self):
        v = self.fx.vendor(["Old hand-picked"])
        _write(v, ["HVAC Ducting Services", "Wires & Cables"])

        self.assertEqual(_stored(v.name), ["HVAC Ducting Services", "Wires & Cables"])
        self.assertEqual(str(frappe.db.get_value("Vendors", v.name, "modified")), PAST)

    def test_a_wo_only_name_gets_no_vendor_category_row(self):
        # Vendor Category.category links to Category; "HVAC Ducting Services" lives in WO Service Category.
        v = self.fx.vendor([])
        _write(v, ["HVAC Ducting Services", "Wires & Cables"])
        self.assertEqual(_rows(v.name), {"Wires & Cables"})

    def test_rows_follow_a_replaced_list(self):
        v = self.fx.vendor([])
        _write(v, ["DX System", "Wires & Cables"])
        _write(v, ["DX System"])
        self.assertEqual(_rows(v.name), {"DX System"})

    def test_daily_window_picks_a_wo_touched_since(self):
        project = self.fx.project()
        v = self.fx.vendor([])
        self.fx.work_order(project, v.name, "HVAC Ducting Services")

        self.assertIn((v.name, "HVAC Ducting Services", "wo"), set(_order_pairs(today())))
        self.assertNotIn((v.name, "HVAC Ducting Services", "wo"), set(_order_pairs(add_days(today(), 1))))

    def test_a_rejected_wo_does_not_count(self):
        project = self.fx.project()
        v = self.fx.vendor([])
        self.fx.work_order(project, v.name, "HVAC Ducting Services", status="Rejected")
        self.assertNotIn((v.name, "HVAC Ducting Services", "wo"), set(_order_pairs(today())))
