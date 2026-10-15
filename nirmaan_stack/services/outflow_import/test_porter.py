# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Porter Statement's pure half: its column adapter, its invoice grouping and refusals, and the
starting project suggestion (#1443).

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
    PORTER_COLUMNS,
    PorterStatementError,
    REASON_NAME,
    STRENGTH_CHECK,
    STRENGTH_STRONG,
    read_porter_statement,
    suggest_placement,
)
from nirmaan_stack.services.outflow_import.project_match import build_project_index
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


class TestTheStartingSuggestion(unittest.TestCase):
    INDEX = build_project_index(
        [("PROJ-ZEPHYR", "Zephyr Tower"), ("PROJ-QUILLON", "Quillon Park"), ("PROJ-OTHER", "Orion Mall")]
    )

    def test_a_remark_naming_a_project_in_full_is_a_strong_name_suggestion(self):
        placed = suggest_placement("zephyr tower project ", self.INDEX)
        self.assertEqual(placed.ledger, "Project Expenses")
        self.assertEqual(placed.project, "PROJ-ZEPHYR")
        self.assertEqual(placed.reason, REASON_NAME)
        self.assertEqual(placed.strength, STRENGTH_STRONG)
        self.assertEqual(placed.expense_type, EXPENSE_TYPE)

    def test_a_single_unique_keyword_is_a_name_suggestion_to_check(self):
        placed = suggest_placement("quillon site", self.INDEX)
        self.assertEqual(placed.project, "PROJ-QUILLON")
        self.assertEqual(placed.reason, REASON_NAME)
        self.assertEqual(placed.strength, STRENGTH_CHECK)

    def test_no_project_is_a_non_project_expense_with_no_reason(self):
        for remark in ("", "misc delivery"):
            placed = suggest_placement(remark, self.INDEX)
            self.assertEqual(placed.ledger, "Non Project Expenses")
            self.assertIsNone(placed.project)
            self.assertEqual(placed.reason, "")
            self.assertEqual(placed.strength, "")
            self.assertEqual(placed.expense_type, EXPENSE_TYPE)

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


if __name__ == "__main__":
    unittest.main()
