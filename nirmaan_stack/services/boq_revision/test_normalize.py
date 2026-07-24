# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for nirmaan_stack.services.boq_revision.normalize (the N2 normalizer).

N2 (ADR-0014 D3/D5/D6) = trim ends + collapse internal whitespace runs to one
space + fold Unicode whitespace (incl. nbsp) + case-insensitive. NO punctuation
or synonym folding -- semantic characters (`1:4:8`, `100mm`) are preserved.
This is the SINGLE home shared by sheet pairing (D3), column headers (D5) and row
descriptions (D6); these tests pin the exact contract so no consumer forks it.
"""

import unittest

from nirmaan_stack.services.boq_revision.normalize import normalize_n2


class TestNormalizeN2(unittest.TestCase):
    def test_trims_leading_and_trailing_whitespace(self):
        self.assertEqual(normalize_n2("  Electrical  "), "electrical")

    def test_summary_variants_collapse(self):
        # D3's driving example: 'SUMMARY ' and 'Summary' must fold to one key.
        self.assertEqual(normalize_n2("SUMMARY "), normalize_n2("Summary"))
        self.assertEqual(normalize_n2("SUMMARY "), "summary")

    def test_case_insensitive(self):
        self.assertEqual(normalize_n2("Electrical"), normalize_n2("ELECTRICAL"))

    def test_collapses_internal_whitespace_runs(self):
        self.assertEqual(normalize_n2("List of  Make -   MEP"), "list of make - mep")

    def test_folds_nbsp_and_unicode_whitespace(self):
        # \xa0 (nbsp) and \t are Unicode whitespace -> str.split() folds them.
        self.assertEqual(normalize_n2("Make\xa0List"), "make list")
        self.assertEqual(normalize_n2("Make\tList"), "make list")

    def test_electrical_variants_never_merge(self):
        # N2 draws the line exactly right: it absorbs case/space noise but NEVER
        # merges content that differs by a real character.
        self.assertNotEqual(normalize_n2("Electrical"), normalize_n2("Electrical 2"))

    def test_preserves_semantic_punctuation(self):
        # No punctuation folding -- these stay distinct.
        self.assertEqual(normalize_n2("Grade 1:4:8"), "grade 1:4:8")
        self.assertNotEqual(normalize_n2("100mm"), normalize_n2("100 mm"))

    def test_none_and_empty(self):
        self.assertEqual(normalize_n2(None), "")
        self.assertEqual(normalize_n2(""), "")
        self.assertEqual(normalize_n2("   "), "")

    def test_non_string_coerced(self):
        self.assertEqual(normalize_n2(42), "42")

    def test_parity_with_parser_normalizer(self):
        # normalize_n2 is intentionally byte-identical to the parser's _auto_guess._normalize
        # (a description keyed here must equal the same text keyed there). This parity test PINS
        # the two so a drift in either is caught, without coupling the modules by import.
        from nirmaan_stack.services.boq_parser._auto_guess import _normalize

        for s in [
            "  Electrical  ",
            "SUMMARY ",
            "List of  Make -   MEP",
            "Make\xa0List",
            "Grade 1:4:8",
            "ELECTRICAL 2",
            "",
            "   ",
        ]:
            self.assertEqual(normalize_n2(s), _normalize(s), f"parity drift on {s!r}")


if __name__ == "__main__":
    unittest.main()
