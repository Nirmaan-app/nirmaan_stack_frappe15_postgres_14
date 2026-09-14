# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The ICICI contains-guard rules (#1257). Pure: no bench, no site, no fixtures.

Every test drives the module through what the match run uses -- `find_hits` then
`pick_recorded_group`, and the shared `status.derive_duplicate_guard_outcome` for the verdict -- so a
refactor of a private helper cannot break a test while leaving the rule intact.
"""

import ast
import json
import unittest
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from nirmaan_stack.services.outflow_import.contains_guard import (
    CONTAINS_GUARD_WINDOW_DAYS,
    RecordClaim,
    claims_of_skip,
    decode_basis,
    encode_basis,
    find_hits,
    match_surface,
    pick_recorded_group,
    reference_tokens,
    skip_basis,
)
from nirmaan_stack.services.outflow_import.ledgers import (
    INFLOW_DOCTYPE,
    NON_PROJECT_EXPENSE_DOCTYPE,
    PAYMENT_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
)
from nirmaan_stack.services.outflow_import.matcher import TargetRef
from nirmaan_stack.services.outflow_import.status import (
    ROW_MISMATCHED,
    ROW_SKIPPED,
    derive_duplicate_guard_outcome,
)

ROW_DATE = datetime(2026, 3, 10)


@dataclass
class Row:
    """The attributes the guard reads off a staged ICICI row -- and nothing else."""

    amount: Decimal
    remarks: str = ""
    name: str = "ROW-THIS"
    transfer_id: str = "S99999999"
    reference_id: str = ""
    direction: str = "Debit"
    added_on: datetime | None = ROW_DATE
    status_raw: str = "SUCCESS"

    @property
    def is_success(self) -> bool:
        return True


def record(reference, amount, *, doctype=PAYMENT_DOCTYPE, name=None, on=ROW_DATE.date()):
    return TargetRef(
        doctype=doctype,
        name=name or f"REC-{reference}-{amount}",
        amount=Decimal(str(amount)),
        status="Paid",
        reference=reference,
        txn_date=on,
    )


def verdict(row, records, claims=()):
    group = pick_recorded_group(row, find_hits(row, records), claims)
    return derive_duplicate_guard_outcome(row, paid_duplicate=group), group


def claim(rec, *, row="ROW-OTHER", batch="OIB-EARLIER", settled=False):
    return RecordClaim(
        doctype=rec.doctype, name=rec.name, import_row=row, import_batch=batch, settled=settled,
    )


IMPS = "MMT/IMPS/610415565123/ALPHA REFUND /TESTPAYEEB/Kotak Mahindra"


class TestNormalisation(unittest.TestCase):
    def test_whitespace_anywhere_and_case_do_not_matter(self):
        self.assertIn("610415565123", reference_tokens(" 6104 15565123 "))
        self.assertIn("UTIBR72025010600221243", reference_tokens("utibr72025010600221243"))

    def test_a_lowercase_piece_with_words_around_it_hits(self):
        row = Row(amount=Decimal("500000"), remarks="RTGS/UTIBR72025010600221243/IDFB0020101/Testgateway")
        self.assertEqual(len(find_hits(row, [record("utibr72025010600221243 paid by rtgs", 500000)])), 1)

    def test_a_padded_lowercase_reference_hits_a_narration(self):
        row = Row(amount=Decimal("12500"), remarks=IMPS)
        self.assertEqual(len(find_hits(row, [record("  610415565123\t", 12500)])), 1)


class TestTokens(unittest.TestCase):
    def test_the_whole_string_is_kept_beside_its_pieces(self):
        tokens = reference_tokens("610415565123 ICICI")
        self.assertIn("610415565123ICICI", tokens)
        self.assertIn("610415565123", tokens)

    def test_a_reference_with_words_around_it_hits_via_its_piece(self):
        row = Row(amount=Decimal("12500"), remarks=IMPS)
        self.assertEqual(len(find_hits(row, [record("610415565123 ICICI", 12500)])), 1)

    def test_a_piece_needs_six_characters_and_a_digit(self):
        self.assertEqual(reference_tokens("12345"), frozenset())
        self.assertEqual(reference_tokens("ABCDEFGH"), frozenset())
        self.assertIn("123456", reference_tokens("123456"))

    def test_junk_references_have_no_eligible_token(self):
        for junk in ("ICICI", "refund", "0003", "Cashbook", "TDS Receivable"):
            self.assertEqual(reference_tokens(junk), frozenset(), junk)

    def test_a_DUMMY_reference_is_ignored_whole_even_with_a_long_number_in_it(self):
        self.assertEqual(reference_tokens("DUMMY-201"), frozenset())
        self.assertEqual(reference_tokens("dummy-610415565123"), frozenset())

    def test_a_BULD_batch_id_never_counts_but_its_neighbour_does(self):
        self.assertEqual(reference_tokens("BULD67453750"), frozenset())
        tokens = reference_tokens("043572728741/BULD67453750")
        self.assertIn("043572728741", tokens)
        self.assertNotIn("BULD67453750", tokens)

    def test_junk_references_never_hit_a_narration_that_contains_them(self):
        row = Row(
            amount=Decimal("5000"),
            remarks="INF/NEFT/0003 ICICI refund Cashbook/BULD67453750/DUMMY-201 TDS Receivable",
        )
        junk = ["ICICI", "refund", "0003", "Cashbook", "TDS Receivable", "BULD67453750", "DUMMY-201"]
        self.assertEqual(find_hits(row, [record(j, 5000, name=j) for j in junk]), ())


class TestTheMatchSurface(unittest.TestCase):
    def test_a_narration_with_a_long_number_is_the_surface_alone(self):
        narration = "CLG/TESTCLIENT SPACES PVT L/000190/HDF/23.02.2026250220266"
        self.assertEqual(match_surface(narration, "000190"), narration)

    def test_a_cheque_line_with_no_long_number_carries_its_cheque_number(self):
        surface = match_surface("CLG/SUMAN ELECTRIC UDYOGS P/HSB", "000734")
        self.assertIn("000734", surface)
        self.assertTrue(surface.startswith("CLG/SUMAN ELECTRIC UDYOGS P/HSB"))

    def test_no_cheque_number_leaves_the_narration_alone(self):
        self.assertEqual(match_surface("CLG/SUMAN ELECTRIC UDYOGS P/HSB", ""), "CLG/SUMAN ELECTRIC UDYOGS P/HSB")

    def test_a_six_digit_cheque_number_hits(self):
        row = Row(amount=Decimal("45000"), remarks="CLG/SUMAN ELECTRIC UDYOGS P/HSB", reference_id="000734")
        self.assertEqual(len(find_hits(row, [record("000734", 45000)])), 1)

    def test_cheque_twins_with_different_numbers_do_not_match_each_other(self):
        narration = "CLG/SUMAN ELECTRIC UDYOGS P/HSB"
        first = Row(amount=Decimal("45000"), remarks=narration, reference_id="000111")
        second = Row(amount=Decimal("45000"), remarks=narration, reference_id="000222")
        stored_from_first = record(match_surface(first.remarks, first.reference_id), 45000)
        self.assertEqual(len(find_hits(first, [stored_from_first])), 1)
        self.assertEqual(find_hits(second, [stored_from_first]), ())

    def test_a_row_matches_its_own_stored_surface(self):
        for remarks, cheque in (
            (IMPS, ""),
            ("INF/NEFT/IN42600000000001/KKBK0008071/65659556 /BULD65659556   /AshaMenonTes", ""),
            ("CLG/SUMAN ELECTRIC UDYOGS P/HSB", "000734"),
        ):
            row = Row(amount=Decimal("100000"), remarks=remarks, reference_id=cheque)
            stored = record(match_surface(remarks, cheque), 100000)
            outcome, _ = verdict(row, [stored])
            self.assertEqual(outcome.status, ROW_SKIPPED, remarks)


class TestTheTransferIdRung(unittest.TestCase):
    def test_a_reference_equal_to_the_transfer_id_hits_though_the_narration_lacks_it(self):
        row = Row(amount=Decimal("2250"), remarks="742905000271:SGST Coll", transfer_id="S20000001")
        self.assertEqual(len(find_hits(row, [record("s20000001", 2250)])), 1)

    def test_SGST_and_CGST_legs_sharing_a_transfer_id_each_skip_on_their_OWN_record(self):
        sgst = Row(amount=Decimal("2250"), remarks="742905000271:SGST Coll:01-01-2026", transfer_id="S20000001", name="SGST")
        cgst = Row(amount=Decimal("2250"), remarks="742905000271:CGST Coll:01-01-2026", transfer_id="S20000001", name="CGST")
        records = [record("S20000001", 2250, name="LEG-A"), record("S20000001", 2250, name="LEG-B")]
        claims, used = [], []
        for leg in (sgst, cgst):
            outcome, group = verdict(leg, records, claims)
            self.assertEqual(outcome.status, ROW_SKIPPED)
            # A single agreeing record -- never the 4,500 the shared reference sums to.
            self.assertEqual(len(group.targets), 1)
            used.append(group.targets[0].name)
            claims.extend(claims_of_skip(leg, "OIB-THIS", group))
        # One record, one line (#1258): the second leg takes the record the first did not.
        self.assertEqual(sorted(used), ["LEG-A", "LEG-B"])

    def test_equality_is_whole_token_not_a_prefix(self):
        row = Row(amount=Decimal("2250"), remarks="GL transfer", transfer_id="S20000001")
        self.assertEqual(find_hits(row, [record("S2000000", 2250)]), ())


class TestTheDateWindow(unittest.TestCase):
    def _hits_at(self, days):
        row = Row(amount=Decimal("12500"), remarks=IMPS)
        return find_hits(row, [record("610415565123", 12500, on=ROW_DATE.date() + timedelta(days=days))])

    def test_the_window_is_fifteen_days(self):
        self.assertEqual(CONTAINS_GUARD_WINDOW_DAYS, 15)

    def test_fifteen_days_either_side_is_in(self):
        self.assertEqual(len(self._hits_at(15)), 1)
        self.assertEqual(len(self._hits_at(-15)), 1)

    def test_sixteen_days_either_side_is_out(self):
        self.assertEqual(self._hits_at(16), ())
        self.assertEqual(self._hits_at(-16), ())

    def test_a_record_with_no_payment_date_never_hits(self):
        row = Row(amount=Decimal("12500"), remarks=IMPS)
        self.assertEqual(find_hits(row, [record("610415565123", 12500, on=None)]), ())


class TestDirection(unittest.TestCase):
    def test_a_withdrawal_reaches_payments_and_both_expense_ledgers(self):
        row = Row(amount=Decimal("12500"), remarks=IMPS, direction="Debit")
        records = [
            record("610415565123", 12500, doctype=d, name=d)
            for d in (PAYMENT_DOCTYPE, PROJECT_EXPENSE_DOCTYPE, NON_PROJECT_EXPENSE_DOCTYPE, INFLOW_DOCTYPE)
        ]
        self.assertEqual(
            {t.doctype for t in find_hits(row, records)},
            {PAYMENT_DOCTYPE, PROJECT_EXPENSE_DOCTYPE, NON_PROJECT_EXPENSE_DOCTYPE},
        )

    def test_a_deposit_reaches_inflows_only(self):
        row = Row(amount=Decimal("12500"), remarks=IMPS, direction="Credit")
        records = [
            record("610415565123", 12500, doctype=d, name=d)
            for d in (PAYMENT_DOCTYPE, PROJECT_EXPENSE_DOCTYPE, NON_PROJECT_EXPENSE_DOCTYPE, INFLOW_DOCTYPE)
        ]
        self.assertEqual({t.doctype for t in find_hits(row, records)}, {INFLOW_DOCTYPE})

    def test_a_row_with_no_direction_reaches_nothing(self):
        row = Row(amount=Decimal("12500"), remarks=IMPS, direction="")
        records = [record("610415565123", 12500, doctype=d, name=d) for d in (PAYMENT_DOCTYPE, INFLOW_DOCTYPE)]
        self.assertEqual(find_hits(row, records), ())

    def test_a_deposit_on_an_inflow_reads_received(self):
        row = Row(amount=Decimal("12500"), remarks=IMPS, direction="Credit")
        outcome, _ = verdict(row, [record("610415565123", 12500, doctype=INFLOW_DOCTYPE, name="PI-1")])
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("received on Project Inflow PI-1", outcome.note)


NARRATION_TWO_REFS = "RTGS/ICICR42026030500000002/UTIB0000468/BULD67453750/600219693408"


class TestGrouping(unittest.TestCase):
    def test_one_agreeing_record_skips_even_beside_a_disagreeing_one(self):
        row = Row(amount=Decimal("1000"), remarks=IMPS)
        outcome, group = verdict(row, [record("610415565123", 1000, name="ONE"), record("610415565123", 500, name="TWO")])
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertEqual([t.name for t in group.targets], ["ONE"])

    def test_the_amount_window_is_five_rupees_inclusive(self):
        row = Row(amount=Decimal("1000"), remarks=IMPS)
        self.assertEqual(verdict(row, [record("610415565123", "1005")])[0].status, ROW_SKIPPED)
        self.assertEqual(verdict(row, [record("610415565123", "1005.01")])[0].status, ROW_MISMATCHED)

    def test_a_same_reference_group_that_sums_to_the_row_skips(self):
        row = Row(amount=Decimal("1000"), remarks=IMPS)
        outcome, group = verdict(row, [record("610415565123", 600, name="A"), record("610415565123", 400, name="B")])
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertEqual(sorted(t.name for t in group.targets), ["A", "B"])

    def test_a_same_reference_group_is_preferred_over_all_hits(self):
        # All three hits also sum inside the window (1,003), so only the precedence picks A + B.
        row = Row(amount=Decimal("1000"), remarks=NARRATION_TWO_REFS)
        records = [
            record("ICICR42026030500000002", 600, name="A"),
            record("ICICR42026030500000002", 400, name="B"),
            record("600219693408", 3, name="C"),
        ]
        outcome, group = verdict(row, records)
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertEqual(sorted(t.name for t in group.targets), ["A", "B"])

    def test_all_hits_with_different_references_that_sum_to_the_row_skip(self):
        row = Row(amount=Decimal("1000"), remarks=NARRATION_TWO_REFS)
        records = [record("ICICR42026030500000002", 700, name="A"), record("600219693408", 300, name="B")]
        outcome, group = verdict(row, records)
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertEqual(sorted(t.name for t in group.targets), ["A", "B"])

    def test_nothing_agreeing_is_mismatched_naming_every_record_and_its_ledger(self):
        row = Row(amount=Decimal("1000"), remarks=NARRATION_TWO_REFS)
        records = [record("ICICR42026030500000002", 700, name="PAY-A"), record("600219693408", 900, name="PAY-B")]
        outcome, _ = verdict(row, records)
        self.assertEqual(outcome.status, ROW_MISMATCHED)
        self.assertIn("Project Payments PAY-A, PAY-B", outcome.note)

    def test_no_hits_is_no_group(self):
        self.assertIsNone(pick_recorded_group(Row(amount=Decimal("1000"), remarks=IMPS), ()))

    def test_the_pick_is_the_same_whatever_order_the_pool_arrives_in(self):
        row = Row(amount=Decimal("1000"), remarks=IMPS)
        records = [record("610415565123", 1000, name=n) for n in ("Z", "M", "A")]
        first = pick_recorded_group(row, find_hits(row, records))
        second = pick_recorded_group(row, find_hits(row, list(reversed(records))))
        self.assertEqual(first.targets, second.targets)

    def test_a_mismatched_note_lists_its_records_in_a_stable_order(self):
        row = Row(amount=Decimal("1000"), remarks=IMPS)
        records = [record("610415565123", 9000, name=n) for n in ("PAY-Z", "PAY-A", "PAY-M")]
        outcome, _ = verdict(row, records)
        self.assertIn("Project Payments PAY-A, PAY-M, PAY-Z", outcome.note)

    def test_closest_amount_then_nearest_date_decides_between_agreeing_records(self):
        row = Row(amount=Decimal("1000"), remarks=IMPS)
        records = [
            record("610415565123", 1004, name="FAR-AMOUNT"),
            record("610415565123", 1001, name="LATE", on=ROW_DATE.date() + timedelta(days=9)),
            record("610415565123", 999, name="NEAR", on=ROW_DATE.date() + timedelta(days=2)),
        ]
        self.assertEqual([t.name for t in verdict(row, records)[1].targets], ["NEAR"])


class TestOneRecordJustifiesOneLine(unittest.TestCase):
    """#1258: a record already accounting for one statement line cannot skip a DIFFERENT line."""

    def test_a_record_another_line_skipped_on_cannot_skip_this_line(self):
        row = Row(amount=Decimal("12500"), remarks=IMPS)
        rec = record("610415565123", 12500, name="PAY-1")
        outcome, group = verdict(row, [rec], [claim(rec, batch="OIB-26-000007")])
        self.assertEqual(outcome.status, ROW_MISMATCHED)
        self.assertIn("Project Payment PAY-1", outcome.note)
        self.assertIn("OIB-26-000007", outcome.note)
        self.assertIn("skipped", outcome.note)
        # The row still links the record its note names.
        self.assertEqual([t.name for t in group.targets], ["PAY-1"])

    def test_a_record_an_import_row_settled_or_created_cannot_skip_this_line(self):
        row = Row(amount=Decimal("50000"), remarks=IMPS, direction="Credit")
        rec = record("610415565123", 50000, doctype=INFLOW_DOCTYPE, name="PI-1")
        outcome, _ = verdict(row, [rec], [claim(rec, batch="OIB-26-000003", settled=True)])
        self.assertEqual(outcome.status, ROW_MISMATCHED)
        self.assertIn("Project Inflow PI-1", outcome.note)
        self.assertIn("recorded from", outcome.note)
        self.assertIn("OIB-26-000003", outcome.note)
        self.assertIn("receipt", outcome.note)

    def test_a_line_is_never_blocked_by_its_own_claim(self):
        row = Row(amount=Decimal("12500"), remarks=IMPS, name="ROW-THIS")
        rec = record("610415565123", 12500, name="PAY-1")
        outcome, _ = verdict(row, [rec], [claim(rec, row="ROW-THIS")])
        self.assertEqual(outcome.status, ROW_SKIPPED)

    def test_an_unused_twin_record_still_skips_the_line(self):
        row = Row(amount=Decimal("12500"), remarks=IMPS)
        used = record("610415565123", 12500, name="PAY-A")
        free = record("610415565123", 12500, name="PAY-B")
        outcome, group = verdict(row, [used, free], [claim(used)])
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertEqual([t.name for t in group.targets], ["PAY-B"])

    def test_a_group_is_blocked_when_one_member_is_used(self):
        row = Row(amount=Decimal("1000"), remarks=IMPS)
        a = record("610415565123", 600, name="PAY-A")
        b = record("610415565123", 400, name="PAY-B")
        outcome, _ = verdict(row, [a, b], [claim(b)])
        self.assertEqual(outcome.status, ROW_MISMATCHED)
        self.assertIn("Project Payment PAY-B already accounts", outcome.note)

    def test_an_amount_off_hit_reads_the_delta_note_whether_or_not_it_is_used(self):
        row = Row(amount=Decimal("20000"), remarks=IMPS)
        rec = record("610415565123", 20500, name="PAY-OFF")
        plain, _ = verdict(row, [rec])
        used, _ = verdict(row, [rec], [claim(rec)])
        self.assertEqual(used, plain)

    def test_a_claim_on_a_record_the_line_did_not_hit_changes_nothing(self):
        row = Row(amount=Decimal("12500"), remarks=IMPS)
        rec = record("610415565123", 12500, name="PAY-1")
        elsewhere = record("999999999999", 12500, name="PAY-ELSEWHERE")
        self.assertEqual(verdict(row, [rec], [claim(elsewhere)]), verdict(row, [rec]))

    def test_unclaimed_records_that_add_up_win_over_a_claimed_single_record(self):
        # Without the claim the single 1,000 record would be picked; with it, the two unused
        # records that sum to the line justify the skip instead -- never the used one.
        row = Row(amount=Decimal("1000"), remarks=IMPS)
        used = record("610415565123", 1000, name="PAY-USED")
        a = record("610415565123", 600, name="PAY-A")
        b = record("610415565123", 400, name="PAY-B")
        outcome, group = verdict(row, [used, a, b], [claim(used)])
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertEqual(sorted(t.name for t in group.targets), ["PAY-A", "PAY-B"])

    def test_only_a_skip_on_an_unblocked_group_has_a_basis(self):
        row = Row(amount=Decimal("12500"), remarks=IMPS)
        rec = record("610415565123", 12500, name="PAY-1")
        _, free = verdict(row, [rec])
        _, blocked = verdict(row, [rec], [claim(rec)])
        self.assertEqual([t.name for t in skip_basis(row, free, skipped=True)], ["PAY-1"])
        self.assertEqual(skip_basis(row, blocked, skipped=False), ())
        self.assertEqual(skip_basis(row, None, skipped=True), ())

        class Failed(Row):
            @property
            def is_success(self):
                return False

        failed = Failed(amount=Decimal("12500"), remarks=IMPS)
        self.assertEqual(skip_basis(failed, free, skipped=True), ())

    def test_the_stored_basis_round_trips_and_tolerates_junk(self):
        recs = (record("610415565123", 600, name="A"), record("610415565123", 400, name="B"))
        stored = encode_basis(recs)
        self.assertEqual(
            decode_basis(stored),
            [{"target_doctype": PAYMENT_DOCTYPE, "target_name": "A"},
             {"target_doctype": PAYMENT_DOCTYPE, "target_name": "B"}],
        )
        self.assertEqual(decode_basis(json.loads(stored)), decode_basis(stored))
        self.assertIsNone(encode_basis(()))
        for junk in (None, "", "not json", "{}", '[{"target_doctype": "X"}]', 5):
            self.assertEqual(decode_basis(junk), [], junk)

    def test_a_skip_claims_every_record_of_its_group(self):
        row = Row(amount=Decimal("1000"), remarks=IMPS, name="ROW-SPLIT")
        _, group = verdict(row, [record("610415565123", 600, name="A"), record("610415565123", 400, name="B")])
        claims = claims_of_skip(row, "OIB-9", group)
        self.assertEqual(
            sorted((c.name, c.import_row, c.import_batch, c.settled) for c in claims),
            [("A", "ROW-SPLIT", "OIB-9", False), ("B", "ROW-SPLIT", "OIB-9", False)],
        )


class TestPurity(unittest.TestCase):
    """Read through the AST, for the reason `test_bank_exclusions.TestPurity` records."""

    @staticmethod
    def _imported_module_names() -> set[str]:
        from nirmaan_stack.services.outflow_import import contains_guard

        tree = ast.parse(Path(contains_guard.__file__).read_text())
        names: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                names.add(node.module)
        return names

    def test_it_imports_no_frappe(self):
        for name in self._imported_module_names():
            self.assertNotIn("frappe", name)

    def test_its_package_imports_are_the_named_pure_leaves(self):
        package = {n for n in self._imported_module_names() if n.startswith("nirmaan_stack")}
        self.assertLessEqual(
            package,
            {
                "nirmaan_stack.services.outflow_import.amounts",
                "nirmaan_stack.services.outflow_import.ledgers",
                "nirmaan_stack.services.outflow_import.normalize",
            },
        )

    def test_every_package_leaf_it_imports_is_itself_bench_free(self):
        import inspect

        from nirmaan_stack.services.outflow_import import amounts, ledgers, normalize

        for leaf in (amounts, ledgers, normalize):
            for line in inspect.getsource(leaf).splitlines():
                if line.strip().startswith(("import ", "from ")):
                    self.assertNotIn("frappe", line, leaf.__name__)


if __name__ == "__main__":
    unittest.main()
