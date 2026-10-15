# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Reviewing a Porter import's projects before Create (#1446, spec #1442, ADR-0032).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_porter_review

Uploads the synthetic statement through the real endpoint (`test_porter_import.PorterImportCase`), passes
its invoices, then drives `get_porter_review` and `set_porter_placement` and asserts on what the import's
lines hold -- the plan the Create job reads. Validation itself is #1444's and is not run here: an invoice
is moved to Passed or Failed directly, which is the only fact the review gate reads.
"""

import frappe

from nirmaan_stack.api.outflow_import import porter_review
from nirmaan_stack.api.outflow_import.test_porter_import import (
    INVOICE_DOCTYPE,
    ROW_DOCTYPE,
    PorterImportCase,
    _fresh_fixture,
)
from nirmaan_stack.services.outflow_import.porter import EXPENSE_TYPE

PLAN_FIELDS = [
    "suggested_doctype",
    "resolved_project",
    "suggested_expense_type",
    "placement_reason",
    "placement_strength",
]


class PorterReviewCase(PorterImportCase):
    def setUp(self):
        super().setUp()
        self.batch = self._upload(_fresh_fixture()[0])["batch"]

    def _set_invoices(self, *statuses: str) -> None:
        """The invoices' validation outcome, in upload order; the last status repeats for the rest."""
        invoices = frappe.get_all(
            INVOICE_DOCTYPE, filters={"import_batch": self.batch}, pluck="name", order_by="creation asc"
        )
        for index, invoice in enumerate(invoices):
            status = statuses[min(index, len(statuses) - 1)]
            frappe.db.set_value(INVOICE_DOCTYPE, invoice, "validation_status", status)
        frappe.db.commit()

    def _row(self, crn_suffix: str):
        name = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch, "transfer_id": ["like", f"%{crn_suffix}"]},
            pluck="name",
        )[0]
        return frappe.db.get_value(ROW_DOCTYPE, name, ["name", *PLAN_FIELDS], as_dict=True)

    def _plans(self):
        return frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch},
            fields=["name", *PLAN_FIELDS],
            order_by="name asc",
        )

    def _review(self):
        return porter_review.get_porter_review(self.batch)

    def _assign(self, rows, project):
        return porter_review.set_porter_placement(self.batch, [row.name for row in rows], project)


class TestReviewWaitsForValidation(PorterReviewCase):
    def _assert_refused(self):
        before = self._plans()
        row = self._row("001")
        with self.assertRaises(frappe.ValidationError) as caught:
            self._review()
        self.assertIn("every invoice", str(caught.exception))
        with self.assertRaises(frappe.ValidationError):
            self._assign([row], self.quillon)
        frappe.db.rollback()
        self.assertEqual(self._plans(), before)

    def test_refused_while_invoices_are_still_being_checked(self):
        self._set_invoices("Passed", "Reading")
        self._assert_refused()

    def test_refused_when_an_invoice_failed(self):
        self._set_invoices("Passed", "Failed", "Passed")
        self._assert_refused()

    def test_offered_once_every_invoice_passed(self):
        self._set_invoices("Passed")
        self.assertEqual(self._review()["batch"], self.batch)


class TestWhatTheReviewShows(PorterReviewCase):
    def setUp(self):
        super().setUp()
        self._set_invoices("Passed")
        self.review = self._review()
        self.lines = {line["crn"][-3:]: line for line in self.review["lines"]}

    def test_every_completed_order_and_no_cancelled_one(self):
        self.assertEqual(len(self.review["lines"]), 11)
        self.assertNotIn("011", self.lines)

    def test_orders_with_one_remark_in_one_city_share_a_group(self):
        # "zephyr tower project " and "zephyr tower project", all in Bangalore.
        zephyr = {self.lines[suffix]["group_key"] for suffix in ("001", "004", "008")}
        self.assertEqual(len(zephyr), 1)
        self.assertTrue(zephyr.pop())
        # "quillon site" in Bangalore, Ahmedabad and Hyderabad: three groups.
        quillon = {self.lines[suffix]["group_key"] for suffix in ("002", "006", "010")}
        self.assertEqual(len(quillon), 3)

    def test_an_order_with_no_remark_shows_its_addresses_and_who_booked_it(self):
        line = self.lines["003"]
        self.assertEqual(line["group_key"], "")
        self.assertEqual(line["booked_by"], "Ravi Testkumar")
        self.assertEqual(line["from_address"], "Demo Foodcourt  Mahadevapura  Bengaluru  Karnataka  India")
        self.assertEqual(line["to_address"], "Lingarajapuram  Bengaluru  Karnataka 560084  India")
        self.assertEqual(line["city"], "Bangalore")
        self.assertEqual(line["fare"], 382.0)
        self.assertEqual(line["completed_on"][:10], "2026-09-12")

    def test_each_suggestion_shows_its_project_reason_and_strength(self):
        zephyr = self.lines["001"]
        self.assertEqual(zephyr["ledger"], "Project Expenses")
        self.assertEqual(zephyr["project"], self.zephyr)
        self.assertEqual(zephyr["project_name"], "Zephyr Tower")
        self.assertEqual((zephyr["reason"], zephyr["strength"]), ("name", "Strong"))
        self.assertEqual(self.lines["002"]["strength"], "Check")
        blank = self.lines["003"]
        self.assertEqual((blank["ledger"], blank["project"]), ("Non Project Expenses", None))
        self.assertTrue(zephyr["editable"])

    def test_only_won_projects_are_offered(self):
        offered = {project["name"] for project in self.review["projects"]}
        self.assertIn(self.zephyr, offered)
        self.assertIn(self.quillon, offered)
        self.assertNotIn(self.zephyr_tender, offered)


class TestCorrectingAPlacement(PorterReviewCase):
    def setUp(self):
        super().setUp()
        self._set_invoices("Passed")
        self.group = [self._row(suffix) for suffix in ("001", "004", "008")]

    def test_assigning_a_group_writes_every_order_in_it_at_once(self):
        result = self._assign(self.group, self.quillon)
        for row in self.group:
            plan = frappe.db.get_value(ROW_DOCTYPE, row.name, PLAN_FIELDS, as_dict=True)
            self.assertEqual(plan.suggested_doctype, "Project Expenses")
            self.assertEqual(plan.resolved_project, self.quillon)
            self.assertEqual(plan.suggested_expense_type, EXPENSE_TYPE)
            # The Accountant decided it: no longer the matcher's suggestion.
            self.assertEqual(plan.placement_reason, "review")
            self.assertIsNone(plan.placement_strength)
        # The reply is the review as the next reload shows it.
        self.assertEqual(result, self._review())
        shown = [line for line in result["lines"] if line["name"] in {row.name for row in self.group}]
        self.assertEqual({line["project_name"] for line in shown}, {"Quillon Park"})

    def test_the_rest_of_the_import_is_left_alone(self):
        others = [plan for plan in self._plans() if plan.name not in {row.name for row in self.group}]
        self._assign(self.group, self.quillon)
        self.assertEqual(
            [plan for plan in self._plans() if plan.name not in {row.name for row in self.group}], others
        )

    def test_clearing_the_project_makes_the_orders_non_project(self):
        self._assign(self.group, None)
        for row in self.group:
            plan = frappe.db.get_value(ROW_DOCTYPE, row.name, PLAN_FIELDS, as_dict=True)
            self.assertEqual(plan.suggested_doctype, "Non Project Expenses")
            self.assertIsNone(plan.resolved_project)
            self.assertEqual(plan.suggested_expense_type, EXPENSE_TYPE)

    def test_a_blank_project_means_non_project_too(self):
        self._assign(self.group, "")
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, self.group[0].name, "suggested_doctype"), "Non Project Expenses"
        )

    def test_a_non_project_order_can_be_given_a_project(self):
        blank = self._row("003")
        self._assign([blank], self.zephyr)
        plan = frappe.db.get_value(ROW_DOCTYPE, blank.name, PLAN_FIELDS, as_dict=True)
        self.assertEqual((plan.suggested_doctype, plan.resolved_project), ("Project Expenses", self.zephyr))


class TestWhatReviewRefuses(PorterReviewCase):
    def setUp(self):
        super().setUp()
        self._set_invoices("Passed")
        self.row = self._row("001")
        self.before = self._plans()

    def _assert_refused(self, rows, project, *words):
        with self.assertRaises(frappe.ValidationError) as caught:
            porter_review.set_porter_placement(self.batch, rows, project)
        for word in words:
            self.assertIn(word, str(caught.exception))
        frappe.db.rollback()
        self.assertEqual(self._plans(), self.before)

    def test_a_project_that_is_not_won(self):
        self._assert_refused([self.row.name], self.zephyr_tender, self.zephyr_tender, "Won")

    def test_a_project_that_does_not_exist(self):
        self._assert_refused([self.row.name], "no-such-project", "no-such-project")

    def test_a_cancelled_order(self):
        cancelled = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch, "row_status": "Skipped"},
            pluck="name",
        )[0]
        self._assert_refused([self.row.name, cancelled], self.quillon, cancelled)

    def test_a_line_of_another_import(self):
        other = frappe.get_all(
            ROW_DOCTYPE, filters={"import_batch": ["!=", self.batch]}, pluck="name", limit=1
        )[0]
        self._assert_refused([self.row.name, other], self.quillon, other)

    def test_an_order_already_created(self):
        frappe.db.set_value(ROW_DOCTYPE, self.row.name, "row_status", "Settled")
        frappe.db.commit()
        self.before = self._plans()
        self._assert_refused([self.row.name], self.quillon, "already created")

    def test_no_orders(self):
        self._assert_refused([], self.quillon, "No orders")

    def test_someone_without_bulk_import_access(self):
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                porter_review.set_porter_placement(self.batch, [self.row.name], self.quillon)
            with self.assertRaises(frappe.PermissionError):
                porter_review.get_porter_review(self.batch)
        finally:
            frappe.set_user("Administrator")
        frappe.db.rollback()
        self.assertEqual(self._plans(), self.before)
