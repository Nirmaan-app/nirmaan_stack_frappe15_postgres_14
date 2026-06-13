# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Unit tests for the deterministic invoice-line → PO-item matcher.

Pure functions — no Frappe site needed. Run inside the bench venv:
    python -m unittest nirmaan_stack.api.invoices.test_line_match
"""
import unittest

from nirmaan_stack.api.invoices._line_match import (
    _norm_unit,
    match_invoice_lines_to_po,
)

PO = [
    {"item_id": "ITM-1", "item_name": "Cement OPC 53 Grade", "unit": "Bags",
     "quantity": 100, "received_quantity": 0, "quote": 350.0, "amount": 35000.0},
    {"item_id": "ITM-2", "item_name": "TMT Steel Bar 12mm", "unit": "Kg",
     "quantity": 500, "received_quantity": 0, "quote": 62.0, "amount": 31000.0},
    {"item_id": "ITM-3", "item_name": "River Sand", "unit": "Brass",
     "quantity": 10, "received_quantity": 0, "quote": 4500.0, "amount": 45000.0},
]


class TestFuzzyMatch(unittest.TestCase):
    def test_clean_name_and_rate_match(self):
        lines = [{"description": "Cement OPC 53 Grade", "unit": "Bags",
                  "quantity": 100, "rate": 350, "amount": 35000}]
        m = match_invoice_lines_to_po(lines, PO)["mappings"][0]
        self.assertEqual(m["status"], "matched")
        self.assertEqual(m["po_item_id"], "ITM-1")
        self.assertEqual(m["source"], "fuzzy")

    def test_one_to_one_assignment(self):
        lines = [
            {"description": "Cement OPC 53 Grade", "unit": "Bags", "quantity": 100, "rate": 350, "amount": 35000},
            {"description": "TMT Steel Bar 12mm", "unit": "Kg", "quantity": 500, "rate": 62, "amount": 31000},
        ]
        res = match_invoice_lines_to_po(lines, PO)
        self.assertEqual(res["mappings"][0]["po_item_id"], "ITM-1")
        self.assertEqual(res["mappings"][1]["po_item_id"], "ITM-2")
        self.assertEqual(res["summary"]["matched"], 2)

    def test_charge_line_is_non_item(self):
        m = match_invoice_lines_to_po([{"description": "Freight Charges", "amount": 2000}], PO)["mappings"][0]
        self.assertEqual(m["status"], "non_item")
        self.assertIsNone(m["po_item_id"])

    def test_unrelated_line_is_unmatched(self):
        lines = [{"description": "Random Widget XYZ", "unit": "Nos", "rate": 9999, "amount": 9999}]
        self.assertEqual(match_invoice_lines_to_po(lines, PO)["mappings"][0]["status"], "unmatched")

    def test_over_billing_flagged(self):
        # Matches ITM-1 but qty 150 > 100 and amount 52500 > 35000.
        lines = [{"description": "Cement OPC 53 Grade", "unit": "Bags", "quantity": 150, "rate": 350, "amount": 52500}]
        m = match_invoice_lines_to_po(lines, PO)["mappings"][0]
        self.assertEqual(m["status"], "matched")
        self.assertTrue(m["over_billing"]["would_exceed"])
        self.assertTrue(m["over_billing"]["amount_exceeded"])
        self.assertTrue(m["over_billing"]["qty_exceeded"])


class TestGeminiResidue(unittest.TestCase):
    # A line fuzzy can't place (opaque description, wrong unit) but whose rate
    # exactly matches a PO item — the residue path should resolve it.
    RESIDUE_LINE = {"description": "Opaque Code 7731", "unit": "Box",
                    "quantity": 500, "rate": 62, "amount": 31000}

    def test_gemini_suggestion_accepted_when_numbers_corroborate(self):
        def mapper(residue, cands):
            return [{"invoice_line_index": residue[0]["invoice_line_index"], "po_item_id": "ITM-2"}]
        m = match_invoice_lines_to_po([self.RESIDUE_LINE], PO, residue_mapper=mapper)["mappings"][0]
        self.assertEqual(m["status"], "matched")
        self.assertEqual(m["po_item_id"], "ITM-2")
        self.assertEqual(m["source"], "gemini")

    def test_gemini_suggestion_rejected_when_numbers_contradict(self):
        # Same opaque line but rate nowhere near ITM-3, and name unrelated → the
        # backend must REFUSE the model's proposal.
        line = {"description": "Opaque Code 7731", "unit": "Box", "quantity": 1, "rate": 99999, "amount": 99999}

        def mapper(residue, cands):
            return [{"invoice_line_index": residue[0]["invoice_line_index"], "po_item_id": "ITM-3"}]
        m = match_invoice_lines_to_po([line], PO, residue_mapper=mapper)["mappings"][0]
        self.assertEqual(m["status"], "unmatched")
        self.assertIsNone(m["po_item_id"])

    def test_mapper_not_called_when_no_residue(self):
        calls = []

        def mapper(residue, cands):
            calls.append(1); return []
        lines = [{"description": "Cement OPC 53 Grade", "unit": "Bags", "quantity": 100, "rate": 350, "amount": 35000}]
        match_invoice_lines_to_po(lines, PO, residue_mapper=mapper)
        self.assertEqual(calls, [])  # everything matched by fuzzy → no model call


class TestUomNormalization(unittest.TestCase):
    def test_synonyms_normalize_equal(self):
        self.assertEqual(_norm_unit("Nos"), _norm_unit("No."))
        self.assertEqual(_norm_unit("PCS"), _norm_unit("pieces"))
        self.assertEqual(_norm_unit("Sq.m"), _norm_unit("SQM"))
        self.assertNotEqual(_norm_unit("Kg"), _norm_unit("Nos"))


if __name__ == "__main__":
    unittest.main()
