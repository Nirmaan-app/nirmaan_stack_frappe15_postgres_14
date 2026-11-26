"""The Work Order invoice rule, pure: the System's own decision (ADR-0014 Amendment C, ADR-0050 decision 6).

Run: DEVENV unit nirmaan_stack.services.test_work_order_invoice_access
"""

import unittest

from nirmaan_stack.services.work_order_invoice_access import (
    DECIDE_REFUSAL,
    GENERATED_EDIT_REFUSAL,
    change_problem,
)

WO = "Service Requests"


def inv(status="Pending", **rest):
    return {"status": status, "document_type": WO, "invoice_no": "INV-1", "invoice_amount": 1000, **rest}


def problem(before, after, by_system=False, generated=False):
    """As a user who may not decide, edit or override: an uploader from procurement."""
    return change_problem(
        before, after, may_decide=False, may_edit=False, may_override_decision=False,
        generated=generated, by_system=by_system,
    )


class TestTheSystemsDecision(unittest.TestCase):
    def test_the_system_approves_a_pending_one_whoever_uploaded_it(self):
        self.assertIsNone(problem(inv(), inv("Approved"), by_system=True))

    def test_a_person_without_the_role_still_may_not(self):
        self.assertEqual(problem(inv(), inv("Approved")), DECIDE_REFUSAL)

    def test_the_system_approves_a_generated_invoices_signed_copy(self):
        self.assertIsNone(problem(inv(), inv("Approved"), by_system=True, generated=True))

    def test_the_flag_does_not_open_the_edit_rules(self):
        # Amendment C decision 3: nobody changes a signed copy's figures, the System included.
        self.assertEqual(
            problem(inv(), inv("Approved", invoice_amount=2000), by_system=True, generated=True),
            GENERATED_EDIT_REFUSAL,
        )


if __name__ == "__main__":
    unittest.main()
