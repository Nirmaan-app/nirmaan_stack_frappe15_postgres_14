# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Rectify core takes the source as an input and says per line why it refuses (#1754, spec #1753).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_rectify_core

Porter is the only source wired (`rectify_sources.PORTER`). These tests hand the core a second, made-up
source built from Porter's, and read back through the core's own plan and write calls that a Porter line
is refused under it, in that source's words, and is left where it was.
"""

import dataclasses
import json

import frappe

from nirmaan_stack.api.outflow_import import porter_rectify
from nirmaan_stack.api.outflow_import.rectify_sources import PORTER
from nirmaan_stack.api.outflow_import.test_porter_create import NON_PROJECT_EXPENSE, PROJECT_EXPENSE
from nirmaan_stack.api.outflow_import.test_porter_rectify import REASON, PorterRectifyCase

_OTHER_WORDING = dataclasses.replace(
    PORTER.wording,
    not_this_source="Only a spend from a Testwallet Statement can be moved.",
)
_OTHER = dataclasses.replace(PORTER, source="Testwallet Statement", wording=_OTHER_WORDING)


class TestTheCoreTakesTheSource(PorterRectifyCase):
    def test_the_plan_refuses_a_line_from_another_source_in_that_sources_words(self):
        lines = self._lines()
        plan = porter_rectify.plan_rectify(_OTHER, json.dumps([lines["002"].name, lines["003"].name]))

        self.assertEqual(
            [line["refusal"] for line in plan["lines"]],
            ["Only a spend from a Testwallet Statement can be moved."] * 2,
        )

    def test_the_write_refuses_a_line_from_another_source_and_leaves_its_expense_where_it_was(self):
        old = self._expense_of("003")

        result = porter_rectify.rectify_rows(_OTHER, json.dumps([self._lines()["003"].name]), self.zephyr, REASON)

        [line] = result["lines"]
        self.assertFalse(line["rectified"])
        self.assertEqual(line["reason"], "Only a spend from a Testwallet Statement can be moved.")
        still = self._expense_of("003")
        self.assertEqual((still.doctype, still.name), (NON_PROJECT_EXPENSE, old.name))

    def test_the_same_lines_under_porter_are_planned_and_moved(self):
        lines = self._lines()
        plan = porter_rectify.plan_rectify(PORTER, json.dumps([lines["003"].name]))
        self.assertIsNone(plan["lines"][0]["refusal"])

        result = porter_rectify.rectify_rows(PORTER, json.dumps([lines["003"].name]), self.zephyr, REASON)

        self.assertTrue(result["lines"][0]["rectified"], result)
        moved = self._expense_of("003")
        self.assertEqual((moved.doctype, moved.projects), (PROJECT_EXPENSE, self.zephyr))


class TestAnyMoveKeepsWhatAPersonAddedLater(PorterRectifyCase):
    """Owner, 2026-11-26: every source's Move keeps the pay-to account, the approval dates and a person's comments."""

    def test_a_porter_move_keeps_the_pay_to_account_approval_dates_and_a_persons_comment(self):
        carried = {
            "pay_to_account_name": "Testporter Logistics",
            "pay_to_account_number": "999888777666",
            "pay_to_ifsc": "TEST0009876",
            "approval_date": "2026-10-02",
            "ceo_approval_date": "2026-10-03",
        }
        old = self._expense_of("003")
        frappe.db.set_value(old.doctype, old.name, carried, update_modified=False)
        frappe.get_doc(old.doctype, old.name).add_comment("Comment", text="Checked against the delivery slip")
        frappe.db.commit()

        result = porter_rectify.rectify_rows(PORTER, json.dumps([self._lines()["003"].name]), self.zephyr, REASON)

        self.assertTrue(result["lines"][0]["rectified"], result)
        new = self._expense_of("003")
        self.assertEqual({k: str(new.get(k)) for k in carried}, carried)
        self.assertIn(
            "Checked against the delivery slip",
            frappe.get_all(
                "Comment",
                filters={"reference_doctype": new.doctype, "reference_name": new.name, "comment_type": "Comment"},
                pluck="content",
            ),
        )
