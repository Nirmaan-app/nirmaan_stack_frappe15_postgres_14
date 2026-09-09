# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tests for `bank_exclusions` -- what a bank statement line must, and must NOT, be dropped for.

Plain `unittest`. No `frappe`, no site, no fixture file, no database -- the module under test is
pure and the cases are inline strings, so the whole policy can be exercised in milliseconds.

⚠️ EVERY NARRATION HERE IS SHAPED AFTER A REAL ROW of the Jan-Aug 2026 ICICI statement (1,274 rows,
405 of them excluded). Shape matters more than realism in a rule test: `BIL/BPAY/.../BBPS/ICICI
CRED/840484` is dropped because of where `BIL/` sits and what follows `BBPS`, and an invented
narration would test a rule nobody wrote.

⚠️ THE NEAR MISSES ARE THE VALUABLE HALF OF THIS FILE. A rule test that only proves the rule catches
its own row is satisfied by `return True`. What these have to pin is the BOUNDARY -- that `ATD/` is
anchored, that `porter` is not `portal`, that a `CASHFREEID` credit is a wallet RETURN and not a
top-up -- because that boundary is what a later widening would eat, silently, and a wrongly-dropped
row is invisible by construction (design rule (a)). Each rule therefore gets at least one row it
must catch and at least one it must NOT.
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

from nirmaan_stack.services.outflow_import.bank_exclusions import (
    EXCLUSION_RULES,
    SKIP_CATEGORY_IDS,
    should_skip,
)


def skip(remarks: str, withdrawal=None, deposit=None):
    """`should_skip` with the two amount columns defaulted to EMPTY.

    Every call site therefore states its direction explicitly, which is the point of design rule
    (b): a case that forgets to say which column is populated fails loudly rather than passing for
    the wrong reason.
    """
    return should_skip(remarks, withdrawal, deposit)


INGEST = (False, "")


# ---------------------------------------------------------------------------------------------
# The three payout wallets -- money parked, not money spent
# ---------------------------------------------------------------------------------------------


class TestPlatformCashfree(unittest.TestCase):
    def test_a_top_up_to_the_cashfree_wallet_is_skipped(self):
        self.assertEqual(
            skip("MMT/IMPS/600219693408/CASHFREEIDFC/IDFB0020101", withdrawal=150000),
            (True, "platform_cashfree"),
        )

    def test_the_typed_label_alone_is_enough_when_no_rival_ifsc_is_present(self):
        """The IFSC leads, but a row that carries only the label still resolves -- rule (c) makes
        the label a FALLBACK, not a dead branch."""
        self.assertEqual(
            skip("MMT/IMPS/600219693408/Cash Free payout/HDFC0000123", withdrawal=150000),
            (True, "platform_cashfree"),
        )

    def test_a_vendor_whose_name_merely_contains_free_is_ingested(self):
        """NEAR MISS. `cash\\s*free` needs both words; a `free` on its own is a vendor's name and
        a real payment to a real payee."""
        self.assertEqual(
            skip(
                "NEFT-YESF362326538812-FREEFLOW SYSTEMS PRIVATE LIMITED-00228130001486",
                withdrawal=88200,
            ),
            INGEST,
        )

    def test_the_same_narration_as_a_credit_is_a_wallet_return_not_a_top_up(self):
        """NEAR MISS on the DIRECTION axis (design rule (b)). Byte-identical platform identity,
        opposite column, different category -- money coming BACK out of the wallet."""
        self.assertEqual(
            skip("MMT/IMPS/607113742500/Cashfree Balanc/CASHFREEID/IDFB0020101", deposit=150000),
            (True, "gateway_wallet_return"),
        )


class TestPlatformCashbook(unittest.TestCase):
    def test_a_top_up_to_the_cashbook_wallet_is_skipped(self):
        self.assertEqual(
            skip("MMT/IMPS/600219733458/CASHBOOK/IDFB0080101", withdrawal=50000),
            (True, "platform_cashbook"),
        )

    def test_a_cashback_credit_is_not_a_cashbook_top_up(self):
        """NEAR MISS. `cash\\s*book` and `cashback` share five letters and nothing else."""
        self.assertEqual(
            skip("MMT/IMPS/610318221904/CASHBACK REWARD/ICIC0000001", deposit=412),
            INGEST,
        )

    def test_a_credit_carrying_the_cashbook_ifsc_is_ingested(self):
        """NEAR MISS on the DIRECTION axis. A top-up is a DEBIT; money arriving from that IFSC is
        not a top-up and no rule claims to know what it is -- so it FAILS OPEN and a human looks at
        it, which is exactly the intended behaviour for a shape we have not seen."""
        self.assertEqual(
            skip("MMT/IMPS/600219733458/CASHBOOK/IDFB0080101", deposit=50000),
            INGEST,
        )


class TestPlatformPorter(unittest.TestCase):
    def test_a_top_up_to_the_porter_wallet_is_skipped(self):
        self.assertEqual(
            skip("MMT/IMPS/600219732045/Porter wallet r/PORTER/RATN0000156", withdrawal=35000),
            (True, "platform_porter"),
        )

    def test_a_portal_is_not_a_porter(self):
        """NEAR MISS. One letter apart, and a real payment to a real vendor."""
        self.assertEqual(
            skip(
                "NEFT-YESF362326538833-PORTAL DESIGNS PRIVATE LIMITED-00228130001486",
                withdrawal=41300,
            ),
            INGEST,
        )

    def test_a_credit_carrying_the_porter_ifsc_is_ingested(self):
        """NEAR MISS on the DIRECTION axis -- a refund from Porter is money we get back, which is a
        fact worth staging, not a top-up to hide."""
        self.assertEqual(
            skip("MMT/IMPS/600219732045/PORTER/RATN0000156", deposit=35000),
            INGEST,
        )

    def test_a_transporter_is_not_a_porter(self):
        """⚠️ THE INVERTED PIN. This test used to assert the OPPOSITE, and the reasoning is kept so
        nobody reverses it back by accident.

        `porter` was a bare substring, so it also matched `transporter` -- a debit to a transport
        vendor was dropped as a wallet top-up. That is an INVISIBLE loss, the one failure mode design
        rule (a) exists to prevent, and it was the single place this module did not fail open.

        It was originally left alone on measurement: across all 1,274 rows of the eight-month
        statement it cost ZERO rows. The owner tightened it anyway (2026-09-07), before it cost
        anything rather than after -- construction pays transporters, and "site transportation
        charges" is an ordinary narration that next month's statement may well carry.

        The fix is `\\b` on both ends, NOT dropping the label branch: requiring the `RATN0000156`
        IFSC would have removed the fallback that rule (c) depends on, which exists precisely because
        operators mistype platform names. All 33 real Porter top-ups still match (measured).
        """
        self.assertEqual(
            skip("NEFT-YESF362326538844-SRI TRANSPORTERS AND LOGISTICS-0022813", withdrawal=18000),
            INGEST,
        )

    def test_the_real_porter_top_ups_still_match_after_the_boundaries(self):
        """The other half of the inversion: narrowing the rule must not cost a real skip. These are
        the two shapes the 33 live Porter rows actually take."""
        self.assertEqual(
            skip("MMT/IMPS/600219732045/Porter wallet r/PORTER/RATN0000156", withdrawal=35000),
            (True, "platform_porter"),
        )
        self.assertEqual(
            skip("MMT/IMPS/607810574843/PORTER/RATN0000156", withdrawal=25000),
            (True, "platform_porter"),
        )


# ---------------------------------------------------------------------------------------------
# Rule (c) -- the IFSC beats the typed label
# ---------------------------------------------------------------------------------------------


class TestTheIfscBeatsTheTypedLabel(unittest.TestCase):
    """⚠️ THE RULE (c) CASES, AND THEY ARE REAL ROWS.

    Four rows of the statement carry a platform name a human typed WRONG: three read `Cashbook
    Balanc` / `Cashbook Bal` while carrying Cashfree's `IDFB0020101`, and one reads `Cashfree
    Balanc` while carrying Cashbook's `IDFB0080101`. The IFSC comes off the beneficiary record and
    cannot be mistyped that way, so it decides.

    ⚠️ THE SKIP VERDICT IS THE SAME EITHER WAY TODAY -- both platforms are excluded -- WHICH IS
    PRECISELY WHY THESE TESTS ASSERT THE CATEGORY AND NOT JUST THE BOOLEAN. Attribution is what
    breaks first, silently, and it is what will decide the row the day one platform moves out of
    scope.
    """

    def test_a_cashbook_labelled_row_carrying_cashfrees_ifsc_is_cashfree(self):
        self.assertEqual(
            skip("MMT/IMPS/607117195999/Cashbook Balanc/CASHFREEID/IDFB0020101", withdrawal=300000),
            (True, "platform_cashfree"),
        )

    def test_the_truncated_cashbook_bal_form_resolves_the_same_way(self):
        self.assertEqual(
            skip("MMT/IMPS/619013944618/Cashbook Bal/CASHFREEID/IDFB0020101", withdrawal=500000),
            (True, "platform_cashfree"),
        )

    def test_a_cashfree_labelled_row_carrying_cashbooks_ifsc_is_cashbook(self):
        """The mirror image -- and the case that forces the Cashfree label branch to STAND DOWN
        when a rival platform's IFSC is on the row. Without that stand-down the first rule would
        claim this row on its wrong label and the ordering would defeat rule (c)."""
        self.assertEqual(
            skip("MMT/IMPS/611212795642/Cashfree Balanc/CASHBOOK/IDFB0080101", withdrawal=50000),
            (True, "platform_cashbook"),
        )


# ---------------------------------------------------------------------------------------------
# The wallet float coming home
# ---------------------------------------------------------------------------------------------


class TestGatewayWalletReturn(unittest.TestCase):
    def test_unspent_wallet_float_sweeping_back_is_skipped(self):
        self.assertEqual(
            skip("MMT/IMPS/608416888038/Cashfree Balanc/CASHFREEID/IDFB0020101", deposit=500000),
            (True, "gateway_wallet_return"),
        )

    def test_the_same_narration_as_a_debit_is_the_top_up_not_the_return(self):
        """NEAR MISS on the DIRECTION axis -- the mirror of the Cashfree direction case."""
        self.assertEqual(
            skip("MMT/IMPS/608416888038/Cashfree Balanc/CASHFREEID/IDFB0020101", withdrawal=500000),
            (True, "platform_cashfree"),
        )

    def test_a_credit_naming_cashfree_without_the_gateway_token_is_not_a_return(self):
        """NEAR MISS. A real row: a failed payment TO Cashfree bouncing home. It mentions the
        platform but carries no `CASHFREEID` gateway token, and it is a different fact --
        a payment that failed, not float sweeping back."""
        self.assertEqual(
            skip(
                "NEFT-RETURN-IN42602057112627-Cashfree-Incorrect Account Number  AC01",
                deposit=500000,
            ),
            (True, "neft_return_failed"),
        )


# ---------------------------------------------------------------------------------------------
# The bank's own ledger move -- BOTH legs, one wording
# ---------------------------------------------------------------------------------------------


class TestInternalGlTransferBothLegs(unittest.TestCase):
    """⚠️ THE CASE DESIGN RULE (b) WAS WRITTEN FOR.

    `Ac xfr from gl 05051 to 60010` occurs TWICE in the statement with byte-identical wording --
    once as a Rs 3.19 Cr debit and once as a Rs 3.19 Cr credit. They are two categories, and the
    ONLY thing separating them is which amount column carries the figure. A rule matching on
    narration alone files one as the other and nothing on any screen would show it.
    """

    NARRATION = "Ac xfr from gl 05051 to 60010"

    def test_the_debit_leg(self):
        self.assertEqual(
            skip(self.NARRATION, withdrawal=31880133.76),
            (True, "internal_gl_transfer"),
        )

    def test_the_credit_leg_same_string(self):
        self.assertEqual(
            skip(self.NARRATION, deposit=31880133.76),
            (True, "internal_gl_transfer_in"),
        )

    def test_the_two_legs_are_different_categories(self):
        """Stated as its own assertion because it is the property, not a side effect of the two
        above: one wording, two answers."""
        debit = skip(self.NARRATION, withdrawal=31880133.76)[1]
        credit = skip(self.NARRATION, deposit=31880133.76)[1]
        self.assertNotEqual(debit, credit)

    def test_a_transfer_to_a_gl_is_not_a_transfer_from_one(self):
        """NEAR MISS. The rule names the direction of the ledger move in words as well as in
        columns; `to gl` is not the shape it knows and abstains."""
        self.assertEqual(skip("Ac xfr to gl 60010 from 05051", withdrawal=100000), INGEST)

    def test_gl_must_be_a_whole_word(self):
        """NEAR MISS. `\\bgl\\b` is what stops the rule reading a vendor name -- without the word
        boundary a payment to a glass supplier is an internal ledger move."""
        self.assertEqual(
            skip("Ac xfr from glass works to site store", withdrawal=45000),
            INGEST,
        )


# ---------------------------------------------------------------------------------------------
# A payment that failed and came home
# ---------------------------------------------------------------------------------------------


class TestNeftReturnFailed(unittest.TestCase):
    def test_a_returned_neft_is_skipped(self):
        self.assertEqual(
            skip(
                "NEFT-RETURN-IN42600152589641-MdAish-Incorrect Account Number  AC01",
                deposit=8820,
            ),
            (True, "neft_return_failed"),
        )

    def test_a_padded_cell_still_matches(self):
        """The anchor tolerates leading whitespace, because a spreadsheet cell often carries it."""
        self.assertEqual(
            skip(
                "  NEFT-RETURN-IN42603353754662-VishnuK-Incorrect Account Number  AC01",
                deposit=7587,
            ),
            (True, "neft_return_failed"),
        )

    def test_an_ordinary_inward_neft_is_ingested(self):
        """NEAR MISS. Same rail, same prefix family, and it is a real receipt somebody must
        reconcile. Only `RETURN` separates them."""
        self.assertEqual(
            skip(
                "NEFT-YESF362326538809-MDEPOT RETAIL TECHNOLOGIES PRIVATE -2 GROUPED "
                "ITEMS-00228130001486",
                deposit=112500,
            ),
            INGEST,
        )

    def test_the_words_neft_return_mid_narration_do_not_match(self):
        """NEAR MISS on the ANCHOR. `re.match`, not `re.search`: the prefix is the bank's own
        transaction type and only means that at the start of the line."""
        self.assertEqual(
            skip("MMT/IMPS/611821706777/NEFT-RETURN-CHARGES REFUND/ICIC0000001", deposit=118),
            INGEST,
        )


# ---------------------------------------------------------------------------------------------
# Card and credit-facility housekeeping
# ---------------------------------------------------------------------------------------------


class TestBankCardAdjustment(unittest.TestCase):
    def test_the_two_rupee_card_rounding_entry_is_skipped(self):
        self.assertEqual(
            skip("CMS/ CC RBI 10 H/ICICI BANK LTD CREDIT CARD WITHD", deposit=2),
            (True, "bank_card_adjustment"),
        )

    def test_the_same_entry_as_a_debit_is_ingested(self):
        """NEAR MISS on the DIRECTION axis -- money leaving on a card narration is not a rounding
        adjustment, and no rule here claims to know what it is."""
        self.assertEqual(
            skip("CMS/ CC RBI 10 H/ICICI BANK LTD CREDIT CARD WITHD", withdrawal=2),
            INGEST,
        )

    def test_a_cms_credit_that_is_not_the_cc_rbi_shape_is_ingested(self):
        """NEAR MISS. `CMS/` is a whole family of collection-service credits and most of them are
        real client money; only the `CC RBI` form is the adjustment."""
        self.assertEqual(
            skip("CMS/ NEFT CR/DAI SPACES PVT LTD/000190", deposit=885000),
            INGEST,
        )


class TestCreditCardBillPayment(unittest.TestCase):
    def test_an_icici_card_settlement_through_bbps_is_skipped(self):
        self.assertEqual(
            skip("BIL/BPAY/0000001MKLAO/BBPS/ICICI CRED/840484", withdrawal=265509.77),
            (True, "credit_card_bill_payment"),
        )

    def test_a_bill_payment_to_someone_else_is_ingested(self):
        """NEAR MISS, and the important one. `BIL/BPAY/.../BBPS/` is how EVERY biller is paid
        through this account -- electricity, telecom, statutory. Both halves of the rule are
        load-bearing: without the `ICICI CRED|BANK` half this drops every utility bill in the file.
        """
        self.assertEqual(
            skip("BIL/BPAY/0000001NL5DD/BBPS/BESCOM/770901", withdrawal=48620),
            INGEST,
        )

    def test_the_prefix_is_anchored(self):
        """NEAR MISS on the ANCHOR. The same tokens mid-narration are a payment to a vendor whose
        reference happens to carry them."""
        self.assertEqual(
            skip("MMT/IMPS/611821706790/ICICI CRED SERVICES/ICIC0000001", withdrawal=265509.77),
            INGEST,
        )

    def test_the_prefix_is_case_sensitive_on_purpose(self):
        """NEAR MISS, and a DELIBERATE narrowing rather than an oversight. `BIL/` is machine-written
        by the bank and is always upper-case, so a lower-case `bil/` is not the bank's prefix -- it
        is free text, and free text at the start of a narration is somebody's reference. Its partner
        pattern `ICICI\\s*(CRED|BANK)` IS case-insensitive, because that half is typed by people."""
        self.assertEqual(
            skip("bil/bpay/0000001MKLAO/bbps/ICICI CRED/840484", withdrawal=265509.77),
            INGEST,
        )


class TestCreditFacilityAutoDebit(unittest.TestCase):
    def test_the_card_auto_debit_standing_instruction_is_skipped(self):
        self.assertEqual(
            skip("ATD/Auto Debit CC1xx3940", withdrawal=39417.04),
            (True, "credit_facility_auto_debit"),
        )

    def test_the_prefix_is_anchored(self):
        """NEAR MISS. `ATD` is three common letters; searched rather than anchored, this rule would
        reach into vendor references and drop real payments."""
        self.assertEqual(
            skip("NEFT-YESF362326538855-ATD/AUTOMOTIVE TRADERS-00228130001486", withdrawal=62000),
            INGEST,
        )

    def test_a_longer_prefix_beginning_with_atd_does_not_match(self):
        """NEAR MISS. The `/` is part of the prefix; `ATDS/` is a different transaction type."""
        self.assertEqual(skip("ATDS/Some other instruction", withdrawal=12000), INGEST)

    def test_a_credit_is_ingested(self):
        """NEAR MISS on the DIRECTION axis -- an auto-debit is by definition a debit."""
        self.assertEqual(skip("ATD/Auto Debit CC1xx3940", deposit=39417.04), INGEST)


# ---------------------------------------------------------------------------------------------
# Fail open -- design rule (a)
# ---------------------------------------------------------------------------------------------


class TestFailOpen(unittest.TestCase):
    """⚠️ THE DEFAULT ANSWER IS INGEST, AND THAT IS THE WHOLE SAFETY ARGUMENT.

    These are real rows from the statement that must reach a human. None of them is exotic; the
    point is that ordinary money movement passes through untouched, so the rules can be widened
    only on purpose and never by accident.
    """

    def test_an_ordinary_inward_neft_from_a_client(self):
        self.assertEqual(
            skip(
                "NEFT-YESF362326538809-MDEPOT RETAIL TECHNOLOGIES PRIVATE -2 GROUPED "
                "ITEMS-00228130001486",
                deposit=112500,
            ),
            INGEST,
        )

    def test_a_direct_tax_payment(self):
        self.assertEqual(
            skip("GIB/002058226122/DTAX      /26012700066182ICIC", withdrawal=250000),
            INGEST,
        )

    def test_fd_interest_credited_by_the_bank(self):
        self.assertEqual(
            skip("Int on FD/RD XXX1083  Tds:1393.Int:13938 and TAX:1393.", deposit=12545),
            INGEST,
        )

    def test_a_fixed_deposit_closing(self):
        self.assertEqual(
            skip("742910001083 FD clos 02-01-2026 STRATOS INFRA TEC", deposit=5000000),
            INGEST,
        )

    def test_a_clearing_credit_from_a_client(self):
        self.assertEqual(
            skip("CLG/DAI SPACES PVT LTD/000190/HDF/23.02.2026", deposit=885000),
            INGEST,
        )

    def test_a_narration_shape_nobody_has_seen_before(self):
        """The case the whole design rule is about: next month's statement carries wording none of
        these ten rules was fitted to. It must arrive as work, not disappear."""
        self.assertEqual(skip("UPI/451234567890/PAYMENT/SOME NEW RAIL", withdrawal=9500), INGEST)

    def test_an_empty_narration_is_ingested(self):
        """An unreadable cell is OUR failure to read the sheet, never evidence that the row is
        noise -- the same reasoning `duplicates.dates_agree` records for a missing date."""
        self.assertEqual(skip("", withdrawal=1000), INGEST)
        self.assertEqual(skip(None, withdrawal=1000), INGEST)


# ---------------------------------------------------------------------------------------------
# Reading the amount columns -- the mechanics behind design rule (b)
# ---------------------------------------------------------------------------------------------


class TestTheDirectionTestIsRobust(unittest.TestCase):
    """⚠️ PLAIN TRUTHINESS WOULD GET THE DIRECTION WRONG, AND THE GL PAIR IS WHERE IT SHOWS.

    A spreadsheet reader hands a blank cell over as float `nan` (truthy) and a CSV reader hands a
    zero over as the string `"0.00"` (truthy). Either makes an EMPTY column read as populated, and
    on a narration that exists in both directions that files the credit leg as the debit leg.
    """

    NARRATION = "Ac xfr from gl 05051 to 60010"

    def test_a_nan_blank_cell_is_not_a_populated_column(self):
        self.assertEqual(
            skip(self.NARRATION, withdrawal=float("nan"), deposit=31880133.76),
            (True, "internal_gl_transfer_in"),
        )

    def test_a_zero_string_is_not_a_populated_column(self):
        self.assertEqual(
            skip(self.NARRATION, withdrawal="0.00", deposit="31880133.76"),
            (True, "internal_gl_transfer_in"),
        )

    def test_a_blank_string_is_not_a_populated_column(self):
        self.assertEqual(
            skip(self.NARRATION, withdrawal="   ", deposit=31880133.76),
            (True, "internal_gl_transfer_in"),
        )

    def test_a_comma_grouped_amount_string_is_populated(self):
        self.assertEqual(
            skip(self.NARRATION, withdrawal="3,18,80,133.76"),
            (True, "internal_gl_transfer"),
        )

    def test_a_row_with_neither_column_populated_matches_nothing(self):
        """Every rule leads with a direction, so a row with no figure at all cannot be skipped --
        which is the correct fail-open answer for a line we cannot even read as money."""
        self.assertEqual(skip(self.NARRATION), INGEST)


# ---------------------------------------------------------------------------------------------
# The policy stays readable, and stays out of the matcher
# ---------------------------------------------------------------------------------------------


class TestThePolicyIsData(unittest.TestCase):
    def test_the_ten_rules_are_declared_once_and_enumerable(self):
        """`SKIP_CATEGORY_IDS` is derived from `EXCLUSION_RULES`, not typed a second time -- a
        caller writing a visible skip reason needs the set, and two hand-kept lists would drift."""
        self.assertEqual(len(EXCLUSION_RULES), 10)
        self.assertEqual(len(SKIP_CATEGORY_IDS), 10)
        self.assertEqual(len(set(SKIP_CATEGORY_IDS)), 10)

    def test_every_category_returned_is_one_of_the_declared_ids(self):
        cases = [
            ("MMT/IMPS/600219693408/CASHFREEIDFC/IDFB0020101", 150000, None),
            ("MMT/IMPS/600219733458/CASHBOOK/IDFB0080101", 50000, None),
            ("MMT/IMPS/600219732045/Porter wallet r/PORTER/RATN0000156", 35000, None),
            ("MMT/IMPS/608416888038/Cashfree Balanc/CASHFREEID/IDFB0020101", None, 500000),
            ("Ac xfr from gl 05051 to 60010", 31880133.76, None),
            ("Ac xfr from gl 05051 to 60010", None, 31880133.76),
            ("NEFT-RETURN-IN42600152589641-MdAish-Incorrect Account Number  AC01", None, 8820),
            ("CMS/ CC RBI 10 H/ICICI BANK LTD CREDIT CARD WITHD", None, 2),
            ("BIL/BPAY/0000001MKLAO/BBPS/ICICI CRED/840484", 265509.77, None),
            ("ATD/Auto Debit CC1xx3940", 39417.04, None),
        ]
        seen = set()
        for remarks, withdrawal, deposit in cases:
            dropped, category = should_skip(remarks, withdrawal, deposit)
            self.assertTrue(dropped, remarks)
            self.assertIn(category, SKIP_CATEGORY_IDS, remarks)
            seen.add(category)
        self.assertEqual(seen, set(SKIP_CATEGORY_IDS), "one case per rule, and all ten reachable")

    def test_the_platform_rules_are_tried_before_the_rest(self):
        """⚠️ THE ORDER IS POLICY. Rule (c) only resolves because a `Cashbook Balanc` row carrying
        Cashfree's IFSC reaches the Cashfree rule before the Cashbook rule sees its label."""
        self.assertEqual(
            SKIP_CATEGORY_IDS[:3],
            ("platform_cashfree", "platform_cashbook", "platform_porter"),
        )


class TestPurity(unittest.TestCase):
    """⚠️ THESE READ THE MODULE'S **AST**, NOT ITS SOURCE TEXT.

    A prose scan cannot tell a prohibition from a violation. This module's docstring explains at
    length that it must not reach the matcher, and it necessarily NAMES the modules it must not
    reach; a raw `assertNotIn("matcher", source)` -- the shape `test_cashbook` and `test_similarity`
    use -- would fail on that explanation and force the explanation to be deleted to keep the test
    green, which is exactly backwards. Parsing `import` statements asks the real question.
    """

    @staticmethod
    def _imported_module_names() -> set[str]:
        from nirmaan_stack.services.outflow_import import bank_exclusions

        tree = ast.parse(Path(bank_exclusions.__file__).read_text())
        names: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    names.add(alias.name)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    names.add(node.module)
                for alias in node.names:
                    names.add(f"{node.module or ''}.{alias.name}")
        return names

    def test_it_imports_no_frappe(self):
        """Same property `matcher.py`, `cashbook.py` and `project_match.py` protect: the whole
        decision stays testable against a real statement with no bench, no site and no fixtures."""
        for name in self._imported_module_names():
            self.assertNotIn("frappe", name)

    def test_it_does_not_reach_the_settlement_matcher(self):
        """⚠️ THIS MODULE MUST NOT BE ABLE TO SETTLE ANYTHING.

        It decides only whether a line reaches the staging list at all. `matcher`, `disambiguate`,
        `status`, `stacks`, `claims` and `candidates` decide what an ingested transfer PAYS, under
        an amount window this module has no equivalent of. The same fence `partial_settle` and
        `similarity` are held behind, and for the same reason: a widening made here because a
        narration looked like noise must not be able to change what moves money unattended.
        """
        forbidden = ("matcher", "disambiguate", "status", "stacks", "claims", "candidates")
        for name in self._imported_module_names():
            for module_name in forbidden:
                self.assertNotIn(
                    module_name,
                    name.split("."),
                    f"bank_exclusions must not import {module_name!r}",
                )

    def test_it_does_not_import_the_parser(self):
        """A separate fence, and a scope one rather than a safety one: this slice is wired to
        nothing, and the parser is being built alongside it. The exclusion policy has to be
        readable and testable without a statement reader in the way."""
        for name in self._imported_module_names():
            self.assertNotIn("parser", name.split("."))


if __name__ == "__main__":
    unittest.main()
