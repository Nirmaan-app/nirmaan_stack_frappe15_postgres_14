# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for nirmaan_stack.services.outflow_import.parser.

FIXTURES ARE SYNTHETIC ON PURPOSE. This repository is public, so no real statement is committed --
real beneficiary names, bank account numbers and IFSC codes would be a data leak. `cashfree_sample.csv`
is fabricated to reproduce the STRUCTURAL properties of two real exports (43 rows and 19 rows), and
each row that exists to reproduce one is labelled in the fixture generator and named in the test
that depends on it.

The two contracts these tests defend hardest, because both are easy to "tidy away":
  * the parser never filters -- a FAILED transfer is staged, not dropped
  * charges sum across EVERY row while gross sums only successful ones
"""

import unittest
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from nirmaan_stack.services.outflow_import.parser import (
    SUPPORTED_SOURCES,
    ParseResult,
    StatementFormatError,
    parse_statement,
)

FIXTURES = Path(__file__).parent / "tests" / "fixtures"


def _load(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def _sample() -> ParseResult:
    return parse_statement(_load("cashfree_sample.csv"), source="Cashfree")


def _by_transfer(result: ParseResult, suffix: str):
    for row in result.rows:
        if row.transfer_id.endswith(suffix):
            return row
    raise AssertionError(f"no staged row ending {suffix!r}")


class TestParseShape(unittest.TestCase):
    def test_cashfree_is_a_supported_source(self):
        self.assertIn("Cashfree", SUPPORTED_SOURCES)

    def test_rows_are_staged_and_the_blank_transfer_id_row_is_not(self):
        result = _sample()
        # 12 data rows in the fixture; the one with a blank Transfer Id cannot be identified and is
        # dropped with a warning rather than staged under an empty key.
        self.assertEqual(len(result.rows), 11)
        self.assertTrue(all(row.transfer_id for row in result.rows))

    def test_row_numbers_reflect_file_position(self):
        result = _sample()
        self.assertEqual(result.rows[0].row_number, 1)
        self.assertEqual([r.row_number for r in result.rows], sorted(r.row_number for r in result.rows))

    def test_period_is_derived_from_the_rows(self):
        result = _sample()
        self.assertEqual(result.period_from, date(2026, 7, 28))
        self.assertEqual(result.period_to, date(2026, 7, 28))

    def test_datetime_is_parsed_with_full_precision(self):
        row = _by_transfer(_sample(), "0001")
        self.assertEqual(row.added_on, datetime(2026, 7, 28, 17, 5, 18))
        self.assertEqual(row.added_on_date, date(2026, 7, 28))


class TestNeverFilters(unittest.TestCase):
    """The parser stages every identifiable row, whatever its outcome."""

    def test_failed_transfer_is_staged_not_dropped(self):
        row = _by_transfer(_sample(), "0002")
        self.assertEqual(row.status_raw, "FAILED")
        self.assertFalse(row.is_success)

    def test_failed_transfer_still_carries_a_bank_reference(self):
        # This is why filtering matters downstream: a failed transfer has a reference that would
        # match a payment just as well as a real one.
        row = _by_transfer(_sample(), "0002")
        self.assertEqual(row.bank_reference_no, "900000000002")
        self.assertEqual(row.normalized_reference, "900000000002")

    def test_failed_transfer_and_its_retry_are_distinct_rows_with_distinct_references(self):
        # Mirrors the live pair: the same Rs 22,000 to the same beneficiary, failed at 18:17:59 and
        # succeeded at 19:23. Both would otherwise match the same payment.
        failed = _by_transfer(_sample(), "0002")
        retry = _by_transfer(_sample(), "0003")
        self.assertEqual(failed.amount, retry.amount)
        self.assertEqual(failed.beneficiary_name, retry.beneficiary_name)
        self.assertNotEqual(failed.transfer_id, retry.transfer_id)
        self.assertNotEqual(failed.bank_reference_no, retry.bank_reference_no)
        self.assertTrue(retry.is_success)

    def test_success_count_excludes_the_failure(self):
        result = _sample()
        self.assertEqual(result.success_count, len(result.rows) - 1)


class TestAmounts(unittest.TestCase):
    def test_gross_sums_successful_rows_only(self):
        result = _sample()
        expected = sum((r.amount for r in result.rows if r.is_success), Decimal("0"))
        self.assertEqual(result.gross_amount, expected)
        # the failed Rs 22,000 must not be in there
        self.assertNotIn(Decimal("22000.0"), [result.gross_amount])

    def test_charges_sum_every_row_including_the_failure(self):
        # Deliberate asymmetry: a charge is money the bank took whatever the outcome, so excluding
        # failed rows would understate the debit.
        result = _sample()
        expected = sum((r.service_charge + r.service_tax for r in result.rows), Decimal("0"))
        self.assertEqual(result.charges_amount, expected)

    def test_batch_total_never_equals_the_sum_of_rows(self):
        # The gateway charge belongs to no settlement target; this is why a reconciled batch still
        # does not tie to the bank statement without booking the charges separately.
        result = _sample()
        self.assertGreater(result.charges_amount, Decimal("0"))

    def test_thousands_separator_in_an_amount(self):
        row = _by_transfer(_sample(), "0009")
        self.assertEqual(row.amount, Decimal("1234.50"))

    def test_amounts_are_decimal_not_float(self):
        for row in _sample().rows:
            self.assertIsInstance(row.amount, Decimal)
            self.assertIsInstance(row.service_charge, Decimal)


class TestDerivedIdentityForms(unittest.TestCase):
    def test_leading_zero_account_is_normalized_beside_the_verbatim_value(self):
        row = _by_transfer(_sample(), "0006")
        self.assertEqual(row.bank_account, "0042345678904")       # verbatim, untouched
        self.assertEqual(row.normalized_account, "42345678904")   # comparable

    def test_padded_bank_reference_is_normalized_beside_the_verbatim_value(self):
        row = _by_transfer(_sample(), "0007")
        self.assertEqual(row.bank_reference_no, "900000000007")   # stripped at field level
        self.assertEqual(row.normalized_reference, "900000000007")

    def test_raw_values_are_preserved_so_a_rematch_cannot_destroy_evidence(self):
        row = _by_transfer(_sample(), "0006")
        self.assertNotEqual(row.bank_account, row.normalized_account)


class TestRemarks(unittest.TestCase):
    def test_long_remark_survives_untruncated(self):
        # Stored in a Text column precisely so this survives; as Data it is varchar(140) and Frappe
        # THROWS rather than truncating.
        row = _by_transfer(_sample(), "0008")
        self.assertGreater(len(row.remarks), 140)

    def test_remark_is_kept_verbatim(self):
        row = _by_transfer(_sample(), "0001")
        self.assertEqual(row.remarks, "Sample Project materials")


class TestWarnings(unittest.TestCase):
    def test_blank_transfer_id_is_reported(self):
        result = _sample()
        self.assertTrue(any("no Transfer Id" in w for w in result.warnings))

    def test_unreadable_date_is_staged_with_a_warning_not_dropped(self):
        result = _sample()
        row = _by_transfer(result, "0010")
        self.assertIsNone(row.added_on)
        self.assertTrue(any("Added On" in w for w in result.warnings))

    def test_in_file_duplicate_transfer_id_is_reported(self):
        result = _sample()
        self.assertIn("TID0000000000000000000000000001", result.duplicate_transfer_ids)
        self.assertTrue(any("more than once" in w for w in result.warnings))

    def test_duplicate_rows_are_still_staged(self):
        # Reporting the duplicate is the parser's job; deciding what to do about it is not.
        result = _sample()
        matching = [r for r in result.rows if r.transfer_id == "TID0000000000000000000000000001"]
        self.assertEqual(len(matching), 2)


class TestWholeFileFailures(unittest.TestCase):
    def test_unknown_source_is_refused(self):
        with self.assertRaises(StatementFormatError):
            parse_statement(_load("cashfree_sample.csv"), source="Nonesuch")

    def test_wrong_header_is_refused_and_names_the_missing_columns(self):
        with self.assertRaises(StatementFormatError) as ctx:
            parse_statement(_load("cashfree_bad_header.csv"), source="Cashfree")
        self.assertIn("Transfer Id", str(ctx.exception))

    def test_empty_file_is_refused(self):
        with self.assertRaises(StatementFormatError):
            parse_statement(_load("cashfree_empty.csv"), source="Cashfree")

    def test_header_only_file_is_refused(self):
        header = _load("cashfree_sample.csv").split(b"\n")[0]
        with self.assertRaises(StatementFormatError):
            parse_statement(header, source="Cashfree")

    def test_utf8_bom_is_tolerated(self):
        # A spreadsheet-exported CSV routinely carries a BOM, which would otherwise become part of
        # the first header name and fail the required-column check with a baffling message.
        with_bom = b"\xef\xbb\xbf" + _load("cashfree_sample.csv")
        self.assertEqual(len(parse_statement(with_bom).rows), 11)

    def test_unknown_extra_columns_are_ignored(self):
        # Real statements carry VPA, Acknowledged, Mode, Status Code and more; none are required.
        result = _sample()
        self.assertTrue(result.rows)


if __name__ == "__main__":
    unittest.main()
