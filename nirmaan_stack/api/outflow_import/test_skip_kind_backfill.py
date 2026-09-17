# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The skip-kind back-fill patch against real rows (Skip Type, 2026-09-17).

The rule itself is pinned purely in `services/outflow_import/test_skip_kinds.py`; this pins that the
patch reads the right columns off real lines, writes the answer, refuses without writing when a line
names no kind, and is a no-op the second time.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, so it calls `backfill_skip_kind(rows=...)` with only the lines
it created -- never `execute()`, which would classify every real skipped line on the site.
"""

import frappe

from nirmaan_stack.api.outflow_import.test_skip_row import SkipFixture
from nirmaan_stack.patches.v3_0.backfill_outflow_skip_kind import (
    UnclassifiableSkipError,
    backfill_skip_kind,
)
from nirmaan_stack.services.outflow_import.status import (
    ROW_SKIPPED,
    SKIP_REASON_ALREADY_PAID,
    SKIP_REASON_EXCLUDED_AT_INGEST,
    SKIP_REASON_NOT_SUCCESSFUL,
)

ROW_DOCTYPE = "Outflow Import Row"


class TestSkipKindBackfill(SkipFixture):
    def _old_skip(self, **fields):
        """A Skipped line as the code before `skip_kind` left it: no kind at all."""
        fields = {"skip_origin": "System", **fields}
        return self._line(status=ROW_SKIPPED, skip_kind="", **fields)

    def _kind(self, row):
        return frappe.db.get_value(ROW_DOCTYPE, row, "skip_kind")

    def setUp(self):
        super().setUp()
        self.hand = self._old_skip(
            skip_origin="Manual", skip_reason="Paid from the other account", outcome_note="Paid from the other account"
        )
        self.upload = self._old_skip(
            outcome_note=None,
            skip_reason=SKIP_REASON_EXCLUDED_AT_INGEST.format(category="platform_porter"),
        )
        self.refused = self._old_skip(
            status_raw="FAILED", outcome_note=None,
            skip_reason=SKIP_REASON_NOT_SUCCESSFUL.format(status="FAILED"),
        )
        self.match_time = self._old_skip(
            outcome_note=SKIP_REASON_ALREADY_PAID.format(records="Project Payment PAY-01393-005"),
        )
        self.cashbook = self._old_skip(
            source="Cashbook", outcome_note=None,
            skip_reason="Moves money between our own balances, not a spend",
        )
        self.mine = [self.hand, self.upload, self.refused, self.match_time, self.cashbook]

    def test_each_shape_is_classified(self):
        counts = backfill_skip_kind(rows=self.mine)
        self.assertEqual(
            counts,
            {
                "Bank refused": 1,
                "Cashbook internal movement": 1,
                "Outflow Already Recorded": 1,
                "Porter wallet top-up": 1,
                "Skipped by hand": 1,
            },
        )
        self.assertEqual(self._kind(self.hand), "Skipped by hand")
        self.assertEqual(self._kind(self.upload), "Porter wallet top-up")
        self.assertEqual(self._kind(self.refused), "Bank refused")
        self.assertEqual(self._kind(self.match_time), "Outflow Already Recorded")
        self.assertEqual(self._kind(self.cashbook), "Cashbook internal movement")

    def test_running_it_again_changes_nothing(self):
        backfill_skip_kind(rows=self.mine)
        before = {row: self._kind(row) for row in self.mine}
        modified = {row: frappe.db.get_value(ROW_DOCTYPE, row, "modified") for row in self.mine}
        self.assertEqual(backfill_skip_kind(rows=self.mine), {})
        self.assertEqual({row: self._kind(row) for row in self.mine}, before)
        self.assertEqual(
            {row: frappe.db.get_value(ROW_DOCTYPE, row, "modified") for row in self.mine}, modified
        )

    def test_a_line_naming_no_kind_stops_it_before_any_write(self):
        mystery = self._old_skip(outcome_note="typed by someone", skip_reason="also typed")
        with self.assertRaises(UnclassifiableSkipError) as caught:
            backfill_skip_kind(rows=[*self.mine, mystery])
        self.assertIn(mystery, str(caught.exception))
        for row in self.mine:
            with self.subTest(row=row):
                self.assertFalse(self._kind(row))

    def test_a_line_that_already_has_a_kind_is_never_rewritten(self):
        kept = self._line(
            status=ROW_SKIPPED, skip_origin="System", skip_kind="Already imported",
            skip_reason=SKIP_REASON_NOT_SUCCESSFUL.format(status="FAILED"),
        )
        self.assertEqual(backfill_skip_kind(rows=[kept]), {})
        self.assertEqual(self._kind(kept), "Already imported")

    def test_an_open_line_is_not_given_a_kind(self):
        open_line = self._line(skip_kind="")
        self.assertEqual(backfill_skip_kind(rows=[open_line]), {})
        self.assertFalse(self._kind(open_line))
