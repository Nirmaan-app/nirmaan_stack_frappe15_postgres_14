# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The rules of a card spend's invoice (#1570, ADR-0037 ruling 8). Pure: `DEVENV unit`."""

import unittest

from nirmaan_stack.services.card_invoices import (
    CardExpenseFacts,
    attach_problem,
    card_line_details,
    no_invoice_problem,
    statement_months,
)

OPEN = CardExpenseFacts(name="NPE-1", is_card=True, invoice_attachment=None, no_invoice_by=None)


class TestTheLineDetails(unittest.TestCase):
    def test_the_serno_is_taken_off_the_payment_ref(self):
        self.assertEqual(card_line_details("Swiggy Limited Bangalore IN - 12345678901"), "Swiggy Limited Bangalore IN")

    def test_details_with_a_dash_of_their_own_keep_it(self):
        self.assertEqual(card_line_details("IND - LINKEDIN PGSI MUMBAI IN - 12345678901"), "IND - LINKEDIN PGSI MUMBAI IN")

    def test_a_ref_with_no_serno_is_kept_whole(self):
        self.assertEqual(card_line_details("ZOMATO GURGAON IN"), "ZOMATO GURGAON IN")
        self.assertEqual(card_line_details(None), "")


class TestTheStatementMonths(unittest.TestCase):
    """GLOSSARY *Statement month*: every month the statement's period overlaps."""

    def test_a_period_across_two_months_belongs_to_both(self):
        self.assertEqual(statement_months("2026-09-02", "2026-10-01", "2026-10-01"), ["2026-09", "2026-10"])

    def test_a_period_inside_one_month_belongs_to_that_month(self):
        self.assertEqual(statement_months("2026-09-01", "2026-09-30", "2026-10-01"), ["2026-09"])

    def test_a_period_across_a_year_end_names_both_years(self):
        self.assertEqual(statement_months("2026-12-02", "2027-01-01", None), ["2026-12", "2027-01"])

    def test_with_no_period_the_statement_date_decides(self):
        self.assertEqual(statement_months(None, None, "2026-10-01"), ["2026-10"])
        self.assertEqual(statement_months(None, None, None), [])


class TestMarkingNoInvoice(unittest.TestCase):
    def test_an_open_card_spend_with_a_reason_may_be_marked(self):
        self.assertIsNone(no_invoice_problem(OPEN, "Toll booth, no receipt"))

    def test_a_reason_is_required(self):
        self.assertEqual(no_invoice_problem(OPEN, "   "), "Type the reason this spend has no invoice.")
        self.assertEqual(no_invoice_problem(OPEN, None), "Type the reason this spend has no invoice.")

    def test_an_expense_that_is_not_a_card_spend_is_refused(self):
        facts = OPEN._replace(is_card=False)
        self.assertEqual(no_invoice_problem(facts, "x"), "NPE-1 is not a card spend.")

    def test_an_invoiced_spend_is_refused(self):
        facts = OPEN._replace(invoice_attachment="/private/files/inv.pdf")
        self.assertEqual(no_invoice_problem(facts, "x"), "NPE-1 already has its invoice.")

    def test_a_spend_already_marked_is_refused_naming_who(self):
        facts = OPEN._replace(no_invoice_by="lead@example.com")
        self.assertEqual(no_invoice_problem(facts, "x"), "NPE-1 is already marked No invoice by lead@example.com.")


class TestAttachingTheInvoice(unittest.TestCase):
    def test_a_file_alone_is_enough(self):
        self.assertIsNone(attach_problem(OPEN, "/private/files/inv.pdf", None, today="2026-10-25"))

    def test_the_file_is_required(self):
        self.assertEqual(attach_problem(OPEN, " ", None, today="2026-10-25"), "Attach the invoice file.")

    def test_an_invoice_date_in_the_future_is_refused(self):
        self.assertEqual(
            attach_problem(OPEN, "/f.pdf", "2026-10-26", today="2026-10-25"), "Invoice date cannot be in the future."
        )
        self.assertIsNone(attach_problem(OPEN, "/f.pdf", "2026-10-25", today="2026-10-25"))

    def test_not_a_card_spend_already_invoiced_or_marked_is_refused(self):
        self.assertEqual(attach_problem(OPEN._replace(is_card=False), "/f.pdf", None, today="2026-10-25"),
                         "NPE-1 is not a card spend.")
        self.assertEqual(attach_problem(OPEN._replace(invoice_attachment="/x.pdf"), "/f.pdf", None, today="2026-10-25"),
                         "NPE-1 already has its invoice.")
        self.assertEqual(attach_problem(OPEN._replace(no_invoice_by="a@b.c"), "/f.pdf", None, today="2026-10-25"),
                         "NPE-1 is already marked No invoice by a@b.c.")


if __name__ == "__main__":
    unittest.main()
