# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Porter Statement's pure half: its column adapter, its invoice grouping and refusals (#1443).
Project placement is `test_porter_placement`'s (#1448).

    devenv.sh unit nirmaan_stack.services.outflow_import.test_porter

The fixture is SYNTHETIC (invented names, phones and emails) and shaped like the 2026-09 statement:
four invoices under two billing entities, an IGST city and a CGST/SGST city, one cancelled order and a
row whose tax is rounded up (133 x 5% = 6.65, the statement says 6.66).
"""

import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

from nirmaan_stack.services.outflow_import.parser import (
    BANK_SUCCESS_STATUS,
    DIRECTION_DEBIT,
    SUPPORTED_SOURCES,
    StatementFormatError,
    parse_statement,
)
from nirmaan_stack.services.outflow_import.porter import (
    EXPENSE_TYPE,
    IMPORT_CREATED,
    IMPORT_CREATING,
    IMPORT_VALIDATED,
    IMPORT_VALIDATING,
    IMPORT_VALIDATION_FAILED,
    INVOICE_ERROR,
    INVOICE_FAILED,
    INVOICE_IN_FLIGHT,
    INVOICE_PASSED,
    PORTER_COLUMNS,
    InvoiceFigures,
    InvoiceRead,
    PorterStatementError,
    expense_description,
    import_state,
    judge_invoice,
    porter_order_fields,
    read_porter_statement,
    remark_group_key,
)
from nirmaan_stack.services.outflow_import.sources import PORTER_STATEMENT_SOURCE

FIXTURE = Path(__file__).parent / "tests" / "fixtures" / "porter_sample.csv"


def _text() -> str:
    return FIXTURE.read_text(encoding="utf-8")


def _parse(text: str):
    return parse_statement(text.encode(), source=PORTER_STATEMENT_SOURCE)


def _statement(text: str | None = None):
    return read_porter_statement(_parse(text if text is not None else _text()))


class TestTheAdapter(unittest.TestCase):
    def test_the_source_is_one_the_parser_knows(self):
        self.assertEqual(PORTER_STATEMENT_SOURCE, "Porter Statement")
        self.assertIn(PORTER_STATEMENT_SOURCE, SUPPORTED_SOURCES)

    def test_a_line_reads_as_a_debit_of_the_fare_by_whoever_booked_it(self):
        row = _parse(_text()).rows[0]
        self.assertEqual(row.transfer_id, "CRN900000000001")
        self.assertEqual(row.amount, Decimal("858.0"))
        self.assertEqual(row.direction, DIRECTION_DEBIT)
        self.assertEqual(row.added_by_raw, "Kavya Menon")
        self.assertEqual(row.remarks.strip(), "zephyr tower project")
        self.assertEqual(row.beneficiary_name, "PORTERTEST LOGISTICS PRIVATE LIMITED")
        self.assertEqual(str(row.added_on), "2026-09-02 10:15:00")

    def test_a_completed_order_is_a_success_and_a_cancelled_one_is_not(self):
        rows = {row.transfer_id: row for row in _parse(_text()).rows}
        self.assertEqual(rows["CRN900000000001"].status_raw, BANK_SUCCESS_STATUS)
        self.assertTrue(rows["CRN900000000001"].is_success)
        self.assertEqual(rows["CRN900000000011"].status_raw, "cancelled")
        self.assertFalse(rows["CRN900000000011"].is_success)

    def test_every_statement_column_is_kept_verbatim(self):
        row = _parse(_text()).rows[3]
        kept = dict(row.extra)
        self.assertEqual(set(kept), set(PORTER_COLUMNS))
        self.assertEqual(kept["porter_invoice_number"], "29SS27A0900001")
        self.assertEqual(kept["order_status"], "completed")
        self.assertEqual(kept["waypoint_addresses"], "Demo Hardware  KR Market  Bengaluru  Karnataka 560002  India")
        self.assertEqual(kept["tax_amount"], "80.8")

    def test_the_other_sources_keep_nothing_extra(self):
        cashbook = (
            "Txn Id,Date,Type,Debit,Payment Status,To,Remark\n"
            "T1,2026-09-01 10:00:00,Wallet Spend,100,SUCCESS,Shop,tea\n"
        )
        row = parse_statement(cashbook.encode(), source="Cashbook").rows[0]
        self.assertEqual(row.extra, ())

    def test_a_file_missing_a_column_is_refused_naming_it(self):
        text = _text().replace("porter_gstin", "gstin_of_porter", 1)
        with self.assertRaises(StatementFormatError) as caught:
            _parse(text)
        self.assertIn("porter_gstin", str(caught.exception))

    def test_a_file_with_no_rows_is_refused(self):
        with self.assertRaises(StatementFormatError):
            _parse(_text().splitlines()[0] + "\n")


class TestGroupingIntoInvoices(unittest.TestCase):
    def test_one_invoice_per_invoice_link(self):
        statement = _statement()
        self.assertEqual(
            [invoice.invoice_number for invoice in statement.invoices],
            ["29SS27A0900001", "24SS27A0900002", "29SM27A0900003", "36SM27A0900004"],
        )

    def test_an_invoice_carries_the_statements_figures_over_completed_orders_only(self):
        hyderabad = _statement().invoices[3]
        self.assertEqual(hyderabad.city, "Hyderabad")
        self.assertEqual(hyderabad.porter_gstin, "36AAATQ1111B1Z3")
        self.assertEqual(hyderabad.customer_gstin, "29AAACN9999X1Z0")
        self.assertEqual(hyderabad.billing_entity, "PORTERTEST MARKETING PRIVATE LIMITED")
        self.assertEqual(
            hyderabad.invoice_link,
            "https://porter-invoices.example.test/2026-10-01/pfe_consolidated_note_36SM27A0900004.pdf",
        )
        # Three lines, one cancelled: 285 + 328 completed, the cancelled 328 counts toward nothing.
        self.assertEqual(hyderabad.completed_orders, 2)
        self.assertEqual(hyderabad.fare_total, Decimal("613"))
        self.assertEqual(hyderabad.tax_total, Decimal("30.65"))

    def test_the_tax_total_is_the_statements_own_row_by_row_sum(self):
        bangalore = _statement().invoices[0]
        self.assertEqual(bangalore.completed_orders, 5)
        self.assertEqual(bangalore.fare_total, Decimal("3087"))
        self.assertEqual(bangalore.tax_total, Decimal("154.36"))

    def test_the_statement_counts_its_orders(self):
        statement = _statement()
        self.assertEqual(len(statement.lines), 12)
        self.assertEqual(len(statement.completed), 11)
        self.assertEqual([line.crn for line in statement.cancelled], ["CRN900000000011"])
        self.assertEqual(statement.fare_total, Decimal("5235"))

    def test_the_period_runs_from_the_first_to_the_last_completion_date(self):
        statement = _statement()
        self.assertEqual(statement.period_from, date(2026, 9, 1))
        self.assertEqual(statement.period_to, date(2026, 9, 30))

    def test_each_line_names_its_invoice(self):
        statement = _statement()
        line = next(line for line in statement.lines if line.crn == "CRN900000000007")
        self.assertEqual(line.invoice_number, "24SS27A0900002")
        self.assertEqual(line.statement["vehicle_type"], "Tata Ace")

    def _refused(self, text: str) -> str:
        with self.assertRaises(PorterStatementError) as caught:
            _statement(text)
        return str(caught.exception)

    def _swap_on_line(self, crn: str, old: str, new: str) -> str:
        lines = _text().splitlines(keepends=True)
        return "".join(
            line.replace(old, new) if line.startswith(crn) else line for line in lines
        )

    def test_an_invoice_whose_lines_disagree_on_the_invoice_number_is_refused(self):
        message = self._refused(
            self._swap_on_line("CRN900000000002", ",29SS27A0900001,", ",29SS27A0999999,")
        )
        self.assertIn("pfe_consolidated_note_29SS27A0900001.pdf", message)
        self.assertIn("invoice number", message)

    def test_an_invoice_whose_lines_disagree_on_the_porter_gstin_is_refused(self):
        message = self._refused(
            self._swap_on_line("CRN900000000002", "29AAATP0000A1Z1", "29AAATP0000A1Z9")
        )
        self.assertIn("Porter GSTIN", message)

    def test_an_invoice_whose_lines_disagree_on_the_customer_gstin_is_refused(self):
        message = self._refused(
            self._swap_on_line("CRN900000000007", "29AAACN9999X1Z0", "27AAACN9999X1Z0")
        )
        self.assertIn("customer GSTIN", message)

    def test_an_invoice_whose_lines_disagree_on_the_billing_entity_is_refused(self):
        message = self._refused(
            self._swap_on_line(
                "CRN900000000009", "PORTERTEST MARKETING PRIVATE LIMITED", "PORTERTEST OTHER LIMITED"
            )
        )
        self.assertIn("billing entity", message)

    def test_one_invoice_number_under_two_links_is_refused(self):
        message = self._refused(
            self._swap_on_line("CRN900000000007", ",24SS27A0900002,", ",29SS27A0900001,")
        )
        self.assertIn("29SS27A0900001", message)

    def test_a_line_with_no_invoice_link_is_refused(self):
        lines = _text().splitlines(keepends=True)
        lines[3] = lines[3].rsplit(",", 1)[0] + ",\n"
        self.assertIn("CRN900000000003", self._refused("".join(lines)))

    def test_a_crn_twice_is_refused(self):
        self.assertIn(
            "CRN900000000001",
            self._refused(self._swap_on_line("CRN900000000002", "CRN900000000002", "CRN900000000001")),
        )

    def test_a_completed_order_with_no_completion_time_is_refused(self):
        self.assertIn(
            "CRN900000000005",
            self._refused(self._swap_on_line("CRN900000000005", "2026-09-28T19:44:49", "")),
        )


class TestTheExpenseType(unittest.TestCase):
    """Placement itself is `test_porter_placement`'s."""

    def test_every_porter_expense_is_typed_material_transportation_charges(self):
        self.assertEqual(EXPENSE_TYPE, "Material Transportation Charges")


class TestALineThePorterImportOwns(unittest.TestCase):
    def test_skip_is_refused_on_an_open_porter_line_pointing_to_its_import(self):
        from nirmaan_stack.services.outflow_import.porter import OWN_IMPORT_LINE_REFUSAL
        from nirmaan_stack.services.outflow_import.skip_origin import manual_skip_refusal

        for status in ("Pending match run", "Mismatched", "Error"):
            refusal = manual_skip_refusal(row_status=status, source=PORTER_STATEMENT_SOURCE)
            self.assertEqual(refusal, OWN_IMPORT_LINE_REFUSAL, status)
        self.assertIn("Porter Statement import", OWN_IMPORT_LINE_REFUSAL)

    def test_a_cancelled_order_can_never_be_unskipped(self):
        from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_PORTER_CANCELLED
        from nirmaan_stack.services.outflow_import.skip_origin import unskip_refusal

        self.assertEqual(SKIP_KIND_PORTER_CANCELLED, "Porter order cancelled")
        self.assertEqual(
            unskip_refusal(
                row_status="Skipped",
                skip_kind=SKIP_KIND_PORTER_CANCELLED,
                source=PORTER_STATEMENT_SOURCE,
            ),
            "Porter cancelled this order and never billed it.",
        )


# --- validation against Porter's own invoice (#1444) ----------------------------------------------

_STATEMENT = InvoiceFigures(
    invoice_number="29SS27A0900001",
    porter_gstin="29AAATP0000A1Z1",
    customer_gstin="29AAACN9999X1Z0",
    fare=Decimal("3087.00"),
    tax=Decimal("154.36"),
)


def _read(**changes) -> InvoiceRead:
    """What Gemini read off a PDF that agrees with `_STATEMENT`, with `changes` applied."""
    agreed = {
        "invoice_number": "29SS27A0900001",
        "invoice_date": date(2026, 10, 1),
        "supplier_gstin": "29AAATP0000A1Z1",
        "receiver_gstin": "29AAACN9999X1Z0",
        "fare": Decimal("3087.00"),
        "tax": Decimal("154.35"),
    }
    agreed.update(changes)
    return InvoiceRead(**agreed)


class TestComparingAnInvoiceWithTheStatement(unittest.TestCase):
    def test_an_invoice_that_agrees_on_everything_passes(self):
        verdict = judge_invoice(_STATEMENT, _read())
        self.assertEqual(verdict.status, INVOICE_PASSED)
        self.assertEqual(verdict.message, "")

    def test_the_statements_row_by_row_tax_rounding_passes(self):
        # Measured on the 2026-09 statement: up to Rs 0.18 between the rows' tax and the invoice's.
        verdict = judge_invoice(_STATEMENT, _read(tax=Decimal("154.18")))
        self.assertEqual(verdict.status, INVOICE_PASSED)

    def test_fare_and_tax_pass_at_exactly_one_rupee_either_way(self):
        for fare, tax in (
            (Decimal("3088.00"), Decimal("155.36")),
            (Decimal("3086.00"), Decimal("153.36")),
        ):
            with self.subTest(fare=fare, tax=tax):
                self.assertEqual(judge_invoice(_STATEMENT, _read(fare=fare, tax=tax)).status, INVOICE_PASSED)

    def test_a_tax_one_rupee_and_one_paisa_out_fails_naming_both_figures(self):
        verdict = judge_invoice(_STATEMENT, _read(tax=Decimal("155.37")))
        self.assertEqual(verdict.status, INVOICE_FAILED)
        self.assertEqual(
            verdict.message,
            "Invoice 29SS27A0900001 disagrees with the statement. "
            "Tax: invoice ₹155.37, statement ₹154.36.",
        )

    def test_a_fare_one_rupee_and_one_paisa_out_fails(self):
        verdict = judge_invoice(_STATEMENT, _read(fare=Decimal("3085.99")))
        self.assertEqual(verdict.status, INVOICE_FAILED)
        self.assertIn("Fare: invoice ₹3,085.99, statement ₹3,087.00", verdict.message)

    def test_a_different_invoice_number_fails(self):
        verdict = judge_invoice(_STATEMENT, _read(invoice_number="29SS27A0900009"))
        self.assertEqual(verdict.status, INVOICE_FAILED)
        self.assertIn("Invoice number: invoice 29SS27A0900009, statement 29SS27A0900001", verdict.message)

    def test_a_supplier_gstin_other_than_porters_fails(self):
        verdict = judge_invoice(_STATEMENT, _read(supplier_gstin="29AAATP0000A1Z9"))
        self.assertEqual(verdict.status, INVOICE_FAILED)
        self.assertIn("Porter GSTIN: invoice 29AAATP0000A1Z9, statement 29AAATP0000A1Z1", verdict.message)

    def test_a_receiver_gstin_other_than_ours_fails(self):
        verdict = judge_invoice(_STATEMENT, _read(receiver_gstin="27AAACN9999X1Z4"))
        self.assertEqual(verdict.status, INVOICE_FAILED)
        self.assertIn("Customer GSTIN: invoice 27AAACN9999X1Z4, statement 29AAACN9999X1Z0", verdict.message)

    def test_every_figure_that_disagrees_is_named(self):
        verdict = judge_invoice(
            _STATEMENT, _read(fare=Decimal("2000"), tax=Decimal("100"), receiver_gstin="27AAACN9999X1Z4")
        )
        self.assertEqual(verdict.status, INVOICE_FAILED)
        self.assertEqual(
            verdict.message,
            "Invoice 29SS27A0900001 disagrees with the statement. "
            "Customer GSTIN: invoice 27AAACN9999X1Z4, statement 29AAACN9999X1Z0; "
            "Fare: invoice ₹2,000.00, statement ₹3,087.00; "
            "Tax: invoice ₹100.00, statement ₹154.36.",
        )

    def test_spacing_and_letter_case_are_not_a_difference(self):
        verdict = judge_invoice(
            _STATEMENT,
            _read(invoice_number=" 29ss27a0900001 ", supplier_gstin="29 AAATP 0000A1Z1", receiver_gstin="29aaacn9999x1z0"),
        )
        self.assertEqual(verdict.status, INVOICE_PASSED)

    def test_a_figure_gemini_did_not_read_is_an_error_to_retry_not_a_failure(self):
        verdict = judge_invoice(_STATEMENT, _read(tax=None, supplier_gstin=""))
        self.assertEqual(verdict.status, INVOICE_ERROR)
        self.assertEqual(
            verdict.message,
            "Invoice 29SS27A0900001: could not read the Porter GSTIN and tax off the PDF. Retry it.",
        )

    def test_a_disagreement_outweighs_a_figure_that_was_not_read(self):
        verdict = judge_invoice(_STATEMENT, _read(tax=None, fare=Decimal("10")))
        self.assertEqual(verdict.status, INVOICE_FAILED)
        self.assertIn("Fare: invoice ₹10.00", verdict.message)

    def test_large_amounts_are_grouped_the_indian_way(self):
        statement = InvoiceFigures("X1", "G1", "G2", Decimal("1234567.5"), Decimal("0"))
        verdict = judge_invoice(statement, InvoiceRead("X1", None, "G1", "G2", Decimal("87344"), Decimal("0")))
        self.assertIn("Fare: invoice ₹87,344.00, statement ₹12,34,567.50", verdict.message)


class TestTheImportsStateComesFromItsInvoices(unittest.TestCase):
    def test_any_invoice_still_in_hand_means_validating(self):
        for busy in ("Queued", "Downloading", "Reading", "Comparing"):
            with self.subTest(busy=busy):
                self.assertEqual(import_state(["Passed", busy, "Failed"]), IMPORT_VALIDATING)

    def test_every_invoice_passed_means_validated(self):
        self.assertEqual(import_state(["Passed", "Passed"]), IMPORT_VALIDATED)

    def test_one_failed_or_errored_invoice_fails_the_whole_import(self):
        self.assertEqual(import_state(["Passed", "Failed"]), IMPORT_VALIDATION_FAILED)
        self.assertEqual(import_state(["Passed", "Error"]), IMPORT_VALIDATION_FAILED)

    def test_an_import_with_no_invoices_is_never_validated(self):
        self.assertEqual(import_state([]), IMPORT_VALIDATION_FAILED)

    def test_the_spellings(self):
        self.assertEqual(
            (IMPORT_VALIDATING, IMPORT_VALIDATED, IMPORT_VALIDATION_FAILED),
            ("Validating", "Validated", "Validation failed"),
        )
        self.assertEqual(
            INVOICE_IN_FLIGHT, frozenset({"Queued", "Downloading", "Reading", "Comparing"})
        )


class TestTheImportStateAfterCreateStarts(unittest.TestCase):
    """Creating / Created (#1445), from the invoices AND the import's lines."""

    PASSED = ["Passed", "Passed"]

    def test_a_validated_import_whose_lines_all_wait_is_still_validated(self):
        lines = ["Pending match run", "Pending match run", "Skipped"]
        self.assertEqual(import_state(self.PASSED, lines), IMPORT_VALIDATED)

    def test_once_one_line_is_created_and_another_is_not_it_is_creating(self):
        self.assertEqual(
            import_state(self.PASSED, ["Settled", "Pending match run", "Skipped"]), IMPORT_CREATING
        )

    def test_a_line_that_could_not_be_created_keeps_it_creating_so_it_can_be_run_again(self):
        self.assertEqual(import_state(self.PASSED, ["Error", "Pending match run"]), IMPORT_CREATING)
        self.assertEqual(import_state(self.PASSED, ["Settled", "Error"]), IMPORT_CREATING)

    def test_a_line_unreconciled_after_create_reopens_the_import(self):
        self.assertEqual(import_state(self.PASSED, ["Settled", "Mismatched"]), IMPORT_CREATING)

    def test_every_completed_line_created_means_created_cancelled_ones_aside(self):
        self.assertEqual(import_state(self.PASSED, ["Settled", "Skipped", "Settled"]), IMPORT_CREATED)

    def test_lines_never_outrank_the_invoices(self):
        self.assertEqual(import_state(["Passed", "Failed"], ["Settled"]), IMPORT_VALIDATION_FAILED)
        self.assertEqual(import_state(["Passed", "Reading"], ["Settled"]), IMPORT_VALIDATING)

    def test_an_import_with_only_cancelled_orders_is_never_created(self):
        self.assertEqual(import_state(self.PASSED, ["Skipped"]), IMPORT_VALIDATED)

    def test_the_spellings(self):
        self.assertEqual((IMPORT_CREATING, IMPORT_CREATED), ("Creating", "Created"))


class TestWhatCreateWritesForAnOrder(unittest.TestCase):
    def test_the_description_names_who_booked_it_and_the_project(self):
        self.assertEqual(
            expense_description(" Arjun Pillai ", "Quillon Park"),
            "Porter Delivery raised by Arjun Pillai for Quillon Park",
        )

    def test_without_a_project_it_names_only_who_booked_it(self):
        self.assertEqual(
            expense_description("Arjun Pillai", ""), "Porter Delivery raised by Arjun Pillai"
        )
        self.assertEqual(
            expense_description("Arjun Pillai", None), "Porter Delivery raised by Arjun Pillai"
        )

    def test_a_blank_booked_by_still_reads_as_a_sentence(self):
        self.assertEqual(expense_description("  ", "Quillon Park"), "Porter Delivery for Quillon Park")
        self.assertEqual(expense_description("", ""), "Porter Delivery")

    def test_the_porter_order_holds_every_order_detail_of_the_statement_line(self):
        line = _statement().lines[3]  # CRN ...004: a waypoint, a Tata 407
        fields = porter_order_fields(line.statement)
        self.assertEqual(
            fields,
            {
                "crn": "CRN900000000004",
                "vehicle_type": "Tata 407",
                "city": "Bangalore",
                "from_address": "Demo Warehouse  Hoskote  Karnataka 562114  India",
                "to_address": "Zephyr Tower Site  Outer Ring Road  Bengaluru  Karnataka 560103  India",
                "waypoint_addresses": "Demo Hardware  KR Market  Bengaluru  Karnataka 560002  India",
                "distance_km": Decimal("12.49"),
                "travel_duration": "46 minutes",
                "waiting_time": "150 minutes",
                "booked_by": "Kavya Menon",
                "booked_by_mobile": "9000000001",
                "booked_by_email": "kavya.menon@example.com",
                "remark": "zephyr tower project",
                "order_status": "completed",
                "fare": Decimal("1616.00"),
                "rcm_gst": Decimal("80.80"),
            },
        )

    def test_the_booked_by_name_is_trimmed(self):
        line = _statement().lines[1]  # "Arjun Pillai " in the file
        self.assertEqual(porter_order_fields(line.statement)["booked_by"], "Arjun Pillai")


class TestTheReviewGroupOfAnOrder(unittest.TestCase):
    """Orders with the same remark in the same city are reviewed, and assigned, as one group (#1446)."""

    def test_spacing_case_and_punctuation_do_not_split_a_remark(self):
        self.assertEqual(
            remark_group_key("zephyr tower project ", "Bangalore"),
            remark_group_key("Zephyr  Tower, Project.", "bangalore "),
        )

    def test_the_same_remark_in_another_city_is_another_group(self):
        self.assertNotEqual(
            remark_group_key("quillon site", "Bangalore"),
            remark_group_key("quillon site", "Hyderabad"),
        )

    def test_different_remarks_are_different_groups(self):
        self.assertNotEqual(
            remark_group_key("zephyr tower", "Bangalore"),
            remark_group_key("zephyr tower project", "Bangalore"),
        )

    def test_an_order_with_no_remark_is_in_no_group(self):
        for blank in ("", "   ", " - ", None):
            with self.subTest(remark=blank):
                self.assertEqual(remark_group_key(blank, "Bangalore"), "")


if __name__ == "__main__":
    unittest.main()
