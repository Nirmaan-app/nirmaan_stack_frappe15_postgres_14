# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `services.outflow_import.import_comment` -- the comment an imported expense carries.

Pure: no bench, no fixtures, no database. The DB-level behaviour (the comment landing on a created
expense, and the refusal reaching the person) lives in `api/outflow_import/test_expenses.py`.
"""

import ast
import unittest
from pathlib import Path

from nirmaan_stack.services.outflow_import.import_comment import (
    COMMENT_MAX_LENGTH,
    import_comment,
    import_comment_problem,
)

BATCH = "OFI-26-00012"


class TestTheImportComment(unittest.TestCase):
    def test_no_typed_comment_is_the_import_note_alone(self):
        self.assertEqual(import_comment(None, BATCH), "Imported from OFI-26-00012")

    def test_a_blank_typed_comment_is_the_import_note_alone(self):
        self.assertEqual(import_comment("   ", BATCH), "Imported from OFI-26-00012")

    def test_a_typed_comment_keeps_the_import_note_after_it(self):
        self.assertEqual(
            import_comment("  Site rent, Sep  ", BATCH),
            "Site rent, Sep · Imported from OFI-26-00012",
        )


class TestTheLengthLimit(unittest.TestCase):
    """`comment` is a Data field on both expense ledgers: 140 characters, then the database refuses."""

    def test_the_limit_is_the_data_field_width(self):
        self.assertEqual(COMMENT_MAX_LENGTH, 140)

    def test_a_comment_that_fits_has_no_problem(self):
        self.assertIsNone(import_comment_problem("Site rent, Sep", BATCH))
        self.assertIsNone(import_comment_problem(None, BATCH))

    def test_the_longest_comment_that_fits_has_no_problem(self):
        room = COMMENT_MAX_LENGTH - len(import_comment("", BATCH)) - len(" · ")
        self.assertIsNone(import_comment_problem("x" * room, BATCH))
        self.assertEqual(len(import_comment("x" * room, BATCH)), COMMENT_MAX_LENGTH)

    def test_one_character_more_is_refused_and_the_refusal_says_how_long_it_may_be(self):
        room = COMMENT_MAX_LENGTH - len(import_comment("", BATCH)) - len(" · ")
        problem = import_comment_problem("x" * (room + 1), BATCH)
        self.assertIsNotNone(problem)
        self.assertIn(str(room), problem)



# The screen's cap (`NEW_EXPENSE_COMMENT_MAX`) is joined to these values by the parity test
# `frontend/src/pages/outflow-import/commentCapParity.test.ts`, which reads this module as text.


class TestPurity(unittest.TestCase):
    def test_it_imports_nothing_but_the_standard_library(self):
        from nirmaan_stack.services.outflow_import import import_comment as module

        tree = ast.parse(Path(module.__file__).read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    self.assertNotIn("frappe", alias.name)
            elif isinstance(node, ast.ImportFrom) and node.module:
                self.assertNotIn("frappe", node.module)
