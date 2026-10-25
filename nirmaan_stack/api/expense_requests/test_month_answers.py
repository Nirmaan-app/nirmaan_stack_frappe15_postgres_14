# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""A form's month answers (spec #1522 review batch 2): a month and year, `YYYY-MM`, or refused.

PURE: no site and no DB. The endpoints that apply this are pinned by `test_office_rent_form`.

Run:
  devenv.sh unit nirmaan_stack.api.expense_requests.test_month_answers
"""

import json
import unittest

from nirmaan_stack.api.expense_requests.flatten import render_description_template
from nirmaan_stack.api.expense_requests.month_answers import is_month, month_problems

FORM = {
    "templateId": "office-rent", "templateVersion": 2,
    "description_template": "Office rent for {rent_month} – {office_location}.",
    "sections": [{"id": "detail", "type": "fields", "fields": [
        {"key": "rent_month", "label": "Rent Month", "type": "month", "required": True},
        {"key": "office_location", "label": "Office Location", "type": "text", "required": True},
    ]}],
}


def _answers(**detail):
    return json.dumps({"templateId": "office-rent", "templateVersion": 2, "responses": {"detail": detail}})


class TestMonthAnswers(unittest.TestCase):
    def test_a_month_and_year_is_accepted(self):
        for good in ("2026-10", "2026-01", "1999-12", " 2026-10 "):
            with self.subTest(month=good):
                self.assertTrue(is_month(good))
                self.assertEqual(month_problems(_answers(rent_month=good), FORM), [])

    def test_anything_else_is_refused_naming_the_field_and_the_answer(self):
        for bad in ("2026-10-01", "Oct 2026", "2026-13", "2026-00", "10-2026", "2026-1", "202610"):
            with self.subTest(month=bad):
                problems = month_problems(_answers(rent_month=bad), FORM)
                self.assertEqual(len(problems), 1)
                self.assertIn(f'Rent Month "{bad}" is not a month', problems[0])

    def test_a_blank_month_is_left_to_the_forms_required_check(self):
        self.assertEqual(month_problems(_answers(office_location="HQ"), FORM), [])

    def test_a_text_field_is_never_checked(self):
        self.assertEqual(month_problems(_answers(office_location="2026-10-01"), FORM), [])

    def test_no_form_or_no_answers_is_left_alone(self):
        self.assertEqual(month_problems(None, FORM), [])
        self.assertEqual(month_problems(_answers(rent_month="nope"), None), [])


class TestAMonthReadsAsMonthAndYear(unittest.TestCase):
    def test_the_sentence_names_the_month_and_year(self):
        self.assertEqual(render_description_template(_answers(rent_month="2026-10", office_location="HQ"), FORM),
                         "Office rent for Oct 2026 – HQ.")

    def test_a_full_date_still_reads_as_a_date(self):
        """A request raised against the form's date version keeps its date (its own frozen form)."""
        self.assertEqual(render_description_template(_answers(rent_month="2026-10-01", office_location="HQ"), FORM),
                         "Office rent for 1 Oct 2026 – HQ.")


if __name__ == "__main__":
    unittest.main()
