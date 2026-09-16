# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The skip-origin back-fill patch against real rows (#1273).

The rule itself is pinned purely in `services/outflow_import/test_skip_origin.py`; this pins that the
patch reads the right columns off real lines, writes the answer, and is a no-op the second time.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, so it calls `backfill_skip_origin(rows=...)` with only the
lines it created -- never `execute()`, which would classify every real skipped line on the site.
"""

import frappe

from nirmaan_stack.api.outflow_import.test_skip_row import SkipFixture
from nirmaan_stack.patches.v3_0.backfill_outflow_skip_origin import backfill_skip_origin
from nirmaan_stack.services.outflow_import.status import (
    ROW_SKIPPED,
    SKIP_ORIGIN_MANUAL,
    SKIP_ORIGIN_SYSTEM,
    SKIP_REASON_EXCLUDED_AT_INGEST,
)

ROW_DOCTYPE = "Outflow Import Row"


class TestSkipOriginBackfill(SkipFixture):
    def _old_skip(self, **fields):
        """A Skipped line as the pre-#1273 code left it: no origin at all."""
        return self._line(status=ROW_SKIPPED, skip_origin="", **fields)

    def _origin(self, row):
        return frappe.db.get_value(ROW_DOCTYPE, row, "skip_origin")

    def setUp(self):
        super().setUp()
        self.hand = self._old_skip(
            decided_by="accounts@nirmaan.app",
            outcome_note="No approved payment or expense matches this transfer.",
            skip_reason="Paid from the other account",
        )
        self.upload = self._old_skip(
            outcome_note=None,
            skip_reason=SKIP_REASON_EXCLUDED_AT_INGEST.format(category="platform_porter"),
        )
        self.match_time = self._old_skip(
            outcome_note="Already recorded as Paid on Project Payment PAY-01393-005.",
        )
        self.re_skipped = self._old_skip(
            decided_by="accounts@nirmaan.app",
            outcome_note="Already recorded as Paid on Project Payment PAY-01393-005.",
            skip_reason="yes this is a duplicate",
        )
        self.cashbook = self._old_skip(
            source="Cashbook",
            decided_by="accounts@nirmaan.app",
            outcome_note=None,
            skip_reason="Not a spend.",
        )
        self.mine = [self.hand, self.upload, self.match_time, self.re_skipped, self.cashbook]

    def test_each_shape_is_classified(self):
        counts = backfill_skip_origin(rows=self.mine)
        self.assertEqual(counts, {SKIP_ORIGIN_MANUAL: 1, SKIP_ORIGIN_SYSTEM: 4})
        self.assertEqual(self._origin(self.hand), SKIP_ORIGIN_MANUAL)
        for row in (self.upload, self.match_time, self.re_skipped, self.cashbook):
            with self.subTest(row=row):
                self.assertEqual(self._origin(row), SKIP_ORIGIN_SYSTEM)

    def test_running_it_again_changes_nothing(self):
        backfill_skip_origin(rows=self.mine)
        before = {row: self._origin(row) for row in self.mine}
        modified = {row: frappe.db.get_value(ROW_DOCTYPE, row, "modified") for row in self.mine}
        self.assertEqual(backfill_skip_origin(rows=self.mine), {})
        self.assertEqual({row: self._origin(row) for row in self.mine}, before)
        self.assertEqual(
            {row: frappe.db.get_value(ROW_DOCTYPE, row, "modified") for row in self.mine}, modified
        )

    def test_a_line_that_already_has_an_origin_is_never_rewritten(self):
        system_with_a_decider = self._line(
            status=ROW_SKIPPED,
            skip_origin=SKIP_ORIGIN_SYSTEM,
            decided_by="accounts@nirmaan.app",
            skip_reason="typed",
        )
        self.assertEqual(backfill_skip_origin(rows=[system_with_a_decider]), {})
        self.assertEqual(self._origin(system_with_a_decider), SKIP_ORIGIN_SYSTEM)

    def test_an_open_line_is_not_given_an_origin(self):
        open_line = self._line(skip_origin="", decided_by="accounts@nirmaan.app")
        self.assertEqual(backfill_skip_origin(rows=[open_line]), {})
        self.assertFalse(self._origin(open_line))
