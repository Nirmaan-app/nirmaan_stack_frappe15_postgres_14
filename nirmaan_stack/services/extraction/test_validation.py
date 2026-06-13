# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Unit tests for the deterministic extraction-validation layer.

Pure functions — no Frappe site needed. Run inside the bench venv:
    python -m unittest nirmaan_stack.services.extraction.test_validation
"""
import unittest

from nirmaan_stack.services.extraction.gemini import _schema, _INVOICE_FIELDS
from nirmaan_stack.services.extraction.helpers import normalize_amount, normalize_date
from nirmaan_stack.services.extraction.validation import (
    ABSENT,
    INVALID,
    VALID,
    reconcile_amounts,
    reconcile_line_items,
    validate_date,
    validate_gstin,
)

# Real GSTINs pulled from the 40-invoice sample — these MUST pass the checksum
# (a regression here means the mod-36 algorithm is wrong and would reject live data).
REAL_GSTINS = [
    "29ABFCS9095N1Z9",  # Stratos KA (recurring receiver)
    "09ABFCS9095N1ZB",  # Stratos UP
    "06ABFCS9095N1ZH",  # Stratos HR
    "29ABIFA8044M1ZX",  # AURA AIR SYSTEMS
    "27AAACC8414B1Z4",  # Carrier
    "07AAMCP9656N1ZE",  # PV Lumens
    "33AAZPN1152H1ZJ",  # Aloukik Agencies
]

# (net, tax, total) triples from the sample — all reconcile within ₹5.
REAL_TRIPLES = [
    (2760, 496, 3257),            # AURA  (gap 1)
    (34469.8, 6204.58, 40674.0),  # Shubham
    (67091.5, 12076.47, 79170.0),  # Emphasis — worst observed gap, ₹2.03
    (5750, 1035, 6785),           # Vasu (exact)
    (882958, 158932.44, 1041890.44),  # Carrier (exact, large)
]


class TestGstinChecksum(unittest.TestCase):
    def test_real_gstins_are_valid(self):
        for g in REAL_GSTINS:
            self.assertEqual(validate_gstin(g)["state"], VALID, msg=g)

    def test_lowercase_is_normalized_and_valid(self):
        self.assertEqual(validate_gstin("29abfcs9095n1z9")["state"], VALID)

    def test_bad_check_digit_is_invalid(self):
        # Correct check digit is '9'; flip it.
        self.assertEqual(validate_gstin("29ABFCS9095N1Z8")["state"], INVALID)

    def test_malformed_is_invalid(self):
        self.assertEqual(validate_gstin("NOTAGSTIN")["state"], INVALID)
        self.assertEqual(validate_gstin("29ABFCS9095N1Z")["state"], INVALID)  # 14 chars

    def test_absent(self):
        for v in (None, "", "null", "N/A", "-"):
            self.assertEqual(validate_gstin(v)["state"], ABSENT, msg=repr(v))


class TestReconcile(unittest.TestCase):
    def test_real_triples_reconcile(self):
        for net, tax, total in REAL_TRIPLES:
            self.assertEqual(
                reconcile_amounts(net, tax, total)["state"], VALID, msg=(net, tax, total)
            )

    def test_tcs_blocks_until_extracted(self):
        # net+tax=1,180,000 but total includes ₹1,180 TCS.
        self.assertEqual(reconcile_amounts(1000000, 180000, 1181180)["state"], INVALID)
        self.assertEqual(
            reconcile_amounts(1000000, 180000, 1181180, tcs=1180)["state"], VALID
        )

    def test_round_off_within_tolerance(self):
        self.assertEqual(reconcile_amounts(100, 18, 118.5, round_off=0.5)["state"], VALID)

    def test_off_by_tax_is_invalid(self):
        self.assertEqual(reconcile_amounts(1000, 180, 2000)["state"], INVALID)

    def test_string_numbers_ok(self):
        self.assertEqual(reconcile_amounts("2760", "496", "3257")["state"], VALID)

    def test_absent_when_missing(self):
        self.assertEqual(reconcile_amounts(None, 100, 200)["state"], ABSENT)
        self.assertEqual(reconcile_amounts("", "", "")["state"], ABSENT)
        self.assertEqual(reconcile_amounts(100, "null", 118)["state"], ABSENT)


class TestReconcileLineItems(unittest.TestCase):
    def test_clean_lines_reconcile(self):
        lines = [
            {"quantity": 2, "rate": 100, "amount": 200},
            {"quantity": 1, "rate": 50, "amount": 50},
        ]
        result = reconcile_line_items(lines, 250)
        self.assertEqual(result["state"], VALID)
        self.assertEqual(result["sum_state"], VALID)
        self.assertTrue(all(s["state"] == VALID for s in result["lines"]))

    def test_per_line_mismatch_is_advisory_not_overall_invalid(self):
        # 2 * 100 = 200 but amount says 250 (per-line off). The SUM still matches
        # net, so the roll-up is VALID and the per-line failure is advisory only.
        result = reconcile_line_items([{"quantity": 2, "rate": 100, "amount": 250}], 250)
        self.assertEqual(result["state"], VALID)         # sum-primary roll-up
        self.assertEqual(result["sum_state"], VALID)
        self.assertEqual(result["lines"][0]["state"], INVALID)  # advisory flag retained

    def test_sum_mismatch_is_invalid(self):
        # Each line reconciles, but Σ(200) != net(500) — the trustworthy signal fails.
        result = reconcile_line_items([{"quantity": 2, "rate": 100, "amount": 200}], 500)
        self.assertEqual(result["sum_state"], INVALID)
        self.assertEqual(result["state"], INVALID)

    def test_discount_as_rupees_reconciles(self):
        # 10 * 100 - 100 discount = 900.
        lines = [{"quantity": 10, "rate": 100, "amount": 900, "discount": 100}]
        self.assertEqual(reconcile_line_items(lines, 900)["lines"][0]["state"], VALID)

    def test_discount_as_percent_reconciles(self):
        # Real spike case (PO/135): 507 * 304 * (1 - 52.5%) = 73210.8. The discount
        # is a percentage; treating it as rupees would false-fail the per-line check.
        lines = [{"quantity": 507, "rate": 304, "amount": 73210.8, "discount": 52.5}]
        result = reconcile_line_items(lines, 73210.8)
        self.assertEqual(result["lines"][0]["state"], VALID)
        self.assertEqual(result["state"], VALID)

    def test_rounding_within_tolerance(self):
        lines = [{"quantity": 1, "rate": 99.99, "amount": 100}]
        self.assertEqual(reconcile_line_items(lines, 100)["state"], VALID)

    def test_string_numbers_ok(self):
        lines = [{"quantity": "2", "rate": "100", "amount": "200"}]
        self.assertEqual(reconcile_line_items(lines, "200")["state"], VALID)

    def test_no_lines_is_absent(self):
        self.assertEqual(reconcile_line_items([], 250)["state"], ABSENT)
        self.assertEqual(reconcile_line_items(None, 250)["state"], ABSENT)

    def test_amount_only_line_skips_arithmetic_but_counts_in_sum(self):
        # Got the amount but not qty/rate → line ABSENT, yet it feeds the sum,
        # which still reconciles → overall VALID via the sum.
        lines = [{"description": "Lump sum work", "amount": 200}]
        result = reconcile_line_items(lines, 200)
        self.assertEqual(result["lines"][0]["state"], ABSENT)
        self.assertEqual(result["sum_state"], VALID)
        self.assertEqual(result["state"], VALID)

    def test_partial_table_skips_sum_but_checks_lines(self):
        # One line missing amount → sum can't be trusted (skipped), but the other
        # line is checkable and clean → VALID, not a false sum-failure.
        lines = [
            {"quantity": 2, "rate": 100, "amount": 200},
            {"description": "TBD", "amount": None},
        ]
        result = reconcile_line_items(lines, 200)
        self.assertEqual(result["sum_state"], ABSENT)
        self.assertEqual(result["state"], VALID)

    def test_uncheckable_lines_are_absent(self):
        lines = [{"description": "Service", "amount": None, "quantity": None, "rate": None}]
        self.assertEqual(reconcile_line_items(lines, 100)["state"], ABSENT)


class TestValidateDate(unittest.TestCase):
    def test_real_formats_parse_and_valid(self):
        for raw in ("14-04-2026", "13-Feb-26", "27.03.2026", "18/02/2026", "6-Apr-2026"):
            self.assertEqual(validate_date(raw, normalize_date)["state"], VALID, msg=raw)

    def test_future_is_invalid(self):
        self.assertEqual(validate_date("2090-01-01", normalize_date)["state"], INVALID)

    def test_too_old_is_invalid(self):
        self.assertEqual(validate_date("2010-01-01", normalize_date)["state"], INVALID)

    def test_unparseable_is_invalid(self):
        self.assertEqual(validate_date("not a date", normalize_date)["state"], INVALID)

    def test_absent(self):
        self.assertEqual(validate_date("", normalize_date)["state"], ABSENT)
        self.assertEqual(validate_date("null", normalize_date)["state"], ABSENT)


class TestNoFabricationSchema(unittest.TestCase):
    """Guard Fix 1: no required + all nullable, so the model can return JSON null
    instead of fabricating a value from training data."""

    def test_schema_has_no_required_and_is_nullable(self):
        schema = _schema(_INVOICE_FIELDS)
        self.assertNotIn("required", schema)
        for field, prop in schema["properties"].items():
            self.assertTrue(prop.get("nullable"), msg=field)


class TestNormalizeAmount(unittest.TestCase):
    def test_numbers_and_junk(self):
        self.assertEqual(normalize_amount(3257.0), "3257.0")
        self.assertEqual(normalize_amount("1,702.00"), "1702.0")
        self.assertEqual(normalize_amount("*2,124.00"), "2124.0")  # OCR junk
        self.assertEqual(normalize_amount("abc"), "")
        self.assertEqual(normalize_amount(None), "")


class _FakeCand:
    def __init__(self, finish_reason):
        self.finish_reason = finish_reason


class _FakeResp:
    def __init__(self, finish_reason, text):
        self.candidates = [_FakeCand(finish_reason)]
        self.text = text


class TestSafeText(unittest.TestCase):
    """Guard the finish_reason enum bug: str(FinishReason.STOP) is
    'FinishReason.STOP' (would reject every success); compare .name instead."""

    def test_stop_returns_text(self):
        from google.genai import types
        from nirmaan_stack.services.extraction.gemini import _safe_text
        self.assertEqual(_safe_text(_FakeResp(types.FinishReason.STOP, '{"a": 1}')), '{"a": 1}')

    def test_blocked_or_truncated_raises(self):
        from google.genai import types
        from nirmaan_stack.services.extraction.gemini import _NonRetryable, _safe_text
        for fr in (types.FinishReason.SAFETY, types.FinishReason.MAX_TOKENS):
            with self.assertRaises(_NonRetryable):
                _safe_text(_FakeResp(fr, '{"a": 1}'))

    def test_empty_text_raises(self):
        from google.genai import types
        from nirmaan_stack.services.extraction.gemini import _NonRetryable, _safe_text
        with self.assertRaises(_NonRetryable):
            _safe_text(_FakeResp(types.FinishReason.STOP, ""))


class TestThinkingLevelClamp(unittest.TestCase):
    """Guard the thinking_level mis-route: SDK ThinkingLevel has only LOW/HIGH."""

    def test_clamps_invalid_to_low(self):
        from nirmaan_stack.services.extraction.gemini import _thinking_level
        self.assertEqual(_thinking_level({"gemini_thinking_level": "medium"}), "low")
        self.assertEqual(_thinking_level({"gemini_thinking_level": "high"}), "high")
        self.assertEqual(_thinking_level({}), "low")


if __name__ == "__main__":
    unittest.main()
