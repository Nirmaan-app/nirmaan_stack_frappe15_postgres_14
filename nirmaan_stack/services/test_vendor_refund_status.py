# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A Vendor Refund's status, and which statuses count for what (#1398, ADR-0032).

Pure module -- no site, no DB.

The doctype's Select is pinned to the code's list, so the JSON and the rules cannot drift. The two
groupings are pinned to the spec's words: only a *Received* refund lowers a paid amount, while the
refund cap counts *Received* and *Reconciliation Pending* together, so a waiting refund holds its
amount back from the next one. A *Cancelled* refund counts for nothing.
"""

import json
import os
import unittest

from nirmaan_stack.services.vendor_refunds import (
    LOWERS_PAID_STATUSES,
    REFUND_STATUSES,
    TAKES_REFUNDABLE_STATUSES,
)

_DOCTYPE_JSON = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "nirmaan_stack",
    "doctype",
    "vendor_refunds",
    "vendor_refunds.json",
)


class TestTheStatus(unittest.TestCase):
    def test_the_doctype_select_is_this_list_in_this_order_and_required(self):
        with open(_DOCTYPE_JSON, encoding="utf-8") as handle:
            fields = {f["fieldname"]: f for f in json.load(handle)["fields"]}
        status = fields["status"]
        self.assertEqual(status["fieldtype"], "Select")
        self.assertEqual(status["options"].split("\n"), list(REFUND_STATUSES))
        self.assertEqual(status.get("reqd"), 1)

    def test_the_three_statuses(self):
        self.assertEqual(REFUND_STATUSES, ("Reconciliation Pending", "Received", "Cancelled"))

    def test_only_a_received_refund_lowers_a_paid_amount(self):
        self.assertEqual(set(LOWERS_PAID_STATUSES), {"Received"})

    def test_the_cap_counts_received_and_waiting_refunds_but_not_cancelled_ones(self):
        self.assertEqual(set(TAKES_REFUNDABLE_STATUSES), {"Received", "Reconciliation Pending"})
