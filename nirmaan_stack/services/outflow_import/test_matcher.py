# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for nirmaan_stack.services.outflow_import.matcher.

Cases are drawn from real shapes observed in the live vendor master and payment ledger, with names
and account numbers FABRICATED -- this repository is public. Each test names the live case it
stands for so a failure points at the production behaviour that breaks, not just at an assertion.

The properties defended hardest, because each one is a way the matcher could be quietly wrong:
  * a shared bank account NEVER resolves to a single vendor
  * an account-only match still succeeds when the names have nothing in common
  * a name-only match still RESOLVES A VENDOR, even though it no longer matches a payment
  * an unreferenced fan-out stays unmatched rather than being reassembled from amounts
  * the first tier that finds anything stops the ladder -- a lower tier never tops up a higher one
"""

import unittest
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.outflow_import.matcher import (
    BASIS_ACCOUNT,
    BASIS_ACCOUNT_IFSC,
    BASIS_BANK_REFERENCE,
    BASIS_NAME,
    BASIS_NONE,
    BASIS_PROJECT_REMARK,
    DEFAULT_VENDOR_POLICY,
    TIER_ACCOUNT,
    TIER_NONE,
    TIER_PROJECT,
    TIER_REFERENCE,
    TargetRef,
    VendorRef,
    build_vendor_index,
    match_by_reference,
    match_expenses,
    match_payments,
    match_row,
    resolve_vendors,
)
from nirmaan_stack.services.outflow_import.project_match import build_project_index


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
        remarks="",
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
        self.remarks = remarks
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

# One identifiable project and a live-shaped DUPLICATE PAIR -- there really are two projects called
# `Fidelity Chennai` -- so both the hit and the refusal are exercised here without restating
# `test_project_match.py`, which owns that rule in full.
PROJECTS = build_project_index(
    [("PROJ-1", "Toshiba"), ("PROJ-2", "Fidelity Chennai"), ("PROJ-3", "Fidelity Chennai")]
)


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


class TestTier0BankReference(unittest.TestCase):
    def test_reference_match_wins(self):
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Paid", "VEN-0001", "900000000001"),
            TargetRef("Project Payments", "PAY-2", Decimal("5000"), "Paid", "VEN-0001", "900000000002"),
        ]
        result = match_payments(_Row(amount="5000", bank_reference_no="900000000001"), targets)
        self.assertEqual(result.tier, TIER_REFERENCE)
        self.assertEqual(len(result.groups), 1)
        self.assertEqual(result.groups[0].basis, BASIS_BANK_REFERENCE)
        self.assertEqual([t.name for t in result.groups[0].targets], ["PAY-1"])

    def test_padded_stored_reference_still_matches(self):
        # 226 live Project Payments hold a whitespace-padded UTR.
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Paid", "VEN-0001", " 900000000001")
        ]
        groups = match_by_reference(_Row(bank_reference_no="900000000001"), targets)
        self.assertEqual(len(groups), 1)

    def test_fan_out_is_grouped_by_shared_reference(self):
        # Live shape: one IMPS transfer of Rs 7,289,432 settling 7 payments across 6 projects.
        targets = [
            TargetRef("Project Payments", f"PAY-{i}", Decimal("1000"), "Paid", "VEN-0001", "900000000001")
            for i in range(1, 8)
        ]
        group = match_by_reference(_Row(bank_reference_no="900000000001"), targets)[0]
        self.assertTrue(group.is_fan_out)
        self.assertEqual(len(group.targets), 7)
        self.assertEqual(group.total_amount, Decimal("7000"))

    def test_tier_0_returns_targets_in_any_status(self):
        # Finding a transfer against a non-Paid payment is an OUTCOME this feature reports; a status
        # filter here would silently turn that finding into "no record found". (The POOL is
        # Approved-only; this function must not add a second, disagreeing opinion about status.)
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "CEO Pending", "VEN-0001", "900000000001")
        ]
        groups = match_by_reference(_Row(bank_reference_no="900000000001"), targets)
        self.assertEqual(groups[0].statuses, frozenset({"CEO Pending"}))

    def test_tier_0_ignores_the_amount_entirely(self):
        """⚠️ AND IT MUST. A fan-out group's members each hold a FRACTION of the transfer, so an
        amount test here would break exactly the case this tier exists to find. The reference is the
        key; the amount is what the lower tiers have instead of one."""
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("999999"), "Approved", "VEN-0001", "900000000001")
        ]
        result = match_payments(_Row(amount="5000", bank_reference_no="900000000001"), targets)
        self.assertEqual(result.tier, TIER_REFERENCE)

    def test_no_reference_on_the_row_yields_nothing_rather_than_matching_blanks(self):
        targets = [TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Approved", "VEN-0001", "")]
        self.assertEqual(match_by_reference(_Row(amount="5000"), targets), ())


class TestTier1AccountAndIfsc(unittest.TestCase):
    """The nearly-certain tier: the money went to an account this company holds for that vendor."""

    def _vendor(self, account="11111111111", ifsc="TEST0000001"):
        return resolve_vendors(_Row(bank_account=account, ifsc=ifsc), INDEX)

    def test_account_and_ifsc_and_amount_match_when_the_stored_reference_is_junk(self):
        # 932 of 7,420 live Paid payments carry a UTR that is not a bank reference at all.
        targets = [
            TargetRef(
                "Project Payments", "PAY-1", Decimal("5000"), "Approved", "VEN-0001",
                "PO/077/00066/25-26",
            )
        ]
        result = match_payments(_Row(amount="5000"), targets, self._vendor())
        self.assertEqual(result.tier, TIER_ACCOUNT)
        self.assertEqual(result.groups[0].basis, BASIS_ACCOUNT_IFSC)

    def test_the_ifsc_is_required_not_merely_preferred(self):
        """⚠️ THE GATE. An account number without its IFSC is a digit sequence that can collide;
        tier 1 auto-suggests on the strength of the PAIR. A row whose IFSC is absent or disagrees
        falls through to tier 2, where the project has to corroborate it."""
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Approved", "VEN-0001", "junk")
        ]
        row = _Row(amount="5000")
        self.assertEqual(match_payments(row, targets, self._vendor(ifsc="")).tier, TIER_NONE)
        self.assertEqual(
            match_payments(row, targets, self._vendor(ifsc="TEST9999999")).tier, TIER_NONE
        )

    def test_a_name_only_vendor_never_reaches_tier_1(self):
        """The vendor still RESOLVES by name -- it is persisted and shown -- but a name is a scoring
        form, never an identity, so it may not admit anything to the certain tier."""
        by_name = resolve_vendors(_Row(beneficiary_name="Testco Insulations"), INDEX)
        self.assertTrue(by_name.candidates)
        self.assertEqual(by_name.best.basis, BASIS_NAME)
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Approved", "VEN-0001", "junk")
        ]
        self.assertEqual(match_payments(_Row(amount="5000"), targets, by_name).tier, TIER_NONE)

    def test_no_vendor_resolved_means_no_tier_1(self):
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Approved", "VEN-0001", "junk")
        ]
        result = match_payments(_Row(amount="5000"), targets, self._vendor("00000000000"))
        self.assertEqual(result.groups, ())

    def test_a_target_with_no_vendor_is_never_matched(self):
        # Found by the S4 suite, whose fixture payments were raw-inserted with a NULL vendor. The
        # old condition only skipped targets that HAD a disagreeing vendor, so a vendor-less target
        # slipped through on amount alone -- matching for want of anything to disagree with.
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Approved", None, "junk")
        ]
        self.assertEqual(match_payments(_Row(amount="5000"), targets, self._vendor()).groups, ())

    def test_it_matches_within_the_strict_rounding_window(self):
        """Measured on live data, 31.4% of payments carry paise while the bank sends whole rupees:
        three approved payments in the first real import were 0.31, 0.68 and 0.90 away from the
        transfers that paid them. Re 1 is exactly the width of that phenomenon."""
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("4999.31"), "Approved", "VEN-0001", "junk")
        ]
        result = match_payments(_Row(amount="5000"), targets, self._vendor())
        self.assertEqual([t.name for g in result.groups for t in g.targets], ["PAY-1"])

    def test_a_gap_wider_than_a_rupee_is_not_tier_1_even_though_it_is_settleable(self):
        """⚠️ THE TWO WINDOWS DOING DIFFERENT JOBS. Rs 4 is inside the SETTLE window, so this record
        can be linked and confirmed by hand -- but Rs 4 is not a rounding, so it is not evidence,
        and tier 1's whole claim is that its evidence is strong."""
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("4996"), "Approved", "VEN-0001", "junk")
        ]
        self.assertEqual(match_payments(_Row(amount="5000"), targets, self._vendor()).tier, TIER_NONE)

    def test_a_tds_sized_gap_never_matches(self):
        targets = [
            TargetRef("Project Payments", "PAY-1", Decimal("4900"), "Approved", "VEN-0001", "junk")
        ]
        self.assertEqual(match_payments(_Row(amount="5000"), targets, self._vendor()).groups, ())

    def test_an_unreferenced_fan_out_stays_unmatched_rather_than_being_reassembled(self):
        # THE one thing this module must not do. Each member holds a fraction of the bank amount;
        # inferring the partition would mean inventing an allocation nobody authorised.
        targets = [
            TargetRef("Project Payments", f"PAY-{i}", Decimal("1000"), "Approved", "VEN-0001", "junk")
            for i in range(1, 8)
        ]
        row = _Row(amount="7000", bank_reference_no="900000000001")
        self.assertEqual(match_payments(row, targets, self._vendor()).groups, ())

    def test_the_date_is_not_consulted_at_all(self):
        """⚠️ DELIBERATELY DROPPED (owner ruling 2026-08-07). The old vendor pass needed a 3-day
        window because a name-scored vendor is weak evidence. The money either went to that account
        or it did not, and a payment recorded weeks late is still that payment."""
        targets = [
            TargetRef(
                "Project Payments", "PAY-1", Decimal("5000"), "Approved", "VEN-0001", "junk",
                date(2026, 1, 1),
            )
        ]
        row = _Row(amount="5000", added_on_date=date(2026, 7, 28))
        self.assertEqual(match_payments(row, targets, self._vendor()).tier, TIER_ACCOUNT)


class TestTier2ProjectInTheRemark(unittest.TestCase):
    """The corroborated tier: the amount agrees AND the remark names the record's project."""

    def _payment(self, name="PAY-1", amount="5000", project="PROJ-1"):
        return TargetRef(
            "Project Payments", name, Decimal(amount), "Approved", "VEN-9999", "junk",
            None, project,
        )

    def test_amount_plus_the_named_project_matches(self):
        result = match_payments(_Row(amount="5000"), [self._payment()], None, "PROJ-1")
        self.assertEqual(result.tier, TIER_PROJECT)
        self.assertEqual(result.groups[0].basis, BASIS_PROJECT_REMARK)

    def test_the_amount_alone_is_never_enough(self):
        """⚠️ THE WHOLE REASON TIER 2 HAS A SECOND AXIS. A round number repeats endlessly across a
        ledger of thousands; without the project this would be a coin flip wearing a suggestion's
        clothes."""
        self.assertEqual(match_payments(_Row(amount="5000"), [self._payment()], None, None).tier, TIER_NONE)

    def test_a_different_project_does_not_match(self):
        result = match_payments(_Row(amount="5000"), [self._payment(project="PROJ-2")], None, "PROJ-1")
        self.assertEqual(result.groups, ())

    def test_a_payment_with_no_project_does_not_match(self):
        result = match_payments(_Row(amount="5000"), [self._payment(project=None)], None, "PROJ-1")
        self.assertEqual(result.groups, ())

    def test_it_uses_the_settle_window_not_the_strict_one(self):
        """Rs 4 out is inside tier 2's window: the project is the evidence here, and the amount is
        the corroboration rather than the claim."""
        result = match_payments(_Row(amount="5000"), [self._payment(amount="4996")], None, "PROJ-1")
        self.assertEqual(result.tier, TIER_PROJECT)

    def test_two_payments_in_the_named_project_are_both_offered(self):
        """Not an error and not a guess -- two approved records at this amount in this project is a
        real ambiguity, and `status.sole_suggestion` is what declines to pre-select one."""
        result = match_payments(
            _Row(amount="5000"),
            [self._payment("PAY-1"), self._payment("PAY-2")],
            None,
            "PROJ-1",
        )
        self.assertEqual([g.targets[0].name for g in result.groups], ["PAY-1", "PAY-2"])


class TestTheLadderStopsAtTheFirstHit(unittest.TestCase):
    def _vendor(self):
        return resolve_vendors(_Row(bank_account="11111111111", ifsc="TEST0000001"), INDEX)

    def test_tier_0_short_circuits_tier_1(self):
        targets = [
            TargetRef("Project Payments", "PAY-A", Decimal("5000"), "Approved", "VEN-0001", "900000000001"),
            TargetRef("Project Payments", "PAY-B", Decimal("5000"), "Approved", "VEN-0001", "junk"),
        ]
        row = _Row(amount="5000", bank_reference_no="900000000001")
        result = match_payments(row, targets, self._vendor())
        self.assertEqual(result.tier, TIER_REFERENCE)
        self.assertEqual([t.name for g in result.groups for t in g.targets], ["PAY-A"])

    def test_tier_1_short_circuits_tier_2(self):
        """⚠️ A LOWER TIER NEVER TOPS UP A HIGHER ONE. Adding PAY-B here would turn one confident
        suggestion into a two-candidate ambiguity that pre-selects nothing -- the exact failure the
        tiers were introduced to remove."""
        targets = [
            TargetRef("Project Payments", "PAY-A", Decimal("5000"), "Approved", "VEN-0001", "junk", None, "PROJ-1"),
            TargetRef("Project Payments", "PAY-B", Decimal("5000"), "Approved", "VEN-9999", "junk", None, "PROJ-1"),
        ]
        result = match_payments(_Row(amount="5000"), targets, self._vendor(), "PROJ-1")
        self.assertEqual(result.tier, TIER_ACCOUNT)
        self.assertEqual([t.name for g in result.groups for t in g.targets], ["PAY-A"])


class TestExpenseMatching(unittest.TestCase):
    """Expenses live at TIER 2 ONLY, so every case here needs the project named in the remark."""

    def test_account_number_in_the_description_corroborates_an_amount_match(self):
        # The one clean live match in the whole exercise was found exactly this way: an approved
        # accommodation expense carried the payee's account number in its free-text description.
        target = TargetRef(
            "Project Expenses", "EXP-1", Decimal("5000"), "Approved", None, "", None, "PROJ-1",
            "Testperson Kappa (July PG rent)\nAccount Number: 39088842277\nIFSC Code: TEST0000009",
        )
        row = _Row(amount="5000", beneficiary_name="Testperson Kappa", bank_account="39088842277",
                   ifsc="TEST0000009")
        candidates = match_expenses(row, [target], "PROJ-1")
        self.assertEqual(len(candidates), 1)
        self.assertGreater(candidates[0].score, 0.8)
        self.assertIn("account number appears in the description", candidates[0].reasons)

    def test_an_amount_only_match_is_no_longer_offered(self):
        """⚠️ THIS TEST IS INVERTED FROM ITS PREVIOUS FORM, AND THE INVERSION IS THE OWNER'S RULING
        (2026-08-07). It used to assert that an amount-only expense IS offered, merely scoring low.
        That was the practical ceiling on this feature: a round-number transfer with an approved
        payment and an unrelated approved expense at the same figure had two candidates and
        pre-selected nothing. An expense whose project the remark does not name is now not offered
        at all, and the row is linked by hand instead."""
        target = TargetRef("Project Expenses", "EXP-1", Decimal("5000"), "Approved", None, "", None, "PROJ-1", "Something else entirely")
        row = _Row(amount="5000", beneficiary_name="Testperson Kappa")
        self.assertEqual(match_expenses(row, [target], None), ())

    def test_a_different_project_is_not_offered(self):
        target = TargetRef("Project Expenses", "EXP-1", Decimal("5000"), "Approved", None, "", None, "PROJ-2", "")
        self.assertEqual(match_expenses(_Row(amount="5000"), [target], "PROJ-1"), ())

    def test_a_non_project_expense_can_never_be_offered(self):
        """`Non Project Expenses` has no project column at all, so nothing can corroborate it --
        which is why it is correct, not merely convenient, that tier 2 cannot reach it."""
        target = TargetRef("Non Project Expenses", "NPE-1", Decimal("5000"), "Approved", None, "", None, None, "")
        self.assertEqual(match_expenses(_Row(amount="5000"), [target], "PROJ-1"), ())

    def test_an_amount_within_the_settle_window_is_offered(self):
        target = TargetRef("Project Expenses", "EXP-1", Decimal("4999.40"), "Approved", None, "", None, "PROJ-1", "")
        offered = match_expenses(_Row(amount="5000"), [target], "PROJ-1")
        self.assertEqual([c.target.name for c in offered], ["EXP-1"])

    def test_an_amount_outside_the_tolerance_is_not_offered(self):
        target = TargetRef("Project Expenses", "EXP-1", Decimal("4900"), "Approved", None, "", None, "PROJ-1", "")
        self.assertEqual(match_expenses(_Row(amount="5000"), [target], "PROJ-1"), ())

    def test_better_corroborated_candidate_ranks_first(self):
        """The description signals still RANK the candidates the project gate admitted -- they just
        no longer decide whether anything is admitted."""
        weak = TargetRef("Project Expenses", "EXP-WEAK", Decimal("5000"), "Approved", None, "", None, "PROJ-1", "unrelated")
        strong = TargetRef("Project Expenses", "EXP-STRONG", Decimal("5000"), "Approved", None, "", None, "PROJ-1",
                           "Testperson Kappa rent, a/c 39088842277")
        row = _Row(amount="5000", beneficiary_name="Testperson Kappa", bank_account="39088842277")
        self.assertEqual(match_expenses(row, [weak, strong], "PROJ-1")[0].target.name, "EXP-STRONG")


class TestMatchRow(unittest.TestCase):
    def test_it_resolves_the_vendor_the_project_and_the_ladder(self):
        payment = TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Approved", "VEN-0001", "900000000001")
        row = _Row(amount="5000", bank_account="11111111111", ifsc="TEST0000001",
                   bank_reference_no="900000000001")
        result = match_row(row, INDEX, [payment], [], PROJECTS)
        self.assertEqual(result.vendor.best.vendor.name, "VEN-0001")
        self.assertEqual(result.best_payment_group.targets[0].name, "PAY-1")
        self.assertEqual(result.tier, TIER_REFERENCE)

    def test_a_tier_1_hit_is_not_topped_up_with_a_tier_2_expense(self):
        """⚠️ THE LADDER'S WHOLE POINT, AND THE REASON `match_row` ORCHESTRATES RATHER THAN CALLING
        BOTH MATCHERS. This row matches a payment on account+IFSC AND an expense on
        amount+project. Offering both would make two candidates, and two candidates pre-select
        nothing -- so a confident row would open no readier than an unmatched one."""
        payment = TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Approved", "VEN-0001", "junk")
        expense = TargetRef("Project Expenses", "EXP-1", Decimal("5000"), "Approved", None, "", None, "PROJ-1", "")
        row = _Row(amount="5000", bank_account="11111111111", ifsc="TEST0000001", remarks="Toshiba")
        result = match_row(row, INDEX, [payment], [expense], PROJECTS)
        self.assertEqual(result.tier, TIER_ACCOUNT)
        self.assertEqual(result.expense_candidates, ())

    def test_tier_2_offers_payments_and_expenses_together(self):
        """At tier 2 they are peers: both rest on amount + project, and which LEDGER the money was
        booked in is exactly what the reviewer is being asked."""
        payment = TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Approved", "VEN-9999", "junk", None, "PROJ-1")
        expense = TargetRef("Project Expenses", "EXP-1", Decimal("5000"), "Approved", None, "", None, "PROJ-1", "")
        row = _Row(amount="5000", remarks="payment for Toshiba")
        result = match_row(row, INDEX, [payment], [expense], PROJECTS)
        self.assertEqual(result.tier, TIER_PROJECT)
        self.assertEqual(result.best_payment_group.targets[0].name, "PAY-1")
        self.assertEqual([c.target.name for c in result.expense_candidates], ["EXP-1"])
        self.assertEqual(result.project, "PROJ-1")

    def test_an_ambiguous_remark_reaches_no_tier_2_at_all(self):
        """Two live projects are called `Fidelity Chennai`; `project_match` refuses to pick one, and
        that refusal has to survive all the way to here rather than being softened en route."""
        payment = TargetRef("Project Payments", "PAY-1", Decimal("5000"), "Approved", "VEN-9999", "junk", None, "PROJ-2")
        row = _Row(amount="5000", remarks="Fidelity Chennai")
        result = match_row(row, INDEX, [payment], [], PROJECTS)
        self.assertEqual(result.tier, TIER_NONE)
        self.assertIsNone(result.project)

    def test_without_a_project_index_the_ladder_stops_after_tier_1(self):
        """Every caller that has no index -- and every test written before tier 2 existed -- gets
        the honest answer rather than a crash."""
        expense = TargetRef("Project Expenses", "EXP-1", Decimal("5000"), "Approved", None, "", None, "PROJ-1", "")
        result = match_row(_Row(amount="5000", remarks="Toshiba"), INDEX, [], [expense])
        self.assertEqual(result.tier, TIER_NONE)
        self.assertEqual(result.expense_candidates, ())

    def test_no_pools_yields_an_empty_result_not_an_error(self):
        result = match_row(_Row(amount="5000"), INDEX)
        self.assertIsNone(result.best_payment_group)
        self.assertEqual(result.expense_candidates, ())
        self.assertEqual(result.tier, TIER_NONE)


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
