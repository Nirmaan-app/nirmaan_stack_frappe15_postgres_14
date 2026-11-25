"""The signature question (ADR-0050 decision 1) is asked only by an INVOICE_WITH_SIGNATURE read: a file read for a
GST-off Work Order with a generated invoice awaiting its signed copy. Every other invoice read (a PO invoice, an
expense bill, a porter PDF) is the plain INVOICE read, without it. Its answer travels with the other entities to
Add Invoice, which keeps them in `autofill_all_entities_json`.

Run: DEVENV unit nirmaan_stack.services.extraction.test_signature_question
"""

import unittest

from nirmaan_stack.services.extraction import gemini
from nirmaan_stack.services.extraction.base import SIGNATURE_PROMPT, with_signature
from nirmaan_stack.services.work_order_invoice_rules import SIGNATURE_ENTITY, SIGNED_ANSWERS


class TestTheSignatureQuestion(unittest.TestCase):
    def test_the_plain_invoice_read_does_not_ask_it(self):
        self.assertNotIn(SIGNATURE_ENTITY, gemini._INVOICE_FIELDS)
        self.assertNotIn(SIGNATURE_ENTITY, gemini._INVOICE_PROMPT)

    def test_the_signed_copy_read_asks_it(self):
        fields, prompt = with_signature(gemini._INVOICE_FIELDS, gemini._INVOICE_PROMPT)
        self.assertIn(SIGNATURE_ENTITY, fields)
        self.assertIn(SIGNATURE_ENTITY, prompt)
        for answer in SIGNED_ANSWERS:
            self.assertIn(f"'{answer}'", prompt)

    def test_the_signed_copy_read_is_the_invoice_read_plus_that_one_question(self):
        fields, prompt = with_signature(gemini._INVOICE_FIELDS, gemini._INVOICE_PROMPT)
        self.assertEqual(fields, gemini._INVOICE_FIELDS + (SIGNATURE_ENTITY,))
        self.assertIn(SIGNATURE_PROMPT, prompt)
        self.assertEqual(prompt.replace(SIGNATURE_PROMPT, ""), gemini._INVOICE_PROMPT)

    def test_its_answer_is_an_entity(self):
        fields, _ = with_signature(gemini._INVOICE_FIELDS, gemini._INVOICE_PROMPT)
        entities = gemini.GeminiExtractor()._to_entities({SIGNATURE_ENTITY: "stamped"}, fields)
        self.assertEqual([(e["type"], e["normalized_text"]) for e in entities], [(SIGNATURE_ENTITY, "stamped")])


if __name__ == "__main__":
    unittest.main()
