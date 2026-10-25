# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for `reset_inventory`: every project's inventory and the warehouse go to 0.

What must hold:
  1. A project whose newest report is older than 3 days gets a new report of zeros dated 3 days
     ago; its old report is untouched, and a project manager can still file today's count.
  2. A project whose newest report is 3 days old or newer has that report zeroed in place.
  3. A Draft already on the zero date is zeroed and submitted, not duplicated.
  4. A project already at 0 is left alone, and a second run finds nothing to do.
  5. A warehouse item goes to 0 with one "Inventory Reset" ledger row for the amount.
  6. Report mode writes nothing.
  7. A report may follow yesterday's: the 3-day lock is gone.

RUNS AGAINST THE SITE DATABASE. Fixtures are written without commit (projects with `db_insert`,
which skips the Projects hooks that commit); tearDown rolls everything back.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from nirmaan_stack import reset_inventory as ri
from nirmaan_stack.api.remaining_items_report import submit_remaining_items_report
from nirmaan_stack.integrations.controllers.internal_transfer_memo import available_quantity

ITEM = "TEST-RESET-ITEM"


class TestResetInventory(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self.projects = []
        self.stock_items = []
        self.zero_date = add_days(today(), -ri.ZERO_REPORT_AGE_DAYS)

    def tearDown(self):
        frappe.db.rollback()

    def _project(self):
        name = f"TEST-RESET-{frappe.generate_hash(length=8)}"
        doc = frappe.get_doc({"doctype": "Projects", "project_name": name})
        doc.name = name
        doc.creation = doc.modified = frappe.utils.now()
        doc.owner = doc.modified_by = "Administrator"
        doc.db_insert()
        self.projects.append(name)
        return name

    def _report(self, project, report_date, qty, status="Submitted"):
        doc = frappe.new_doc("Remaining Items Report")
        doc.project = project
        doc.report_date = report_date
        doc.status = status
        doc.append("items", {"item_id": ITEM, "item_name": "Reset test item", "unit": "Nos",
                             "category": "Test", "dn_quantity": 10, "remaining_quantity": qty})
        doc.insert(ignore_permissions=True)
        return doc.name

    def _stock(self, qty):
        doc = frappe.new_doc("Warehouse Stock Item")
        doc.item_id = f"{ITEM}-{frappe.generate_hash(length=6)}"
        doc.item_name = "Reset test item"
        doc.quantity = qty
        doc.insert(ignore_permissions=True)
        self.stock_items.append(doc.name)
        return doc.name

    def _plan(self):
        """The real plan, cut down to this test's fixtures so it never writes other rows."""
        plan = ri.build_plan()
        plan.project_steps = [s for s in plan.project_steps if s.project in self.projects]
        plan.warehouse_items = [w for w in plan.warehouse_items if w.name in self.stock_items]
        return plan

    def _reports(self, project):
        return frappe.get_all("Remaining Items Report", filters={"project": project},
                              fields=["name", "report_date", "status"], order_by="report_date asc")

    def _quantities(self, report):
        return [r.remaining_quantity for r in frappe.get_all(
            "Remaining Item Entry", filters={"parent": report}, fields=["remaining_quantity"])]

    def test_project_action_rules(self):
        zero = "2026-10-19"
        self.assertIsNone(ri.project_action("2026-10-01", True, zero, None))
        self.assertEqual(ri.project_action("2026-10-19", False, zero, None), ri.ZERO_NEWEST)
        self.assertEqual(ri.project_action("2026-10-22", False, zero, None), ri.ZERO_NEWEST)
        self.assertEqual(ri.project_action("2026-10-01", False, zero, "RIR-1"), ri.ZERO_REPORT_ON_DATE)
        self.assertEqual(ri.project_action("2026-10-01", False, zero, None), ri.ADD_ZERO_REPORT)

    def test_old_report_gets_zero_report_three_days_back(self):
        project = self._project()
        old = self._report(project, add_days(today(), -10), 5)
        self.assertEqual(available_quantity(ITEM, project), 5)

        ri.apply_plan(self._plan())

        reports = self._reports(project)
        self.assertEqual([str(r.report_date) for r in reports], [add_days(today(), -10), self.zero_date])
        self.assertEqual(self._quantities(old), [5])
        self.assertEqual(self._quantities(reports[-1].name), [0])
        self.assertEqual(reports[-1].status, "Submitted")
        self.assertEqual(available_quantity(ITEM, project), 0)

        with patch.object(frappe.db, "commit"):
            submit_remaining_items_report(project, today(), [
                {"item_id": ITEM, "item_name": "Reset test item", "unit": "Nos", "category": "Test",
                 "dn_quantity": 10, "remaining_quantity": 2}])
        self.assertEqual(available_quantity(ITEM, project), 2)

    def test_recent_report_zeroed_in_place(self):
        project = self._project()
        recent = self._report(project, today(), 5)

        ri.apply_plan(self._plan())

        self.assertEqual([r.name for r in self._reports(project)], [recent])
        self.assertEqual(self._quantities(recent), [0])
        self.assertEqual(available_quantity(ITEM, project), 0)

    def test_draft_on_zero_date_is_submitted(self):
        project = self._project()
        self._report(project, add_days(today(), -10), 5)
        draft = self._report(project, self.zero_date, 4, status="Draft")

        ri.apply_plan(self._plan())

        reports = self._reports(project)
        self.assertEqual(len(reports), 2)
        self.assertEqual(reports[-1].name, draft)
        self.assertEqual(reports[-1].status, "Submitted")
        self.assertEqual(self._quantities(draft), [0])
        self.assertEqual(available_quantity(ITEM, project), 0)

    def test_zero_project_left_alone_and_second_run_is_empty(self):
        zero_project = self._project()
        self._report(zero_project, add_days(today(), -10), 0)
        project = self._project()
        self._report(project, add_days(today(), -10), 5)
        stock = self._stock(7)

        plan = self._plan()
        self.assertIn(zero_project, plan.already_zero)
        self.assertEqual([s.project for s in plan.project_steps], [project])
        ri.apply_plan(plan)

        again = self._plan()
        self.assertEqual(again.project_steps, [])
        self.assertEqual(again.warehouse_items, [])
        self.assertEqual(len(frappe.get_doc("Warehouse Stock Item", stock).ledger), 1)

    def test_warehouse_items_zeroed_with_ledger_row(self):
        positive = self._stock(7)
        negative = self._stock(-2)

        ri.apply_plan(self._plan())

        for name, impact, qty in ((positive, "Decrease", 7), (negative, "Increase", 2)):
            wsi = frappe.get_doc("Warehouse Stock Item", name)
            self.assertEqual(wsi.quantity, 0)
            self.assertEqual(len(wsi.ledger), 1)
            row = wsi.ledger[0]
            self.assertEqual((row.doctype_ref, row.impact, row.quantity),
                             (ri.RESET_LEDGER_REF, impact, qty))

    def test_report_mode_writes_nothing(self):
        project = self._project()
        old = self._report(project, add_days(today(), -10), 5)
        stock = self._stock(7)

        ri.run(apply=False)

        self.assertEqual([r.name for r in self._reports(project)], [old])
        self.assertEqual(frappe.db.get_value("Warehouse Stock Item", stock, "quantity"), 7)

    def test_report_can_follow_yesterdays(self):
        project = self._project()
        self._report(project, add_days(today(), -1), 5)

        with patch.object(frappe.db, "commit"):
            result = submit_remaining_items_report(project, today(), [
                {"item_id": ITEM, "item_name": "Reset test item", "unit": "Nos", "category": "Test",
                 "dn_quantity": 10, "remaining_quantity": 3}])

        self.assertEqual(result["action"], "created")
        self.assertEqual(available_quantity(ITEM, project), 3)
