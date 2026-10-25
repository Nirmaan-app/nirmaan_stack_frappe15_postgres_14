# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Porter import's per-phase progress summary (#1556, spec #1554).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_porter_progress

Drives the synthetic statement (12 orders, 1 cancelled, on 4 Porter Invoices) through the real upload,
the validation job (Gemini and the download faked, `test_porter_validation`) and the Create job
(`test_porter_create`), and reads `progress` where the screen does: `get_porter_status` and Import
History's `list_imports`. One class per stage: checking, validation failed, validated, partly created,
created.
"""

import json
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import porter as porter_api
from nirmaan_stack.api.outflow_import import porter_create, porter_records
from nirmaan_stack.api.outflow_import.porter_review import set_porter_placement
from nirmaan_stack.api.outflow_import.review import list_imports
from nirmaan_stack.api.outflow_import.test_porter_create import PorterCreateCase
from nirmaan_stack.api.outflow_import.test_porter_import import SOURCE

ORDERS, CANCELLED, COMPLETED, INVOICES = 12, 1, 11, 4


class ProgressCase(PorterCreateCase):
    def _progress(self):
        return porter_api.get_porter_status(self.batch)["progress"]

    def _history_progress(self):
        listed = next(
            item
            for item in list_imports(sources=json.dumps([SOURCE]), month="2026-09")
            if item["name"] == self.batch
        )
        return listed["progress"]


class TestWhileCheckingInvoices(ProgressCase):
    def test_upload_counts_orders_invoices_and_cancelled_orders(self):
        self.assertEqual(
            self._progress()["upload"], {"orders": ORDERS, "invoices": INVOICES, "cancelled": CANCELLED}
        )

    def test_every_invoice_is_in_progress_with_an_estimate_of_time_left(self):
        check = self._progress()["check"]
        self.assertEqual(
            {k: check[k] for k in ("invoices", "passed", "in_progress", "to_retry", "not_matching")},
            {"invoices": INVOICES, "passed": 0, "in_progress": INVOICES, "to_retry": 0, "not_matching": 0},
        )
        self.assertGreater(check["seconds_left"], 0)

    def test_nothing_is_created_and_no_create_job_runs(self):
        create = self._progress()["create"]
        self.assertEqual(create["created"], 0)
        self.assertFalse(create["running"])

    def test_import_history_gets_the_same_summary(self):
        self.assertEqual(self._history_progress(), self._progress())


class TestWhenValidationFailed(ProgressCase):
    def setUp(self):
        super().setUp()
        # One PDF bills another fare (doesn't match), one cannot be read (to retry).
        self.replies[self.numbers["24SS27A0900002"]]["net_amount"] = 1.0
        self.gemini_fails.add(self.numbers["29SS27A0900001"])
        self._validate()

    def test_check_counts_passed_to_retry_and_not_matching_and_no_time_is_left(self):
        self.assertEqual(
            self._progress()["check"],
            {
                "invoices": INVOICES,
                "passed": 2,
                "passed_with_warnings": 0,
                "in_progress": 0,
                "to_retry": 1,
                "not_matching": 1,
                "seconds_left": None,
            },
        )

    def test_import_history_gets_the_same_summary(self):
        self.assertEqual(self._history_progress(), self._progress())


class TestWhenValidated(ProgressCase):
    def setUp(self):
        super().setUp()
        self._validate()

    def test_every_invoice_passed(self):
        check = self._progress()["check"]
        self.assertEqual((check["passed"], check["in_progress"], check["seconds_left"]), (INVOICES, 0, None))

    def test_each_completed_order_is_placed_automatically_by_a_person_or_needs_a_person(self):
        projects = self._progress()["projects"]
        self.assertEqual(projects["orders"], COMPLETED)
        self.assertEqual(projects["placed_by_person"], 0)
        self.assertEqual(
            projects["placed_automatically"] + projects["placed_by_person"] + projects["needs_person"], COMPLETED
        )
        # 001 is a Strong name match; 002 a Check; 003 has no project found.
        self.assertGreaterEqual(projects["placed_automatically"], 1)
        self.assertGreaterEqual(projects["needs_person"], 2)

    def test_an_order_a_person_places_moves_from_needs_a_person_to_placed_by_a_person(self):
        before = self._progress()["projects"]
        set_porter_placement(self.batch, json.dumps([self._lines()["002"].name]), self.zephyr)
        after = self._progress()["projects"]
        self.assertEqual(after["placed_by_person"], 1)
        self.assertEqual(after["needs_person"], before["needs_person"] - 1)
        self.assertEqual(after["placed_automatically"], before["placed_automatically"])

    def test_every_completed_order_waits_for_create(self):
        self.assertEqual(
            self._progress()["create"],
            {"orders": COMPLETED, "created": 0, "waiting": COMPLETED, "failed": 0, "reopened": 0, "running": False},
        )

    def test_a_queued_create_job_shows_as_running(self):
        with patch.object(porter_records, "is_job_enqueued", side_effect=lambda job: job == f"porter-create-{self.batch}"):
            status = porter_api.get_porter_status(self.batch)
        self.assertTrue(status["progress"]["create"]["running"])
        self.assertTrue(status["create_running"])

    def test_import_history_gets_the_same_summary(self):
        self.assertEqual(self._history_progress(), self._progress())


class TestWhenPartlyCreated(ProgressCase):
    def setUp(self):
        super().setUp()
        self._validate()
        self._press_create()
        real = porter_create.create_expense_from_row
        calls = []

        def _third_fails(*args, **kwargs):
            calls.append(1)
            if len(calls) == 3:
                raise RuntimeError("worker died")
            return real(*args, **kwargs)

        with patch.object(porter_create, "create_expense_from_row", side_effect=_third_fails):
            self._run_create()

    def test_create_counts_created_and_failed_and_no_job_is_running(self):
        self.assertEqual(
            self._progress()["create"],
            {"orders": COMPLETED, "created": 10, "waiting": 0, "failed": 1, "reopened": 0, "running": False},
        )

    def test_a_line_unreconciled_after_create_counts_as_reopened(self):
        from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row

        settled = next(line for line in self._lines().values() if line.row_status == "Settled")
        unreconcile_row(row=settled.name, legs="all", reason="wrong project")
        create = self._progress()["create"]
        self.assertEqual((create["created"], create["failed"], create["reopened"]), (9, 1, 1))

    def test_import_history_gets_the_same_summary(self):
        self.assertEqual(self._history_progress(), self._progress())


class TestWhenCreated(ProgressCase):
    def setUp(self):
        super().setUp()
        self._validate()
        self._press_create()
        self._run_create()

    def test_every_completed_order_is_created(self):
        self.assertEqual(
            self._progress()["create"],
            {"orders": COMPLETED, "created": COMPLETED, "waiting": 0, "failed": 0, "reopened": 0, "running": False},
        )

    def test_import_history_gets_the_same_summary(self):
        self.assertEqual(self._history_progress(), self._progress())
