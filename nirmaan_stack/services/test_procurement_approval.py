"""Unit tests for the pure awaiting-approval rule (ADR-0010, rule B1).

These are PURE — no DB, no bench context. They pin the rule that the sidebar's SQL
aggregate must agree with. The aggregate↔rule parity on real rows is exercised
separately against live data (see the ADR); here we lock the rule itself.
"""

import unittest

from nirmaan_stack.services.procurement_approval import (
    AWAITING_APPROVAL_STATES,
    PENDING_ITEM_STATUS,
    has_pending_item,
    is_awaiting_approval,
)


class _Item:
    """Object-shaped order_list row (mirrors a frappe.get_doc child object)."""

    def __init__(self, status):
        self.status = status


class TestProcurementApprovalRule(unittest.TestCase):
    def test_constants(self):
        self.assertEqual(AWAITING_APPROVAL_STATES, frozenset({"Vendor Selected", "Partially Approved"}))
        self.assertEqual(PENDING_ITEM_STATUS, "Pending")

    # --- has_pending_item ------------------------------------------------
    def test_has_pending_item_dict_rows(self):
        self.assertTrue(has_pending_item([{"status": "Approved"}, {"status": "Pending"}]))
        self.assertFalse(has_pending_item([{"status": "Approved"}, {"status": "Sent Back"}]))

    def test_has_pending_item_object_rows(self):
        self.assertTrue(has_pending_item([_Item("Approved"), _Item("Pending")]))
        self.assertFalse(has_pending_item([_Item("Approved")]))

    def test_has_pending_item_empty_and_none(self):
        self.assertFalse(has_pending_item([]))
        self.assertFalse(has_pending_item(None))

    # --- is_awaiting_approval -------------------------------------------
    def test_awaiting_when_state_and_pending_item(self):
        for state in ("Vendor Selected", "Partially Approved"):
            self.assertTrue(is_awaiting_approval(state, [{"status": "Pending"}]), state)
            self.assertTrue(is_awaiting_approval(state, [_Item("Approved"), _Item("Pending")]), state)

    def test_not_awaiting_when_no_pending_item(self):
        for state in ("Vendor Selected", "Partially Approved"):
            self.assertFalse(is_awaiting_approval(state, [{"status": "Approved"}]), state)
            self.assertFalse(is_awaiting_approval(state, []), state)
            self.assertFalse(is_awaiting_approval(state, None), state)

    def test_not_awaiting_when_wrong_state(self):
        # A pending item in a non-approval state is NOT awaiting approval.
        for state in ("Vendor Approved", "Pending", "Approved", "Sent Back", "Delayed", "", None):
            self.assertFalse(is_awaiting_approval(state, [{"status": "Pending"}]), state)


if __name__ == "__main__":
    unittest.main()
