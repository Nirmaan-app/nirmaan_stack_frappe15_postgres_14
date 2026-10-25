# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""`Payment TDS Deduction.borne_by`'s Select options are the code's constants (#1451).

Every reader compares the stored value to `payment_tds.BORNE_BY_VENDOR` / `BORNE_BY_COMPANY`
(`borne_tds_by_order_sql` in SQL, the request cap, the page's Amount Paid hover), so an option renamed in the
doctype JSON alone would make every deduction read as withheld, silently. Pure: reads the JSON file.
"""

import json
import os
import unittest

from nirmaan_stack.services.payment_tds import BORNE_BY_COMPANY, BORNE_BY_VENDOR

_DOCTYPE_JSON = os.path.join(
	os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
	"nirmaan_stack", "doctype", "payment_tds_deduction", "payment_tds_deduction.json",
)


class TestBorneByOptions(unittest.TestCase):
	def setUp(self):
		with open(_DOCTYPE_JSON, encoding="utf-8") as handle:
			self.field = {f["fieldname"]: f for f in json.load(handle)["fields"]}["borne_by"]

	def test_the_select_is_the_two_constants_in_this_order(self):
		self.assertEqual(self.field["options"].split("\n"), [BORNE_BY_VENDOR, BORNE_BY_COMPANY])

	def test_a_row_written_with_no_value_reads_as_withheld(self):
		self.assertEqual(self.field["default"], BORNE_BY_VENDOR)
