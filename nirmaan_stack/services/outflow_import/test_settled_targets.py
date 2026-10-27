# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the delete refusal on a record a bank line settles (ADR-0022 Amendment G).

Pure: no bench, no database. The hooks that feed it are pinned against the live site in
`api/outflow_import/test_delete_settled_target.py`.
"""

import unittest
from datetime import datetime
from decimal import Decimal

from nirmaan_stack.services.outflow_import.settled_targets import delete_while_settled_refusal

_TAIL = "Take it off with Unreconcile on Bulk Import Transactions first."


def _line(batch="OFR-26-000042", added_on=datetime(2026, 10, 12, 10, 30), amount="21480"):
    return {"import_batch": batch, "added_on": added_on, "target_amount": Decimal(amount)}


class TestDeleteWhileSettledRefusal(unittest.TestCase):
    def test_no_live_line_allows_the_delete(self):
        self.assertIsNone(delete_while_settled_refusal("PAY-001-001", []))

    def test_a_live_line_is_named_by_its_import_and_bank_date(self):
        self.assertEqual(
            delete_while_settled_refusal("PAY-001-001", [_line()]),
            "PAY-001-001 cannot be deleted: 1 bank line totalling ₹21,480 "
            f"(import OFR-26-000042, 12-Oct-2026) is linked to it. {_TAIL}",
        )

    def test_a_line_with_no_bank_date_is_named_by_its_import_alone(self):
        self.assertEqual(
            delete_while_settled_refusal("PAY-001-001", [_line(added_on=None)]),
            "PAY-001-001 cannot be deleted: 1 bank line totalling ₹21,480 "
            f"(import OFR-26-000042) is linked to it. {_TAIL}",
        )

    def test_a_line_whose_import_row_is_gone_still_refuses_without_a_where(self):
        self.assertEqual(
            delete_while_settled_refusal("PAY-001-001", [_line(batch=None, added_on=None)]),
            f"PAY-001-001 cannot be deleted: 1 bank line totalling ₹21,480 is linked to it. {_TAIL}",
        )
