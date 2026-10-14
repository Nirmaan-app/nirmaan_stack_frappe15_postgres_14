"""Pure tests for the monthly asset audit rules (`services/asset_audit.py`).

Run: bench --site localhost run-tests --module nirmaan_stack.services.test_asset_audit
"""

import re
from datetime import date

from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.asset_audit import (
    AUDIT_CONDITIONS,
    AUDIT_FULFILLED,
    AUDIT_PENDING,
    NOTE_HANDOVER,
    audit_month_label,
    created_text,
    cycle_month,
    for_month_pattern,
    fulfilled_text,
    month_start,
    submit_refusal,
)


class TestAuditMonth(FrappeTestCase):
    def test_the_month_is_two_digits_slash_year(self):
        self.assertEqual(audit_month_label(date(2026, 9, 30)), "09/2026")
        self.assertEqual(audit_month_label(date(2026, 10, 1)), "10/2026")
        self.assertEqual(audit_month_label(date(2027, 1, 15)), "01/2027")

    def test_every_day_of_a_month_is_the_same_audit_month(self):
        self.assertEqual(audit_month_label(date(2026, 2, 1)), audit_month_label(date(2026, 2, 28)))
        self.assertNotEqual(audit_month_label(date(2026, 1, 31)), audit_month_label(date(2026, 2, 1)))

    def test_from_the_28th_an_audit_belongs_to_next_month(self):
        self.assertEqual(cycle_month(date(2026, 10, 1)), date(2026, 10, 1))
        self.assertEqual(cycle_month(date(2026, 10, 27)), date(2026, 10, 1))
        self.assertEqual(cycle_month(date(2026, 10, 28)), date(2026, 11, 1))
        self.assertEqual(cycle_month(date(2026, 10, 31)), date(2026, 11, 1))
        self.assertEqual(cycle_month(date(2026, 12, 28)), date(2027, 1, 1))
        self.assertEqual(cycle_month(date(2026, 2, 28)), date(2026, 3, 1))

    def test_month_start(self):
        self.assertEqual(month_start(date(2026, 10, 14)), date(2026, 10, 1))
        self.assertEqual(month_start(date(2026, 10, 1)), date(2026, 10, 1))

    def test_created_text(self):
        self.assertEqual(created_text(date(2026, 10, 14)), "10/2026")
        self.assertEqual(created_text(date(2026, 10, 14), NOTE_HANDOVER), "10/2026 · handover")


class TestSubmitRule(FrappeTestCase):
    def test_a_good_audit_with_a_photo_is_accepted(self):
        for condition in ("Good", "Fair"):
            self.assertIsNone(submit_refusal(AUDIT_PENDING, condition, True, None))

    def test_only_an_open_audit_can_be_sent(self):
        self.assertIn("already submitted", submit_refusal(AUDIT_FULFILLED, "Good", True, None))
        self.assertIn("no audit waiting", submit_refusal(None, "Good", True, None))
        self.assertIn("no audit waiting", submit_refusal("", "Good", True, None))

    def test_the_condition_must_be_one_of_the_four(self):
        self.assertEqual(AUDIT_CONDITIONS, ("Good", "Fair", "Poor", "Damaged"))
        for bad in (None, "", "New", "Lost", "good"):
            self.assertIsNotNone(submit_refusal(AUDIT_PENDING, bad, True, None), bad)

    def test_a_photo_is_required(self):
        self.assertIn("photo", submit_refusal(AUDIT_PENDING, "Good", False, "all fine here"))

    def test_poor_and_damaged_need_ten_characters_of_remarks(self):
        for condition in ("Poor", "Damaged"):
            self.assertIn("at least 10", submit_refusal(AUDIT_PENDING, condition, True, None))
            self.assertIsNotNone(submit_refusal(AUDIT_PENDING, condition, True, "   cracked  "))
            self.assertIsNone(submit_refusal(AUDIT_PENDING, condition, True, "Screen cracked at the corner"))

    def test_the_status_is_checked_before_anything_else(self):
        """A second tab with an empty form must hear "already submitted", not "add a photo"."""
        self.assertIn("already submitted", submit_refusal(AUDIT_FULFILLED, None, False, None))


class TestFulfilledText(FrappeTestCase):
    def test_unchanged_condition_is_the_condition_and_the_month(self):
        self.assertEqual(fulfilled_text("Good", "Good", "10/2026", None), "Good · for 10/2026")
        self.assertEqual(fulfilled_text("Good", None, None, "  "), "Good")

    def test_a_change_names_the_old_condition_then_the_month_then_the_remarks(self):
        self.assertEqual(
            fulfilled_text("Damaged", "Fair", "09/2026", " Screen cracked "),
            "Damaged · was Fair · for 09/2026 · Screen cracked",
        )

    def test_the_for_month_pattern_reads_the_month_in_its_place_only(self):
        """The "already sent for that month" check (`due_assignments`) matches the history text with this."""
        def sent_for(label, text):
            return bool(re.search(for_month_pattern(label), text))

        self.assertTrue(sent_for("10/2026", fulfilled_text("Good", "Good", "10/2026", None)))
        self.assertTrue(sent_for("09/2026", fulfilled_text("Damaged", "Fair", "09/2026", "Screen cracked")))
        self.assertFalse(sent_for("10/2026", fulfilled_text("Good", "Good", "09/2026", None)))
        # the remarks never count, however they are worded
        self.assertFalse(sent_for("10/2026", fulfilled_text("Damaged", "Fair", "09/2026", "for 10/2026 too")))
        self.assertFalse(sent_for("10/2026", fulfilled_text("Poor", "Good", "09/2026", "worse · for 10/2026")))
        self.assertFalse(sent_for("10/2026", "Good · for 10/20267"))

    def test_it_always_starts_with_the_condition(self):
        """The Fulfilled list filters by condition with a prefix match."""
        for condition in AUDIT_CONDITIONS:
            self.assertTrue(fulfilled_text(condition, "New", "10/2026", "x").startswith(condition))
