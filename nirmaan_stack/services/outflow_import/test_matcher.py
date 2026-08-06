# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for nirmaan_stack.services.outflow_import.matcher.

Cases are drawn from real shapes observed in the live vendor master and payment ledger, with names
and account numbers FABRICATED -- this repository is public. Each test names the live case it
stands for so a failure points at the production behaviour that breaks, not just at an assertion.

The four properties defended hardest, because each one is a way the matcher could be quietly wrong:
  * a shared bank account NEVER resolves to a single vendor
  * an account-only match still succeeds when the names have nothing in common
  * a name-only match still succeeds when the master's account is stale
  * an unreferenced fan-out stays unmatched rather than being reassembled from amounts
"""

import unittest
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.outflow_import.matcher import (
    BASIS_ACCOUNT,
    BASIS_BANK_REFERENCE,
    BASIS_NAME,
    BASIS_NONE,
    BASIS_VENDOR_AMOUNT_DATE,
    DEFAULT_VENDOR_POLICY,
    TargetRef,
    VendorRef,
    build_vendor_index,
    match_expenses,
    match_payments,
    match_row,
    resolve_vendors,
)


class _Row:
    """Minimal stand-in for parser.RawRow -- the matcher reads by attribute, never by type."""

    def __init__(
        self,
        amount="0",
        beneficiary_name="",
        bank_account="",
        ifsc="",
        bank_reference_no="",
        added_on_date=None,
        normalized_account=None,
        normalized_reference=None,
    ):
        from nirmaan_stack.services.outflow_import.normalize import (
            normalize_account,
            normalize_reference,
        )

        self.amount = Decimal(str(amount))
        self.beneficiary_name = beneficiary_name
        self.bank_account = bank_account
        self.ifsc = ifsc
        self.bank_reference_no = bank_reference_no
        self.added_on_date = added_on_date
        self.normalized_account = (
            normalize_account(bank_account) if normalized_account is None else normalized_account
        )
        self.normalized_reference = (
            normalize_reference(bank_reference_no)
            if normalized_reference is None
            else normalized_reference
        )


VENDORS = [
    # account-only route: the beneficiary is a PERSON, the vendor is a COMPANY.
    # Live shape: statement 'Dharmaraj L' resolved to vendor 'SMB INSULATIONS' by account alone.
    VendorRef("VEN-0001", "Testco Insulations", "", "11111111111", "TEST0000001"),
    # name is a SUBSET of the vendor name. Live shape: 'Md Arsad Alam' -> 'Md Arsad Alam Electrical Work'.
    VendorRef("VEN-0002", "Testperson Alpha Electrical Work", "", "22222222222", "TEST0000002"),
    # stale account: the master holds a DIFFERENT account from the one actually paid.
    # Live shape: Aura Air Systems, paid from an account the master does not hold.
    VendorRef("VEN-0003", "Testvendor Air Systems", "", "33333333333", "TEST0000003"),
    # SHARED ACCOUNT across legally distinct entities with different registrations.
    # Live shape: one account maps to three D.S. Ductofab companies with three different GSTs.
    VendorRef("VEN-0004", "Testgroup Systems Pvt Ltd (North)", "", "44444444444", "TEST0000004"),
    VendorRef("VEN-0005", "Testgroup Systems Pvt Ltd (South)", "", "44444444444", "TEST0000004"),
    # trade-word neighbours that must never merge. Live shape: Sri Sai Enterprises / Sri Sai Roadlines.
    VendorRef("VEN-0006", "Testfamily Enterprises", "", "55555555555", "TEST0000005"),
    VendorRef("VEN-0007", "Testfamily Roadlines", "", "66666666666", "TEST0000006"),
    # account_name differs from vendor_name. Live shape: 174 of 1,077 vendors.
    VendorRef("VEN-0008", "Testvendor Eta Trading", "Testvendor Eta", "77777777777", "TEST0000007"),
    # leading-zero account in the master.
    VendorRef("VEN-0009", "Testvendor Theta", "", "0088888888888", "TEST0000008"),
]

INDEX = build_vendor_index(VENDORS)


class TestVendorResolutionByAccount(unittest.TestCase):
    def test_account_resolves_when_the_names_share_nothing(self):
        # The whole reason account comes first. Name matching returns nothing here.
        row = _Row(beneficiary_name="Testperson Dharma", bank_account="11111111111", ifsc="TEST0000001")
        resolution = resolve_vendors(row, INDEX)
        self.assertEqual([c.vendor.name for c in resolution.candidates], ["VEN-0001"])
        self.assertEqual(resolution.basis, BASIS_ACCOUNT)
        self.assertFalse(resolution.ambiguous)

    def test_ifsc_agreement_scores_above_account_alone(self):
        with_ifsc = resolve_vendors(
            _Row(bank_account="11111111111", ifsc="TEST0000001"), INDEX
        ).best
        without = resolve_vendors(_Row(bank_account="11111111111", ifsc="WRONG0000"), INDEX).best
        self.assertGreater(with_ifsc.score, without.score)
        self.assertIn("IFSC matches", with_ifsc.reasons)

    def test_leading_zero_account_still_resolves(self):
        row = _Row(bank_account="88888888888", ifsc="TEST0000008")
        self.assertEqual([c.vendor.name for c in resolve_vendors(row, INDEX).candidates], ["VEN-0009"])

    def test_shared_account_is_ambiguous_and_never_picks_one(self):
        # The single most important guard in this module. Two legally distinct entities share an
        # account; there is nothing in a statement that separates them, so BOTH must surface.
        row = _Row(bank_account="44444444444", ifsc="TEST0000004")
        resolution = resolve_vendors(row, INDEX)
        self.assertTrue(resolution.ambiguous)
        self.assertEqual(
            sorted(c.vendor.name for c in resolution.candidates), ["VEN-0004", "VEN-0005"]
        )


class TestVendorResolutionByName(unittest.TestCase):
    def test_name_resolves_when_the_account_is_stale(self):
        # Live shape: a vendor paid from an account the master does not hold. Account finds nothing;
        # the name is the only route, which is why account-first is not account-only.
        row = _Row(beneficiary_name="Testvendor Air Systems", bank_account="99999999999")
        resolution = resolve_vendors(row, INDEX)
        self.assertEqual([c.vendor.name for c in resolution.candidates], ["VEN-0003"])
        self.assertEqual(resolution.basis, BASIS_NAME)

    def test_statement_name_that_is_a_subset_of_the_vendor_name_resolves(self):
        row = _Row(beneficiary_name="Testperson Alpha")
        self.assertIn("VEN-0002", [c.vendor.name for c in resolve_vendors(row, INDEX).candidates])

    def test_account_name_is_matched_as_well_as_vendor_name(self):
        row = _Row(beneficiary_name="Testvendor Eta")
        self.assertIn("VEN-0008", [c.vendor.name for c in resolve_vendors(row, INDEX).candidates])

    def test_trade_word_neighbours_are_both_offered_not_silently_merged(self):
        row = _Row(beneficiary_name="Testfamily Enterprises")
        names = [c.vendor.name for c in resolve_vendors(row, INDEX).candidates]
        self.assertEqual(names[0], "VEN-0006")

    def test_single_word_name_does_not_match_on_tokens(self):
        # MIN_SIGNIFICANT_TOKENS: one word matches far too much to be worth offering.
        row = _Row(beneficiary_name="Testfamily")
        self.assertEqual(resolve_vendors(row, INDEX).candidates, ())

    def test_nothing_resolves_to_an_empty_resolution_not_a_guess(self):
        row = _Row(beneficiary_name="Entirely Unrelated Party", bank_account="00000000000")
        resolution = resolve_vendors(row, INDEX)
        self.assertEqual(resolution.candidates, ())
        self.assertEqual(resolution.basis, BASIS_NONE)
        self.assertIsNone(resolution.best)

    def test_account_and_name_agreeing_keeps_the_account_basis_and_records_both_reasons(self):
        row = _Row(beneficiary_name="Testvendor Air Systems", bank_account="33333333333")
        best = resolve_vendors(row, INDEX).best
        self.assertEqual(best.basis, BASIS_ACCOUNT)
        self.assertGreater(len(best.reasons), 1)


class TestPaymentPassA(unittest.TestCase):
    def test_reference_match_wins(self):
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Paid", "VEN-0001", "900000000001"),
            TargetRef("Project Payments", "PAY-2", Decimal("5000"), "Paid", "VEN-0001", "900000000002"),
        ]
        groups = match_payments(_Row(amount="5000", bank_reference_no="900000000001"), targets)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].basis, BASIS_BANK_REFERENCE)
        self.assertEqual([t.name for t in groups[0].targets], ["PAY-1"])

    def test_padded_stored_reference_still_matches(self):
        # 226 live Project Payments hold a whitespace-padded UTR.
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Paid", "VEN-0001", " 900000000001")
        ]
        groups = match_payments(_Row(amount="5000", bank_reference_no="900000000001"), targets)
        self.assertEqual(len(groups), 1)

    def test_fan_out_is_grouped_by_shared_reference(self):
        # Live shape: one IMPS transfer of Rs 7,289,432 settling 7 payments across 6 projects.
        targets = [
            TargetRef("Project Payments", f"PAY-{i}", Decimal("1000"), "Paid", "VEN-0001", "900000000001")
            for i in range(1, 8)
        ]
        group = match_payments(_Row(amount="7000", bank_reference_no="900000000001"), targets)[0]
        self.assertTrue(group.is_fan_out)
        self.assertEqual(len(group.targets), 7)
        self.assertEqual(group.total_amount, Decimal("7000"))

    def test_pass_a_returns_targets_in_any_status(self):
        # Finding a transfer against a non-Paid payment is an OUTCOME this feature reports; a status
        # filter here would silently turn that finding into "no record found".
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "CEO Pending", "VEN-0001", "900000000001")
        ]
        groups = match_payments(_Row(amount="5000", bank_reference_no="900000000001"), targets)
        self.assertEqual(groups[0].statuses, frozenset({"CEO Pending"}))


class TestPaymentPassB(unittest.TestCase):
    def _vendor(self, account="11111111111"):
        return resolve_vendors(_Row(bank_account=account), INDEX)

    def test_vendor_amount_and_date_match_when_the_stored_reference_is_junk(self):
        # 932 of 7,420 live Paid payments carry a UTR that is not a bank reference.
        targets = [
            TargetRef(
                "Project Payments", "PAY-1", Decimal("5000"), "Paid", "VEN-0001",
                "PO/077/00066/25-26", date(2026, 7, 28),
            )
        ]
        row = _Row(amount="5000", bank_reference_no="900000000001", added_on_date=date(2026, 7, 28))
        groups = match_payments(row, targets, self._vendor())
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].basis, BASIS_VENDOR_AMOUNT_DATE)

    def test_pass_b_requires_a_resolved_vendor(self):
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Paid", "VEN-0001", "junk", date(2026, 7, 28))
        ]
        row = _Row(amount="5000", added_on_date=date(2026, 7, 28))
        self.assertEqual(match_payments(row, targets, self._vendor("00000000000")), ())

    def test_a_target_with_no_vendor_is_never_matched_by_pass_b(self):
        # Found by the S4 suite, whose fixture payments were raw-inserted with a NULL vendor. The
        # old condition only skipped targets that HAD a disagreeing vendor, so a vendor-less target
        # slipped through on amount + date alone -- matching for want of anything to disagree with.
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Paid", None, "junk", date(2026, 7, 28))
        ]
        row = _Row(amount="5000", added_on_date=date(2026, 7, 28))
        self.assertEqual(match_payments(row, targets, self._vendor()), ())

    def test_pass_b_respects_the_date_window(self):
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Paid", "VEN-0001", "junk", date(2026, 6, 1))
        ]
        row = _Row(amount="5000", added_on_date=date(2026, 7, 28))
        self.assertEqual(match_payments(row, targets, self._vendor()), ())

    def test_pass_b_requires_an_exact_amount(self):
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("4999"), "Paid", "VEN-0001", "junk", date(2026, 7, 28))
        ]
        row = _Row(amount="5000", added_on_date=date(2026, 7, 28))
        self.assertEqual(match_payments(row, targets, self._vendor()), ())

    def test_an_unreferenced_fan_out_stays_unmatched_rather_than_being_reassembled(self):
        # THE one thing this module must not do. Each member holds a fraction of the bank amount;
        # inferring the partition would mean inventing an allocation nobody authorised.
        targets = [
            TargetRef("Project Payments", f"PAY-{i}", Decimal("1000"), "Paid", "VEN-0001", "junk", date(2026, 7, 28))
            for i in range(1, 8)
        ]
        row = _Row(amount="7000", bank_reference_no="900000000001", added_on_date=date(2026, 7, 28))
        self.assertEqual(match_payments(row, targets, self._vendor()), ())

    def test_pass_a_short_circuits_pass_b(self):
        targets = [
            TargetRef("Project Payments", "PAY-A", Decimal("5000"), "Paid", "VEN-0001", "900000000001", date(2026, 7, 28)),
            TargetRef("Project Payments", "PAY-B", Decimal("5000"), "Paid", "VEN-0001", "junk", date(2026, 7, 28)),
        ]
        row = _Row(amount="5000", bank_reference_no="900000000001", added_on_date=date(2026, 7, 28))
        groups = match_payments(row, targets, self._vendor())
        self.assertEqual(len(groups), 1)
        self.assertEqual([t.name for t in groups[0].targets], ["PAY-A"])


class TestExpenseMatching(unittest.TestCase):
    def test_account_number_in_the_description_corroborates_an_amount_match(self):
        # The one clean live match in the whole exercise was found exactly this way: an approved
        # accommodation expense carried the payee's account number in its free-text description.
        target = TargetRef(
            "Project Expenses", "EXP-1", Decimal("5000"), "Approved", None, "", None, "PROJ-1",
            "Testperson Kappa (July PG rent)\nAccount Number: 39088842277\nIFSC Code: TEST0000009",
        )
        row = _Row(amount="5000", beneficiary_name="Testperson Kappa", bank_account="39088842277",
                   ifsc="TEST0000009")
        candidates = match_expenses(row, [target])
        self.assertEqual(len(candidates), 1)
        self.assertGreater(candidates[0].score, 0.8)
        self.assertIn("account number appears in the description", candidates[0].reasons)

    def test_amount_only_match_is_offered_but_scores_low(self):
        target = TargetRef("Project Expenses", "EXP-1", Decimal("5000"), "Approved", None, "", None, "PROJ-1", "Something else entirely")
        candidates = match_expenses(_Row(amount="5000", beneficiary_name="Testperson Kappa"), [target])
        self.assertEqual(len(candidates), 1)
        self.assertLess(candidates[0].score, 0.5)

    def test_wrong_amount_is_not_offered(self):
        target = TargetRef("Project Expenses", "EXP-1", Decimal("4999"), "Approved", None, "", None, "PROJ-1", "")
        self.assertEqual(match_expenses(_Row(amount="5000"), [target]), ())

    def test_better_corroborated_candidate_ranks_first(self):
        weak = TargetRef("Project Expenses", "EXP-WEAK", Decimal("5000"), "Approved", None, "", None, None, "unrelated")
        strong = TargetRef("Project Expenses", "EXP-STRONG", Decimal("5000"), "Approved", None, "", None, None,
                           "Testperson Kappa rent, a/c 39088842277")
        row = _Row(amount="5000", beneficiary_name="Testperson Kappa", bank_account="39088842277")
        self.assertEqual(match_expenses(row, [weak, strong])[0].target.name, "EXP-STRONG")


class TestMatchRow(unittest.TestCase):
    def test_orchestrates_all_three_pools(self):
        payment = TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Paid", "VEN-0001", "900000000001")
        expense = TargetRef("Project Expenses", "EXP-1", Decimal("5000"), "Approved", None, "", None, None, "")
        row = _Row(amount="5000", bank_account="11111111111", bank_reference_no="900000000001")
        result = match_row(row, INDEX, [payment], [expense])
        self.assertEqual(result.vendor.best.vendor.name, "VEN-0001")
        self.assertEqual(result.best_payment_group.targets[0].name, "PAY-1")
        self.assertEqual(len(result.expense_candidates), 1)

    def test_no_pools_yields_an_empty_result_not_an_error(self):
        result = match_row(_Row(amount="5000"), INDEX)
        self.assertIsNone(result.best_payment_group)
        self.assertEqual(result.expense_candidates, ())


class TestPolicyIsTunableWithoutTouchingLogic(unittest.TestCase):
    def test_raising_the_name_threshold_drops_weak_candidates(self):
        from dataclasses import replace

        row = _Row(beneficiary_name="Testperson Alpha")
        lenient = resolve_vendors(row, INDEX, DEFAULT_VENDOR_POLICY)
        strict = resolve_vendors(row, INDEX, replace(DEFAULT_VENDOR_POLICY, MIN_NAME_SCORE=0.99))
        self.assertTrue(lenient.candidates)
        self.assertEqual(strict.candidates, ())

    def test_account_still_resolves_under_a_strict_name_policy(self):
        from dataclasses import replace

        row = _Row(bank_account="11111111111")
        strict = resolve_vendors(row, INDEX, replace(DEFAULT_VENDOR_POLICY, MIN_NAME_SCORE=0.99))
        self.assertEqual([c.vendor.name for c in strict.candidates], ["VEN-0001"])


if __name__ == "__main__":
    unittest.main()
