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

import csv
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

# Slices C1-C5 added a layer ABOVE the column map -- where the table sits inside the sheet, and
# what the reader will be told about it. Imported separately for the same reason the ICICI block
# below is: these names answer a different question from "how is a row built".
from nirmaan_stack.services.outflow_import.parser import (  # noqa: E402
    column_letter,
    describe_mapped_columns,
    locate_table,
)
from nirmaan_stack.services.outflow_import.sources import source_has_preamble  # noqa: E402

# The ICICI slice reads two things the other sources have no equivalent of -- a direction label and
# a counterparty pulled out of free text -- so it imports them separately rather than widening the
# block above.
from nirmaan_stack.services.outflow_import.parser import (  # noqa: E402
    DIRECTION_CREDIT,
    DIRECTION_DEBIT,
    _icici_counterparty,
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


def _cashbook() -> ParseResult:
    return parse_statement(_load("cashbook_sample.csv"), source="Cashbook")


def _icici() -> ParseResult:
    return parse_statement(_load("icici_sample.csv"), source="ICICI Bank Statement")


def _icici_row(number: int):
    """The staged row at a given position in `icici_sample.csv`.

    Addressed by POSITION rather than by transfer id, unlike `_by_transfer`, because two of the
    fixture's pairs deliberately SHARE an id -- see `TestIciciSource`'s docstring.
    """
    for row in _icici().rows:
        if row.row_number == number:
            return row
    raise AssertionError(f"no staged row at position {number}")


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

    def test_the_gateway_duplicate_warning_did_not_move_when_the_key_became_source_aware(self):
        """⚠️ SLICE B3a THREADED `source` INTO `_duplicate_transfer_ids`, AND THE WHOLE ARGUMENT FOR
        DOING IT THAT WAY IS THAT CASHFREE AND CASHBOOK CANNOT MOVE.

        Neither is in `duplicates.WIDE_IDENTITY_SOURCES`, so both still key on `(id, amount, date)`
        and their duplicate behaviour -- proven in production -- is byte-identical. Pinned as the
        exact warning STRING rather than a substring, because "did not move" is the claim."""
        result = _sample()
        self.assertEqual(result.duplicate_transfer_ids, ("TID0000000000000000000000000001",))
        self.assertEqual(
            [w for w in result.warnings if "more than once" in w],
            [
                "1 transfer id(s) appear more than once in this file: "
                "TID0000000000000000000000000001"
            ],
        )
        # Cashbook's two porter-shaped spends differ only in their ids, and still are not a repeat.
        self.assertEqual(_cashbook().duplicate_transfer_ids, ())

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


class TestXlsx(unittest.TestCase):
    """.xlsx alongside .csv (owner ruling Q10, slice V3).

    `cashfree_sample.xlsx` is the same statement as `cashfree_sample.csv`, with dates as DATETIME
    cells and amounts as FLOATS but identity fields left as TEXT. That mix is the point of the
    fixture -- see the leading-zero test below.

    ⚠️ IT IS NOT, HOWEVER, "SAVED THE WAY A REAL EXPORT SAVES IT" -- THAT CLAIM WAS HERE AND IT WAS
    FALSE. It was generated by openpyxl, which writes an HONEST `<dimension>`. A real Cashfree
    export writes `<dimension ref="A1"/>`, and every real .xlsx upload therefore failed from the
    day this format shipped until 2026-08-21 while this suite stayed green. That is the shape of
    defect a fixture built by the same library it is testing will always miss.
    `cashfree_bad_dimension.xlsx` is the twin with ONLY that lie introduced -- see
    `TestAWorkbookThatLiesAboutItsSize`.
    """

    def test_it_parses_to_exactly_the_same_rows_as_its_csv_twin(self):
        """THE GATE FOR THIS SLICE. Format is an encoding, not a dialect: the same statement must
        produce the same rows whichever way it was saved, or every downstream rule silently has two
        behaviours."""
        from_csv = parse_statement(_load("cashfree_sample.csv"), source="Cashfree")
        from_xlsx = parse_statement(_load("cashfree_sample.xlsx"), source="Cashfree")
        self.assertEqual(from_csv.rows, from_xlsx.rows)

    def test_the_batch_level_figures_agree_too(self):
        from_csv = parse_statement(_load("cashfree_sample.csv"), source="Cashfree")
        from_xlsx = parse_statement(_load("cashfree_sample.xlsx"), source="Cashfree")
        # Compared as Decimals, not as text: 57727.50 and 57727.5 are the same money and different
        # strings, and a repr comparison here would fail for no reason that matters.
        self.assertEqual(from_csv.gross_amount, from_xlsx.gross_amount)
        self.assertEqual(from_csv.charges_amount, from_xlsx.charges_amount)
        self.assertEqual(from_csv.period_from, from_xlsx.period_from)
        self.assertEqual(from_csv.period_to, from_xlsx.period_to)
        self.assertEqual(from_csv.duplicate_transfer_ids, from_xlsx.duplicate_transfer_ids)

    def test_a_declared_dimension_of_one_cell_does_not_truncate_the_read(self):
        """THE REAL-WORLD SHAPE. `cashfree_bad_dimension.xlsx` is byte-identical to the twin except
        that its sheet declares `<dimension ref="A1"/>`, exactly as a Cashfree Transfers export
        does. Under `read_only=True` openpyxl believes that declaration and clips every row to
        column A -- so the statement lost 21 of its 22 columns and the required-column check
        reported five of six missing, while `Added On` (column A) was found. Bounded `iter_rows`
        is what overrides it."""
        honest = parse_statement(_load("cashfree_sample.xlsx"), source="Cashfree")
        lying = parse_statement(_load("cashfree_bad_dimension.xlsx"), source="Cashfree")
        self.assertEqual(honest.rows, lying.rows)

    def test_the_lying_workbook_agrees_with_the_csv_too(self):
        """Through the whole chain, not just against its xlsx twin -- the csv is the reference."""
        from_csv = parse_statement(_load("cashfree_sample.csv"), source="Cashfree")
        lying = parse_statement(_load("cashfree_bad_dimension.xlsx"), source="Cashfree")
        self.assertEqual(from_csv.rows, lying.rows)
        self.assertEqual(from_csv.gross_amount, lying.gross_amount)
        self.assertEqual(from_csv.period_from, lying.period_from)
        self.assertEqual(from_csv.period_to, lying.period_to)

    def test_the_column_scan_ceiling_refuses_rather_than_short_reads(self):
        """⚠️ `_MAX_SCAN_COLUMNS` IS A REAL CEILING, unlike the row one, so it must never be reached
        silently. A statement wider than the scan would otherwise be parsed with its tail chopped
        off -- which reads as a successful import of a statement nobody exported."""
        import io as _io

        from openpyxl import Workbook

        from nirmaan_stack.services.outflow_import.parser import _MAX_SCAN_COLUMNS

        workbook = Workbook()
        sheet = workbook.active
        sheet.append([f"Column {i}" for i in range(_MAX_SCAN_COLUMNS + 5)])
        sheet.append(["x"] * (_MAX_SCAN_COLUMNS + 5))
        buffer = _io.BytesIO()
        workbook.save(buffer)

        with self.assertRaises(StatementFormatError) as caught:
            parse_statement(buffer.getvalue(), source="Cashfree")
        self.assertIn(str(_MAX_SCAN_COLUMNS), str(caught.exception))

    def test_the_row_ceiling_is_excels_own_limit_so_it_can_never_truncate(self):
        """It is NOT a performance guard -- it exists only because `iter_rows` needs a bound, and
        it is set where no workbook Excel can open could ever reach it."""
        from nirmaan_stack.services.outflow_import.parser import _MAX_SCAN_ROWS

        self.assertEqual(_MAX_SCAN_ROWS, 1_048_576)

    def test_the_format_is_sniffed_from_the_bytes_not_the_name(self):
        """No filename reaches the parser at all, so a renamed export still works. The failure mode
        of trusting an extension is a 'missing column' error on a perfectly good file."""
        result = parse_statement(_load("cashfree_sample.xlsx"), source="Cashfree")
        self.assertEqual(len(result.rows), 11)

    def test_a_leading_zero_bank_account_survives(self):
        """⚠️ THE ONE THAT BREAKS SILENTLY. Account `0042345678904` written to a NUMBER cell comes
        back as 42345678904 -- a valid-looking account that belongs to nobody. The fixture keeps
        identity fields as text for exactly this reason, and this test is what would catch a future
        change that started coercing them."""
        result = parse_statement(_load("cashfree_sample.xlsx"), source="Cashfree")
        accounts = {row.bank_account for row in result.rows}
        self.assertIn("0042345678904", accounts)

    def test_a_typed_datetime_cell_reads_as_the_same_instant_as_its_text_twin(self):
        from_csv = parse_statement(_load("cashfree_sample.csv"), source="Cashfree")
        from_xlsx = parse_statement(_load("cashfree_sample.xlsx"), source="Cashfree")
        self.assertEqual(from_csv.rows[0].added_on, datetime(2026, 7, 28, 17, 5, 18))
        self.assertEqual(from_csv.rows[0].added_on, from_xlsx.rows[0].added_on)

    def test_an_unreadable_date_stays_unreadable_rather_than_becoming_today(self):
        """The fixture carries a deliberate 'not-a-date'. It must warn, not silently substitute --
        a fabricated date would place the transfer in the wrong period."""
        result = parse_statement(_load("cashfree_sample.xlsx"), source="Cashfree")
        undated = [row for row in result.rows if row.added_on is None]
        self.assertTrue(undated)

    def test_a_file_that_is_not_a_workbook_but_starts_like_one_is_refused_clearly(self):
        """A truncated or corrupt upload still carries the ZIP magic. The message has to say the
        file could not be opened, not report a missing column."""
        with self.assertRaises(StatementFormatError) as caught:
            parse_statement(b"PK\x03\x04 and then nothing useful", source="Cashfree")
        self.assertIn("could not be opened", str(caught.exception))

    def test_an_xlsx_missing_a_required_column_fails_the_same_way_a_csv_does(self):
        """The required-column check is downstream of the format seam, so it must be reached
        identically by both. If .xlsx skipped it, a wrong workbook would stage garbage rows."""
        from openpyxl import Workbook

        import io as _io

        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["Transfer Id", "Amount"])
        sheet.append(["T1", 100])
        buffer = _io.BytesIO()
        workbook.save(buffer)

        with self.assertRaises(StatementFormatError) as caught:
            parse_statement(buffer.getvalue(), source="Cashfree")
        self.assertIn("Missing column", str(caught.exception))


class TestCashbookSource(unittest.TestCase):
    """The petty-cash wallet statement (slice 1).

    `cashbook_sample.csv` is fabricated on the same terms as the Cashfree fixture, and reproduces
    every structural shape found in a real 137-row export: a spend whose Note says more than its
    Remark, a spend with no free text at all, two spends identical but for their ids, a refused
    spend, a spend with no debit figure, three movements that are not spends, one transfer missing
    its id, and the six-row totals block the sheet ends with.
    """

    def test_cashbook_is_a_supported_source(self):
        self.assertIn("Cashbook", SUPPORTED_SOURCES)

    def test_every_row_carrying_a_transfer_id_is_staged(self):
        # 17 rows in the fixture: 10 identifiable movements, 1 unidentifiable, 6 totals lines.
        result = _cashbook()
        self.assertEqual(len(result.rows), 10)
        self.assertTrue(all(row.transfer_id for row in result.rows))

    def test_the_kind_of_movement_is_recorded_verbatim(self):
        result = _cashbook()
        self.assertEqual(_by_transfer(result, "AAAAAA").row_kind, "Wallet Spend")
        self.assertEqual(_by_transfer(result, "900001-0").row_kind, "VA → Wallet")
        self.assertEqual(_by_transfer(result, "VALOAD-9000002").row_kind, "Bank → VA")
        self.assertEqual(_by_transfer(result, "PTM9000003").row_kind, "Wallet Credit")

    def test_a_top_up_is_staged_rather_than_filtered_out(self):
        """The parser never filters -- deciding a top-up is not importable is downstream's job.

        This is the same contract the FAILED Cashfree transfer defends, and it matters more here:
        a top-up is not an error, it is simply not a spend, and the staged row is what makes the
        eventual skip visible instead of an absence nobody can account for.
        """
        result = _cashbook()
        self.assertIsNotNone(_by_transfer(result, "900001-0"))
        self.assertIsNotNone(_by_transfer(result, "VALOAD-9000002"))

    def test_a_refused_spend_is_staged_and_keeps_its_status(self):
        row = _by_transfer(_cashbook(), "FFFFFF")
        self.assertEqual(row.status_raw, "FAILED")
        self.assertFalse(row.is_success)


class TestCashbookRemarkJoin(unittest.TestCase):
    """Remark and Note arrive as one string, because both feed the same matcher."""

    def test_a_note_saying_more_than_its_remark_is_not_lost(self):
        row = _by_transfer(_cashbook(), "BBBBBB")
        self.assertEqual(row.remarks, "Pay to merchant - Printout charges beta site")

    def test_a_blank_note_leaves_no_dangling_separator(self):
        row = _by_transfer(_cashbook(), "AAAAAA")
        self.assertEqual(row.remarks, "Transport charges alpha project")

    def test_a_row_with_neither_reads_as_empty_not_as_a_separator(self):
        row = _by_transfer(_cashbook(), "CCCCCC")
        self.assertEqual(row.remarks, "")


class TestCashbookTrailerRows(unittest.TestCase):
    """The totals block must cost NOTHING, and an unidentifiable transfer must still be reported.

    ⚠️ THESE TWO TESTS ARE A PAIR AND NEITHER IS SAFE ALONE. Suppressing the totals block by
    dropping the warning outright would pass the first and break the second, and losing that
    warning means a transfer we cannot identify disappears in silence.
    """

    def test_the_totals_block_produces_no_warnings(self):
        result = _cashbook()
        self.assertEqual(
            [w for w in result.warnings if "no Transfer Id" in w],
            ["Row 11 has no Transfer Id and was not staged."],
        )

    def test_a_transfer_with_an_amount_but_no_id_is_still_reported(self):
        result = _cashbook()
        self.assertTrue(any("Row 11" in w for w in result.warnings))

    def test_no_totals_line_is_staged_as_a_transfer(self):
        result = _cashbook()
        self.assertFalse(any("Balance" in (row.beneficiary_name or "") for row in result.rows))


class TestCashbookFigures(unittest.TestCase):
    def test_the_date_is_read_without_the_time_beside_it(self):
        """Owner ruling: `Date` is taken, `Time` is discarded, so a spend lands at midnight."""
        row = _by_transfer(_cashbook(), "AAAAAA")
        self.assertEqual(row.added_on, datetime(2026, 8, 1, 0, 0))
        self.assertEqual(row.added_on_date, date(2026, 8, 1))

    def test_period_spans_the_statement(self):
        result = _cashbook()
        self.assertEqual(result.period_from, date(2026, 8, 1))
        self.assertEqual(result.period_to, date(2026, 8, 4))

    def test_a_wallet_statement_carries_no_charges(self):
        self.assertEqual(_cashbook().charges_amount, Decimal("0"))

    def test_gross_sums_successful_debits_and_the_refused_spend_is_not_in_it(self):
        # 180 + 70 + 6000 + 250 + 250; the FAILED 400 never left, and a credit is not a debit.
        self.assertEqual(_cashbook().gross_amount, Decimal("6750"))

    def test_a_spend_with_no_debit_figure_reads_as_zero_rather_than_failing_the_file(self):
        row = _by_transfer(_cashbook(), "GGGGGG")
        self.assertEqual(row.amount, Decimal("0"))
        self.assertTrue(row.is_success)

    def test_two_spends_alike_but_for_their_ids_are_not_called_duplicates(self):
        """Identity is `(id, amount, date)`, and the ids differ -- so these are two real spends.

        Measured on a real export: one such pair exists in 115 rows, two porter payments minutes
        apart. Keying the check on anything coarser would silently merge them.
        """
        result = _cashbook()
        self.assertEqual(result.duplicate_transfer_ids, ())

    def test_who_spent_it_is_captured_separately_from_who_was_paid(self):
        row = _by_transfer(_cashbook(), "AAAAAA")
        self.assertEqual(row.added_by_raw, "Asha Menon")
        self.assertEqual(row.beneficiary_name, "Testvendor Alpha")


class TestCashbookWholeFileFailures(unittest.TestCase):
    def test_a_statement_without_a_remark_column_is_refused(self):
        """Remark is the ONLY signal this source carries for choosing a project or a type.

        Without it the file would parse perfectly and book every row to a fallback -- a silent
        loss, which is precisely what the required-column check exists to prevent.
        """
        with self.assertRaises(StatementFormatError) as caught:
            parse_statement(_load("cashbook_no_remark.csv"), source="Cashbook")
        self.assertIn("Remark", str(caught.exception))

    def test_a_cashfree_statement_is_refused_as_cashbook(self):
        with self.assertRaises(StatementFormatError) as caught:
            parse_statement(_load("cashfree_sample.csv"), source="Cashbook")
        self.assertIn("Missing column", str(caught.exception))


class TestCashbookXlsx(unittest.TestCase):
    def test_it_parses_to_exactly_the_same_rows_as_its_csv_twin(self):
        from_csv = _cashbook()
        from_xlsx = parse_statement(_load("cashbook_sample.xlsx"), source="Cashbook")
        self.assertEqual(
            [(r.transfer_id, r.amount, r.remarks, r.row_kind) for r in from_csv.rows],
            [(r.transfer_id, r.amount, r.remarks, r.row_kind) for r in from_xlsx.rows],
        )

    def test_the_totals_block_is_dropped_from_the_workbook_too(self):
        result = parse_statement(_load("cashbook_sample.xlsx"), source="Cashbook")
        self.assertEqual(len(result.rows), 10)
        self.assertEqual(len([w for w in result.warnings if "no Transfer Id" in w]), 1)


class TestCashfreeIsUnaffected(unittest.TestCase):
    """Slice 1 touched shared code. Cashfree must not have moved.

    ⚠️ THE TRAILER RULE IS THE RISK HERE, and it is narrow by design: it suppresses a warning only
    where a row has NO id, NO amount and NO status. The Cashfree fixture's unidentifiable row
    carries an amount of 400 and a status of SUCCESS, so it stays reported -- which is the whole
    reason the rule tests content rather than just emptiness.
    """

    def test_the_blank_transfer_id_row_is_still_warned_about(self):
        result = _sample()
        self.assertTrue(any("no Transfer Id" in w for w in result.warnings))

    def test_row_kind_is_blank_on_a_source_that_does_not_declare_one(self):
        self.assertTrue(all(row.row_kind == "" for row in _sample().rows))

    def test_a_single_column_remark_is_unchanged_by_the_multi_column_map(self):
        """A map naming ONE column must still read exactly that cell, unjoined and unstripped.

        `raw()` gained a tuple branch; this pins that the string branch beneath it did not change
        behaviour. It is the whole-fixture form of the assertion rather than a spot check, because
        a join defect would be uniform and a single row could miss it.
        """
        self.assertEqual(
            [row.remarks for row in _sample().rows],
            [
                "Sample Project materials",
                "Sample Project Transportation Services",
                "Sample Project Transportation Services",
                "Sample Project HVAC Services",
                "Sample Project HVAC Services",
                "Sample Project materials",
                "Sample Project materials",
                "Sample Project materials supplied against multiple indents raised during the "
                "month including consumables, fasteners and sundry site items delivered in "
                "several tranches across the north and south blocks",
                "Sample Project Room Rent",
                "Sample Project materials",
                "Sample Project materials",
            ],
        )


class TestSingleDebitColumnDirection(unittest.TestCase):
    """A single DEBIT column states `Debit` -- but only on the rows that carried a figure (B3a).

    ⚠️ THE OBVIOUS RULE IS WRONG AND THESE TESTS EXIST TO KEEP IT OUT. "A source with one amount
    column states Debit" reads as harmless and mislabels real money on the one source that mixes
    directions: Cashbook puts wallet spends, wallet top-ups and bank loads in ONE file, and its
    `Credit` column is deliberately unmapped, so a top-up parses with a blank `Debit` and an amount
    of 0. Stamping `Debit` there asserts money left the account on a row where it arrived -- and
    does it invisibly, because the row then reads like every ordinary spend beside it.

    A blank means "the statement did not state one", which on a top-up is exactly true: we never
    read the column that would have said `Credit`.

    ⚠️ AND THE PARSER IS PRECISE WHERE THE BACKFILL APPROXIMATES.
    `patches.v3_0.backfill_outflow_row_direction` stamps `Debit` on every PRE-B3 Cashfree and
    Cashbook row, unscoped by amount, because a stored row carries no trace of which cell it came
    from -- so a handful of old zero-amount Cashbook rows read `Debit` where a fresh parse now
    leaves them blank. That divergence is stated, not reconciled: a patch is append-only history.
    """

    def test_a_payouts_only_export_states_debit_on_every_row(self):
        """Cashfree lists transfers we instructed out and can contain no receipt, so a figure in
        `Amount` IS a statement that money left."""
        rows = _sample().rows
        self.assertTrue(rows)
        self.assertTrue(all(row.direction == DIRECTION_DEBIT for row in rows), [r.direction for r in rows])

    def test_a_cashbook_spend_states_debit(self):
        self.assertEqual(_by_transfer(_cashbook(), "AAAAAA").direction, DIRECTION_DEBIT)

    def test_a_cashbook_non_spend_row_does_not_come_back_debit(self):
        """⚠️ THE LOAD-BEARING ONE. A top-up and a bank load are money ARRIVING; their `Debit` cell
        is blank, so the direction must be blank too -- never `Debit`, and never `Credit` either,
        since the column that would have said so is not mapped and we are not entitled to infer it.
        """
        result = _cashbook()
        for suffix in ("900001-0", "VALOAD-9000002", "PTM9000003"):
            row = _by_transfer(result, suffix)
            self.assertNotEqual(row.direction, DIRECTION_DEBIT, suffix)
            self.assertEqual(row.direction, "", suffix)

    def test_a_spend_with_no_debit_figure_states_nothing_either(self):
        """The rule is about the CELL, not the row kind: this row IS a `Wallet Spend` and a success,
        and its `Debit` is still blank, so the statement still said nothing about direction."""
        row = _by_transfer(_cashbook(), "GGGGGG")
        self.assertEqual(row.row_kind, "Wallet Spend")
        self.assertEqual(row.amount, Decimal("0"))
        self.assertEqual(row.direction, "")

    def test_the_rule_is_declared_on_the_adapter_not_hardcoded_per_source(self):
        """⚠️ NO CODE OUTSIDE THE ADAPTER TABLE MAY BE SOURCE-AWARE -- the module docstring says so
        in as many words, and this is the mechanical check. The direction claim is a property of the
        column map (`_StatesWhenPopulated`), so `_build_row` never learns which gateway it is
        reading and a future single-column source is one map entry."""
        from nirmaan_stack.services.outflow_import import parser as parser_module

        for source in ("Cashfree", "Cashbook"):
            column_map, _required, _derive = parser_module._ADAPTERS[source]
            marker = column_map["amount"]
            self.assertIsInstance(marker, parser_module._StatesWhenPopulated)
            self.assertEqual(marker.label, DIRECTION_DEBIT)
            self.assertEqual(marker.label_field, "direction")

    def test_the_amount_itself_is_unchanged_by_the_marker(self):
        """The marker changes what the row LEARNS from the cell, never what the field's value is."""
        self.assertEqual(_by_transfer(_sample(), "0001").amount, Decimal("5000.0"))
        self.assertEqual(_by_transfer(_cashbook(), "AAAAAA").amount, Decimal("180"))
        self.assertEqual(_sample().gross_amount, Decimal("57727.50"))
        self.assertEqual(_cashbook().gross_amount, Decimal("6750"))


class TestIciciSource(unittest.TestCase):
    """The bank's own current-account statement (slice B1).

    `icici_sample.csv` is fabricated on the same terms as the other two fixtures -- invented company
    and person names, invented account numbers -- while reproducing every structural shape found in
    the real 1,274-row export. Each row exists for a reason and the reason is named here, because a
    row nobody can account for is a row a later change will "tidy up":

      1  INF/INFT, a DEBIT, amount `23,00,552.00` -- Indian digit grouping, which is how every
         amount in this export is written
      2  NEFT hyphen form, a CREDIT -- name and reference both inside the narration
      3  RTGS hyphen form, a CREDIT
      4  IMPS with FIVE segments -- the payer is second-to-last, the last segment is an IFSC
      5  IMPS with SIX segments -- the payer is still second-to-last, segment 3 is a purpose note
         and the last is a bank name
      6  INF/NEFT -- the payee is the LAST segment, which is what separates it from INF/INFT
      7  CMS collection, a CREDIT
      8  CLG cheque clearing, LONG form -- segment 2 is a real cheque number and is kept
      9  TRF cheque clearing, LONG form
      10 `GIB/` government tax challan -- there is NO counterparty and a blank is the truth
      11 a bare account number / FD closure -- likewise blank
      12 + 13  ONE transfer id, same date, same amount, same direction, DIFFERENT remarks (the real
         shape is an SGST and a CGST leg posted together) -- this is why a durable duplicate key
         needs the remarks
      14 + 15  ONE transfer id, same date, same amount, byte-identical remarks, OPPOSITE directions
         (the real shape is both legs of a general-ledger transfer) -- this is why that key also
         needs the direction
      16 a deliberately unreadable date -- must warn, never silently substitute
      17 BOTH money columns populated -- corrupt input, must warn and must not guess
      18 CLG cheque clearing, SHORT form -- segment 2 is a three-letter DRAWEE BANK CODE, not a
         reference, and must come back blank
      19 RTGS SLASH form, short -- a different narration from the hyphen form, and one nothing
         reached until it was measured against the live payment ledger
      20 RTGS SLASH form, long -- its tail is a batch id, so the payer is found by scanning back
         past the IFSC and the `BULD` id

    ⚠️ ROWS 12-15 ARE **NO LONGER** REPORTED AS IN-FILE DUPLICATES, AND THAT REVERSED AT SLICE B3a.
    Until then `_duplicate_transfer_ids` keyed on `(id, amount, date)` -- exactly what those two
    pairs share -- so the parser named both ids while staging, on B3's wide key, kept all four rows
    distinct. The pairs are still in the fixture for the same reason they always were (they prove
    the durable key needs the remarks AND the direction); what changed is that the preview now reads
    that same key, so the two surfaces give one answer about one file.
    """

    def test_icici_is_a_supported_source(self):
        self.assertIn("ICICI Bank Statement", SUPPORTED_SOURCES)

    def test_every_row_is_staged(self):
        # 20 data rows, every one of them carrying a Tran. Id. A passbook has no totals block and
        # no unidentifiable rows -- the bank numbers every posting it makes.
        result = _icici()
        self.assertEqual(len(result.rows), 20)
        self.assertTrue(all(row.transfer_id for row in result.rows))

    # --- direction ------------------------------------------------------------------------------

    def test_a_withdrawal_reads_as_a_debit(self):
        row = _icici_row(1)
        self.assertEqual(row.direction, DIRECTION_DEBIT)
        self.assertEqual(row.amount, Decimal("2300552.00"))

    def test_a_deposit_reads_as_a_credit(self):
        row = _icici_row(2)
        self.assertEqual(row.direction, DIRECTION_CREDIT)
        self.assertEqual(row.amount, Decimal("44275.00"))

    def test_a_credit_keeps_a_positive_amount_rather_than_a_sign(self):
        """`amount` is what the statement printed; direction sits BESIDE it.

        Encoding a credit as a negative amount would fold "how much" and "which way" into one
        field, and every downstream comparison against a stored expense amount would then have to
        know which source the row came from.
        """
        self.assertGreater(_icici_row(2).amount, Decimal("0"))

    def test_a_row_with_neither_money_column_populated_states_no_direction(self):
        """The other half of capability 3: corrupt input yields a blank direction, never a guess.

        ⚠️ THIS REPLACES A PRE-B3a PIN THAT ASSERTED CASHFREE AND CASHBOOK ROWS WERE ALL BLANK. That
        claim moved -- see `TestSingleDebitColumnDirection` -- but the rule it was defending did
        not, so the rule is pinned here on the source that still shows it: row 17 has a figure in
        BOTH columns, so the statement never said which way, and neither does the parser.
        """
        self.assertEqual(_icici_row(17).direction, "")

    # --- amounts and dates ----------------------------------------------------------------------

    def test_indian_digit_grouping_parses(self):
        """`23,00,552.00` groups at two digits, not three. `normalize_amount` strips every
        non-digit before parsing, so nothing in this adapter has to know that -- this test is what
        pins that it stays true."""
        self.assertEqual(_icici_row(1).amount, Decimal("2300552.00"))
        self.assertEqual(_icici_row(3).amount, Decimal("2500000.00"))

    def test_the_value_date_format_is_read(self):
        """⚠️ INVERTED AT SLICE C4: THIS IS NOW THE LEGACY-FORMAT FALLBACK, NOT THE RULE.

        `added_on` used to be mapped to `Value Date` outright. It is now `_FirstPopulated(
        ("Transaction Date", "Value Date"))` -- capability 6 -- because the two differ on 11 of
        1,395 rows of the current export and the transaction date is the one a human means.

        `icici_sample.csv` is the OLDER 8-column export, which has no `Transaction Date` column at
        all, so it still reads its `Value Date` and reads it identically. That is precisely what
        this test is for now: it is the guard that the fallback keeps working, and the fixture is
        deliberately NOT regenerated to the 10-column shape for the same reason.
        `TestFirstPopulatedDate` pins the preference itself, on the newer fixture.
        """
        row = _icici_row(1)
        self.assertEqual(row.added_on, datetime(2026, 1, 1, 0, 0))
        self.assertEqual(row.added_on_date, date(2026, 1, 1))

    def test_the_legacy_export_has_no_transaction_date_column_to_prefer(self):
        """The other half of the test above, stated rather than implied.

        It would be easy to read the pass above as "Value Date still wins" and quietly reintroduce
        that as the rule. It does not win -- it is simply the only date column this file has.
        """
        header = _load("icici_sample.csv").decode().splitlines()[0]
        self.assertIn("Value Date", header)
        self.assertNotIn("Transaction Date", header)

    def test_there_is_no_time_of_day_so_every_row_lands_at_midnight(self):
        self.assertTrue(
            all(
                row.added_on.hour == 0 and row.added_on.minute == 0
                for row in _icici().rows
                if row.added_on
            )
        )

    # --- the synthesized status -----------------------------------------------------------------

    def test_every_row_carries_a_success_status(self):
        """⚠️ THE COST OF LEAVING THIS BLANK IS ONE-DIRECTIONAL AND SILENT. A passbook lists only
        postings that already settled, so SUCCESS is the truth. A blank status is not recognised by
        `BANK_TERMINAL_STATUSES`, which leans towards "still in flight" on purpose -- and the D4
        duplicate guard only counts a TERMINAL row as already imported. Blank would therefore make
        every ICICI row permanently non-duplicable: the same statement would re-stage in full on
        every upload, forever."""
        result = _icici()
        self.assertTrue(all(row.status_raw == "SUCCESS" for row in result.rows))
        self.assertTrue(all(row.is_success for row in result.rows))

    def test_a_bank_statement_carries_no_gateway_charges(self):
        result = _icici()
        self.assertEqual(result.charges_amount, Decimal("0"))

    def test_there_is_no_beneficiary_account_or_ifsc_on_this_source(self):
        """Both are absent from the export. An IFSC DOES appear inside some narrations, but it is
        the REMITTER's bank, never the payee's -- lifting it into `ifsc` would fill an identity
        field with the wrong bank's code."""
        result = _icici()
        self.assertTrue(all(row.bank_account == "" for row in result.rows))
        self.assertTrue(all(row.ifsc == "" for row in result.rows))

    def test_the_cheque_number_column_is_read_where_it_is_populated(self):
        # 32 of 1,274 real rows carry one; the fixture's row 8 is the shape.
        self.assertEqual(_icici_row(8).reference_id, "000190")
        self.assertEqual(_icici_row(1).reference_id, "")

    # --- counterparty extraction, one test per narration family ---------------------------------

    def test_neft_hyphen_form(self):
        # 103 rows in the real file, NEFT and RTGS together.
        row = _icici_row(2)
        self.assertEqual(row.beneficiary_name, "HIDEAWAY INTERIORS PRIVATE")
        self.assertEqual(row.bank_reference_no, "AXISP00111222333")

    def test_rtgs_hyphen_form(self):
        row = _icici_row(3)
        self.assertEqual(row.beneficiary_name, "TESTBUILD CONTRACTORS PRIVATE")
        self.assertEqual(row.bank_reference_no, "SBINR12026010300000001")

    def test_imps_with_five_segments(self):
        """`MMT/IMPS/<ref>/<payer>/<IFSC>` -- 123 of the real file's 881 IMPS rows.

        ⚠️ TESTED SEPARATELY FROM THE SIX-SEGMENT SHAPE ON PURPOSE. The two shapes are what make
        the rule non-obvious, and a single test over one of them would pass under either of the
        two rules that were measured WRONG (see the next test).
        """
        row = _icici_row(4)
        self.assertEqual(row.beneficiary_name, "TESTWALLET")
        self.assertEqual(row.bank_reference_no, "600200000001")

    def test_imps_with_six_segments(self):
        """`MMT/IMPS/<ref>/<purpose>/<payer>/<bank name>` -- 758 of the 881, so this is the single
        highest-volume shape in the whole statement.

        ⚠️ TWO RULES WERE TRIED AND MEASURED WRONG; NEITHER MAY BE REINTRODUCED:
          * `parts[4]` (a fixed position) returns the IFSC `IDFB0020101` on the 122 five-segment
            rows -- a bank code sitting in the payee field.
          * "the last segment that is not an IFSC" returns the BANK NAME `Kotak Mahindra` on every
            six-segment row, because a bank name is not IFSC-shaped.
        Second-to-last is the only rule that reads both, and it leaves 0 blanks across all 881.
        """
        row = _icici_row(5)
        self.assertEqual(row.beneficiary_name, "TESTPAYEEB")
        self.assertEqual(row.bank_reference_no, "601200000002")

    def test_both_imps_shapes_come_out_of_the_same_rule(self):
        """The point of the rule, asserted directly rather than through the fixture: one call, two
        shapes, and neither the IFSC nor the bank name reaches the payee field."""
        self.assertEqual(
            _icici_counterparty("MMT/IMPS/600219693408/CASHFREEIDFC/IDFB0020101"),
            ("CASHFREEIDFC", "600219693408"),
        )
        self.assertEqual(
            _icici_counterparty(
                "MMT/IMPS/601211625341/STRATOS REFUND /SAFETYWALA/Kotak Mahindra"
            ),
            ("SAFETYWALA", "601211625341"),
        )

    def test_inf_inft_internal_transfer(self):
        # 73 rows. The payee sits at a FIXED position here, unlike IMPS.
        row = _icici_row(1)
        self.assertEqual(row.beneficiary_name, "WIB Office acco")
        self.assertEqual(row.bank_reference_no, "042800000001")

    def test_inf_neft_is_a_different_shape_from_inf_inft(self):
        """23 rows, and they share the `INF/` prefix with the 73 above while placing the payee
        somewhere else entirely -- last segment, not segment 4. Reading them as one family puts a
        `BULD` batch id in the payee field."""
        row = _icici_row(6)
        self.assertEqual(row.beneficiary_name, "AshaMenonTes")
        self.assertEqual(row.bank_reference_no, "IN42600000000001")

    def test_cms_collection(self):
        # 3 rows.
        row = _icici_row(7)
        self.assertEqual(row.beneficiary_name, "TESTCLIENT VIBES PRIVATE LIMITED")
        self.assertEqual(row.bank_reference_no, "2000000001")

    def test_cheque_clearing_carries_a_client_name(self):
        """37 `CLG/` and 4 `TRF/` rows, and they were missing from the original spec. They are the
        most valuable rows in the file per row: an inbound cheque is a customer paying us."""
        self.assertEqual(_icici_row(8).beneficiary_name, "TESTCLIENT SPACES PVT L")
        self.assertEqual(_icici_row(9).beneficiary_name, "315 TEST AVENUE")
        self.assertEqual(_icici_row(18).beneficiary_name, "TESTSPARK ELECTRIC UDY")

    def test_a_cheque_clearing_bank_code_is_not_reported_as_a_reference(self):
        """⚠️ THE CORRECTION THAT MATTERS MOST ON THIS FAMILY. Segment 2 of the SHORT form holds a
        three-letter DRAWEE BANK CODE -- `KMB`, `HSB`, `UTI`, `HDF`, `ICI`, `SBI`, `PNB`, `KCU` on
        all 31 of the real file's short-form rows. Handing that to `normalize_reference` puts a
        token that can collide with anything into an IDENTITY field; it matched nothing in a live
        tier-0 run, which is both the correct outcome and the reason nobody would have noticed it
        was garbage. These rows are meant to reach the matcher on NAME (tier 2), never on
        reference."""
        self.assertEqual(_icici_row(18).bank_reference_no, "")
        self.assertEqual(_icici_row(18).normalized_reference, "")

    def test_a_real_cheque_number_is_still_kept(self):
        """The other half of the same correction, and it is not symmetry for its own sake: the
        `Cheque. No./Ref. No.` COLUMN is empty on all 10 of the real long-form rows, so the
        narration is the only place that cheque number exists. Blanking the whole family would have
        thrown it away."""
        self.assertEqual(_icici_row(8).bank_reference_no, "000190")
        self.assertEqual(_icici_row(9).bank_reference_no, "000834")

    def test_rtgs_slash_form_is_read_and_does_not_disturb_the_hyphen_form(self):
        """⚠️ A SECOND RTGS NARRATION, INVISIBLE UNTIL IT WAS MEASURED. It fell through to the
        no-counterparty branch, so 9 real rows carried no reference -- and 6 of them match a
        `Project Payments.utr` EXACTLY, amount and all. Adding it took live tier-0 hits from 35 to
        41.

        The hyphen form is tested FIRST in the extractor; the two cannot collide (they differ on
        the fifth character) and this asserts both still read correctly side by side.
        """
        self.assertEqual(_icici_row(19).bank_reference_no, "ICICR42026030200000001")
        self.assertEqual(_icici_row(19).beneficiary_name, "Testgateway")
        # ...and the hyphen form is untouched
        self.assertEqual(_icici_row(3).bank_reference_no, "SBINR12026010300000001")

    def test_rtgs_slash_payer_is_found_past_the_ifsc_and_the_batch_id(self):
        """The long form's TAIL is a `BULD` batch id, so neither end of the narration holds the
        payer. Scanning back past anything IFSC-shaped or `BULD`-prefixed is what reaches it."""
        row = _icici_row(20)
        self.assertEqual(row.beneficiary_name, "TESTFIRESOLUTIO")
        self.assertEqual(row.bank_reference_no, "ICICR42026030500000002")

    def test_a_row_with_no_counterparty_stays_blank(self):
        """⚠️ 141 of 1,274 real rows have NO counterparty, and a blank is the TRUTH on every one of
        them: government tax challans, interest postings, FD closures, ledger moves between our own
        accounts. Synthesizing a placeholder would put a party in front of the matcher that no
        human could ever confirm -- which is also why `beneficiary_name` is not in this source's
        required set."""
        for number in (10, 11):
            row = _icici_row(number)
            self.assertEqual(row.beneficiary_name, "")
            self.assertEqual(row.bank_reference_no, "")

    def test_an_unrecognised_narration_yields_nothing_rather_than_a_guess(self):
        self.assertEqual(_icici_counterparty("Ac xfr from gl 05051 to 60010"), ("", ""))
        self.assertEqual(_icici_counterparty("Int on FD/RD XXX1083  Tds:1393."), ("", ""))
        self.assertEqual(_icici_counterparty(""), ("", ""))

    # --- the two pairs that prove the durable key needs more than (id, amount, date) -------------

    def test_two_legs_sharing_an_id_differ_only_in_their_remarks(self):
        """The real shape is an SGST and a CGST leg posted together under one Tran. Id: same date,
        same amount, same direction. Nothing but the remark tells them apart, which is why the D4
        durable key cannot be built without it."""
        first, second = _icici_row(12), _icici_row(13)
        self.assertEqual(first.transfer_id, second.transfer_id)
        self.assertEqual(first.amount, second.amount)
        self.assertEqual(first.added_on_date, second.added_on_date)
        self.assertEqual(first.direction, second.direction)
        self.assertNotEqual(first.remarks, second.remarks)

    def test_two_legs_sharing_an_id_differ_only_in_their_direction(self):
        """The real shape is both legs of a general-ledger transfer: one id, one date, one amount,
        byte-identical narration, opposite sides of the account. Remarks alone cannot separate
        these -- the direction can, and only because it is captured."""
        out, back = _icici_row(14), _icici_row(15)
        self.assertEqual(out.transfer_id, back.transfer_id)
        self.assertEqual(out.amount, back.amount)
        self.assertEqual(out.added_on_date, back.added_on_date)
        self.assertEqual(out.remarks, back.remarks)
        self.assertEqual(out.direction, DIRECTION_DEBIT)
        self.assertEqual(back.direction, DIRECTION_CREDIT)

    def test_neither_pair_is_reported_as_an_in_file_duplicate_and_both_are_still_staged(self):
        """⚠️ THIS PIN IS INVERTED FROM ITS PRE-B3a FORM, WHICH ASSERTED BOTH IDS WERE REPORTED.

        The old answer came from `_duplicate_transfer_ids` keying on `(id, amount, date)` while
        staging keyed on B3's five-field key: one file, two answers about the same four rows. It now
        reads `duplicates.row_identity_of` with the source, which separates each pair on exactly the
        field it was put in the fixture to demonstrate -- the remarks for 12/13, the direction for
        14/15 -- so nothing is reported and all four rows stage, as they always did.

        Kept failing for anything else on purpose: a regression that narrowed this back to the
        triple would name the two ids again, and a bug that widened it wrongly would drop a row."""
        result = _icici()
        self.assertEqual(result.duplicate_transfer_ids, ())
        self.assertFalse([w for w in result.warnings if "more than once" in w])
        self.assertEqual(len([r for r in result.rows if r.transfer_id == "S20000001"]), 2)
        self.assertEqual(len([r for r in result.rows if r.transfer_id == "S30000001"]), 2)

    def test_the_preview_warning_and_staging_read_the_same_key(self):
        """The whole point of threading `source` through: `duplicates.py`'s docstring says every
        reader of this key must agree or "one call two rows duplicates while another calls them
        distinct, on the same file". This asserts the agreement directly rather than by its
        symptom -- an id is reported here exactly when the source's own identity repeats."""
        from nirmaan_stack.services.outflow_import.duplicates import row_identity_of

        result = _icici()
        seen, repeated = set(), []
        for row in result.rows:
            identity = row_identity_of(row, "ICICI Bank Statement")
            if identity in seen and row.transfer_id not in repeated:
                repeated.append(row.transfer_id)
            seen.add(identity)
        self.assertEqual(tuple(repeated), result.duplicate_transfer_ids)
        # And the wide key really is what separates them: every staged row is its own transfer.
        self.assertEqual(len(seen), len(result.rows))

    # --- warnings -------------------------------------------------------------------------------

    def test_an_unreadable_date_warns_and_the_row_is_still_staged(self):
        """A fabricated date would place the transfer in the wrong period, so the row keeps a
        `None` and says so."""
        result = _icici()
        row = _icici_row(16)
        self.assertIsNone(row.added_on)
        self.assertTrue(any("Row 16" in w and "Added On" in w for w in result.warnings))

    def test_both_money_columns_populated_is_corrupt_and_says_so(self):
        """⚠️ NOTHING IS GUESSED HERE. Picking one of two populated columns would post a real
        amount in a direction the statement never claimed -- invisibly wrong. A blank amount, a
        blank direction and a loud warning are visibly wrong, which is recoverable."""
        result = _icici()
        row = _icici_row(17)
        self.assertEqual(row.amount, Decimal("0"))
        self.assertEqual(row.direction, "")
        self.assertTrue(
            any("Row 17" in w and "both" in w for w in result.warnings),
            result.warnings,
        )

    def test_the_only_warnings_are_the_two_the_fixture_asks_for(self):
        """Pinned as a whole count, because a warning that fires on ordinary rows is how a warning
        list stops being read -- the same failure capability 2 was written to fix.

        ⚠️ IT WAS THREE BEFORE SLICE B3a. The third was the over-reported "2 transfer id(s) appear
        more than once", which the source-aware key removed; the unreadable date (row 16) and the
        both-money-columns row (17) remain, and both are genuine."""
        result = _icici()
        self.assertEqual(len(result.warnings), 2, result.warnings)
        self.assertTrue(any("Added On" in w for w in result.warnings))
        self.assertTrue(any("both" in w for w in result.warnings))

    # --- whole-file failures --------------------------------------------------------------------

    def test_a_statement_missing_a_money_column_is_refused(self):
        """Both money columns are required as COLUMNS, not as values -- exactly one of them is
        blank on every row by design. Losing one would silently halve the statement's directions."""
        text = _load("icici_sample.csv").decode()
        without_deposit = text.replace('"Deposit Amt (INR)",', "", 1)
        with self.assertRaises(StatementFormatError) as caught:
            parse_statement(without_deposit.encode(), source="ICICI Bank Statement")
        self.assertIn("Deposit Amt (INR)", str(caught.exception))

    def test_a_cashfree_statement_is_refused_as_icici(self):
        with self.assertRaises(StatementFormatError) as caught:
            parse_statement(_load("cashfree_sample.csv"), source="ICICI Bank Statement")
        self.assertIn("Missing column", str(caught.exception))

    def test_an_icici_statement_is_refused_as_cashfree(self):
        with self.assertRaises(StatementFormatError) as caught:
            parse_statement(_load("icici_sample.csv"), source="Cashfree")
        self.assertIn("Missing column", str(caught.exception))


# --- slices C1-C4: where the table is, and which column is the date ------------------------------
#
# `icici_preamble_sample.csv` is the FABRICATED 10-column export, on the same terms as every other
# fixture here -- invented company names, invented account numbers -- reproducing the structural
# shape of the real Detailed Statement that will be uploaded routinely:
#
#   1-16   account-info preamble. Row 8 reads `Transaction Date from:`, which is the NEAR-MISS the
#          whole search rests on: it must not be mistaken for the `Transaction Date` COLUMN.
#   17     the header row -- ten columns, `Value Date` and `Transaction Date` side by side
#   18-21  the table. Row 19 is an interest posting whose two dates DIFFER (the 11-of-1,395 shape);
#          row 21 has a blank `Transaction Date` and must fall back to its `Value Date`.
#   22     wholly blank -- this is what ENDS the table
#   23-27  the balances block, every figure in column B, which is the `Tran. Id` column
#   28     wholly blank
#   29-31  the legend, column A only
#
# ⚠️ THE BALANCES BLOCK IS THE POINT OF THE TRAILER, NOT DECORATION. Its figures sit in the
# `Tran. Id` column, so a table read to the end of the sheet stages them as transfers with ids like
# `-4,87,90,566.06` -- measured on a real 145-row export: 94 rows read where 90 are real. The
# legend lines are harmless by accident (column A only, so a blank id already drops them), which is
# exactly why the blank-row rule is the guard and "drop rows that look wrong" is not.


def _icici_preamble(name: str = "icici_preamble_sample.csv", **kwargs) -> ParseResult:
    return parse_statement(_load(name), source="ICICI Bank Statement", **kwargs)


def _grid(*rows) -> list:
    """A hand-built sheet. Every test below that needs a specific shape builds it here rather than
    committing another fixture, because the shape IS the assertion."""
    return [list(row) for row in rows]


_REQUIRED = frozenset({"Tran. Id", "Transaction Remarks"})


class TestLocateTable(unittest.TestCase):
    """`locate_table` -- pure, and tested over hand-built grids (slice C2).

    It answers two questions that used to be assumed: WHERE the table starts, and where it ENDS.
    Both are gated on `sources.source_has_preamble`, and the gate is load-bearing rather than
    decorative -- see `TestTheLayoutGateHoldsGatewaySourcesStill`.
    """

    def test_the_header_is_the_first_row_carrying_every_required_column(self):
        grid = _grid(
            ["Detailed Statement"],
            ["Name:", "TESTCO"],
            ["Tran. Id", "Transaction Remarks"],
            ["S1", "a payment"],
        )
        bounds = locate_table(grid, required=_REQUIRED, has_preamble=True)
        self.assertEqual(bounds.header_row, 3)
        self.assertEqual(bounds.detected_header_row, 3)
        self.assertFalse(bounds.was_overridden)
        self.assertEqual(bounds.first_data_row, 4)
        self.assertEqual(bounds.last_data_row, 4)

    def test_a_preamble_row_that_merely_mentions_a_column_name_is_not_the_header(self):
        """⚠️ THE NEAR-MISS, AND THE REASON MATCHING IS EXACT AFTER STRIP RATHER THAN FUZZY. Row 2
        of a real ICICI statement's preamble reads `Transaction Date from:`. A substring, prefix or
        `startswith` rule would accept it as the `Transaction Date` column and place the header
        several rows too high -- where the required-column check would then fail, or worse, pass on
        a coincidence and read the preamble as transactions."""
        grid = _grid(
            ["Transaction Date from:", "01/Jan/2026"],
            ["Transaction Date to:", "08/Sep/2026"],
            ["Transaction Date", "Tran. Id", "Transaction Remarks"],
            ["01/Jan/2026", "S1", "a payment"],
        )
        bounds = locate_table(
            grid,
            required=frozenset({"Transaction Date", "Tran. Id", "Transaction Remarks"}),
            has_preamble=True,
        )
        self.assertEqual(bounds.header_row, 3)

    def test_leading_and_trailing_space_around_a_header_name_still_matches(self):
        """Exact-after-STRIP, not exact-after-nothing. A spreadsheet routinely leaves a trailing
        space in a header cell, and refusing over one would be a baffling failure on a good file."""
        grid = _grid(["  Tran. Id ", "Transaction Remarks  "], ["S1", "a payment"])
        self.assertEqual(
            locate_table(grid, required=_REQUIRED, has_preamble=True).header_row, 1
        )

    # --- where the table ends -------------------------------------------------------------------

    def test_the_first_wholly_blank_row_ends_the_table_and_the_trailer_is_counted(self):
        grid = _grid(
            ["Tran. Id", "Transaction Remarks"],
            ["S1", "a payment"],
            ["S2", "another payment"],
            [],
            ["Opening Bal:", "-4,87,90,566.06"],
            ["Closing Bal:", "-5,39,48,002.86"],
        )
        bounds = locate_table(grid, required=_REQUIRED, has_preamble=True)
        self.assertEqual((bounds.first_data_row, bounds.last_data_row), (2, 3))
        self.assertEqual(bounds.trailing_non_blank_rows, 2)
        self.assertEqual(bounds.total_rows, 6)

    def test_a_row_of_empty_cells_is_as_blank_as_an_empty_row(self):
        """A CSV writes its blank line as `,,,` and a workbook writes it as a row of `None`. Both
        are the end of the table, and a rule that only recognised one of them would truncate one
        format and over-read the other, from the same statement."""
        grid = _grid(
            ["Tran. Id", "Transaction Remarks"],
            ["S1", "a payment"],
            ["", "   ", ""],
            ["Closing Bal:", "-5,39,48,002.86"],
        )
        bounds = locate_table(grid, required=_REQUIRED, has_preamble=True)
        self.assertEqual(bounds.last_data_row, 2)
        self.assertEqual(bounds.trailing_non_blank_rows, 1)

    def test_a_sheet_that_simply_ends_after_its_data_ignores_nothing(self):
        grid = _grid(["Tran. Id", "Transaction Remarks"], ["S1", "a"], ["S2", "b"])
        bounds = locate_table(grid, required=_REQUIRED, has_preamble=True)
        self.assertEqual(bounds.last_data_row, 3)
        self.assertEqual(bounds.trailing_non_blank_rows, 0)

    def test_a_header_with_nothing_under_it_is_an_empty_table_not_a_crash(self):
        grid = _grid(["Tran. Id", "Transaction Remarks"])
        bounds = locate_table(grid, required=_REQUIRED, has_preamble=True)
        self.assertGreater(bounds.first_data_row, bounds.last_data_row)

    # --- the refusal ----------------------------------------------------------------------------

    def test_no_header_row_names_the_closest_candidate_and_what_it_lacks(self):
        """⚠️ THE OLD MESSAGE WAS `"The uploaded statement has no header row."` AND IT READ THE SAME
        FOR THREE DIFFERENT PROBLEMS -- a wrong file, the wrong source picked, and a perfectly good
        statement whose header needs pointing at. Naming the closest row and its missing columns is
        what turns it into an instruction."""
        grid = _grid(
            ["Detailed Statement"],
            ["Tran. Id", "Balance (INR)"],
            ["S1", "100"],
        )
        with self.assertRaises(StatementFormatError) as caught:
            locate_table(grid, required=_REQUIRED, has_preamble=True, source_label="ICICI")
        message = str(caught.exception)
        self.assertIn("row 2", message)
        self.assertIn("Transaction Remarks", message)
        self.assertIn("ICICI", message)

    def test_a_sheet_with_nothing_in_common_lists_every_column_it_needed(self):
        grid = _grid(["Nothing", "Familiar"], ["a", "b"])
        with self.assertRaises(StatementFormatError) as caught:
            locate_table(grid, required=_REQUIRED, has_preamble=True)
        self.assertIn("Tran. Id", str(caught.exception))
        self.assertIn("Transaction Remarks", str(caught.exception))

    def test_an_empty_sheet_still_says_there_is_no_header_row(self):
        with self.assertRaises(StatementFormatError) as caught:
            locate_table([], required=_REQUIRED, has_preamble=True)
        self.assertIn("no header row", str(caught.exception))

    # --- the override ---------------------------------------------------------------------------

    def test_an_override_picks_a_later_qualifying_row(self):
        """The case an override EXISTS for: two rows qualify and the first one is not the table.
        Detection cannot know that, and a person looking at the sheet can."""
        grid = _grid(
            ["Tran. Id", "Transaction Remarks"],
            ["a summary line", "which happens to qualify"],
            ["Tran. Id", "Transaction Remarks"],
            ["S1", "a payment"],
        )
        bounds = locate_table(
            grid, required=_REQUIRED, has_preamble=True, header_row_override=3
        )
        self.assertEqual(bounds.header_row, 3)
        self.assertTrue(bounds.was_overridden)
        # ⚠️ REPORTED SEPARATELY, AND THAT SEPARATION IS THE SCREEN'S WHOLE QUESTION: "we read row
        # 1, you asked for row 3" is the only sentence that shows a person overrode something.
        self.assertEqual(bounds.detected_header_row, 1)

    def test_confirming_the_detected_row_still_counts_as_overridden(self):
        """`was_overridden` reports what the REQUEST said, not what the outcome was. Someone who
        confirms row 17 by hand has made a decision, and relabelling it as auto-detected removes
        the only evidence that a person looked."""
        grid = _grid(["Tran. Id", "Transaction Remarks"], ["S1", "a"])
        bounds = locate_table(
            grid, required=_REQUIRED, has_preamble=True, header_row_override=1
        )
        self.assertTrue(bounds.was_overridden)
        self.assertEqual(bounds.detected_header_row, bounds.header_row)

    def test_an_override_past_the_end_of_the_sheet_is_refused_with_its_length(self):
        grid = _grid(["Tran. Id", "Transaction Remarks"], ["S1", "a"])
        with self.assertRaises(StatementFormatError) as caught:
            locate_table(grid, required=_REQUIRED, has_preamble=True, header_row_override=9)
        self.assertIn("2 row(s)", str(caught.exception))

    def test_an_override_at_a_row_that_is_not_a_header_names_what_is_missing(self):
        """⚠️ AN OVERRIDE IS VALIDATED, NEVER TRUSTED. Read blind, row 2 here would become the
        header and every transaction under it would parse against column names taken from a
        transaction -- a full sheet of rows with no id, no amount and no date, and no error."""
        grid = _grid(
            ["Tran. Id", "Transaction Remarks"],
            ["S1", "a payment"],
            ["S2", "another payment"],
        )
        with self.assertRaises(StatementFormatError) as caught:
            locate_table(grid, required=_REQUIRED, has_preamble=True, header_row_override=2)
        message = str(caught.exception)
        self.assertIn("Row 2", message)
        self.assertIn("Tran. Id", message)

    def test_a_row_number_that_is_not_a_positive_whole_number_is_refused(self):
        grid = _grid(["Tran. Id", "Transaction Remarks"], ["S1", "a"])
        for bad in (0, -3, "1", 1.0, None if False else True):
            with self.subTest(bad=bad):
                with self.assertRaises(StatementFormatError):
                    locate_table(
                        grid, required=_REQUIRED, has_preamble=True, header_row_override=bad
                    )

    def test_true_is_refused_even_though_python_calls_it_an_int(self):
        """⚠️ `isinstance(True, int)` IS `True`. Without the explicit bool guard a caller that
        passed a flag where a row number belongs would read row 1 and look like it worked."""
        grid = _grid(["Tran. Id", "Transaction Remarks"], ["S1", "a"])
        with self.assertRaises(StatementFormatError):
            locate_table(grid, required=_REQUIRED, has_preamble=True, header_row_override=True)


class TestTheLayoutGateHoldsGatewaySourcesStill(unittest.TestCase):
    """⚠️ THE GATE IS LOAD-BEARING, NOT DECORATION (slice C2).

    Cashfree (16 batches) and Cashbook (2) carry live settled data. Both halves of the new layout
    behaviour are gated on `sources.source_has_preamble`, and each half would break them in a
    different way if it were made universal:

      * SEARCHING for the header would let a gateway export whose row 1 is wrong quietly find a
        matching row further down and import part of a file nobody meant to send.
      * ENDING at the first blank row would SILENTLY TRUNCATE any gateway sheet carrying one --
        the worst failure class in this module, because the import looks entirely successful.
    """

    def test_a_gateway_source_declares_no_preamble_and_a_passbook_does(self):
        self.assertFalse(source_has_preamble("Cashfree"))
        self.assertFalse(source_has_preamble("Cashbook"))
        self.assertTrue(source_has_preamble("ICICI Bank Statement"))

    def test_an_unknown_or_blank_source_keeps_the_row_one_behaviour(self):
        self.assertFalse(source_has_preamble(""))
        self.assertFalse(source_has_preamble("Something New"))

    def test_without_a_preamble_the_header_is_row_one_and_nothing_else(self):
        grid = _grid(
            ["Nothing", "Familiar"],
            ["Tran. Id", "Transaction Remarks"],
            ["S1", "a payment"],
        )
        with self.assertRaises(StatementFormatError) as caught:
            locate_table(grid, required=_REQUIRED, has_preamble=False)
        # It refuses rather than finding row 2 -- and its message does not send the reader to a
        # "closest row" that it would not have read anyway.
        self.assertIn("Missing column", str(caught.exception))
        self.assertNotIn("closest row", str(caught.exception))

    def test_without_a_preamble_a_blank_row_does_not_end_the_table(self):
        grid = _grid(
            ["Tran. Id", "Transaction Remarks"],
            ["S1", "a payment"],
            [],
            ["S2", "a payment after the gap"],
        )
        bounds = locate_table(grid, required=_REQUIRED, has_preamble=False)
        self.assertEqual(bounds.last_data_row, 4)
        self.assertEqual(bounds.trailing_non_blank_rows, 0)

    def test_a_blank_line_in_a_real_cashfree_statement_costs_nothing(self):
        """The end-to-end form of the test above, on the live source's own fixture. A universal
        end-rule would drop every transfer after the gap and report a clean import."""
        text = _load("cashfree_sample.csv").decode().splitlines()
        with_gap = "\n".join(text[:3] + [""] + text[3:]) + "\n"
        self.assertEqual(
            [r.transfer_id for r in parse_statement(with_gap.encode(), source="Cashfree").rows],
            [r.transfer_id for r in _sample().rows],
        )

    def test_a_gateway_source_carries_no_layout_and_no_grid(self):
        """⚠️ `None` RATHER THAN A TRIVIALLY-TRUE ROW 1. It is what makes the preview's `sheet`
        block ABSENT for these two sources -- a block full of true-by-construction numbers would
        put a header picker on a screen with nothing to pick."""
        for result in (_sample(), _cashbook()):
            self.assertIsNone(result.bounds)
            self.assertEqual(result.grid, ())

    def test_an_override_is_refused_on_a_source_that_has_no_row_to_pick(self):
        """Refused rather than ignored: a header row arriving for a sheet with no preamble means
        the caller believes something about this file that is not true, and reading row 1 anyway
        would hide that. Row 1 itself is accepted, because it is not a disagreement."""
        with self.assertRaises(StatementFormatError) as caught:
            parse_statement(_load("cashfree_sample.csv"), source="Cashfree", header_row=4)
        self.assertIn("row 1", str(caught.exception))

        self.assertEqual(
            len(parse_statement(_load("cashfree_sample.csv"), source="Cashfree", header_row=1).rows),
            11,
        )


class TestIciciPreambleStatement(unittest.TestCase):
    """The 10-column export end to end, through `parse_statement` (slices C1-C4)."""

    def test_the_table_is_found_between_its_preamble_and_its_trailer(self):
        bounds = _icici_preamble().bounds
        self.assertEqual(bounds.total_rows, 31)
        self.assertEqual(bounds.detected_header_row, 17)
        self.assertEqual(bounds.header_row, 17)
        self.assertFalse(bounds.was_overridden)
        self.assertEqual((bounds.first_data_row, bounds.last_data_row), (18, 21))
        # 5 balance lines + a legend heading + 2 legend lines. Blank rows are not counted: "we
        # ignored 8 rows carrying text" is the sentence a reader can check.
        self.assertEqual(bounds.trailing_non_blank_rows, 8)

    def test_the_balances_block_does_not_become_four_transfers(self):
        """⚠️ THE MEASURED DEFECT THE END-RULE EXISTS FOR. Four of the five balance lines put their
        FIGURE in column B, which on this sheet is `Tran. Id` -- so a table read to the end of the
        file stages them as transfers with ids like `-4,87,90,566.06`. On a real 145-row export
        that is 94 rows read where 90 are real."""
        result = _icici_preamble()
        self.assertEqual(len(result.rows), 4)
        self.assertEqual(
            [row.transfer_id for row in result.rows],
            ["S20000001", "S20000002", "S20000003", "S20000004"],
        )
        self.assertFalse([row for row in result.rows if "," in row.transfer_id])

    def test_the_preamble_produces_no_warnings_at_all(self):
        """Rows above the header are not rows we failed to read -- they were never offered to the
        row builder. A preamble reported as sixteen warnings is how a warning list stops being
        read; see capability 2 in the module docstring for the same argument about a trailer."""
        self.assertEqual(_icici_preamble().warnings, ())

    def test_the_workbook_twin_parses_to_exactly_the_same_rows(self):
        """The whole point of the C1 split: finding the table happens ABOVE the format seam, so a
        preamble and a trailer read identically whichever way the sheet was saved. Both real
        exports are .xlsx, so this is the format that matters -- and a blank row survives openpyxl
        as an empty row, which is what the end-rule depends on."""
        from_csv = _icici_preamble()
        from_xlsx = _icici_preamble("icici_preamble_sample.xlsx")
        self.assertEqual(from_csv.rows, from_xlsx.rows)
        self.assertEqual(from_csv.bounds, from_xlsx.bounds)

    def test_the_header_row_can_be_overridden_through_parse_statement(self):
        """A row that is not the header is refused by name rather than read blind."""
        with self.assertRaises(StatementFormatError) as caught:
            _icici_preamble(header_row=8)
        self.assertIn("Row 8", str(caught.exception))

        bounds = _icici_preamble(header_row=17).bounds
        self.assertEqual(bounds.header_row, 17)
        self.assertTrue(bounds.was_overridden)

    def test_the_whole_sheet_rides_the_result_including_its_preamble(self):
        """Carried on the result rather than re-read by the endpoint, so the rows the picker
        DISPLAYS and the rows the parser READ are one read."""
        grid = _icici_preamble().grid
        self.assertEqual(len(grid), 31)
        self.assertEqual(grid[7][0], "Transaction Date from:")
        self.assertEqual(grid[16][1], "Tran. Id")


class TestFirstPopulatedDate(unittest.TestCase):
    """Capability 6 -- `added_on` prefers `Transaction Date` and falls back to `Value Date`.

    ⚠️ THE SWITCH IS SAFE ONLY BECAUSE THERE IS NO HISTORY TO DISAGREE WITH IT, AND THAT WAS
    MEASURED (2026-09-08): ZERO `ICICI Bank Statement` batches exist in the live database. The date
    is part of `duplicates.row_identity_of`, so on a source with stored rows this change would
    silently re-open every row whose two dates differ and stage it a second time.
    """

    def test_transaction_date_wins_where_the_two_disagree(self):
        """Row 19 of the fixture is an interest posting -- the bank VALUES it a day before it POSTS
        it. 11 of 1,395 real rows are this shape, all of them interest. The transaction date is
        when the money moved, which is what a reviewer reconciles against."""
        row = [r for r in _icici_preamble().rows if r.transfer_id == "S20000002"][0]
        self.assertEqual(row.added_on, datetime(2026, 1, 2, 0, 0))

    def test_value_date_is_used_where_the_preferred_column_is_blank_on_that_row(self):
        """PER ROW, not per file. The preference is consulted for every row, so one row missing its
        transaction date falls back without affecting any other."""
        row = [r for r in _icici_preamble().rows if r.transfer_id == "S20000004"][0]
        self.assertEqual(row.added_on, datetime(2026, 1, 4, 0, 0))

    def test_the_period_follows_the_preferred_column(self):
        result = _icici_preamble()
        self.assertEqual(result.period_from, date(2026, 1, 1))
        self.assertEqual(result.period_to, date(2026, 1, 4))

    def test_a_tuple_would_join_the_two_dates_which_is_why_this_is_its_own_marker(self):
        """⚠️ RECORDED SO THE THREE MULTI-COLUMN FORMS ARE NEVER COLLAPSED INTO ONE. A tuple map
        value JOINS with `_MULTI_COLUMN_JOIN`, so `added_on` mapped that way would hand
        `_parse_datetime` `"01/Jan/2026 - 02/Jan/2026"` and every row would land undated."""
        from nirmaan_stack.services.outflow_import.parser import _parse_datetime

        self.assertIsNone(_parse_datetime("01/Jan/2026 - 02/Jan/2026"))

    def test_whichever_is_populated_would_call_both_dates_corrupt(self):
        """The other rejected form. `_WhicheverIsPopulated` demands EXACTLY ONE be populated and
        warns when two are -- but here both are populated on essentially every row, by design."""
        from nirmaan_stack.services.outflow_import.parser import (
            _WhicheverIsPopulated,
            _resolve_whichever,
        )

        marker = _WhicheverIsPopulated(
            columns=("Transaction Date", "Value Date"),
            labels=("posted", "valued"),
            label_field="direction",
        )
        value, label, problem = _resolve_whichever(
            marker, lambda name: {"Transaction Date": "02/Jan/2026", "Value Date": "01/Jan/2026"}[name]
        )
        self.assertEqual((value, label, problem), ("", "", "both"))

    def test_the_required_set_does_not_name_the_preferred_column(self):
        """⚠️ REQUIRING `Transaction Date` WOULD REFUSE THE OLDER 8-COLUMN EXPORT OUTRIGHT, which
        still parses correctly through the fallback -- and the required set is also what decides
        which row IS the header, so it must name only what every variant of this statement has."""
        from nirmaan_stack.services.outflow_import.parser import _ICICI_REQUIRED

        self.assertIn("Value Date", _ICICI_REQUIRED)
        self.assertNotIn("Transaction Date", _ICICI_REQUIRED)


class TestDescribeMappedColumns(unittest.TestCase):
    """"These are the columns I will read", derived from the adapter's own map (slice C5).

    ⚠️ DERIVED, NEVER A SECOND HAND-WRITTEN LIST. It is display copy for a screen whose entire job
    is confirming that the parser is reading the right row -- so a list maintained separately would
    be free to keep saying `Value Date` on the day the map started preferring `Transaction Date`,
    and the person would be confirming something that is not happening.
    """

    def _described(self, name="icici_preamble_sample.csv"):
        result = _icici_preamble(name)
        header = result.grid[result.bounds.header_row - 1]
        return describe_mapped_columns("ICICI Bank Statement", header)

    def test_every_mapped_field_is_named_with_its_columns_and_letters(self):
        self.assertEqual(
            self._described(),
            [
                {"label": "Transfer id",
                 "columns": [{"header": "Tran. Id", "letter": "B"}]},
                {"label": "Date",
                 "columns": [{"header": "Transaction Date", "letter": "D"},
                             {"header": "Value Date", "letter": "C"}],
                 "note": "the first one that has a value"},
                {"label": "Amount & direction",
                 "columns": [{"header": "Withdrawal Amt (INR)", "letter": "H"},
                             {"header": "Deposit Amt (INR)", "letter": "I"}],
                 "note": "whichever one is filled in"},
                {"label": "Reference",
                 "columns": [{"header": "Cheque. No./Ref. No.", "letter": "F"}]},
                {"label": "Remarks",
                 "columns": [{"header": "Transaction Remarks", "letter": "G"}]},
            ],
        )

    def test_the_columns_are_listed_in_the_order_the_parser_consults_them(self):
        """`Transaction Date` before `Value Date`, which is D before C -- NOT sheet order. The list
        is an account of a decision, so it has to read in the order the decision is made."""
        date_entry = [e for e in self._described() if e["label"] == "Date"][0]
        self.assertEqual([c["letter"] for c in date_entry["columns"]], ["D", "C"])

    def test_a_derived_field_has_no_column_and_is_omitted(self):
        """`status_raw`, `beneficiary_name` and `bank_reference_no` are read out of the narration
        (capability 4). Listing them would promise a column that does not exist."""
        labels = {entry["label"] for entry in self._described()}
        self.assertNotIn("Status", labels)
        self.assertNotIn("Beneficiary", labels)

    def test_a_column_this_file_does_not_have_is_omitted_rather_than_listed_blank(self):
        """On the older 8-column export there genuinely is no `Transaction Date` to read, and
        saying so by absence is truer than showing it greyed out. The note goes with it: with one
        column left there is no choice to explain."""
        header = _load("icici_sample.csv").decode().splitlines()[0]
        described = describe_mapped_columns(
            "ICICI Bank Statement", next(csv.reader([header]))
        )
        date_entry = [e for e in described if e["label"] == "Date"][0]
        self.assertEqual(date_entry["columns"], [{"header": "Value Date", "letter": "C"}])
        self.assertNotIn("note", date_entry)

    def test_column_letters_run_past_z(self):
        self.assertEqual([column_letter(i) for i in (0, 25, 26, 27, 51, 52)],
                         ["A", "Z", "AA", "AB", "AZ", "BA"])


if __name__ == "__main__":
    unittest.main()
