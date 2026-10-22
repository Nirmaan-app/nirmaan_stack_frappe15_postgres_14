# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""A form's PAN answers (spec #1522, #1524): uppercased, and refused unless shaped like a PAN.

PURE: no site and no DB. The endpoint that applies this is pinned by `test_office_rent_form`.

Run:
  devenv.sh unit nirmaan_stack.api.expense_requests.test_pan_answers
"""

import json
import unittest

from nirmaan_stack.api.expense_requests.pan_answers import clean_pan_answers

FORM = {
    "templateId": "office-rent", "templateVersion": 1,
    "sections": [{"id": "detail", "type": "fields", "fields": [
        {"key": "landlord_name", "label": "Landlord Name", "type": "text", "required": True},
        {"key": "landlord_pan", "label": "Landlord PAN", "type": "pan", "required": True},
    ]}],
}


def _answers(**detail):
    return json.dumps({"templateId": "office-rent", "templateVersion": 1,
                       "responses": {"detail": detail}})


def _detail(source_data):
    return json.loads(source_data)["responses"]["detail"]


class TestPanAnswers(unittest.TestCase):
    def test_a_lowercase_pan_is_stored_uppercased(self):
        cleaned, problems = clean_pan_answers(_answers(landlord_name="Asha", landlord_pan=" abcpk1234d "), FORM)
        self.assertEqual(problems, [])
        self.assertEqual(_detail(cleaned), {"landlord_name": "Asha", "landlord_pan": "ABCPK1234D"})

    def test_a_pan_not_shaped_like_one_is_refused_naming_the_field(self):
        for bad in ("ABC123", "ABCPK1234", "ABCPK12345", "1BCPK1234D", "ABCPKX234D"):
            with self.subTest(pan=bad):
                _cleaned, problems = clean_pan_answers(_answers(landlord_pan=bad), FORM)
                self.assertEqual(len(problems), 1)
                self.assertIn("Landlord PAN", problems[0])
                self.assertIn(bad, problems[0])

    def test_a_blank_pan_is_left_to_the_forms_required_check(self):
        cleaned, problems = clean_pan_answers(_answers(landlord_name="Asha"), FORM)
        self.assertEqual(problems, [])
        self.assertEqual(_detail(cleaned), {"landlord_name": "Asha"})

    def test_a_text_field_is_never_uppercased(self):
        cleaned, _problems = clean_pan_answers(_answers(landlord_name="asha", landlord_pan="abcpk1234d"), FORM)
        self.assertEqual(_detail(cleaned)["landlord_name"], "asha")

    def test_a_form_with_no_pan_field_leaves_the_answers_untouched(self):
        form = {"sections": [{"id": "detail", "type": "fields", "fields": [
            {"key": "landlord_pan", "label": "PAN as text", "type": "text"}]}]}
        raw = _answers(landlord_pan="abc123")
        self.assertEqual(clean_pan_answers(raw, form), (raw, []))

    def test_no_form_or_no_answers_is_left_alone(self):
        self.assertEqual(clean_pan_answers(None, FORM), (None, []))
        raw = _answers(landlord_pan="abc123")
        self.assertEqual(clean_pan_answers(raw, None), (raw, []))


if __name__ == "__main__":
    unittest.main()
