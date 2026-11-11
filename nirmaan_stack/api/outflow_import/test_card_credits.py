# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A card statement's credits, sorted at upload and worked afterwards (#1567, spec #1565, ADR-0039 decision 4).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_card_credits

Uploads a real PDF built from the fixture (the `test_card_import.CardImportCase` harness) and asserts on the
lines it stages and on what the main-table endpoints then allow: payments and cashback skipped for good, a
refund pair skipped together and unskipped together, an unpaired credit kept off the main table as a refund
(#1673), a spend still refused there.
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
from nirmaan_stack.services.outflow_import.card_credits import CARD_REFUND_REFUSAL, CARD_SPEND_REFUSAL
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
                # "Autodebit Payment Recd." left at #1624: it is an Internal Transfer (below).
                [
                    "Auto Dr.Retn-Insuff. fund",
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

    def test_the_unpaired_makemytrip_credit_is_a_refund_waiting_like_every_spend(self):
        # #1673 (ADR-0039 Amendment D): it was open on the main table at Mismatched; it is Create's work now.
        line = self._line(self.batch, "MAKEMYTRIP(INDIA) P Gurgaon IN", 801.50)
        self.assertEqual(line.row_status, "Pending match run")
        self.assertFalse(line.skip_kind)
        spends = [l for l in self._lines(self.batch) if l.direction == "Debit"]
        self.assertEqual({l.row_status for l in spends}, {"Pending match run"})

    def test_review_lists_the_skipped_lines_with_their_reasons(self):
        review = card_import.get_card_import(self.batch)
        skipped = [l for l in review["lines"] if l["row_status"] == "Skipped"]
        self.assertEqual(len(skipped), 5)  # 6 until #1624 moved the auto-debit payment out
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


class TestAnUnpairedRefundIsNotAMainTableLine(CardCreditsCase):
    """#1673 flipped #1567's "decided on the main table": the unpaired credit waits for the card import's Create,
    like a spend. `test_card_refunds` holds the rest."""

    def setUp(self):
        super().setUp()
        self.batch = self._upload_text(self._text())
        self.credit = self._line(self.batch, "MAKEMYTRIP(INDIA) P Gurgaon IN", 801.50)

    def test_neither_it_nor_any_spend_is_listed(self):
        inflow = get_outflow_rows(scope=SCOPE_NOT_MATCHED_INFLOW, batch=self.batch)
        self.assertEqual(inflow["rows"], [])
        outflow = get_outflow_rows(scope=SCOPE_NOT_MATCHED_OUTFLOW, batch=self.batch)
        self.assertEqual(outflow["rows"], [])

    def test_it_may_not_be_skipped_by_hand(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            skip_row(self.credit.name, "Refund already counted elsewhere")
        self.assertIn(CARD_REFUND_REFUSAL, str(caught.exception))

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
        # #1624: the auto-debit payment is an Internal Transfer, which is no open credit either.
        self.assertEqual({l.row_status for l in credits}, {"Skipped", "Internal Transfer"})

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
        # #1673: the credit comes back as an unpaired refund, Create's work like the spend.
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, self.refund.name, ["suggested_doctype", "match_basis"]),
            ("Non Project Expenses", "card statement"),
        )
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


class TestTheAutoDebitIsAnInternalTransfer(CardCreditsCase):
    """#1624: the bank's auto-debit paying the card is an Internal Transfer, with its record and the card's digits."""

    def setUp(self):
        super().setUp()
        self.batch = self._upload_text(self._text())

    def test_it_is_an_internal_transfer_line_with_one_record_on_the_card(self):
        line = self._line(self.batch, "Autodebit Payment Recd.", 173999.02)
        self.assertEqual((line.row_status, line.skip_kind or None), ("Internal Transfer", None))
        records = frappe.get_all(
            "Internal Transfer", filters={"import_row": line.name},
            fields=["from_place", "to_place", "detail", "direction", "made_by", "amount"],
        )
        self.assertEqual(
            [(r.from_place, r.to_place, r.detail, r.direction, r.made_by, float(r.amount)) for r in records],
            [("ICICI Current Account", "ICICI Credit Card", "Card ending 1111", "In", "card_auto_debit", 173999.02)],
        )

    def test_review_lists_it_under_internal_transfers_not_skipped(self):
        review = card_import.get_card_import(self.batch)
        internal = [l for l in review["lines"] if l["row_status"] == "Internal Transfer"]
        self.assertEqual([l["details"] for l in internal], ["Autodebit Payment Recd."])
        self.assertIn("ICICI Credit Card", internal[0]["outcome_note"])

    def test_it_is_in_the_main_internal_transfers_tab(self):
        rows = get_outflow_rows(scope="internal_transfers", batch=self.batch, limit=50)["rows"]
        self.assertEqual([r["remarks"] for r in rows], ["Autodebit Payment Recd."])
