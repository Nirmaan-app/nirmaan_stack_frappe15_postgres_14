# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A card spend's expense type and description (#1568, ADR-0039 rulings 5 and 6). Pure.

    devenv.sh unit nirmaan_stack.services.outflow_import.test_card_types
"""

import json
import unittest
from pathlib import Path

from nirmaan_stack.services.outflow_import.card_types import (
    FALLBACK_EXPENSE_TYPE,
    TYPE_SOURCE_AI,
    TYPE_SOURCE_FALLBACK,
    TYPE_SOURCE_MEMORY,
    TYPE_SOURCE_REVIEW,
    TYPE_SOURCES,
    AiAnswer,
    choose_type,
    needs_check,
    spend_description,
)

_APP = Path(__file__).resolve().parents[2]


class TestTheDescription(unittest.TestCase):
    def test_it_names_the_merchant_and_the_holders_card(self):
        self.assertEqual(
            spend_description("MAKEMYTRIP(INDIA) P Gurgaon IN", "ARJUN TESTHOLDER"),
            "Card spend at MAKEMYTRIP, ARJUN TESTHOLDER's card",
        )

    def test_the_merchant_is_the_cleaned_name(self):
        self.assertEqual(
            spend_description("ZOMATO LIMITED Gurugram IN", "A HOLDER"), "Card spend at ZOMATO, A HOLDER's card"
        )


class TestTheCheckMark(unittest.TestCase):
    def test_the_fallback_is_marked_check(self):
        self.assertTrue(needs_check(TYPE_SOURCE_FALLBACK))

    def test_a_type_chosen_on_review_is_not(self):
        self.assertFalse(needs_check(TYPE_SOURCE_REVIEW))

    def test_the_fallback_type_is_misc_expenses(self):
        self.assertEqual(FALLBACK_EXPENSE_TYPE, "Misc. Expenses")


LIVE = ("Hotel Expenses", "Staff Welfare Expenses", "Misc. Expenses")


class TestChoosingASpendsType(unittest.TestCase):
    """Memory first, then a confident AI answer on the live list, else the fallback (ADR-0039 ruling 5)."""

    def test_a_remembered_type_wins_over_the_ai(self):
        self.assertEqual(
            choose_type("Hotel Expenses", AiAnswer("Staff Welfare Expenses", 0.99), LIVE),
            ("Hotel Expenses", TYPE_SOURCE_MEMORY),
        )

    def test_a_remembered_type_no_longer_live_is_ignored(self):
        self.assertEqual(
            choose_type("Old Type", AiAnswer("Hotel Expenses", 0.9), LIVE), ("Hotel Expenses", TYPE_SOURCE_AI)
        )

    def test_a_confident_answer_on_the_list_is_taken(self):
        self.assertEqual(choose_type(None, AiAnswer("Hotel Expenses", 0.7), LIVE), ("Hotel Expenses", TYPE_SOURCE_AI))

    def test_an_answer_off_the_list_is_the_fallback(self):
        self.assertEqual(choose_type(None, AiAnswer("Scaffolding Rent", 1.0), LIVE), (FALLBACK_EXPENSE_TYPE, TYPE_SOURCE_FALLBACK))

    def test_a_low_confidence_answer_is_the_fallback(self):
        self.assertEqual(choose_type(None, AiAnswer("Hotel Expenses", 0.69), LIVE), (FALLBACK_EXPENSE_TYPE, TYPE_SOURCE_FALLBACK))

    def test_no_answer_is_the_fallback(self):
        self.assertEqual(choose_type(None, None, LIVE), (FALLBACK_EXPENSE_TYPE, TYPE_SOURCE_FALLBACK))

    def test_the_ai_naming_the_fallback_itself_is_still_marked_check(self):
        self.assertEqual(choose_type(None, AiAnswer(FALLBACK_EXPENSE_TYPE, 0.95), LIVE), (FALLBACK_EXPENSE_TYPE, TYPE_SOURCE_FALLBACK))


class TestTheFixtureAndTheSchemaAgree(unittest.TestCase):
    def test_misc_expenses_is_a_non_project_type_in_the_fixture(self):
        types = json.loads((_APP / "fixtures" / "expense_type.json").read_text(encoding="utf-8"))
        [misc] = [row for row in types if row["name"] == FALLBACK_EXPENSE_TYPE]
        self.assertEqual(misc["non_project"], 1)

    def test_the_type_source_options_are_type_sources_in_order(self):
        path = _APP / "nirmaan_stack" / "doctype" / "outflow_import_row" / "outflow_import_row.json"
        [field] = [f for f in json.loads(path.read_text(encoding="utf-8"))["fields"] if f["fieldname"] == "type_source"]
        self.assertEqual(tuple(field["options"].split("\n")[1:]), TYPE_SOURCES)


if __name__ == "__main__":
    unittest.main()
