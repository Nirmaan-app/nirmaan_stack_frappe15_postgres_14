# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An expense type's Who gets paid (spec #1420 tickets #1429, #1436, ADR-0033). Run with `devenv.sh unit`.

Required / Optional / Not asked are screen rules since #1436; the server only pins the options the
screens offer."""

import unittest

from nirmaan_stack.services.payees.expense_rules import PAYEE_RULES
from nirmaan_stack.services.payees.test_rules import load_shared_cases

#: Shared with the frontend's `utils/payees/expensePayee.test.ts` (F1).
SHARED = load_shared_cases()


class TestSharedCases(unittest.TestCase):
    def test_the_rules_are_the_ones_the_screens_offer(self):
        self.assertEqual(list(PAYEE_RULES), SHARED["payee_rules"])
