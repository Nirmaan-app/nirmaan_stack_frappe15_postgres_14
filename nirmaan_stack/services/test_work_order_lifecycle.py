"""The Work Order lifecycle rules, pure (#1529). The role checks through a real save are in
`nirmaan_stack/doctype/service_requests/test_work_order_lifecycle.py`.

Run: DEVENV unit nirmaan_stack.services.test_work_order_lifecycle
"""

import unittest

from nirmaan_stack.services.work_order_lifecycle import DECIDE_REFUSAL, change_problem


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


if __name__ == "__main__":
    unittest.main()
