"""Pure tests for the asset department rules (`services/asset_department.py`).

Departments are Nirmaan Department records (Links), so moves compare the names exactly.

Run: bench --site localhost run-tests --module nirmaan_stack.services.test_asset_department
"""

from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.asset_department import (
    MIN_REASON_LENGTH,
    can_edit_asset_department,
    department_move,
    needs_reason,
    normalize_department,
    reason_refusal,
)


class TestNormalize(FrappeTestCase):
    def test_spaces_are_trimmed_and_collapsed(self):
        self.assertEqual(normalize_department("  Site   Projects "), "Site Projects")

    def test_empty_becomes_none(self):
        self.assertIsNone(normalize_department("   "))
        self.assertIsNone(normalize_department(None))


class TestDepartmentMove(FrappeTestCase):
    def test_same_department_does_not_move(self):
        self.assertIsNone(department_move("Projects", "Projects"))

    def test_names_are_compared_exactly(self):
        # Link values are record names; a different spelling would be a different record
        self.assertEqual(department_move("Projects", "projects"), ("Projects", "projects"))

    def test_person_without_department_does_not_move_the_asset(self):
        self.assertIsNone(department_move("Projects", None))
        self.assertIsNone(department_move("Projects", ""))

    def test_other_department_moves_from_to(self):
        self.assertEqual(department_move("Projects", "Accounts"), ("Projects", "Accounts"))

    def test_asset_without_department_takes_the_persons(self):
        self.assertEqual(department_move(None, "Accounts"), (None, "Accounts"))
        self.assertEqual(department_move("", "Accounts"), (None, "Accounts"))


class TestReason(FrappeTestCase):
    def test_reason_needed_only_to_leave_a_department(self):
        self.assertTrue(needs_reason(("Projects", "Accounts")))
        self.assertFalse(needs_reason((None, "Accounts")))
        self.assertFalse(needs_reason(None))

    def test_missing_or_short_reason_is_refused(self):
        move = ("Projects", "Accounts")
        self.assertIn("Projects", reason_refusal(move, None))
        self.assertIn("Accounts", reason_refusal(move, "x" * (MIN_REASON_LENGTH - 1)))
        self.assertIsNotNone(reason_refusal(move, "   " + "x" * 5 + "   "))  # spaces don't count

    def test_good_reason_passes(self):
        self.assertIsNone(reason_refusal(("Projects", "Accounts"), "Moved to the accounts team"))

    def test_no_reason_needed_when_nothing_leaves(self):
        self.assertIsNone(reason_refusal(None, None))
        self.assertIsNone(reason_refusal((None, "Accounts"), None))


class TestEditRule(FrappeTestCase):
    def test_empty_department_can_always_be_filled(self):
        self.assertTrue(can_edit_asset_department(None, has_been_assigned=True))

    def test_never_assigned_asset_can_be_fixed(self):
        self.assertTrue(can_edit_asset_department("Projects", has_been_assigned=False))

    def test_assigned_asset_cannot_be_moved_in_edit(self):
        self.assertFalse(can_edit_asset_department("Projects", has_been_assigned=True))
        self.assertTrue(can_edit_asset_department("   ", has_been_assigned=True))
