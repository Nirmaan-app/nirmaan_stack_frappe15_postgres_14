# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The line-scoped match run, `review.match_line` (#1272, unreconcile/unskip prep).

Unskip must re-check ONE line straight away. `match_line` is that entry point, and the property that
matters is PARITY: on the same database, a line matched on its own ends in exactly the state a full
`match_batch` would leave it in -- status, note, suggestion and duplicate basis.

HOW PARITY IS MEASURED. Each case first runs the whole batch (so every sibling sits where a real
import leaves it), then re-opens the line and runs `match_line`, then re-opens it again and runs
`match_batch`, and compares the two outcomes field by field. Re-opening is what unskip does before
it asks, so the comparison is the real one rather than a convenient one.

⚠️ FOUR CASES GENUINELY DIFFER, AND EACH IS PINNED HERE RATHER THAN LEFT TO BE FOUND. A one-line run
never re-decides a sibling: it cannot take a record a sibling currently holds (the claim contest,
an Option B pick, an ICICI claim), and it cannot un-pair a stack its siblings already paired. See the domain doc's #1272 section.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every record is created by the fixtures below and purged by
`OutflowReviewFixture.tearDownClass`.
"""

from datetime import timedelta

import frappe

from nirmaan_stack.api.outflow_import.duplicate_preview import build_preview
from nirmaan_stack.api.outflow_import.review import (
    BATCH_DOCTYPE,
    ROW_DOCTYPE,
    match_batch,
    match_line,
)
from nirmaan_stack.api.outflow_import.test_review import (
    _GUARD_DAY,
    OutflowReviewFixture,
    _random_reference,
    _stage_icici_statement,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_account
from nirmaan_stack.api.outflow_import.test_settle_payment import SETTLEABLE
from nirmaan_stack.services.outflow_import.sources import source_runs_the_matcher
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
    several_found_note,
)

#: Every field `_persist_row_outcome` and the four passes write. Comparing all of them, not just
#: the four the ticket names, is what makes "the same outcome" mean the same row.
OUTCOME_FIELDS = (
    "row_status",
    "outcome_note",
    "resolved_vendor",
    "suggested_doctype",
    "suggested_name",
    "auto_matched",
    "match_basis",
    "suggestion_rule",
    "duplicate_basis",
)


def _outcome(name: str) -> dict:
    return frappe.db.get_value(ROW_DOCTYPE, name, list(OUTCOME_FIELDS), as_dict=True)


def _reopen(name: str) -> None:
    """Put a line back where unskip will put it: pending, with no outcome of its own."""
    frappe.db.set_value(
        ROW_DOCTYPE,
        name,
        {
            "row_status": ROW_PENDING_MATCH,
            "outcome_note": None,
            "resolved_vendor": None,
            "suggested_doctype": None,
            "suggested_name": None,
            "auto_matched": 0,
            "match_basis": None,
            "suggestion_rule": None,
            "duplicate_basis": None,
        },
        update_modified=False,
    )
    frappe.db.commit()


class _ParityMixin:
    def _line_then_batch(self, name: str, batch: str) -> tuple[dict, dict]:
        """`(outcome of match_line, outcome of match_batch)` for one line, from the same start."""
        _reopen(name)
        match_line(name)
        frappe.db.commit()
        line = _outcome(name)

        _reopen(name)
        match_batch(batch)
        return line, _outcome(name)

    def assertLineMatchesBatch(self, name: str, batch: str) -> dict:
        line, batch_outcome = self._line_then_batch(name, batch)
        self.assertEqual(line, batch_outcome)
        return line


class TestGatewayLinesMatchAsTheBatchDoes(_ParityMixin, OutflowReviewFixture):
    """The Cashfree fixture's own lines: one of each outcome the per-row loop produces."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)

    def _name(self, suffix):
        return self._rows_by_transfer_suffix()[suffix]["name"]

    def test_an_exact_reference_already_paid_line_is_skipped_again(self):
        outcome = self.assertLineMatchesBatch(self._name("0003"), self.batch.name)
        self.assertEqual(outcome.row_status, ROW_SKIPPED)
        self.assertIn(self.pay_already, outcome.outcome_note)

    def test_a_single_approved_record_is_matched_and_suggested(self):
        outcome = self.assertLineMatchesBatch(self._name("0001"), self.batch.name)
        self.assertEqual(outcome.row_status, ROW_MATCHED)
        self.assertEqual(outcome.suggested_name, self.pay_clean)

    def test_a_line_with_no_candidate_is_not_matched(self):
        outcome = self.assertLineMatchesBatch(self._name("0009"), self.batch.name)
        self.assertEqual(outcome.row_status, ROW_MISMATCHED)
        self.assertFalse(outcome.suggested_name)

    def test_a_fan_out_stays_matched_with_no_single_suggestion(self):
        outcome = self.assertLineMatchesBatch(self._name("0004"), self.batch.name)
        self.assertEqual(outcome.row_status, ROW_MATCHED)
        self.assertIn(self.pay_fan_a, outcome.outcome_note)

    def test_the_return_names_the_line_and_its_new_state(self):
        name = self._name("0001")
        _reopen(name)
        result = match_line(name)
        frappe.db.commit()
        self.assertEqual(result["run"]["batch"], self.batch.name)
        self.assertEqual(result["row"], name)
        self.assertEqual(result["row_status"], ROW_MATCHED)
        self.assertEqual(result["suggested_name"], self.pay_clean)
        self.assertTrue(result["outcome_note"])

    def test_the_import_rollup_is_refreshed(self):
        name = self._name("0009")
        _reopen(name)
        self.assertGreater(
            frappe.db.count(ROW_DOCTYPE, {"import_batch": self.batch.name, "row_status": ROW_PENDING_MATCH}),
            0,
        )
        match_line(name)
        frappe.db.commit()
        batch = frappe.get_doc(BATCH_DOCTYPE, self.batch.name)
        pending = frappe.db.count(
            ROW_DOCTYPE, {"import_batch": self.batch.name, "row_status": ROW_PENDING_MATCH}
        )
        self.assertEqual(batch.total_rows, batch.reviewed_rows + pending)
        self.assertEqual(pending, 0)


class TestFrozenLinesAreNeverTouched(OutflowReviewFixture):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)

    def test_a_settled_skipped_or_partly_allocated_line_is_refused_and_unchanged(self):
        name = self._rows_by_transfer_suffix()["0009"]["name"]
        try:
            for status in (ROW_SETTLED, ROW_SKIPPED, ROW_PARTIALLY_ALLOCATED):
                frappe.db.set_value(
                    ROW_DOCTYPE, name,
                    {"row_status": status, "outcome_note": "A person decided this."},
                    update_modified=False,
                )
                frappe.db.commit()
                before = _outcome(name)
                with self.assertRaises(frappe.ValidationError, msg=status):
                    match_line(name)
                frappe.db.rollback()
                self.assertEqual(_outcome(name), before, status)
        finally:
            _reopen(name)


class TestCashbookIsNeverMatched(OutflowReviewFixture):
    """A Cashbook line's stored plan (`suggested_doctype`) is what its job writes from. A match run
    clears every suggestion it does not re-find, so reaching one would erase the plan."""

    PLAN = "Project Expenses"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.db.set_value(BATCH_DOCTYPE, cls.batch.name, "source", "Cashbook", update_modified=False)
        cls.line = frappe.db.get_value(
            ROW_DOCTYPE, {"import_batch": cls.batch.name, "row_status": ROW_PENDING_MATCH}, "name"
        )
        frappe.db.set_value(
            ROW_DOCTYPE, cls.line, {"source": "Cashbook", "suggested_doctype": cls.PLAN},
            update_modified=False,
        )
        frappe.db.commit()

    def test_the_predicate_names_cashbook_and_nothing_else(self):
        self.assertFalse(source_runs_the_matcher("Cashbook"))
        self.assertFalse(source_runs_the_matcher(" Cashbook "))
        for source in ("Cashfree", "ICICI Bank Statement", "", None):
            self.assertTrue(source_runs_the_matcher(source), source)

    def test_match_line_refuses_a_cashbook_line_and_writes_nothing(self):
        before = _outcome(self.line)
        with self.assertRaises(frappe.ValidationError):
            match_line(self.line)
        frappe.db.rollback()
        self.assertEqual(_outcome(self.line), before)
        self.assertEqual(before.suggested_doctype, self.PLAN)

    def test_match_batch_on_a_cashbook_import_writes_nothing(self):
        before = {
            r["name"]: r
            for r in frappe.get_all(
                ROW_DOCTYPE, filters={"import_batch": self.batch.name}, fields=["name", *OUTCOME_FIELDS]
            )
        }
        result = match_batch(self.batch.name)
        after = {
            r["name"]: r
            for r in frappe.get_all(
                ROW_DOCTYPE, filters={"import_batch": self.batch.name}, fields=["name", *OUTCOME_FIELDS]
            )
        }
        self.assertEqual(after, before)
        self.assertEqual(result["matched_rows"], 0)
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, self.line, "suggested_doctype"), self.PLAN)

    def test_the_duplicate_preview_reports_nothing_for_a_cashbook_import(self):
        report = build_preview(batch=self.batch.name)
        self.assertEqual(report["totals"]["skip"] + report["totals"]["mismatched"], 0)


class TestBankStatementLinesMatchAsTheBatchDoes(_ParityMixin, OutflowReviewFixture):
    """The ICICI contains-guard path, including the one-record-one-line claim (#1258)."""

    @classmethod
    def _plant_targets(cls):
        cls.refs = {k: _random_reference() for k in ("pay", "twin", "none")}
        prefix = f"T1272{frappe.generate_hash(length=6).upper()}"
        cls.tids = {k: f"{prefix}{k.upper()}" for k in ("pay", "twin1", "twin2", "none")}
        r = cls.refs
        lines = [
            {"tid": cls.tids["pay"], "narration": f"MMT/IMPS/{r['pay']}/TESTPAYEE/SBIN0017034",
             "amount": 12500, "credit": False, "cheque": "", "day": _GUARD_DAY},
            {"tid": cls.tids["twin1"], "narration": f"MMT/IMPS/{r['twin']}/PAYEE ONE",
             "amount": 11000, "credit": False, "cheque": "", "day": _GUARD_DAY},
            {"tid": cls.tids["twin2"], "narration": f"MMT/IMPS/{r['twin']}/PAYEE TWO",
             "amount": 11000, "credit": False, "cheque": "", "day": _GUARD_DAY + timedelta(minutes=1)},
            {"tid": cls.tids["none"], "narration": f"MMT/IMPS/{r['none']}/NOBODY",
             "amount": 4321, "credit": False, "cheque": "", "day": _GUARD_DAY},
        ]
        cls.icici = _stage_icici_statement(lines, "test-1272-icici.csv")
        cls.batches.append(cls.icici.name)
        day = _GUARD_DAY.date()
        cls.rec_pay = cls._insert_payment_row(amount=12500, status="Paid", utr=r["pay"], payment_date=day)
        # ONE record under a reference two lines carry: only one of them may skip on it.
        cls.rec_twin = cls._insert_payment_row(amount=11000, status="Paid", utr=r["twin"], payment_date=day)
        frappe.db.commit()
        match_batch(cls.icici.name)

    def _name(self, key):
        return frappe.db.get_value(
            ROW_DOCTYPE, {"import_batch": self.icici.name, "transfer_id": self.tids[key]}, "name"
        )

    def test_the_precondition_one_twin_skipped_and_the_other_did_not(self):
        statuses = {k: _outcome(self._name(k)).row_status for k in ("twin1", "twin2")}
        self.assertEqual(sorted(statuses.values()), [ROW_MISMATCHED, ROW_SKIPPED])

    def test_a_contains_guard_skip_is_skipped_again_with_the_same_basis(self):
        outcome = self.assertLineMatchesBatch(self._name("pay"), self.icici.name)
        self.assertEqual(outcome.row_status, ROW_SKIPPED)
        self.assertIn(self.rec_pay, frappe.as_json(outcome.duplicate_basis))

    def test_a_line_whose_record_another_line_claims_is_left_not_matched(self):
        loser = next(
            k for k in ("twin1", "twin2") if _outcome(self._name(k)).row_status == ROW_MISMATCHED
        )
        outcome = self.assertLineMatchesBatch(self._name(loser), self.icici.name)
        self.assertEqual(outcome.row_status, ROW_MISMATCHED)
        self.assertFalse(outcome.duplicate_basis)
        self.assertFalse(outcome.suggested_name)

    def test_a_line_with_no_recorded_money_is_not_matched_and_never_suggested(self):
        outcome = self.assertLineMatchesBatch(self._name("none"), self.icici.name)
        self.assertEqual(outcome.row_status, ROW_MISMATCHED)
        self.assertFalse(outcome.suggested_name)


class _ClaimFixture(OutflowReviewFixture):
    """Two transfers, different accounts, one approved payment both find (tier 2, via the remark)."""

    AMOUNT = 6641.29  # implausible in the live ledger
    ACCOUNTS = ("71000000001", "71000000002")
    PAYMENT_COUNT = 1

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.claim_project = f"TEST-OFP-{frappe.generate_hash(length=10)}"
        cls.claim_project_name = f"Quorvane{frappe.generate_hash(length=6)}"
        frappe.db.sql(
            """
            INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner, docstatus, idx,
                                       project_name)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s)
            """,
            (cls.claim_project, "Administrator", "Administrator", cls.claim_project_name),
        )
        cls.early = cls._claim_row("0003", cls.ACCOUNTS[0], "2026-01-02 09:00:00")
        cls.late = cls._claim_row("0004", cls.ACCOUNTS[1], "2026-01-03 09:00:00")
        cls.planted = sorted(
            cls._insert_payment_row(
                amount=cls.AMOUNT, status=SETTLEABLE, utr="PO/CLAIM/01272/25-26",
                payment_date=None, project=cls.claim_project,
            )
            for _ in range(cls.PAYMENT_COUNT)
        )
        cls.payment = cls.planted[0]
        frappe.db.commit()

    @classmethod
    def _claim_row(cls, suffix, account, added_on) -> str:
        name = frappe.db.get_value(
            ROW_DOCTYPE,
            {"import_batch": cls.batch.name, "transfer_id": cls._row(suffix).transfer_id},
            "name",
        )
        frappe.db.set_value(
            ROW_DOCTYPE,
            name,
            {
                "bank_account": account or None,
                "normalized_account": normalize_account(account) if account else None,
                "ifsc": "TEST0007777",
                "amount": cls.AMOUNT,
                "remarks": f"{cls.claim_project_name} miscellaneous services",
                "added_on": added_on,
                "bank_reference_no": None,
                "normalized_reference": None,
            },
            update_modified=False,
        )
        return name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("Projects", {"name": cls.claim_project})
        super().tearDownClass()


class TestAClaimContestMatchesAsTheBatchDoes(_ParityMixin, _ClaimFixture):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)

    def test_the_precondition_the_earlier_transfer_holds_the_record(self):
        self.assertEqual(_outcome(self.early).suggested_name, self.payment)

    def test_the_later_transfer_loses_the_contest_either_way(self):
        outcome = self.assertLineMatchesBatch(self.late, self.batch.name)
        # The loser keeps `Matched` (it did find an approved record) and loses only the pick.
        self.assertEqual(outcome.row_status, ROW_MATCHED)
        self.assertFalse(outcome.suggested_name)
        self.assertIn(self.payment, outcome.outcome_note)

    def test_the_earlier_transfer_keeps_the_record_either_way(self):
        outcome = self.assertLineMatchesBatch(self.early, self.batch.name)
        self.assertEqual(outcome.suggested_name, self.payment)


class TestAOneLineRunNeverTakesARecordFromASibling(_ClaimFixture):
    """⚠️ DIFFERENCE 1, PINNED. The earlier transfer was skipped while the later one took the record.

    A batch run re-derives BOTH and hands the record to the earlier transfer, stripping the later
    one's pick. A one-line run of the earlier transfer may not strip a sibling it did not re-derive
    (`Claim.releasable`), so the earlier transfer gives way instead. Nothing is wrong either way --
    a record is still claimed once -- but the two runs leave the pick on different lines.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.db.set_value(ROW_DOCTYPE, cls.early, "row_status", ROW_SKIPPED, update_modified=False)
        frappe.db.commit()
        match_batch(cls.batch.name)
        # Captured here: the test below changes it, and tests run in name order.
        cls.late_pick_before = _outcome(cls.late).suggested_name

    def test_the_precondition_the_later_transfer_holds_the_record(self):
        self.assertEqual(self.late_pick_before, self.payment)

    def test_line_scoped_the_sibling_keeps_it_and_batch_scoped_the_earlier_line_takes_it(self):
        _reopen(self.early)
        match_line(self.early)
        frappe.db.commit()
        self.assertFalse(_outcome(self.early).suggested_name)
        self.assertIn(self.payment, _outcome(self.early).outcome_note)
        self.assertEqual(_outcome(self.late).suggested_name, self.payment)

        match_batch(self.batch.name)
        self.assertEqual(_outcome(self.early).suggested_name, self.payment)
        self.assertFalse(_outcome(self.late).suggested_name)


class TestAOneLineRunNeverTakesATwinASiblingPicked(_ClaimFixture):
    """⚠️ DIFFERENCE 4, PINNED (Option B). Two transfers with no account, two identical approved
    payments on the remark's project, so M3 picks the first FREE record by name. The earlier transfer
    was skipped, so the later one picked the first record.

    A batch run clears both picks and re-picks in date order: the earlier transfer takes the first
    record, the later one the second. A one-line run reads the later transfer's stored pick as
    claimed, so the returning line takes the second record and its sibling keeps the first.
    """

    ACCOUNTS = ("", "")
    PAYMENT_COUNT = 2

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.db.set_value(ROW_DOCTYPE, cls.early, "row_status", ROW_SKIPPED, update_modified=False)
        frappe.db.commit()
        match_batch(cls.batch.name)
        # Captured here: the test below changes it, and tests run in name order.
        cls.late_before = _outcome(cls.late)

    def test_the_precondition_the_later_transfer_picked_the_first_record_by_rule(self):
        self.assertEqual(self.late_before.suggested_name, self.planted[0])
        self.assertTrue(self.late_before.suggestion_rule)
        self.assertNotEqual(self.late_before.suggestion_rule, "sole")

    def test_line_scoped_the_returning_line_takes_the_other_twin(self):
        _reopen(self.early)
        match_line(self.early)
        frappe.db.commit()
        self.assertEqual(_outcome(self.early).suggested_name, self.planted[1])
        self.assertEqual(_outcome(self.late).suggested_name, self.planted[0])

        match_batch(self.batch.name)
        self.assertEqual(_outcome(self.early).suggested_name, self.planted[0])
        self.assertEqual(_outcome(self.late).suggested_name, self.planted[1])


class TestAOneLineRunNeverUnpairsAStack(OutflowReviewFixture):
    """⚠️ DIFFERENCE 2, PINNED. Two transfers were paired against two identical payments while a third
    identical transfer was skipped. It comes back.

    A batch run sees three transfers against two records -- unbalanced -- so it pairs NOTHING, takes
    both siblings' picks away and writes the surplus note on all three. A one-line run leaves the two
    pairings standing: both records are already spoken for, so the returning line finds nothing free
    and reads as "several found, none chosen".
    """

    AMOUNT = 7747.43  # implausible in the live ledger, and far from every other class's amounts

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.account = "98765432172"
        cls.vendor = f"TEST-OFV-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """
            INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner, docstatus, idx,
                                      vendor_name, account_number, ifsc)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s)
            """,
            (cls.vendor, "Administrator", "Administrator", "Testvendor Linescope Ltd",
             cls.account, "TEST0009172"),
        )
        cls.stack_rows = [cls._stack_row(s) for s in ("0003", "0004", "0005")]
        cls.stack_payments = []
        for _ in range(2):
            name = cls._insert_payment_row(
                amount=cls.AMOUNT, status=SETTLEABLE, utr="PO/STACK/01272/25-26",
                payment_date=None, project=cls.project,
            )
            frappe.db.set_value("Project Payments", name, "vendor", cls.vendor, update_modified=False)
            cls.stack_payments.append(name)
        cls.returning = cls.stack_rows[2]
        cls.siblings = cls.stack_rows[:2]
        frappe.db.set_value(ROW_DOCTYPE, cls.returning, "row_status", ROW_SKIPPED, update_modified=False)
        frappe.db.commit()
        match_batch(cls.batch.name)
        # Captured here: the test below changes it, and tests run in name order.
        cls.sibling_picks_before = {_outcome(n).suggested_name for n in cls.siblings}

    @classmethod
    def _stack_row(cls, suffix) -> str:
        name = frappe.db.get_value(
            ROW_DOCTYPE,
            {"import_batch": cls.batch.name, "transfer_id": cls._row(suffix).transfer_id},
            "name",
        )
        frappe.db.set_value(
            ROW_DOCTYPE,
            name,
            {
                "bank_account": cls.account,
                "normalized_account": normalize_account(cls.account),
                "ifsc": "TEST0009172",
                "amount": cls.AMOUNT,
                "bank_reference_no": None,
                "normalized_reference": None,
            },
            update_modified=False,
        )
        return name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("Vendors", {"name": cls.vendor})
        super().tearDownClass()

    def test_the_precondition_the_two_siblings_are_paired(self):
        self.assertEqual(self.sibling_picks_before, set(self.stack_payments))

    def test_line_scoped_the_pairs_stand_and_batch_scoped_nothing_pairs(self):
        _reopen(self.returning)
        match_line(self.returning)
        frappe.db.commit()
        returning = _outcome(self.returning)
        self.assertEqual(returning.row_status, ROW_MISMATCHED)
        self.assertFalse(returning.suggested_name)
        self.assertEqual(returning.outcome_note, several_found_note(2))
        self.assertEqual({_outcome(n).suggested_name for n in self.siblings}, set(self.stack_payments))

        match_batch(self.batch.name)
        batch_notes = set()
        for name in self.stack_rows:
            outcome = _outcome(name)
            self.assertFalse(outcome.suggested_name, name)
            self.assertEqual(outcome.row_status, ROW_MISMATCHED, name)
            batch_notes.add(outcome.outcome_note)
        self.assertEqual(len(batch_notes), 1, "every member carries the one surplus note")
        self.assertNotEqual(batch_notes.pop(), several_found_note(2))


class TestAOneLineRunNeverLetsAnOpenSiblingClaimFirst(OutflowReviewFixture):
    """⚠️ DIFFERENCE 3, PINNED. Two ICICI lines carry the same reference; the later one was skipped by
    hand before the money was recorded. Then ONE Paid record appears, and the later line comes back.

    A batch run re-checks the EARLIER line too, and it claims the record first (#1258): the returning
    line stays Not-Matched. A one-line run does not re-check the earlier line, so the returning line
    takes the record and skips. Still one record, one line -- on a different line.
    """

    @classmethod
    def _plant_targets(cls):
        cls.ref = _random_reference()
        prefix = f"T1272C{frappe.generate_hash(length=6).upper()}"
        cls.tids = {k: f"{prefix}{k.upper()}" for k in ("early", "late")}
        lines = [
            {"tid": cls.tids["early"], "narration": f"MMT/IMPS/{cls.ref}/PAYEE ONE",
             "amount": 13579, "credit": False, "cheque": "", "day": _GUARD_DAY},
            {"tid": cls.tids["late"], "narration": f"MMT/IMPS/{cls.ref}/PAYEE TWO",
             "amount": 13579, "credit": False, "cheque": "", "day": _GUARD_DAY + timedelta(minutes=1)},
        ]
        cls.icici = _stage_icici_statement(lines, "test-1272-icici-claim.csv")
        cls.batches.append(cls.icici.name)
        frappe.db.commit()
        match_batch(cls.icici.name)
        cls.early = cls._line("early")
        cls.late = cls._line("late")
        cls.statuses_before_record = (_outcome(cls.early).row_status, _outcome(cls.late).row_status)
        frappe.db.set_value(ROW_DOCTYPE, cls.late, "row_status", ROW_SKIPPED, update_modified=False)
        cls.record = cls._insert_payment_row(
            amount=13579, status="Paid", utr=cls.ref, payment_date=_GUARD_DAY.date()
        )
        frappe.db.commit()

    @classmethod
    def _line(cls, key):
        return frappe.db.get_value(
            ROW_DOCTYPE, {"import_batch": cls.icici.name, "transfer_id": cls.tids[key]}, "name"
        )

    def test_the_precondition_neither_line_skipped_before_the_record_existed(self):
        self.assertEqual(self.statuses_before_record, (ROW_MISMATCHED, ROW_MISMATCHED))

    def test_line_scoped_the_returning_line_skips_and_batch_scoped_the_earlier_one_does(self):
        _reopen(self.late)
        match_line(self.late)
        frappe.db.commit()
        self.assertEqual(_outcome(self.late).row_status, ROW_SKIPPED)
        self.assertIn(self.record, frappe.as_json(_outcome(self.late).duplicate_basis))
        self.assertEqual(_outcome(self.early).row_status, ROW_MISMATCHED)

        _reopen(self.late)
        match_batch(self.icici.name)
        self.assertEqual(_outcome(self.early).row_status, ROW_SKIPPED)
        self.assertEqual(_outcome(self.late).row_status, ROW_MISMATCHED)
        self.assertFalse(_outcome(self.late).duplicate_basis)
