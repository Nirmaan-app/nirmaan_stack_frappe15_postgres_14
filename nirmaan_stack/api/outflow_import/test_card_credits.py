# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A card statement's credits, sorted at upload and worked afterwards (#1567, spec #1565, ADR-0037 decision 4).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_card_credits

Uploads a real PDF built from the fixture (the `test_card_import.CardImportCase` harness) and asserts on the
lines it stages and on what the main-table endpoints then allow: payments and cashback skipped for good, a
refund pair skipped together and unskipped together, an unpaired credit decided on the main table, a spend
still refused there.
"""

import frappe

from nirmaan_stack.api.outflow_import import card_import
from nirmaan_stack.api.outflow_import.review import (
    SCOPE_NOT_MATCHED_INFLOW,
    SCOPE_NOT_MATCHED_OUTFLOW,
    get_outflow_rows,
    skip_row,
    unskip_row,
)
from nirmaan_stack.api.outflow_import.test_card_import import ROW_DOCTYPE, CardImportCase
from nirmaan_stack.services.outflow_import.card_credits import CARD_SPEND_REFUSAL
from nirmaan_stack.services.outflow_import.skip_origin import UNSKIP_LOCKED_KINDS
from nirmaan_stack.services.outflow_import.tests.card_pdf_builder import pdf_from_text

_FIELDS = [
    "name",
    "transfer_id",
    "remarks",
    "amount",
    "direction",
    "row_status",
    "skip_kind",
    "skip_origin",
    "skip_reason",
    "outcome_note",
    "card_refund_partner",
]


class CardCreditsCase(CardImportCase):
    def _upload_text(self, text: str) -> str:
        return self._upload(pdf_from_text(text))["batch"]

    def _lines(self, batch: str):
        return frappe.get_all(ROW_DOCTYPE, filters={"import_batch": batch}, fields=_FIELDS, order_by="transfer_id")

    def _line(self, batch: str, remarks: str, amount: float, direction: str = "Credit"):
        [line] = [
            l
            for l in self._lines(batch)
            if l.remarks == remarks and float(l.amount) == amount and l.direction == direction
        ]
        return line

    def _paired_text(self) -> str:
        """The fixture with the MakeMyTrip ₹801.50 credit turned into a ₹2,244.00 one, which cancels the
        MakeMyTrip ₹2,244.00 spend of 10-Sep; Payments / Credits moves by the same difference."""
        text = self._text()
        text = text.replace("MAKEMYTRIP(INDIA) P Gurgaon IN 0 801.50 CR", "MAKEMYTRIP(INDIA) P Gurgaon IN 0 2,244.00 CR")
        return text.replace("Á2,76,821.73", "Á2,78,264.23")


class TestTheFixtureIsSorted(CardCreditsCase):
    def setUp(self):
        super().setUp()
        self.batch = self._upload_text(self._text())

    def test_payments_into_the_card_are_system_skips_with_their_reason(self):
        payments = [l for l in self._lines(self.batch) if l.skip_kind == "Card payment received"]
        self.assertEqual(
            sorted(l.remarks for l in payments),
            sorted(
                [
                    "Auto Dr.Retn-Insuff. fund",
                    "Autodebit Payment Recd.",
                    "UPI Payment Received",
                    "UPI Payment Received",
                    "UPI Payment Received",
                ]
            ),
        )
        for line in payments:
            self.assertEqual((line.row_status, line.skip_origin), ("Skipped", "System"))
            self.assertTrue(line.skip_reason.startswith("Card payment received."))
            self.assertEqual(line.outcome_note, line.skip_reason)

    def test_cashback_is_a_system_skip(self):
        line = self._line(self.batch, "transaction cashback", 1854.21)
        self.assertEqual((line.row_status, line.skip_kind, line.skip_origin), ("Skipped", "Card cashback", "System"))
        self.assertTrue(line.skip_reason.startswith("Card cashback"))

    def test_the_unpaired_makemytrip_credit_stays_open_and_every_spend_waits(self):
        line = self._line(self.batch, "MAKEMYTRIP(INDIA) P Gurgaon IN", 801.50)
        self.assertEqual(line.row_status, "Mismatched")
        self.assertFalse(line.skip_kind)
        spends = [l for l in self._lines(self.batch) if l.direction == "Debit"]
        self.assertEqual({l.row_status for l in spends}, {"Pending match run"})

    def test_review_lists_the_skipped_lines_with_their_reasons(self):
        review = card_import.get_card_import(self.batch)
        skipped = [l for l in review["lines"] if l["row_status"] == "Skipped"]
        self.assertEqual(len(skipped), 6)
        for line in skipped:
            self.assertIn(line["skip_kind"], ("Card payment received", "Card cashback"))
            self.assertTrue(line["skip_reason"])

    def test_payments_and_cashback_can_never_be_unskipped(self):
        for kind in ("Card payment received", "Card cashback"):
            line = next(l for l in self._lines(self.batch) if l.skip_kind == kind)
            with self.subTest(kind=kind), self.assertRaises(frappe.ValidationError) as caught:
                unskip_row(line.name, "I disagree")
            self.assertIn(UNSKIP_LOCKED_KINDS[kind], str(caught.exception))
            frappe.db.rollback()
            self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, line.name, "row_status"), "Skipped")


class TestAnUnpairedCreditIsDecidedOnTheMainTable(CardCreditsCase):
    def setUp(self):
        super().setUp()
        self.batch = self._upload_text(self._text())
        self.credit = self._line(self.batch, "MAKEMYTRIP(INDIA) P Gurgaon IN", 801.50)

    def test_it_is_listed_under_not_matched_inflow_and_no_spend_is_listed(self):
        inflow = get_outflow_rows(scope=SCOPE_NOT_MATCHED_INFLOW, batch=self.batch)
        self.assertEqual([row["name"] for row in inflow["rows"]], [self.credit.name])
        outflow = get_outflow_rows(scope=SCOPE_NOT_MATCHED_OUTFLOW, batch=self.batch)
        self.assertEqual(outflow["rows"], [])

    def test_it_may_be_skipped_by_hand(self):
        skip_row(self.credit.name, "Refund already counted elsewhere")
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, self.credit.name, ["row_status", "skip_kind"]),
            ("Skipped", "Skipped by hand"),
        )

    def test_the_bank_credit_guard_lets_it_through(self):
        from nirmaan_stack.api.outflow_import.expenses import guard_not_an_own_import_line

        guard_not_an_own_import_line(frappe.db.get_value(ROW_DOCTYPE, self.credit.name, "*", as_dict=True))

    def test_a_spend_is_still_refused_on_the_main_table(self):
        from nirmaan_stack.api.outflow_import.expenses import guard_not_an_own_import_line

        spend = next(l for l in self._lines(self.batch) if l.direction == "Debit")
        with self.assertRaises(frappe.ValidationError) as caught:
            skip_row(spend.name, "not ours")
        self.assertIn(CARD_SPEND_REFUSAL, str(caught.exception))
        frappe.db.rollback()
        with self.assertRaises(frappe.ValidationError) as caught:
            guard_not_an_own_import_line(frappe.db.get_value(ROW_DOCTYPE, spend.name, "*", as_dict=True))
        self.assertIn(CARD_SPEND_REFUSAL, str(caught.exception))


class TestARefundPair(CardCreditsCase):
    def setUp(self):
        super().setUp()
        self.batch = self._upload_text(self._paired_text())
        self.refund = self._line(self.batch, "MAKEMYTRIP(INDIA) P Gurgaon IN", 2244.0)
        self.spend = self._line(self.batch, "MAKEMYTRIP(INDIA) P Gurgaon IN", 2244.0, direction="Debit")

    def test_both_lines_are_skipped_and_each_names_the_other(self):
        for line, partner in ((self.refund, self.spend), (self.spend, self.refund)):
            self.assertEqual((line.row_status, line.skip_kind, line.skip_origin), ("Skipped", "Card refund pair", "System"))
            self.assertEqual(line.card_refund_partner, partner.name)
            self.assertIn(partner.transfer_id, line.skip_reason)
        self.assertIn("cancels the spend", self.refund.skip_reason)
        self.assertIn("cancelled by the merchant credit", self.spend.skip_reason)

    def test_no_credit_is_left_open(self):
        credits = [l for l in self._lines(self.batch) if l.direction == "Credit"]
        self.assertEqual({l.row_status for l in credits}, {"Skipped"})

    def test_unskipping_the_credit_brings_both_lines_back(self):
        result = unskip_row(self.refund.name, "Not a refund of that booking")
        self.assertEqual(result["status"], "Mismatched")
        refund = frappe.db.get_value(ROW_DOCTYPE, self.refund.name, _FIELDS, as_dict=True)
        spend = frappe.db.get_value(ROW_DOCTYPE, self.spend.name, _FIELDS, as_dict=True)
        def cleared(line):
            return [line.row_status] + [
                line.get(f) or None for f in ("skip_kind", "skip_origin", "skip_reason", "card_refund_partner")
            ]

        self.assertEqual(cleared(refund), ["Mismatched", None, None, None, None])
        self.assertEqual(cleared(spend), ["Pending match run", None, None, None, None])
        # The spend is back as Create's work: still planned as a Non-Project Expense.
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, self.spend.name, ["suggested_doctype", "match_basis"]),
            ("Non Project Expenses", "card statement"),
        )
        comments = frappe.get_all(
            "Comment",
            filters={"reference_doctype": ROW_DOCTYPE, "reference_name": ["in", [self.refund.name, self.spend.name]]},
            pluck="content",
        )
        self.assertEqual(len([c for c in comments if "Not a refund of that booking" in c]), 2)

    def test_unskipping_the_spend_brings_both_lines_back_too(self):
        unskip_row(self.spend.name, "Wrong pairing")
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, self.refund.name, "row_status"), "Mismatched")
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, self.spend.name, "row_status"), "Pending match run")

    def test_a_second_unskip_is_refused(self):
        unskip_row(self.refund.name, "Wrong pairing")
        with self.assertRaises(frappe.ValidationError):
            unskip_row(self.spend.name, "again")
