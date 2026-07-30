"""Unit tests for the pure active-period helpers in wip_monthly_report.

Covers (no DB): timeline reconstruction, status-aware contiguous-interval merging
(WIP + Handover are both tracked; a WIP->Handover transition stays TWO labelled
stints), and per-month day counting incl. multi-stint / zero-day-drop / combined
WIP+Handover "active days".
"""

from datetime import date, datetime

from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.reports.wip_monthly_report import (
    _active_periods_for_month,
    _build_intervals,
    _compliance_metrics,
    _merged_active_periods,
    _period_day_set,
)

NOW = datetime(2026, 7, 9, 12, 0, 0)


def _dt(y, m, d):
    return datetime(y, m, d, 10, 0, 0)


class TestActiveIntervals(FrappeTestCase):
    # --- _build_intervals -------------------------------------------------- #
    def test_no_changes_uses_current_status(self):
        iv = _build_intervals(_dt(2025, 7, 9), "WIP", [], NOW)
        self.assertEqual(iv, [("WIP", _dt(2025, 7, 9), NOW)])

    def test_seed_status_from_first_change_old(self):
        changes = [(_dt(2026, 1, 29), "WIP", "Completed")]
        iv = _build_intervals(_dt(2024, 9, 11), "Completed", changes, NOW)
        self.assertEqual(iv[0], ("WIP", _dt(2024, 9, 11), _dt(2026, 1, 29)))
        self.assertEqual(iv[1], ("Completed", _dt(2026, 1, 29), NOW))

    # --- _merged_active_periods ------------------------------------------- #
    def test_contiguous_same_status_merge_to_one(self):
        intervals = [
            ("WIP", _dt(2025, 3, 20), _dt(2025, 3, 20)),
            ("WIP", _dt(2025, 3, 20), _dt(2025, 3, 21)),
            ("WIP", _dt(2025, 3, 21), NOW),
        ]
        merged = _merged_active_periods(intervals, NOW)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0][0], date(2025, 3, 20))
        self.assertTrue(merged[0][2])          # ongoing
        self.assertEqual(merged[0][3], "WIP")  # status label

    def test_wip_then_handover_are_two_stints(self):
        # WIP -> Handover is contiguous but DIFFERENT status => 2 labelled stints
        intervals = [
            ("WIP", _dt(2026, 2, 4), _dt(2026, 3, 4)),
            ("Handover", _dt(2026, 3, 4), NOW),
        ]
        merged = _merged_active_periods(intervals, NOW)
        self.assertEqual(len(merged), 2)
        self.assertEqual([m[3] for m in merged], ["WIP", "Handover"])
        self.assertTrue(merged[1][2])          # Handover ongoing

    def test_inactive_status_is_a_gap(self):
        # WIP, Halted (NOT active => gap), WIP, Handover => 3 active stints
        intervals = [
            ("WIP", _dt(2026, 1, 19), _dt(2026, 4, 4)),
            ("Halted", _dt(2026, 4, 4), _dt(2026, 4, 11)),
            ("WIP", _dt(2026, 4, 11), _dt(2026, 4, 20)),
            ("Handover", _dt(2026, 4, 20), NOW),
        ]
        merged = _merged_active_periods(intervals, NOW)
        self.assertEqual([m[3] for m in merged], ["WIP", "WIP", "Handover"])

    # --- _active_periods_for_month ---------------------------------------- #
    def test_full_month_ongoing(self):
        merged = [(date(2026, 1, 21), date(2026, 7, 9), True, "WIP")]
        total, periods = _active_periods_for_month(merged, date(2026, 4, 1), date(2026, 5, 1))
        self.assertEqual(total, 30)  # April has 30 days
        self.assertEqual(len(periods), 1)
        self.assertIsNone(periods[0]["end"])
        self.assertEqual(periods[0]["status"], "WIP")

    def test_partial_entry_month(self):
        merged = [(date(2026, 6, 9), date(2026, 7, 9), True, "WIP")]
        total, periods = _active_periods_for_month(merged, date(2026, 6, 1), date(2026, 7, 1))
        self.assertEqual(total, 22)  # Jun 9..30

    def test_partial_exit_and_zero_day_drop(self):
        merged = [
            (date(2026, 1, 19), date(2026, 4, 4), False, "WIP"),
            (date(2026, 4, 18), date(2026, 4, 18), False, "WIP"),
        ]
        total, periods = _active_periods_for_month(merged, date(2026, 4, 1), date(2026, 5, 1))
        self.assertEqual(total, 3)
        self.assertEqual(len(periods), 1)

    def test_wip_plus_handover_days_combined(self):
        # WIP Apr 1-11 (10d) + Handover Apr 11 -> ongoing (20d) => 30 active days
        merged = [
            (date(2026, 4, 1), date(2026, 4, 11), False, "WIP"),
            (date(2026, 4, 11), date(2026, 7, 9), True, "Handover"),
        ]
        total, periods = _active_periods_for_month(merged, date(2026, 4, 1), date(2026, 5, 1))
        self.assertEqual(total, 30)
        self.assertEqual([p["status"] for p in periods], ["WIP", "Handover"])
        self.assertEqual([p["days"] for p in periods], [10, 20])

    def test_month_before_active_yields_nothing(self):
        merged = [(date(2026, 4, 1), date(2026, 5, 1), False, "WIP")]
        total, periods = _active_periods_for_month(merged, date(2026, 1, 1), date(2026, 2, 1))
        self.assertEqual(total, 0)
        self.assertEqual(periods, [])


class TestComplianceMetrics(FrappeTestCase):
    # Anchor: 2026-01-01 is a Thursday, so 2026-01-05 is a Monday and 2026-01-04
    # / 11 / 18 / 25 are Sundays. All windows below use ``[cstart, cend)``.

    # --- _period_day_set --------------------------------------------------- #
    def test_period_day_set_entry_in_exit_out(self):
        s = _period_day_set(date(2026, 1, 5), date(2026, 1, 12))  # Mon 5 .. Sun 11
        self.assertEqual(len(s), 7)
        self.assertIn(date(2026, 1, 5), s)        # entry day counts
        self.assertNotIn(date(2026, 1, 12), s)    # exit day does not

    # --- _compliance_metrics: DPR (daily, Sundays excluded) ---------------- #
    def test_dpr_excludes_sundays_and_reconciles(self):
        active = _period_day_set(date(2026, 1, 5), date(2026, 1, 12))  # Mon..Sun (7d)
        dpr = {
            date(2026, 1, 5), date(2026, 1, 7), date(2026, 1, 9),  # 3 working-day DPRs
            date(2026, 1, 11),  # Sunday DPR — NOT counted (Sunday isn't a working day)
            date(2026, 1, 20),  # outside the active window — NOT counted
        }
        m = _compliance_metrics(active, dpr, 0)
        self.assertEqual(m["active_working_days"], 6)   # 7 days − 1 Sunday
        self.assertEqual(m["total_dpr_days"], 3)
        self.assertEqual(m["missing_dpr_days"], 3)
        # The reconciliation guarantee the report is built on:
        self.assertEqual(m["total_dpr_days"] + m["missing_dpr_days"], m["active_working_days"])

    # --- _compliance_metrics: Inventory (weekly cadence, VOLUME actual) ---- #
    # `expected` is still the active Monday count, but `actual` is now a plain COUNT of
    # inventory report DOCUMENTS — the weekday a report lands on no longer matters.
    def test_inventory_actual_is_a_document_count_regardless_of_weekday(self):
        active = _period_day_set(date(2026, 1, 5), date(2026, 1, 12))  # one Monday: Jan 5
        # A single report filed on the Tuesday now COUNTS (pre-change this was 0).
        m = _compliance_metrics(active, set(), 1)
        self.assertEqual(m["expected_inventory"], 1)
        self.assertEqual(m["actual_inventory"], 1)
        self.assertEqual(m["missing_inventory"], 0)

    def test_inventory_two_mondays_partial(self):
        active = _period_day_set(date(2026, 1, 5), date(2026, 1, 19))  # Mon 5 .. Sun 18
        m = _compliance_metrics(active, set(), 1)       # one report filed
        self.assertEqual(m["active_working_days"], 12)  # 14 days − 2 Sundays
        self.assertEqual(m["expected_inventory"], 2)    # Jan 5 + Jan 12
        self.assertEqual(m["actual_inventory"], 1)
        self.assertEqual(m["missing_inventory"], 1)

    def test_inventory_over_delivery_clamps_missing_at_zero(self):
        """`actual` is unbounded, so over-delivery must not render a negative gap.

        This is not hypothetical — live rows do it (5 active Mondays, 6 reports filed).
        """
        active = _period_day_set(date(2026, 1, 5), date(2026, 1, 19))  # 2 Mondays
        m = _compliance_metrics(active, set(), 5)       # five reports against two weeks
        self.assertEqual(m["expected_inventory"], 2)
        self.assertEqual(m["actual_inventory"], 5)      # reported honestly, NOT capped
        self.assertEqual(m["missing_inventory"], 0)     # gap clamped, never −3

    def test_empty_active_set_is_all_zero(self):
        m = _compliance_metrics(set(), {date(2026, 1, 5)}, 0)
        self.assertEqual(
            (m["active_working_days"], m["total_dpr_days"], m["missing_dpr_days"]),
            (0, 0, 0),
        )
        self.assertEqual(
            (m["expected_inventory"], m["actual_inventory"], m["missing_inventory"]),
            (0, 0, 0),
        )

    def test_empty_active_set_still_reports_filed_inventory(self):
        """No active days => nothing expected, but a filed report is still counted.

        Follows from the whole-month scope ruling: a report filed while the project was
        inactive lands on the project row, and `missing` stays clamped at 0.
        """
        m = _compliance_metrics(set(), set(), 2)
        self.assertEqual(
            (m["expected_inventory"], m["actual_inventory"], m["missing_inventory"]),
            (0, 2, 0),
        )
