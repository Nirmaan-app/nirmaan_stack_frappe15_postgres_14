# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The two ways out for a waiting Vendor Refund whose bank line never comes (#1403, ADR-0032).

Pure module -- no site, no DB.

*Cancel*: the refund stays, Cancelled, and counts for nothing. *Mark Received with no bank line*: it
counts at once, with a required reason, and carries the "No bank proof" mark until a bank line is
matched to it. Both start only from a refund still waiting (Reconciliation Pending). Who may do each
is the endpoints' check (`api/vendor_refunds/waiting_refunds`).
"""

import json
import os
import unittest
from datetime import datetime

from nirmaan_stack.services.vendor_refunds import (
    NO_BANK_LINE_FIELDS,
    cancel_problem,
    no_bank_line_problem,
    no_bank_line_values,
)

_DOCTYPE_JSON = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "nirmaan_stack",
    "doctype",
    "vendor_refunds",
    "vendor_refunds.json",
)


class TestCancellingAWaitingRefund(unittest.TestCase):
    def test_a_waiting_refund_may_be_cancelled(self):
        self.assertIsNone(cancel_problem("Reconciliation Pending"))

    def test_a_received_or_cancelled_refund_may_not(self):
        for status in ("Received", "Cancelled"):
            with self.subTest(status=status):
                self.assertIn(f"{status} refund cannot be cancelled", cancel_problem(status))


class TestMarkingItReceivedWithNoBankLine(unittest.TestCase):
    def test_a_waiting_refund_with_a_reason_may_be_marked(self):
        self.assertIsNone(no_bank_line_problem("Reconciliation Pending", "Vendor confirmed by email"))

    def test_the_reason_is_required(self):
        for reason in (None, "", "   "):
            with self.subTest(reason=reason):
                self.assertIn("reason", no_bank_line_problem("Reconciliation Pending", reason))

    def test_only_a_waiting_refund_may_be_marked(self):
        for status in ("Received", "Cancelled"):
            with self.subTest(status=status):
                self.assertIn(f"{status} refund", no_bank_line_problem(status, "a reason"))

    def test_the_mark_makes_it_received_and_records_who_when_and_why(self):
        at = datetime(2026, 10, 13, 11, 30)
        self.assertEqual(
            no_bank_line_values("admin@nirmaan.app", "  Vendor confirmed by email ", at),
            {
                "status": "Received",
                "no_bank_line": 1,
                "no_bank_line_by": "admin@nirmaan.app",
                "no_bank_line_at": at,
                "no_bank_line_reason": "Vendor confirmed by email",
            },
        )

    def test_the_doctype_carries_the_mark_read_only(self):
        with open(_DOCTYPE_JSON, encoding="utf-8") as handle:
            doctype = json.load(handle)
        fields = {f["fieldname"]: f for f in doctype["fields"]}
        for fieldname in NO_BANK_LINE_FIELDS:
            with self.subTest(field=fieldname):
                self.assertIn(fieldname, doctype["field_order"])
                self.assertEqual(fields[fieldname].get("read_only"), 1)
        self.assertEqual(fields["no_bank_line"]["fieldtype"], "Check")
        self.assertEqual(fields["no_bank_line_by"]["options"], "User")
        self.assertEqual(fields["no_bank_line_at"]["fieldtype"], "Datetime")
