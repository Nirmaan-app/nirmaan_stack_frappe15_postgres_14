# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `reminders.next_open_due_date` -- the schedule's "Next Due Date".

The rule: the next due date (today or later) whose cycle is not already Done. A cycle marked
Done ahead of its due date is stepped past; a missed, still-Pending cycle is in the past and
never holds the date back (it shows as Overdue in the Action Center instead).

Run:  bench --site localhost run-tests --module nirmaan_stack.services.test_reminders
"""

import unittest

from frappe import _dict
from frappe.utils import getdate

from nirmaan_stack.services.reminders import next_due_date, next_open_due_date


def _row(due_month, due_day):
    return _dict(due_month=due_month, due_day=due_day, from_month=None, to_month=None)


QUARTERLY_31ST = [_row("Jul", 31), _row("Oct", 31), _row("Jan", 31), _row("Apr", 31)]


def _monthly(due_day, done=(), base="2026-10-29"):
    return next_open_due_date("Monthly", due_day, [], done, base)


class TestNothingDone(unittest.TestCase):
    def test_matches_the_calendar_cycle(self):
        self.assertEqual(_monthly(20), getdate("2026-11-20"))
        self.assertEqual(_monthly(20), next_due_date("Monthly", 20, [], "2026-10-29"))

    def test_due_today_is_still_next(self):
        self.assertEqual(_monthly(29), getdate("2026-10-29"))

    def test_overdue_pending_cycles_do_not_hold_the_date_back(self):
        """PF Filing: 15 Sep and 15 Oct still Pending on 29 Oct -> Next Due is 15 Nov."""
        self.assertEqual(_monthly(15), getdate("2026-11-15"))


class TestDoneCyclesAreSkipped(unittest.TestCase):
    def test_current_cycle_done_ahead_moves_to_next_month(self):
        self.assertEqual(_monthly(31, done=["2026-10-31"]), getdate("2026-11-30"))

    def test_due_today_and_done_moves_on(self):
        self.assertEqual(_monthly(29, done=["2026-10-29"]), getdate("2026-11-29"))

    def test_two_cycles_done_in_a_row_skips_both(self):
        self.assertEqual(
            _monthly(20, done=["2026-11-20", "2026-12-20"]), getdate("2027-01-20")
        )

    def test_a_done_cycle_later_than_the_next_one_does_not_skip_the_next(self):
        self.assertEqual(_monthly(20, done=["2026-12-20"]), getdate("2026-11-20"))

    def test_reopen_moves_back(self):
        """Reopen = the date leaves the Done set; the earlier cycle is next again."""
        self.assertEqual(_monthly(20, done=["2026-11-20"]), getdate("2026-12-20"))
        self.assertEqual(_monthly(20, done=[]), getdate("2026-11-20"))

    def test_past_done_cycles_are_ignored(self):
        self.assertEqual(
            _monthly(20, done=["2026-08-20", "2026-09-20", "2026-10-20"]),
            getdate("2026-11-20"),
        )

    def test_done_dates_may_arrive_as_strings_or_dates(self):
        self.assertEqual(_monthly(20, done=[getdate("2026-11-20")]), getdate("2026-12-20"))
        self.assertEqual(_monthly(20, done=["2026-11-20"]), getdate("2026-12-20"))


class TestMonthEndClamp(unittest.TestCase):
    def test_31st_in_a_30_day_month_then_done_moves_to_the_31st(self):
        self.assertEqual(_monthly(31, base="2026-11-01"), getdate("2026-11-30"))
        self.assertEqual(
            _monthly(31, done=["2026-11-30"], base="2026-11-01"), getdate("2026-12-31")
        )

    def test_february(self):
        self.assertEqual(
            _monthly(31, done=["2027-01-31"], base="2027-01-02"), getdate("2027-02-28")
        )


class TestFixedDates(unittest.TestCase):
    def _quarterly(self, done=(), base="2026-10-29"):
        return next_open_due_date("Quarterly", 0, QUARTERLY_31ST, done, base)

    def test_quarterly_done_moves_to_next_quarter(self):
        self.assertEqual(self._quarterly(), getdate("2026-10-31"))
        self.assertEqual(self._quarterly(done=["2026-10-31"]), getdate("2027-01-31"))

    def test_wraps_into_next_year_and_clamps_april(self):
        self.assertEqual(
            self._quarterly(done=["2027-01-31"], base="2026-11-01"), getdate("2027-04-30")
        )

    def test_no_due_date_rows_gives_none(self):
        self.assertIsNone(next_open_due_date("Quarterly", 0, [], [], "2026-10-29"))
        self.assertIsNone(next_open_due_date("Custom Dates", 0, None, ["2026-10-31"]))


class TestLoopAlwaysEnds(unittest.TestCase):
    def test_every_cycle_done_returns_none_instead_of_looping(self):
        done = [f"{2026 + (m // 12)}-{m % 12 + 1:02d}-20" for m in range(9, 9 + 60)]
        self.assertIsNone(_monthly(20, done=done))
