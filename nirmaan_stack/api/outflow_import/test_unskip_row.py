# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Unskip a hand-skipped line, and re-check it straight away (#1274, parent #1270, ADR-0022).

What is pinned, all through the whitelisted `review.unskip_row`:

  * refused for a plain Accountant, a locked kind, a Cashbook line not skipped by hand and a line that
    is not Skipped --
    and nothing is written when it is;
  * a reason is required;
  * the re-check lands the line Not-Matched (no recorded money), Matched with the suggestion (one
    approved record), or Skipped again as SYSTEM (money recorded since), and the return carries the
    status, note and suggestion the screen's notice reads;
  * the duplicate claim basis is cleared, so a line the old skip blocked is judged without it;
  * the import rollup follows (a Completed import reopens);
  * a Version row and a comment carrying the reason are written.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every batch, row, payment, Version and Comment is created here
and purged; nothing else is touched.
"""

from datetime import timedelta

import frappe

from nirmaan_stack.api.outflow_import.review import (
    UNSKIP_REASON_REQUIRED,
    match_batch,
    match_line,
    skip_row,
    unskip_row,
)
from nirmaan_stack.api.outflow_import.test_review import (
    _GUARD_DAY,
    OutflowReviewFixture,
    _random_reference,
    _stage_icici_statement,
)
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, SkipFixture
from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.services.outflow_import.skip_origin import (
    UNSKIP_REFUSED_CASHBOOK,
    UNSKIP_REFUSED_NOT_SKIPPED,
    UNSKIP_LOCKED_KINDS,
    UNSKIP_REFUSED_NO_KIND,
)
from nirmaan_stack.services.outflow_import.status import (
    BATCH_COMPLETED,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_SKIPPED,
    SKIP_ORIGIN_MANUAL,
    SKIP_ORIGIN_SYSTEM,
)

REASON = "It was a site labour advance after all"

_STORED = (
    "row_status", "skip_origin", "skip_reason", "outcome_note", "decided_by", "decided_at",
    "suggested_name", "duplicate_basis", "skip_kind",
)


def _stored(row):
    return frappe.db.get_value(ROW_DOCTYPE, row, list(_STORED), as_dict=True)


def _purge_audit(rows):
    if rows:
        frappe.db.delete("Version", {"ref_doctype": ROW_DOCTYPE, "docname": ["in", list(rows)]})
        frappe.db.delete(
            "Comment", {"reference_doctype": ROW_DOCTYPE, "reference_name": ["in", list(rows)]}
        )
        frappe.db.commit()


def _hand_skip(row):
    """A line a person skipped. Written directly, so the fixture does not depend on `skip_row`'s state
    rules -- a line that is ALREADY Skipped cannot be skipped again by the endpoint."""
    frappe.db.set_value(
        ROW_DOCTYPE,
        row,
        {
            "row_status": ROW_SKIPPED,
            "skip_origin": SKIP_ORIGIN_MANUAL,
            "skip_kind": "Skipped by hand",
            "skip_reason": "not ours",
            "outcome_note": "not ours",
            "decided_by": "Administrator",
            "decided_at": frappe.utils.now_datetime(),
        },
        update_modified=False,
    )
    frappe.db.commit()


class TestUnskipRefusals(SkipFixture):
    def _assert_refused(self, row, sentence):
        before = _stored(row)
        with self.assertRaises(frappe.ValidationError) as caught:
            unskip_row(row, REASON)
        self.assertIn(sentence, str(caught.exception))
        self.assertEqual(_stored(row), before)

    def test_a_plain_accountant_is_refused_and_nothing_is_written(self):
        row = self._line(
            status=ROW_SKIPPED, skip_origin=SKIP_ORIGIN_MANUAL, skip_kind="Skipped by hand", amount=8231.77
        )
        before = _stored(row)
        frappe.set_user(self.users.make(ACCOUNTANT))
        with self.assertRaises(frappe.PermissionError):
            unskip_row(row, REASON)
        frappe.set_user("Administrator")
        self.assertEqual(_stored(row), before)

    def test_a_reason_is_required(self):
        row = self._line(
            status=ROW_SKIPPED, skip_origin=SKIP_ORIGIN_MANUAL, skip_kind="Skipped by hand", amount=8231.77
        )
        with self.assertRaises(frappe.ValidationError) as caught:
            unskip_row(row, "   ")
        self.assertIn(UNSKIP_REASON_REQUIRED, str(caught.exception))
        self.assertEqual(_stored(row).row_status, ROW_SKIPPED)

    def test_the_four_locked_kinds_are_refused_with_their_own_sentence(self):
        """Owner, 2026-09-17 (A1): these stay skipped. INVERTED from #1274's "a system skip is refused"."""
        for kind, sentence in UNSKIP_LOCKED_KINDS.items():
            with self.subTest(kind=kind):
                row = self._line(status=ROW_SKIPPED, skip_origin=SKIP_ORIGIN_SYSTEM, skip_kind=kind)
                self._assert_refused(row, sentence)

    def test_a_line_with_no_kind_is_refused(self):
        row = self._line(status=ROW_SKIPPED, skip_origin=SKIP_ORIGIN_SYSTEM, skip_kind="")
        self._assert_refused(row, UNSKIP_REFUSED_NO_KIND)

    def test_a_cashbook_line_not_skipped_by_hand_is_refused(self):
        """#1314 (owner Q4) NARROWS decision B1: only a Cashbook HAND skip comes back; every system kind
        stays locked. The hand-skip half is pinned in `test_cashbook_undo`."""
        for kind in ("Cashbook internal movement", "Outflow Already Recorded", "No amount"):
            with self.subTest(kind=kind):
                row = self._line(
                    status=ROW_SKIPPED, skip_origin=SKIP_ORIGIN_MANUAL, skip_kind=kind, source="Cashbook"
                )
                self._assert_refused(row, UNSKIP_REFUSED_CASHBOOK)

    def test_a_line_that_is_not_skipped_is_refused(self):
        self._assert_refused(self._line(status=ROW_MISMATCHED), UNSKIP_REFUSED_NOT_SKIPPED)


class TestUnskipASystemSkip(SkipFixture):
    """Owner, 2026-09-17: a system skip outside the locked kinds comes back, and is re-checked at once."""

    def test_a_bank_rule_exclusion_comes_back_as_work(self):
        # The re-check does not re-apply bank rules (they are decided at upload), so the line is open.
        row = self._line(
            status=ROW_SKIPPED,
            skip_origin=SKIP_ORIGIN_SYSTEM,
            skip_kind="Porter wallet top-up",
            skip_reason="Not spending -- this line is money moving inside the bank or between our own "
            "accounts. Excluded by bank-statement rule 'platform_porter'.",
            outcome_note=None,
            amount=8231.77,
        )
        result = unskip_row(row, REASON)
        stored = _stored(row)
        self.assertEqual(stored.row_status, ROW_MISMATCHED)
        self.assertEqual(result["status"], ROW_MISMATCHED)
        self.assertFalse(stored.skip_kind)
        self.assertFalse(stored.skip_origin)


class TestUnskipALineWithNothingRecorded(SkipFixture):
    """A one-line import: skip it by hand (the import reads Completed), then bring it back."""

    def test_it_lands_not_matched_and_the_import_reopens(self):
        row = self._line(amount=8231.77)
        batch = frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")
        skip_row(row, "not ours")
        self.assertEqual(frappe.db.get_value(BATCH_DOCTYPE, batch, "status"), BATCH_COMPLETED)

        result = unskip_row(row, f"  {REASON}  ")

        stored = _stored(row)
        self.assertEqual(stored.row_status, ROW_MISMATCHED)
        self.assertFalse(stored.skip_origin)
        self.assertFalse(stored.skip_kind)
        self.assertFalse(stored.skip_reason)
        self.assertFalse(stored.decided_by)
        self.assertIsNone(stored.decided_at)
        self.assertFalse(stored.suggested_name)
        self.assertNotEqual(stored.outcome_note, "not ours")

        self.assertEqual(result["row"], row)
        self.assertEqual(result["status"], ROW_MISMATCHED)
        self.assertEqual(result["outcome_note"], stored.outcome_note)
        self.assertFalse(result["suggested_name"])
        self.assertNotEqual(result["batch_status"], BATCH_COMPLETED)
        self.assertNotEqual(frappe.db.get_value(BATCH_DOCTYPE, batch, "status"), BATCH_COMPLETED)
        self.assertEqual(frappe.db.get_value(BATCH_DOCTYPE, batch, "skipped_rows"), 0)

    def test_it_writes_a_version_row_and_a_comment_carrying_the_reason(self):
        row = self._line(amount=8231.77)
        skip_row(row, "not ours")
        unskip_row(row, REASON)

        versions = frappe.get_all(
            "Version",
            filters={"ref_doctype": ROW_DOCTYPE, "docname": row},
            fields=["data"],
            order_by="creation asc",
        )
        # One for the skip, one for the unskip.
        self.assertEqual(len(versions), 2)
        self.assertIn("skip_origin", versions[-1]["data"])
        self.assertIn("Pending match run", versions[-1]["data"])

        comments = frappe.get_all(
            "Comment",
            filters={"reference_doctype": ROW_DOCTYPE, "reference_name": row, "comment_type": "Comment"},
            fields=["content"],
        )
        unskipped = [c["content"] for c in comments if "Unskipped" in c["content"]]
        self.assertEqual(len(unskipped), 1)
        self.assertIn(REASON, unskipped[0])
        self.assertIn("Administrator", unskipped[0])


class TestUnskipReChecksAgainstTheLedger(OutflowReviewFixture):
    """The Cashfree fixture: 0001 has one approved payment, 0003 a payment already Paid."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)
        frappe.db.commit()
        cls.touched = []

    @classmethod
    def tearDownClass(cls):
        _purge_audit(cls.touched)
        super().tearDownClass()

    def _name(self, suffix):
        name = self._rows_by_transfer_suffix()[suffix]["name"]
        self.touched.append(name)
        return name

    def test_a_line_with_one_approved_record_lands_matched_with_that_suggestion(self):
        name = self._name("0001")
        _hand_skip(name)

        result = unskip_row(name, REASON)

        self.assertEqual(result["status"], ROW_MATCHED)
        self.assertEqual(result["suggested_name"], self.pay_clean)
        self.assertEqual(result["suggested_doctype"], "Project Payments")
        stored = _stored(name)
        self.assertEqual(stored.row_status, ROW_MATCHED)
        self.assertEqual(stored.suggested_name, self.pay_clean)
        self.assertFalse(stored.skip_origin)

    def test_money_recorded_since_skips_it_again_as_a_system_skip(self):
        name = self._name("0003")
        _hand_skip(name)

        result = unskip_row(name, REASON)

        self.assertEqual(result["status"], ROW_SKIPPED)
        self.assertIn(self.pay_already, result["outcome_note"])
        stored = _stored(name)
        self.assertEqual(stored.row_status, ROW_SKIPPED)
        self.assertEqual(stored.skip_origin, SKIP_ORIGIN_SYSTEM)
        # And re-filed under the kind the re-check found, never left as "Skipped by hand".
        self.assertEqual(stored.skip_kind, "Outflow Already Recorded")
        self.assertFalse(stored.skip_reason)
        # ⚠️ INVERTED (owner, 2026-09-17): an already-recorded skip MAY be unskipped now -- and the
        # SAME re-check that just skipped it skips it again, so the money is never opened twice.
        again = unskip_row(name, REASON)
        self.assertEqual(again["status"], ROW_SKIPPED)
        self.assertEqual(_stored(name).skip_kind, "Outflow Already Recorded")


class TestUnskipReleasesTheDuplicateClaim(OutflowReviewFixture):
    """Two ICICI lines carry one reference, one Paid record. The first line skipped on it (and holds
    the claim); the second is blocked by "one record, one line". The first was a hand skip."""

    @classmethod
    def _plant_targets(cls):
        cls.ref = _random_reference()
        prefix = f"T1274{frappe.generate_hash(length=6).upper()}"
        cls.tids = {k: f"{prefix}{k.upper()}" for k in ("one", "two")}
        lines = [
            {"tid": cls.tids["one"], "narration": f"MMT/IMPS/{cls.ref}/PAYEE ONE",
             "amount": 11000, "credit": False, "cheque": "", "day": _GUARD_DAY},
            {"tid": cls.tids["two"], "narration": f"MMT/IMPS/{cls.ref}/PAYEE TWO",
             "amount": 11000, "credit": False, "cheque": "", "day": _GUARD_DAY + timedelta(minutes=1)},
        ]
        cls.icici = _stage_icici_statement(lines, "test-1274-icici.csv")
        cls.batches.append(cls.icici.name)
        cls.record = cls._insert_payment_row(
            amount=11000, status="Paid", utr=cls.ref, payment_date=_GUARD_DAY.date()
        )
        frappe.db.commit()
        match_batch(cls.icici.name)

    @classmethod
    def tearDownClass(cls):
        _purge_audit([cls._line(k) for k in ("one", "two")])
        super().tearDownClass()

    @classmethod
    def _line(cls, key):
        return frappe.db.get_value(
            ROW_DOCTYPE, {"import_batch": cls.icici.name, "transfer_id": cls.tids[key]}, "name"
        )

    def test_the_claim_is_released_and_the_blocked_line_skips_on_its_next_run(self):
        holder = next(k for k in ("one", "two") if _stored(self._line(k)).row_status == ROW_SKIPPED)
        blocked = "two" if holder == "one" else "one"
        holder, blocked = self._line(holder), self._line(blocked)
        self.assertIn(self.record, frappe.as_json(_stored(holder).duplicate_basis))
        self.assertEqual(_stored(blocked).row_status, ROW_MISMATCHED)

        # The holder was a hand skip. Its amount no longer agrees with the record, so its re-check
        # cannot simply take the claim back.
        frappe.db.set_value(ROW_DOCTYPE, holder, "amount", 9000, update_modified=False)
        _hand_skip(holder)

        result = unskip_row(holder, REASON)

        self.assertEqual(result["status"], ROW_MISMATCHED)
        self.assertFalse(_stored(holder).duplicate_basis)

        match_line(blocked)
        frappe.db.commit()
        stored = _stored(blocked)
        self.assertEqual(stored.row_status, ROW_SKIPPED)
        self.assertIn(self.record, frappe.as_json(stored.duplicate_basis))
