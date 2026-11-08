"""The Purchase Order invoice decision rule, pure (#1638): `decision_problem` on plain mappings, no DB.

Run: DEVENV unit nirmaan_stack.services.test_purchase_order_invoice_access
"""

import unittest

from nirmaan_stack.services.purchase_order_invoice_access import DECIDE_REFUSAL, decision_problem

PO, WO = "Procurement Orders", "Service Requests"


def inv(status="Pending", document_type=PO, **rest):
    return {"status": status, "document_type": document_type, "invoice_no": "INV-1", **rest}


def problem(before, after, may_decide=False, by_system=False):
    return decision_problem(before, after, may_decide=may_decide, by_system=by_system)


class TestAPersonsDecision(unittest.TestCase):
    def test_a_non_approver_may_not_approve_or_reject(self):
        for status in ("Approved", "Rejected"):
            self.assertEqual(problem(inv(), inv(status)), DECIDE_REFUSAL)

    def test_a_non_approver_may_not_move_a_decided_one_back(self):
        self.assertEqual(problem(inv("Approved"), inv("Pending")), DECIDE_REFUSAL)

    def test_an_approver_may(self):
        self.assertIsNone(problem(inv(), inv("Approved"), may_decide=True))
        self.assertIsNone(problem(inv(), inv("Rejected"), may_decide=True))

    def test_a_save_that_keeps_the_status_is_no_decision(self):
        self.assertIsNone(problem(inv(), inv(invoice_no="INV-2")))
        self.assertIsNone(problem(inv("Approved"), inv("Approved", reconciliation_status="full")))


class TestANewInvoice(unittest.TestCase):
    def test_uploading_a_pending_one_is_open_to_all(self):
        self.assertIsNone(problem(None, inv()))
        self.assertIsNone(problem(None, inv("")))

    def test_one_born_decided_takes_an_approver(self):
        self.assertEqual(problem(None, inv("Approved")), DECIDE_REFUSAL)
        self.assertIsNone(problem(None, inv("Approved"), may_decide=True))


class TestTheSystemsDecision(unittest.TestCase):
    def test_auto_approval_passes_without_the_role(self):
        self.assertIsNone(problem(inv(), inv("Approved"), by_system=True))


class TestWorkOrderInvoices(unittest.TestCase):
    def test_a_work_order_invoice_is_not_this_rules(self):
        self.assertIsNone(problem(inv(document_type=WO), inv("Approved", document_type=WO)))

    def test_moving_one_off_a_purchase_order_is_still_judged(self):
        self.assertEqual(problem(inv("Pending"), inv("Approved", document_type=WO)), DECIDE_REFUSAL)


if __name__ == "__main__":
    unittest.main()
