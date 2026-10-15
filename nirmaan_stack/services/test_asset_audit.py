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
    MAX_ANSWER_TEXT_LENGTH,
    MAX_AUDIT_ANSWERS,
    NOTE_HANDOVER,
    audit_month_label,
    clean_answers,
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
    def test_an_open_audit_with_a_photo_is_accepted(self):
        self.assertIsNone(submit_refusal(AUDIT_PENDING, True))

    def test_only_an_open_audit_can_be_sent(self):
        self.assertIn("already submitted", submit_refusal(AUDIT_FULFILLED, True))
        self.assertIn("no audit waiting", submit_refusal(None, True))
        self.assertIn("no audit waiting", submit_refusal("", True))

    def test_a_photo_is_required(self):
        self.assertIn("photo", submit_refusal(AUDIT_PENDING, False))

    def test_the_status_is_checked_before_anything_else(self):
        """A second tab with an empty form must hear "already submitted", not "add a photo"."""
        self.assertIn("already submitted", submit_refusal(AUDIT_FULFILLED, False))


class TestFulfilledText(FrappeTestCase):
    """No condition since 2026-10-15: the month the audit was for, then the remarks."""

    def test_the_month_then_the_remarks(self):
        self.assertEqual(fulfilled_text("10/2026", None), "for 10/2026")
        self.assertEqual(fulfilled_text("10/2026", "  "), "for 10/2026")
        self.assertEqual(fulfilled_text("09/2026", " Kept in the site store "), "for 09/2026 · Kept in the site store")
        self.assertEqual(fulfilled_text(None, "x"), "x")

    def test_the_for_month_pattern_reads_the_month_in_its_place_only(self):
        """The "already sent for that month" check (`due_assignments`) matches the history text with this."""
        def sent_for(label, text):
            return bool(re.search(for_month_pattern(label), text))

        self.assertTrue(sent_for("10/2026", fulfilled_text("10/2026", None)))
        self.assertTrue(sent_for("09/2026", fulfilled_text("09/2026", "Screen cracked")))
        self.assertFalse(sent_for("10/2026", fulfilled_text("09/2026", None)))
        # the remarks never count, however they are worded
        self.assertFalse(sent_for("10/2026", fulfilled_text("09/2026", "for 10/2026 too")))
        self.assertFalse(sent_for("10/2026", fulfilled_text("09/2026", "worse · for 10/2026")))
        self.assertFalse(sent_for("10/2026", "for 10/20267"))

    def test_the_pattern_still_reads_rows_sent_before_the_condition_was_dropped(self):
        def sent_for(label, text):
            return bool(re.search(for_month_pattern(label), text))

        for condition in AUDIT_CONDITIONS:
            self.assertTrue(sent_for("10/2026", f"{condition} · for 10/2026"), condition)
        self.assertTrue(sent_for("09/2026", "Damaged · was Fair · for 09/2026 · Screen cracked"))
        self.assertFalse(sent_for("10/2026", "Damaged · was Fair · for 09/2026 · for 10/2026 too"))
        self.assertFalse(sent_for("10/2026", "Kept at · for 10/2026"))  # only a real condition may come first


# Answers as the Submit audit dialog sends them: each with its question and choice text.
GOOD = [
    {"id": "who", "q": "Who is using this device?", "a": "Only me, for work"},
    {"id": "works", "q": "Does it work properly?", "a": "Yes, it works fine"},
    {"id": "damage", "q": "Is it damaged anywhere?", "a": "No damage"},
    {"id": "charger", "q": "Do you have its charger and cables?", "a": "Yes, I have them"},
]


class TestCleanAnswers(FrappeTestCase):
    def test_answers_are_saved_as_sent(self):
        saved, refusal = clean_answers([dict(a) for a in GOOD])
        self.assertIsNone(refusal)
        self.assertEqual(saved, GOOD)

    def test_a_red_answer_keeps_its_note_trimmed_and_drops_an_empty_one(self):
        answers = [dict(a) for a in GOOD]
        answers[2] = {"id": "damage", "q": "Is it damaged anywhere?", "a": "Small damage: scratches or dents", "flag": True,
                      "text": "  Dent on the lid  "}
        answers[3] = {"id": "charger", "q": "Do you have its charger and cables?", "a": "No, they're missing", "flag": 1, "text": " "}
        saved, refusal = clean_answers(answers)
        self.assertIsNone(refusal)
        self.assertEqual(saved[2], {"id": "damage", "q": "Is it damaged anywhere?", "a": "Small damage: scratches or dents",
                                    "flag": 1, "text": "Dent on the lid"})
        self.assertEqual(saved[3], {"id": "charger", "q": "Do you have its charger and cables?", "a": "No, they're missing", "flag": 1})

    def test_a_note_under_an_answer_that_is_not_red_is_dropped(self):
        answers = [dict(a) for a in GOOD]
        answers[0]["text"] = "ignored"
        saved, _ = clean_answers(answers)
        self.assertNotIn("text", saved[0])
        self.assertNotIn("flag", saved[0])

    def test_refusals(self):
        long_note = {"id": "damage", "q": "Is it damaged anywhere?", "a": "Small damage", "flag": 1,
                     "text": "x" * (MAX_ANSWER_TEXT_LENGTH + 1)}
        cases = [
            (None, "Answer the questions"),
            ([], "Answer the questions"),
            ("who=me", "Answer the questions"),
            ([["who", "me"]], "Answer the questions"),
            ([{"id": "who", "q": "Who is using this device?", "a": ""}], "missing"),
            ([{"id": "", "q": "Q?", "a": "A"}], "missing"),
            ([{"id": "who", "q": "x" * 301, "a": "A"}], "missing"),
            (GOOD + [GOOD[0]], "answered twice"),
            ([{"id": f"q{i}", "q": "Q?", "a": "A"} for i in range(MAX_AUDIT_ANSWERS + 1)], "Too many answers"),
            ([long_note], "under 200"),
        ]
        for answers, message in cases:
            saved, refusal = clean_answers(answers)
            self.assertIsNone(saved, message)
            self.assertIn(message, refusal or "", message)
