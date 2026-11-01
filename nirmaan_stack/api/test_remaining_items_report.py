# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for `submit_remaining_items_report` with an empty ("nothing to count") submission.

What must hold:
  1. Empty submit when the latest Submitted report is also empty: that report moves to today,
     no new report is added.
  2. Empty submit when the latest report has items: a new empty report is created and the old
     one is untouched.
  3. Empty submit with no earlier report: a new empty report is created.
  4. A submit with items after an empty report: a new report is created; the empty one stays.
  5. Only the latest report counts: an older empty report is not moved when a newer one has items.

RUNS AGAINST THE SITE DATABASE. Fixtures are written without commit (projects with `db_insert`,
which skips the Projects hooks that commit; the endpoint's commit is patched out); tearDown
rolls everything back.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from nirmaan_stack.api.remaining_items_report import submit_remaining_items_report

ITEM = {"item_id": "TEST-RIR-EMPTY-ITEM", "item_name": "Empty-submit test item", "unit": "Nos",
        "category": "Test", "dn_quantity": 10, "remaining_quantity": 4}


class TestEmptyRemainingItemsSubmit(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")

    def tearDown(self):
        frappe.db.rollback()

    def _project(self):
        name = f"TEST-RIR-EMPTY-{frappe.generate_hash(length=8)}"
        doc = frappe.get_doc({"doctype": "Projects", "project_name": name})
        doc.name = name
        doc.creation = doc.modified = frappe.utils.now()
        doc.owner = doc.modified_by = "Administrator"
        doc.db_insert()
        return name

    def _report(self, project, report_date, with_item):
        doc = frappe.new_doc("Remaining Items Report")
        doc.project = project
        doc.report_date = report_date
        doc.status = "Submitted"
        if with_item:
            doc.append("items", ITEM)
        doc.insert(ignore_permissions=True)
        return doc.name

    def _submit(self, project, items):
        with patch.object(frappe.db, "commit"):
            return submit_remaining_items_report(project, today(), items)

    def _reports(self, project):
        rows = frappe.get_all("Remaining Items Report", filters={"project": project},
                              fields=["name", "report_date"], order_by="report_date asc")
        return [(r.name, str(r.report_date),
                 frappe.db.count("Remaining Item Entry", {"parent": r.name})) for r in rows]

    def test_empty_after_empty_moves_to_today(self):
        project = self._project()
        old = self._report(project, add_days(today(), -1), with_item=False)

        result = self._submit(project, [])

        self.assertEqual(result["name"], old)
        self.assertEqual(self._reports(project), [(old, today(), 0)])

    def test_empty_after_items_creates_new(self):
        project = self._project()
        old = self._report(project, add_days(today(), -1), with_item=True)

        result = self._submit(project, [])

        self.assertEqual(result["action"], "created")
        self.assertEqual(self._reports(project),
                         [(old, add_days(today(), -1), 1), (result["name"], today(), 0)])

    def test_empty_with_no_earlier_report_creates_new(self):
        project = self._project()

        result = self._submit(project, "[]")

        self.assertEqual(result["action"], "created")
        self.assertEqual(self._reports(project), [(result["name"], today(), 0)])

    def test_items_after_empty_creates_new(self):
        project = self._project()
        old = self._report(project, add_days(today(), -1), with_item=False)

        result = self._submit(project, [ITEM])

        self.assertEqual(result["action"], "created")
        self.assertEqual(self._reports(project),
                         [(old, add_days(today(), -1), 0), (result["name"], today(), 1)])

    def test_only_latest_report_is_moved(self):
        project = self._project()
        older_empty = self._report(project, add_days(today(), -3), with_item=False)
        newer = self._report(project, add_days(today(), -1), with_item=True)

        result = self._submit(project, [])

        self.assertEqual(result["action"], "created")
        self.assertEqual(self._reports(project), [
            (older_empty, add_days(today(), -3), 0),
            (newer, add_days(today(), -1), 1),
            (result["name"], today(), 0),
        ])
