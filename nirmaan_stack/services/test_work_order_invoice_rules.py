"""ADR-0050's rules 2 and 3, pure: when the System approves a Work Order invoice, and the reasons with their
figures when it does not (decisions 2, 3, 4, 7, 8).

Run: DEVENV unit nirmaan_stack.services.test_work_order_invoice_rules
"""

import unittest

from nirmaan_stack.services.work_order_invoice_rules import (
    DUPLICATE,
    LINK,
    generated_copy_verdict,
    matched_rules,
    rule_reasons,
    signature_signed,
)


def figures(**changes):
    """A GST-off Work Order of ₹1,00,000 with ₹40,000 paid and ₹20,000 invoiced and Approved; this invoice is
    ₹10,000, so it matches neither rule: ₹30,000 invoiced against ₹1,00,000 and against ₹40,000."""
    base = {
        "gst_on": False,
        "total_amount": 100_000,
        "amount_paid": 40_000,
        "gst_paid": 0,
        "approved_amount": 20_000,
        "approved_gst": 0,
        "invoice_amount": 10_000,
        "invoice_gst": 0,
    }
    return {**base, **changes}


class TestMatchedRules(unittest.TestCase):
    """Which rule approved, with its figures: what Re-check shows on each Work Order invoice it approves."""

    def test_none_when_neither_matches(self):
        self.assertEqual(matched_rules(figures()), [])

    def test_rule_two_with_the_wo_total(self):
        self.assertEqual(matched_rules(figures(approved_amount=90_000)),
                         [{"rule": 2, "base": False, "target": 100_000, "invoiced": 100_000}])

    def test_rule_three_with_amount_paid(self):
        self.assertEqual(matched_rules(figures(approved_amount=30_000)),
                         [{"rule": 3, "base": False, "target": 40_000, "invoiced": 40_000}])

    def test_both_when_both_match(self):
        self.assertEqual([m["rule"] for m in matched_rules(figures(approved_amount=90_000, amount_paid=100_000))],
                         [2, 3])

    def test_rule_three_on_a_gst_on_wo_compares_base(self):
        # ₹40,000 paid of which ₹6,000 GST payments; ₹30,000 + ₹10,000 invoiced of which ₹6,000 GST: base 34,000 each.
        got = matched_rules(figures(gst_on=True, gst_paid=6_000, approved_amount=30_000, approved_gst=6_000))
        self.assertEqual(got, [{"rule": 3, "base": True, "target": 34_000, "invoiced": 34_000}])

    def test_it_agrees_with_rule_reasons(self):
        for changes in ({}, {"approved_amount": 90_000}, {"approved_amount": 30_000}, {"invoice_amount": 10_001}):
            f = figures(**changes)
            self.assertEqual(bool(matched_rules(f)), rule_reasons(f) == [], changes)


class TestRuleTwoTotalAmount(unittest.TestCase):
    def test_the_invoice_that_brings_the_invoices_to_the_total_is_approved(self):
        self.assertEqual(rule_reasons(figures(approved_amount=90_000)), [])

    def test_even_when_only_part_is_paid(self):
        self.assertEqual(rule_reasons(figures(approved_amount=90_000, amount_paid=5_000)), [])

    def test_within_one_rupee_either_way(self):
        self.assertEqual(rule_reasons(figures(approved_amount=90_001)), [])
        self.assertEqual(rule_reasons(figures(approved_amount=89_999)), [])

    def test_not_two_rupees(self):
        self.assertNotEqual(rule_reasons(figures(approved_amount=89_998)), [])


class TestRuleThreeAmountPaid(unittest.TestCase):
    def test_invoices_equal_to_what_is_paid_are_approved(self):
        self.assertEqual(rule_reasons(figures(amount_paid=30_000.50)), [])

    def test_invoices_short_of_what_is_paid_are_not(self):
        # "Exactly equal, ± ₹1", not "not more than Amount Paid" (decision 3).
        self.assertNotEqual(rule_reasons(figures(amount_paid=35_000)), [])

    def test_invoices_ahead_of_what_is_paid_are_not(self):
        self.assertNotEqual(rule_reasons(figures(amount_paid=25_000)), [])


def gst_on(**changes):
    """A GST-on Work Order of ₹1,18,000 (₹1,00,000 base). Paid: ₹59,000, of which a ₹9,000 GST payment.
    Approved: one ₹23,600 invoice (₹20,000 base). This invoice: ₹35,400 (₹30,000 base)."""
    return figures(**{"gst_on": True, "total_amount": 118_000, "amount_paid": 59_000, "gst_paid": 9_000,
                      "approved_amount": 23_600, "approved_gst": 3_600, "invoice_amount": 35_400,
                      "invoice_gst": 5_400, **changes})


class TestRuleThreeOnAGstOnWorkOrder(unittest.TestCase):
    def test_base_invoiced_equal_to_base_paid_is_approved(self):
        # ₹50,000 base paid (₹59,000 less the GST payment) = ₹20,000 + ₹30,000 base invoiced.
        self.assertEqual(rule_reasons(gst_on()), [])

    def test_the_gst_payment_is_left_out(self):
        # A GST payment comes only after an invoice is approved (ADR-0030): counting it would never match.
        self.assertNotEqual(rule_reasons(gst_on(gst_paid=0)), [])

    def test_the_reason_names_the_base_figures(self):
        self.assertEqual(
            rule_reasons(gst_on(amount_paid=69_000)),
            ["wo_total_mismatch:118000.00:59000.00", "wo_base_paid_mismatch:60000.00:50000.00"],
        )


class TestWhyNot(unittest.TestCase):
    def test_each_reason_carries_its_two_figures(self):
        # Decision 8: WO total vs Approved invoices + this one; Amount Paid vs the same.
        self.assertEqual(
            rule_reasons(figures()),
            ["wo_total_mismatch:100000.00:30000.00", "wo_paid_mismatch:40000.00:30000.00"],
        )


NUMBER = "INV-26-27-00042-00317-RA-2"


def record(status="Generated", invoice_no=NUMBER, amount=50_000, name="WGI-SR-00317-2"):
    return {"name": name, "invoice_no": invoice_no, "status": status, "amount": amount}


def verdict(records, submitted=NUMBER, extracted=NUMBER, ai_read=True, amount=50_000, gst_off=True):
    return generated_copy_verdict(
        submitted_no=submitted, extracted_no=extracted, ai_read=ai_read, amount=amount, gst_off=gst_off,
        records=records,
    )


class TestAddInvoiceOfAGeneratedInvoice(unittest.TestCase):
    """Decision 1, second path: when an Add Invoice upload is a generated invoice's signed copy."""

    def test_the_ai_read_number_of_a_generated_one_with_its_amount_is_its_copy(self):
        self.assertEqual(verdict([record()]), (LINK, "WGI-SR-00317-2"))

    def test_the_amount_may_differ_by_a_rupee(self):
        self.assertEqual(verdict([record()], amount=50_001), (LINK, "WGI-SR-00317-2"))
        self.assertEqual(verdict([record()], amount=50_002), (None, None))

    def test_a_typed_number_is_not_linked(self):
        self.assertEqual(verdict([record()], ai_read=False), (None, None))
        self.assertEqual(verdict([record()], extracted="INV-OTHER"), (None, None))

    def test_a_number_already_signed_or_approved_is_a_duplicate(self):
        for status in ("Signed", "Approved"):
            self.assertEqual(verdict([record(status)]), (DUPLICATE, "WGI-SR-00317-2"))
            self.assertEqual(verdict([record(status)], ai_read=False), (DUPLICATE, "WGI-SR-00317-2"))

    def test_a_voided_one_or_another_number_is_a_normal_invoice(self):
        self.assertEqual(verdict([record("Voided")]), (None, None))
        self.assertEqual(verdict([record(invoice_no="INV-26-27-00042-00317-RA-1")]), (None, None))

    def test_the_number_matches_whatever_its_case_and_spaces(self):
        self.assertEqual(verdict([record()], submitted=f" {NUMBER.lower()} ", extracted=NUMBER.lower()),
                         (LINK, "WGI-SR-00317-2"))

    def test_not_on_a_gst_on_work_order(self):
        self.assertEqual(verdict([record()], gst_off=False), (None, None))


class TestTheSignatureBox(unittest.TestCase):
    def test_signed_or_stamped_is_signed(self):
        self.assertTrue(signature_signed({"authorized_signature": "signed"}))
        self.assertTrue(signature_signed({"authorized_signature": "Stamped"}))

    def test_an_empty_box_or_no_answer_is_not(self):
        self.assertFalse(signature_signed({"authorized_signature": "not_signed"}))
        self.assertFalse(signature_signed({}))


if __name__ == "__main__":
    unittest.main()
