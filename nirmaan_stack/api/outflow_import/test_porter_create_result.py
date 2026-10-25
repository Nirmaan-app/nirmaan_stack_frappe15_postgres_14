# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Create's result: every order it could not create is named, with its note and its fix (#1561, spec #1554).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_porter_create_result

Built on `test_porter_create.PorterCreateCase`: the statement is uploaded through the real endpoint, validated
with Gemini and the PDF download faked, and the Create job run directly. Each test removes what it made.
"""

from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import porter as porter_api
from nirmaan_stack.api.outflow_import import porter_create
from nirmaan_stack.api.outflow_import import porter_review
from nirmaan_stack.api.outflow_import.test_porter_create import PorterCreateCase
from nirmaan_stack.api.outflow_import.test_porter_import import ROW_DOCTYPE
from nirmaan_stack.services.outflow_import.status import ROW_SETTLED


class TestTheOrdersCreateCouldNotCreateAreNamed(PorterCreateCase):
    """#1561: each line Create could not create comes back with its CRN, its stored note and its fix, in
    the status (the result screen) and the review."""

    def _stop_quillon(self):
        self._validate()
        self._press_create()
        frappe.db.set_value("Projects", self.quillon, "tendering_status", "Tendering", update_modified=False)
        frappe.db.commit()
        self.addCleanup(self._won_again, self.quillon)
        self._run_create()
        return [line for line in self._lines().values() if line.resolved_project == self.quillon]

    @staticmethod
    def _won_again(project: str) -> None:
        frappe.db.rollback()
        frappe.db.set_value("Projects", project, "tendering_status", "Won", update_modified=False)
        frappe.db.commit()

    def test_a_line_on_a_project_no_longer_won_comes_back_with_its_crn_its_note_and_re_place(self):
        on_quillon = self._stop_quillon()
        self.assertTrue(on_quillon)
        expected = sorted(
            (
                {
                    "name": line.name,
                    "crn": line.transfer_id,
                    "note": line.outcome_note,
                    "fix": "re-place",
                    "project": self.quillon,
                    "project_name": "Quillon Park",
                }
                for line in on_quillon
            ),
            key=lambda line: line["name"],
        )
        self.assertEqual(porter_api.get_porter_status(self.batch)["failed_lines"], expected)
        self.assertEqual(porter_review.get_porter_review(self.batch)["failed_lines"], expected)
        for line in expected:
            self.assertIn("not Won", line["note"])

    def test_once_it_is_placed_on_a_won_project_its_fix_is_try_again(self):
        on_quillon = self._stop_quillon()
        porter_review.set_porter_placement(self.batch, [on_quillon[0].name], self.zephyr)
        fixes = {line["name"]: line["fix"] for line in porter_api.get_porter_status(self.batch)["failed_lines"]}
        self.assertEqual(fixes[on_quillon[0].name], "retry")

    def test_a_line_that_failed_on_a_server_error_is_tried_again(self):
        self._validate()
        self._press_create()
        real = porter_create.create_expense_from_row
        calls = []

        def _first_fails(*args, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("worker died")
            return real(*args, **kwargs)

        with patch.object(porter_create, "create_expense_from_row", side_effect=_first_fails):
            self._run_create()
        [failed] = porter_api.get_porter_status(self.batch)["failed_lines"]
        self.assertEqual(failed["fix"], "retry")
        self.assertEqual(failed["note"], "Could not create this expense. Run Create again.")
        self.assertEqual(failed["crn"], frappe.db.get_value(ROW_DOCTYPE, failed["name"], "transfer_id"))

    def test_nothing_is_named_while_every_line_is_created(self):
        self._validate()
        self.assertEqual(porter_api.get_porter_status(self.batch)["failed_lines"], [])
        self._press_create()
        self._run_create()
        self.assertEqual(porter_api.get_porter_status(self.batch)["failed_lines"], [])


class TestTheCreatedExpensesAreNamed(PorterCreateCase):
    """#1561 "View the N expenses": the status names the Porter Orders that have an Expense, by the expense
    doctype each is on now, so the result can open those lists filtered to them."""

    def test_nothing_is_named_before_create(self):
        self._validate()
        self.assertEqual(porter_api.get_porter_status(self.batch)["created_expenses"], {})

    def test_each_created_order_is_named_under_the_doctype_its_expense_is_on(self):
        self._validate()
        self._press_create()
        self._run_create()
        expected: dict[str, list[str]] = {}
        for line in self._lines().values():
            if line.row_status == ROW_SETTLED:
                expected.setdefault(line.suggested_doctype, []).append(line.transfer_id)
        named = porter_api.get_porter_status(self.batch)["created_expenses"]
        self.assertEqual({doctype: sorted(crns) for doctype, crns in named.items()}, {
            doctype: sorted(crns) for doctype, crns in expected.items()
        })
        for doctype, crns in named.items():
            for crn in crns:
                self.assertTrue(frappe.db.exists(doctype, {"porter_order": crn}))
