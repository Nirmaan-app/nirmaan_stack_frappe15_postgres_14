"""Unit tests for `services/snag_photo.py` -- pure, no database.

The write paths that enforce the rule are tested against the site in
`api/snags/test_snag_api.py`; this pins the rule itself, both sides of every boundary.
"""

import unittest

from nirmaan_stack.services.snag_photo import photo_rule_violation

PHOTO = "/api/method/frappe_gcp_attachment.controller.generate_file?key=a&file_name=a.jpg"
OTHER = "/api/method/frappe_gcp_attachment.controller.generate_file?key=b&file_name=b.jpg"


class TestPhotoRule(unittest.TestCase):
    def test_moving_into_completed_needs_a_photo(self):
        for previous in ("Pending", "WIP", "Not Applicable", None):
            with self.subTest(previous=previous):
                self.assertIsNotNone(photo_rule_violation(previous, "Completed", None, None))
                self.assertIsNone(photo_rule_violation(previous, "Completed", None, PHOTO))

    def test_a_completed_snag_cannot_drop_its_photo_but_may_replace_it(self):
        self.assertIsNotNone(photo_rule_violation("Completed", "Completed", PHOTO, None))
        self.assertIsNone(photo_rule_violation("Completed", "Completed", PHOTO, OTHER))

    def test_a_legacy_completed_snag_with_no_photo_is_left_alone(self):
        self.assertIsNone(photo_rule_violation("Completed", "Completed", None, None))

    def test_no_other_status_needs_a_photo(self):
        for status in ("Pending", "WIP", "Not Applicable"):
            with self.subTest(status=status):
                self.assertIsNone(photo_rule_violation("Completed", status, PHOTO, None))
                self.assertIsNone(photo_rule_violation(None, status, None, None))


if __name__ == "__main__":
    unittest.main()
