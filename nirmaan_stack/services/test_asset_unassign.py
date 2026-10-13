"""Pure tests for the unassign reason rule (`services/asset_unassign.py`).

Run: bench --site localhost run-tests --module nirmaan_stack.services.test_asset_unassign
"""

from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.asset_unassign import (
    OTHER,
    UNASSIGN_REASONS,
    unassign_reason_refusal,
    unassign_reason_text,
)


class TestUnassignReason(FrappeTestCase):
    def test_a_listed_reason_is_enough(self):
        self.assertIsNone(unassign_reason_refusal("Employee left / exit", None))
        self.assertIsNone(unassign_reason_refusal("Lost or stolen", "  "))

    def test_no_or_unknown_reason_is_refused(self):
        self.assertIsNotNone(unassign_reason_refusal(None, None))
        self.assertIsNotNone(unassign_reason_refusal("", "Returned on the last day"))
        self.assertIsNotNone(unassign_reason_refusal("aaaaaaaaaa", None))

    def test_other_needs_ten_characters_of_details(self):
        self.assertIn("at least 10", unassign_reason_refusal(OTHER, None))
        self.assertIsNotNone(unassign_reason_refusal(OTHER, "   too short   "))
        self.assertIsNone(unassign_reason_refusal(OTHER, "Sent to the Pune office"))

    def test_text_kept_in_the_history(self):
        self.assertEqual(unassign_reason_text("Lost or stolen", None), "Lost or stolen")
        self.assertEqual(
            unassign_reason_text("Employee left / exit", "  returned on   last day "),
            "Employee left / exit — returned on last day",
        )

    def test_other_is_the_last_choice(self):
        self.assertEqual(UNASSIGN_REASONS[-1], OTHER)
