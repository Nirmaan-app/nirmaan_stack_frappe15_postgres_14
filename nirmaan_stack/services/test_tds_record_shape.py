# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A `Payment TDS Deduction` names exactly one source, and its section is one of the code's (#1523).

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not the Technical Data Sheet family.

Pure: the link rule is a function of two values, and the field shapes are read off the doctype JSON.
The save that runs the rule is pinned by `services/test_tds_expense_records` against the database.
"""

import json
import os
import unittest

from nirmaan_stack.services.payment_tds import (
	TDS_SECTION_RENT,
	TDS_SECTION_WORK_ORDER,
	TDS_SECTIONS,
	deduction_link_problem,
)

_DOCTYPE_JSON = os.path.join(
	os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
	"nirmaan_stack", "doctype", "payment_tds_deduction", "payment_tds_deduction.json",
)


class TestDeductionLinkRule(unittest.TestCase):
	def test_a_payment_alone_is_accepted(self):
		self.assertIsNone(deduction_link_problem("PAY-1", None))

	def test_an_expense_alone_is_accepted(self):
		self.assertIsNone(deduction_link_problem(None, "NPE-1"))

	def test_neither_is_refused_and_says_what_is_missing(self):
		problem = deduction_link_problem(None, None)
		self.assertIn("Project Payment", problem)
		self.assertIn("Non-Project Expense", problem)

	def test_blank_and_whitespace_count_as_missing(self):
		self.assertIsNotNone(deduction_link_problem("", "  "))

	def test_both_is_refused_and_names_both(self):
		problem = deduction_link_problem("PAY-1", "NPE-1")
		self.assertIn("PAY-1", problem)
		self.assertIn("NPE-1", problem)
		self.assertIn("never both", problem)


class TestDeductionFields(unittest.TestCase):
	def setUp(self):
		with open(_DOCTYPE_JSON, encoding="utf-8") as handle:
			self.fields = {f["fieldname"]: f for f in json.load(handle)["fields"]}

	def test_the_section_select_is_the_constants_in_this_order(self):
		self.assertEqual(self.fields["tds_section"]["options"].split("\n"), list(TDS_SECTIONS))
		self.assertEqual(list(TDS_SECTIONS), [TDS_SECTION_WORK_ORDER, TDS_SECTION_RENT])

	def test_a_row_written_with_no_section_reads_as_a_work_order_row(self):
		self.assertEqual(self.fields["tds_section"]["default"], TDS_SECTION_WORK_ORDER)

	def test_both_links_are_optional_and_unique(self):
		for fieldname, target in (
			("project_payment", "Project Payments"),
			("non_project_expense", "Non Project Expenses"),
		):
			with self.subTest(fieldname=fieldname):
				field = self.fields[fieldname]
				self.assertEqual((field["fieldtype"], field["options"]), ("Link", target))
				self.assertFalse(field.get("reqd"))
				self.assertTrue(field.get("unique"))


if __name__ == "__main__":
	unittest.main()
