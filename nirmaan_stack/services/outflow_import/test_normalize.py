# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for nirmaan_stack.services.outflow_import.normalize.

Every rule in that module was derived from a real failure against the live vendor master or payment
ledger, so these tests are written as those cases rather than as abstract properties -- if one
breaks, the thing that breaks in production is named right there in the test.

The identity/scoring split is pinned deliberately: account and reference are IDENTITY forms and must
never merge distinct values, while name and tokens are SCORING forms and are allowed to be lossy.
"""

import unittest
from decimal import Decimal

from nirmaan_stack.services.outflow_import.normalize import (
    NAME_NOISE_TOKENS,
    name_tokens,
    normalize_account,
    normalize_amount,
    normalize_name,
    normalize_reference,
)


class TestNormalizeAccount(unittest.TestCase):
    def test_leading_zeros_are_stripped(self):
        # Live case: a statement carried 0869102000002783 while the vendor master stored the same
        # account as 869102000002783. A raw compare misses it and the vendor reads as unknown.
        self.assertEqual(normalize_account("0869102000002783"), normalize_account("869102000002783"))

    def test_trailing_whitespace_is_stripped(self):
        # Live case: one Keywest vendor record stores '50200023578202 ' with a trailing space.
        self.assertEqual(normalize_account("50200023578202 "), "50200023578202")

    def test_internal_spaces_and_hyphens_are_removed(self):
        self.assertEqual(normalize_account("5020 0023 578202"), "50200023578202")
        self.assertEqual(normalize_account("5020-0023-578202"), "50200023578202")

    def test_blank_and_none_become_empty(self):
        self.assertEqual(normalize_account(""), "")
        self.assertEqual(normalize_account("   "), "")
        self.assertEqual(normalize_account(None), "")

    def test_all_zero_account_stays_distinguishable_from_missing(self):
        # A zero account is a value; a missing one is not. Collapsing both to "" would make an
        # absent account match a present one.
        self.assertEqual(normalize_account("0000"), "0")
        self.assertNotEqual(normalize_account("0000"), normalize_account(""))

    def test_distinct_accounts_never_merge(self):
        self.assertNotEqual(normalize_account("12345678901"), normalize_account("12345678902"))


class TestNormalizeReference(unittest.TestCase):
    def test_padded_reference_matches_clean_reference(self):
        # This is the whole point of the function. 226 live Project Payments.utr values are
        # whitespace-padded, e.g. ' 504918114686'. The existing _fulfil_payment guard strips the
        # INCOMING value but compares against unstripped storage, so those rows are invisible to it.
        self.assertEqual(normalize_reference(" 504918114686"), normalize_reference("504918114686"))

    def test_internal_whitespace_is_removed(self):
        self.assertEqual(normalize_reference("6209 1987 4360"), "620919874360")

    def test_leading_zeros_are_preserved(self):
        # Unlike an account number, a bank reference is an opaque token -- its first character is
        # significant and stripping it would merge two different references.
        self.assertEqual(normalize_reference("0620919874360"), "0620919874360")
        self.assertNotEqual(normalize_reference("0620919874360"), normalize_reference("620919874360"))

    def test_mixed_form_reference_is_upper_cased(self):
        # Live shape: '043572728741/BULD67453750'.
        self.assertEqual(
            normalize_reference("043572728741/buld67453750"), "043572728741/BULD67453750"
        )

    def test_blank_and_none_become_empty(self):
        self.assertEqual(normalize_reference(""), "")
        self.assertEqual(normalize_reference(None), "")


class TestNormalizeName(unittest.TestCase):
    def test_trailing_space_folds(self):
        # Live vendor record: 'Sri Sai Enterprises ' (trailing space).
        self.assertEqual(normalize_name("Sri Sai Enterprises "), normalize_name("Sri Sai Enterprises"))

    def test_case_folds(self):
        # Live pair: statement 'HAKIMI HARDWARE' vs master 'Hakimi Hardware'.
        self.assertEqual(normalize_name("HAKIMI HARDWARE"), normalize_name("Hakimi Hardware"))

    def test_ampersand_becomes_the_word_and(self):
        # Live pair: statement 'RIDDHI SIDDHI FASTENERS INDUSTRIAL NEEDS'
        # vs master 'RIDDHI SIDDHI FASTENERS & INDUSTRIAL NEEDS'.
        self.assertEqual(normalize_name("A & B"), "a and b")

    def test_punctuation_becomes_a_separator(self):
        # Live pair: master 'RAJ MARKETING e-Hub' vs statement 'RAJ MARKETING eHub'.
        self.assertEqual(normalize_name("RAJ MARKETING e-Hub"), "raj marketing e hub")

    def test_internal_whitespace_runs_collapse(self):
        # normalize_name does NOT singularise -- that belongs to the scoring side, name_tokens.
        self.assertEqual(normalize_name("Sri   Sai\tEnterprises"), "sri sai enterprises")

    def test_distinct_trade_names_never_merge(self):
        # Two different live vendors sharing a prefix. If these ever collapse, the matcher will
        # offer the wrong one.
        self.assertNotEqual(normalize_name("Sri Sai Enterprises"), normalize_name("Sri Sai Roadlines"))

    def test_blank_and_none_become_empty(self):
        self.assertEqual(normalize_name(""), "")
        self.assertEqual(normalize_name(None), "")


class TestNameTokens(unittest.TestCase):
    def test_plural_and_singular_agree(self):
        # Live pair: statement 'Absolute Air Solutions' vs master 'Absolute Air Solution'.
        self.assertEqual(name_tokens("Absolute Air Solutions"), name_tokens("Absolute Air Solution"))

    def test_double_s_word_is_not_singularised(self):
        # 'Mark Express' is a live vendor word; stripping the final s would corrupt it.
        self.assertIn("express", name_tokens("Mark Express Pvt Ltd"))

    def test_short_token_is_not_singularised(self):
        self.assertEqual(name_tokens("Gas"), ("gas",))

    def test_legal_form_abbreviations_expand(self):
        self.assertEqual(
            name_tokens("Dhatri Networks Pvt Ltd"), name_tokens("Dhatri Networks Private Limited")
        )

    def test_hyphenated_and_joined_forms_agree_at_token_level(self):
        # normalize_name leaves 'e hub' vs 'ehub' unequal as strings; the token set is where the
        # matcher recovers this pair, which is why the two functions are separate.
        self.assertNotEqual(normalize_name("RAJ MARKETING e-Hub"), normalize_name("RAJ MARKETING eHub"))
        self.assertIn("raj", name_tokens("RAJ MARKETING e-Hub"))
        self.assertIn("marketing", name_tokens("RAJ MARKETING eHub"))

    def test_ampersand_form_and_plain_form_agree_once_noise_is_dropped(self):
        left = [t for t in name_tokens("RIDDHI SIDDHI FASTENERS & INDUSTRIAL NEEDS")
                if t not in NAME_NOISE_TOKENS]
        right = [t for t in name_tokens("RIDDHI SIDDHI FASTENERS INDUSTRIAL NEEDS")
                 if t not in NAME_NOISE_TOKENS]
        self.assertEqual(left, right)

    def test_trade_words_are_not_noise(self):
        # These are exactly what separates two live vendors; if they ever enter NAME_NOISE_TOKENS,
        # 'Sri Sai Enterprises' and 'Sri Sai Roadlines' become indistinguishable.
        for word in ("enterprise", "roadline", "hardware", "network"):
            self.assertNotIn(word, NAME_NOISE_TOKENS)

    def test_order_is_preserved(self):
        self.assertEqual(name_tokens("Alpha Beta Gamma"), ("alpha", "beta", "gamma"))


class TestNormalizeAmount(unittest.TestCase):
    def test_thousands_separator(self):
        self.assertEqual(normalize_amount("1,234.50"), Decimal("1234.50"))

    def test_currency_symbol_and_whitespace(self):
        self.assertEqual(normalize_amount(" ₹ 5,000.00 "), Decimal("5000.00"))

    def test_plain_float_string(self):
        self.assertEqual(normalize_amount("9175.0"), Decimal("9175.0"))

    def test_numeric_inputs_pass_through(self):
        self.assertEqual(normalize_amount(5000), Decimal("5000"))
        self.assertEqual(normalize_amount(Decimal("12.34")), Decimal("12.34"))

    def test_parenthesised_negative(self):
        self.assertEqual(normalize_amount("(2,500.00)"), Decimal("-2500.00"))

    def test_signed_negative(self):
        self.assertEqual(normalize_amount("-750"), Decimal("-750"))

    def test_blank_and_unparseable_become_zero_rather_than_raising(self):
        # A bad amount is a row-level finding the caller reports, never a reason to abandon a file.
        for bad in ("", "   ", None, "n/a", "-", "."):
            self.assertEqual(normalize_amount(bad), Decimal("0"))

    def test_result_is_exact_not_binary_float(self):
        # Decimal, not float: these figures are compared for exact equality against a stored amount
        # and then differenced.
        self.assertEqual(normalize_amount("0.1") + normalize_amount("0.2"), Decimal("0.3"))


if __name__ == "__main__":
    unittest.main()
