"""The project rule for assets (`services/asset_project.project_refusal`, owner 2026-10-15). Pure: no database.

Run: bench --site localhost run-tests --module nirmaan_stack.services.test_asset_project
"""

import unittest

from nirmaan_stack.services.asset_project import project_refusal


class TestProjectRefusal(unittest.TestCase):
    def test_no_project_is_always_fine(self):
        for kind in ("Project", "IT", None):
            self.assertIsNone(project_refusal(None, kind, False, None))
            self.assertIsNone(project_refusal("", kind, False, None))

    def test_a_won_project_on_a_project_asset(self):
        self.assertIsNone(project_refusal("PROJ-1", "Project", True, "Won"))

    def test_refusals(self):
        self.assertEqual(project_refusal("PROJ-1", "IT", True, "Won"), "Only Project assets can be booked to a project.")
        self.assertIn("doesn't exist", project_refusal("PROJ-X", "Project", False, None))
        self.assertIn("isn't Won", project_refusal("PROJ-1", "Project", True, "Tendering"))
        self.assertIn("isn't Won", project_refusal("PROJ-1", "Project", True, None))
