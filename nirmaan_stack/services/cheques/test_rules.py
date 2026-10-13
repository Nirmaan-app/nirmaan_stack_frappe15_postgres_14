# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Pure: the Cheque's names pinned to the doctype JSON, and the bank identity (spec #1407).

No database. Run with `devenv.sh unit nirmaan_stack.services.cheques.test_rules`.
"""

import json
import os
import unittest

from nirmaan_stack.services.cheques import rules

DOCTYPES = os.path.join(os.path.dirname(__file__), "..", "..", "nirmaan_stack", "doctype")


def _options(folder: str, fieldname: str) -> tuple:
    with open(os.path.join(DOCTYPES, folder, f"{folder}.json")) as f:
        fields = {d["fieldname"]: d for d in json.load(f)["fields"]}
    return tuple(fields[fieldname]["options"].split("\n"))


class TestChequeNamesMatchTheDoctype(unittest.TestCase):
    def test_select_options_are_the_rule_constants(self):
        self.assertEqual(_options("cheques", "status"), rules.CHEQUE_STATUSES)
        self.assertEqual(_options("cheques", "bank"), rules.BANKS)
        self.assertEqual(_options("cheques", "made_from"), rules.MADE_FROM)
        self.assertEqual(_options("cheque_line", "line_type"), rules.LINE_TYPES)


class TestBankIdentity(unittest.TestCase):
    def test_an_others_bank_name_ignores_case_and_repeated_spaces(self):
        self.assertEqual(rules.bank_key("Others", "HDFC Bank"), rules.bank_key("Others", " hdfc   BANK "))
        self.assertNotEqual(rules.bank_key("Others", "HDFC Bank"), rules.bank_key("ICICI Bank"))

    def test_a_fixed_bank_ignores_any_typed_name(self):
        self.assertEqual(rules.bank_key("ICICI Bank", "anything"), "icici bank")

    def test_a_cheque_number_keeps_leading_zeros_and_loses_spaces(self):
        self.assertEqual(rules.normalise_cheque_no(" 004 521 "), "004521")
