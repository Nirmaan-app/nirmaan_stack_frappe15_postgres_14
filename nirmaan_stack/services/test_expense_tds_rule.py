# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Which expense withholds tax, at what rate, and when (spec #1522, #1525). Pure: no database.

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not a Technical Data Sheet.

The withholding itself, through the real endpoints, is `api/expense_requests/test_office_rent_tds`.

Run:
  devenv.sh unit nirmaan_stack.services.test_expense_tds_rule
"""

import json
import os
import unittest

from nirmaan_stack.services.expense_tds import (
    OFFICE_RENT_TDS,
    deductee_gaps,
    tds_rule_for,
    withholds_now,
)
from nirmaan_stack.services.payment_tds import TDS_SECTIONS

NPE = "Non Project Expenses"
PE = "Project Expenses"
RENT = "Office Rent"

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "fixtures", "expense_type.json")


class TestWhichTypeAndRate(unittest.TestCase):
    def test_office_rent_withholds_ten_percent_under_194_i(self):
        rule = tds_rule_for(RENT)
        self.assertIs(rule, OFFICE_RENT_TDS)
        self.assertEqual((rule.rate, rule.section), (10.0, "194-I"))
        self.assertIn(rule.section, TDS_SECTIONS)

    def test_no_other_type_withholds(self):
        for other in ("Rent/PG for Staff", "Electricity Expenses", "office rent", "", None):
            with self.subTest(other=other):
                self.assertIsNone(tds_rule_for(other))

    def test_the_deductee_keys_are_the_ones_office_rents_form_asks(self):
        with open(FIXTURE) as handle:
            row = next(r for r in json.load(handle) if r["name"] == RENT)
        fields = {f["key"]: f["type"] for s in json.loads(row["source_format"])["sections"]
                  for f in s.get("fields") or []}
        self.assertEqual(fields.get(OFFICE_RENT_TDS.deductee_name_key), "text")
        self.assertEqual(fields.get(OFFICE_RENT_TDS.deductee_pan_key), "pan")


class TestWhen(unittest.TestCase):
    def test_an_approval_from_an_earlier_step_withholds(self):
        for before in ("Requested", "CEO Pending"):
            with self.subTest(before=before):
                self.assertTrue(withholds_now(NPE, RENT, before, "Approved", inserted=False))

    def test_an_undo_back_to_approved_or_any_other_save_does_not(self):
        for before, after in (("Reconciliation Pending", "Approved"), ("Paid", "Approved"),
                              ("Approved", "Approved"), ("Approved", "Reconciliation Pending"),
                              ("Approved", "Paid"), ("Requested", "CEO Pending"),
                              ("Requested", "Rejected"), ("Paid", "Reconciliation Pending")):
            with self.subTest(before=before, after=after):
                self.assertFalse(withholds_now(NPE, RENT, before, after, inserted=False))

    def test_a_row_born_approved_withholds_and_one_born_anywhere_else_does_not(self):
        self.assertTrue(withholds_now(NPE, RENT, None, "Approved", inserted=True))
        # The bank import creates its expenses Paid, and an import-made expense records no tax (ADR-0021).
        for status in ("Requested", "CEO Pending", "Paid", "Reconciliation Pending"):
            with self.subTest(status=status):
                self.assertFalse(withholds_now(NPE, RENT, None, status, inserted=True))

    def test_only_an_office_rent_non_project_expense(self):
        self.assertFalse(withholds_now(NPE, "Electricity Expenses", "Requested", "Approved", inserted=False))
        self.assertFalse(withholds_now(NPE, "Electricity Expenses", None, "Approved", inserted=True))
        self.assertFalse(withholds_now(PE, RENT, "Requested", "Approved", inserted=False))


# `tds_split` rounds through Frappe's `flt(x, 2)`, which reads the site's rounding method, so it is
# pinned through the endpoints (`test_office_rent_tds`), not here.
class TestTheLandlord(unittest.TestCase):
    def test_a_named_landlord_with_a_valid_pan_in_any_case_has_no_gap(self):
        self.assertEqual(deductee_gaps("Asha Rao", "ABCPK1234D"), [])
        self.assertEqual(deductee_gaps(" Asha Rao ", " abcpk1234d "), [])

    def test_each_gap_is_named(self):
        self.assertEqual(deductee_gaps("", "ABCPK1234D"), ["the landlord's name"])
        self.assertEqual(deductee_gaps("Asha Rao", None), ["the landlord's PAN"])
        self.assertEqual(deductee_gaps("Asha Rao", "ABC123"), ["a valid landlord PAN"])
        self.assertEqual(deductee_gaps(" ", " "), ["the landlord's name", "the landlord's PAN"])


if __name__ == "__main__":
    unittest.main()
