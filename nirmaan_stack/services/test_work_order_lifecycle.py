"""The Work Order lifecycle rules, pure (#1529). The role checks through a real save are in
`nirmaan_stack/doctype/service_requests/test_work_order_lifecycle.py`.

Run: DEVENV unit nirmaan_stack.services.test_work_order_lifecycle
"""

import unittest

from nirmaan_stack.services.work_order_lifecycle import DECIDE_REFUSAL, approval_record, change_problem


def _wo(status):
    return {"status": status}


class TestWhoDecides(unittest.TestCase):
    def test_moves_into_approved_or_rejected_need_an_approver(self):
        for before, after in (
            ("Vendor Selected", "Approved"),
            ("Vendor Selected", "Rejected"),
            ("Amendment", "Approved"),
        ):
            with self.subTest(before=before, after=after):
                self.assertEqual(change_problem(_wo(before), _wo(after), may_decide=False), DECIDE_REFUSAL)
                self.assertIsNone(change_problem(_wo(before), _wo(after), may_decide=True))

    def test_a_new_work_order_saved_straight_as_approved_needs_an_approver(self):
        self.assertEqual(change_problem(None, _wo("Approved"), may_decide=False), DECIDE_REFUSAL)
        self.assertIsNone(change_problem(None, _wo("Vendor Selected"), may_decide=False))

    def test_other_saves_need_no_approver(self):
        for before, after in (
            ("Approved", "Approved"),       # GST switch, Edit terms
            ("Approved", "Amendment"),      # Amend
            ("Rejected", "Vendor Selected"),  # edit and resend
            ("Rejected", "Rejected"),
        ):
            with self.subTest(before=before, after=after):
                self.assertIsNone(change_problem(_wo(before), _wo(after), may_decide=False))


APPROVER, NOW = "approver@example.com", "2026-10-22 11:30:00"
STAMPED = {"approved_on": "2026-01-05 10:00:00", "approved_by": "first@example.com"}


class TestApprovalRecord(unittest.TestCase):
    """What a save stores as the Work Order's approved-on and approved-by (#1532)."""

    def _record(self, before, after):
        return approval_record(before, after, user=APPROVER, now=NOW)

    def test_approving_stamps_who_and_when(self):
        for before in (_wo("Vendor Selected"), None):
            with self.subTest(before=before):
                self.assertEqual(
                    self._record(before, _wo("Approved")), {"approved_on": NOW, "approved_by": APPROVER}
                )

    def test_later_saves_keep_the_stamp_whatever_they_send(self):
        """A payment, invoice, GST or notes save of an Approved WO, an amend, and the accept or revert of
        an amendment (which moves it back into Approved) all keep the first approval."""
        sent = {"approved_on": NOW, "approved_by": "someone-else@example.com"}
        for before, after in (("Approved", "Approved"), ("Approved", "Amendment"), ("Amendment", "Approved")):
            with self.subTest(before=before, after=after):
                self.assertEqual(self._record({**_wo(before), **STAMPED}, {**_wo(after), **sent}), STAMPED)

    def test_an_unapproved_work_order_has_no_stamp(self):
        sent = {"approved_on": NOW, "approved_by": APPROVER}
        for before, after in ((None, "Vendor Selected"), ("Vendor Selected", "Rejected")):
            with self.subTest(before=before, after=after):
                self.assertEqual(
                    self._record(_wo(before) if before else None, {**_wo(after), **sent}),
                    {"approved_on": None, "approved_by": None},
                )


if __name__ == "__main__":
    unittest.main()
