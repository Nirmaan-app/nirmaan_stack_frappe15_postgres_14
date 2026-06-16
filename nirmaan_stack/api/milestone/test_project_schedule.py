# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tests for the Project Schedule milestone-date logic.

Two layers:

1. TestComputeMilestoneDates / TestFormulaParity — PURE functions, no Frappe
   site needed. They lock down `_compute_milestone_dates` (the formula the
   backend SAVES) and prove it stays in lock-step with the frontend preview
   (`projectFormulaWindow` in ProjectScheduler.tsx), including the short-window
   clamping. Run inside the bench venv:
       python -m unittest nirmaan_stack.api.milestone.test_project_schedule

2. TestSelectiveRecompute — DB-backed FrappeTestCase for the new
   `reset_milestones_to_formula` endpoint and the freeze/recompute contract.
   Run with:
       bench --site localhost run-tests --module \
         nirmaan_stack.api.milestone.test_project_schedule
"""

import unittest
from datetime import date, timedelta

from nirmaan_stack.api.milestone.project_schedule import _compute_milestone_dates


# ── Test helpers ────────────────────────────────────────────────────────────

def _master(weeks):
	"""Build a Work-Milestones-shaped dict from a 9-length list of week %s."""
	assert len(weeks) == 9
	return {f"week_{i + 1}": weeks[i] for i in range(9)}


def _round_half_up(x):
	"""JavaScript Math.round semantics: ties round toward +Infinity.
	(Python's built-in round() is banker's rounding — half-to-even.)"""
	import math
	return math.floor(x + 0.5)


def _clamped_formula(round_fn, project_start, project_end, weeks):
	"""Faithful re-implementation of the milestone-date formula, parameterised
	by the rounding function. With round_fn=round this mirrors the backend
	`_compute_milestone_dates`; with round_fn=_round_half_up it mirrors the
	frontend `projectFormulaWindow` (JS Math.round). Used by the parity tests."""
	duration_days = (project_end - project_start).days + 1
	if duration_days <= 0:
		return None, None
	week_slot_days = duration_days / 9

	first_week_idx = -1
	last_non_zero_idx = -1
	completion_week_idx = -1
	for i in range(9):
		if weeks[i] > 0:
			if first_week_idx == -1:
				first_week_idx = i
			last_non_zero_idx = i
		if completion_week_idx == -1 and weeks[i] >= 100:
			completion_week_idx = i
	last_week_idx = completion_week_idx if completion_week_idx != -1 else last_non_zero_idx
	if first_week_idx == -1:
		return None, None

	start_offset = round_fn(first_week_idx * week_slot_days)
	end_offset = round_fn((last_week_idx + 1) * week_slot_days) - 1
	last_offset = max(0, duration_days - 1)
	start_offset = max(0, min(start_offset, last_offset))
	end_offset = max(0, min(end_offset, last_offset))
	end_offset = max(end_offset, start_offset)
	return (
		project_start + timedelta(days=start_offset),
		project_start + timedelta(days=end_offset),
	)


# A spread of week-distribution patterns covering the interesting shapes.
# week_1..week_9 are CUMULATIVE planned %, so each pattern is monotonically
# non-decreasing (real data never drops back — once a week is 30, later weeks
# are >= 30) and, once it hits 100, stays at 100.
WEEK_PATTERNS = [
	[0, 0, 0, 0, 0, 0, 0, 0, 0],              # nothing scheduled
	[100, 100, 100, 100, 100, 100, 100, 100, 100],  # done in week 1, stays 100
	[50, 100, 100, 100, 100, 100, 100, 100, 100],   # completes week 2
	[0, 0, 0, 0, 20, 40, 60, 80, 100],        # starts week 5, finishes week 9
	[0, 0, 0, 0, 0, 0, 0, 0, 100],            # starts and completes only in week 9
	[10, 20, 30, 40, 50, 60, 70, 80, 100],    # ramps across the full span
	[0, 0, 0, 30, 60, 90, 100, 100, 100],     # starts week 4, completes week 7
	[0, 0, 30, 60, 80, 90, 95, 98, 99],       # starts week 3, never reaches 100
	                                          # (defensive last-non-zero branch)
]


# ── 1. Pure formula tests ────────────────────────────────────────────────────

class TestComputeMilestoneDates(unittest.TestCase):
	def test_standard_window_first_two_weeks(self):
		start = date(2026, 1, 1)
		end = date(2026, 3, 4)  # 63 days → week_slot_days = 7
		# cumulative: 50% by wk1, 100% by wk2, stays 100 thereafter
		s, e = _compute_milestone_dates(start, end, _master([50, 100, 100, 100, 100, 100, 100, 100, 100]))
		self.assertEqual(s, date(2026, 1, 1))   # offset 0
		self.assertEqual(e, date(2026, 1, 14))  # round(2*7)-1 = 13 (completes wk2)

	def test_first_week_only(self):
		start = date(2026, 1, 1)
		end = date(2026, 3, 4)
		# completes in week 1, cumulative stays at 100
		s, e = _compute_milestone_dates(start, end, _master([100, 100, 100, 100, 100, 100, 100, 100, 100]))
		self.assertEqual(s, date(2026, 1, 1))
		self.assertEqual(e, date(2026, 1, 7))   # round(1*7)-1 = 6

	def test_mid_span_week4_to_week7(self):
		start = date(2026, 1, 1)
		end = date(2026, 3, 4)  # 63 days → week_slot_days = 7
		# cumulative: starts week 4 (>0), hits 100 in week 7 → end is week 7
		s, e = _compute_milestone_dates(start, end, _master([0, 0, 0, 30, 60, 90, 100, 100, 100]))
		self.assertEqual(s, date(2026, 1, 22))  # round(3*7) = 21 → Jan 22
		self.assertEqual(e, date(2026, 2, 18))  # round(7*7) - 1 = 48 → Feb 18

	def test_no_scheduled_weeks_returns_none(self):
		s, e = _compute_milestone_dates(date(2026, 1, 1), date(2026, 3, 4),
		                                _master([0] * 9))
		self.assertIsNone(s)
		self.assertIsNone(e)

	def test_invalid_window_returns_none(self):
		# end before start → non-positive duration
		s, e = _compute_milestone_dates(date(2026, 3, 4), date(2026, 1, 1),
		                                _master([100, 0, 0, 0, 0, 0, 0, 0, 0]))
		self.assertIsNone(s)
		self.assertIsNone(e)

	def test_missing_dates_return_none(self):
		self.assertEqual(
			_compute_milestone_dates(None, date(2026, 3, 4), _master([100] + [0] * 8)),
			(None, None),
		)
		self.assertEqual(
			_compute_milestone_dates(date(2026, 1, 1), None, _master([100] + [0] * 8)),
			(None, None),
		)

	def test_short_window_clamps_into_range(self):
		# 5-day project: week_slot_days = 0.555…; a week-9 milestone must still
		# land *inside* the window, not past the end.
		start = date(2026, 1, 1)
		end = date(2026, 1, 5)  # 5 days, last valid offset = 4
		s, e = _compute_milestone_dates(start, end, _master([0] * 8 + [100]))
		self.assertGreaterEqual(s, start)
		self.assertLessEqual(e, end)
		self.assertGreaterEqual(e, s)  # never inverted

	def test_short_window_never_inverts(self):
		# 3-day project where the raw offsets would put end (0) before start (1);
		# clamping must collapse it to a single day, not invert.
		start = date(2026, 1, 1)
		end = date(2026, 1, 3)  # 3 days
		# starts and completes in week 3, cumulative stays 100 after
		s, e = _compute_milestone_dates(start, end, _master([0, 0, 100, 100, 100, 100, 100, 100, 100]))
		self.assertIsNotNone(s)
		self.assertGreaterEqual(e, s)
		self.assertLessEqual(e, end)


# ── 2. Frontend ↔ backend parity tests ───────────────────────────────────────

class TestFormulaParity(unittest.TestCase):
	"""Guards the claim: the Step-2 preview (`projectFormulaWindow`) equals the
	saved value (`_compute_milestone_dates`)."""

	def test_backend_matches_reference_formula_exactly(self):
		# The backend uses Python round(); _clamped_formula(round, ...) is the
		# same algorithm. Any divergence means the backend code drifted.
		start = date(2026, 1, 1)
		for span in range(1, 200):                      # 1-day … ~28-week windows
			end = start + timedelta(days=span - 1)
			for weeks in WEEK_PATTERNS:
				expected = _clamped_formula(round, start, end, weeks)
				actual = _compute_milestone_dates(start, end, _master(weeks))
				self.assertEqual(actual, expected, msg=f"span={span} weeks={weeks}")

	def test_js_preview_matches_backend_on_integer_slots(self):
		# When week_slot_days is a whole number (duration multiple of 9) there is
		# no rounding at all, so the JS preview (half-up) and the backend MUST be
		# byte-for-byte identical — including the previously-broken short windows.
		start = date(2026, 1, 1)
		for span in (9, 18, 27, 45, 63, 90, 126):
			end = start + timedelta(days=span - 1)
			for weeks in WEEK_PATTERNS:
				js = _clamped_formula(_round_half_up, start, end, weeks)
				backend = _compute_milestone_dates(start, end, _master(weeks))
				self.assertEqual(js, backend, msg=f"span={span} weeks={weeks}")

	def test_js_preview_within_one_day_everywhere(self):
		# For arbitrary windows the only residual gap between JS (half-up) and
		# backend (banker's) rounding is a tie at exactly .5 → at most 1 day, and
		# the clamping keeps both in-window and non-inverted.
		start = date(2026, 1, 1)
		for span in range(1, 200):
			end = start + timedelta(days=span - 1)
			for weeks in WEEK_PATTERNS:
				js = _clamped_formula(_round_half_up, start, end, weeks)
				backend = _compute_milestone_dates(start, end, _master(weeks))
				if backend == (None, None):
					self.assertEqual(js, (None, None))
					continue
				self.assertLessEqual(abs((js[0] - backend[0]).days), 1)
				self.assertLessEqual(abs((js[1] - backend[1]).days), 1)
				self.assertGreaterEqual(js[1], js[0])  # preview never inverts


# ── 3. DB-backed endpoint / contract tests ───────────────────────────────────

try:
	from frappe.tests.utils import FrappeTestCase
	import frappe
	_HAS_FRAPPE_SITE = True
except Exception:  # pragma: no cover - import guard for venv-only runs
	_HAS_FRAPPE_SITE = False


if _HAS_FRAPPE_SITE:

	class TestSelectiveRecompute(FrappeTestCase):
		"""Exercises the freeze/recompute contract through the real doctypes.

		Seeds a throwaway Work Header + two Work Milestones + a Project, lets the
		Projects hook build the schedule, then drives update / bulk-reset and
		asserts which rows move and which stay frozen."""

		HEADER = "ZZ Test Schedule Header"
		MS_A = "ZZ Test Milestone A"
		MS_B = "ZZ Test Milestone B"

		@classmethod
		def setUpClass(cls):
			super().setUpClass()
			from nirmaan_stack.api.milestone.project_schedule import ensure_project_schedule

			if not frappe.db.exists("Work Headers", cls.HEADER):
				frappe.get_doc({
					"doctype": "Work Headers",
					"work_header_name": cls.HEADER,
				}).insert(ignore_permissions=True, ignore_if_duplicate=True)

			for ms, order in ((cls.MS_A, 1), (cls.MS_B, 2)):
				if not frappe.db.exists("Work Milestones", {"work_milestone_name": ms}):
					frappe.get_doc({
						"doctype": "Work Milestones",
						"work_milestone_name": ms,
						"work_header": cls.HEADER,
						"work_milestone_order": order,
						"weightage": 50,
						# MS_A finishes week 1, MS_B finishes week 9
						"week_1": 100 if ms == cls.MS_A else 0,
						"week_9": 100 if ms == cls.MS_B else 0,
					}).insert(ignore_permissions=True, ignore_if_duplicate=True)

			proj = frappe.get_doc({
				"doctype": "Projects",
				"project_name": "ZZ Test Schedule Project",
				"project_start_date": "2026-01-01 00:00:00",
				"project_end_date": "2026-03-04 00:00:00",  # 63-day window
				# generate_pwm (after_insert hook) reads project_scopes["scopes"];
				# an empty list keeps the hook a no-op for this fixture.
				"project_scopes": {"scopes": []},
				"project_work_header_entries": [
					{"project_work_header_name": cls.HEADER, "enabled": 1},
				],
			})
			proj.flags.ignore_mandatory = True
			proj.insert(ignore_permissions=True)
			cls.project_id = proj.name
			ensure_project_schedule(cls.project_id)
			frappe.db.commit()

		def _row(self, milestone_name):
			sched = frappe.get_doc("Project Schedule", self.project_id)
			return next(r for r in sched.milestones if r.work_milestone == milestone_name)

		def test_manual_override_freezes_then_bulk_reset_recomputes(self):
			from nirmaan_stack.api.milestone.project_schedule import (
				update_milestone_dates,
				reset_milestones_to_formula,
			)

			# 1) Manually override MS_A — it should be flagged frozen.
			row_a = self._row(self.MS_A)
			update_milestone_dates(self.project_id, row_a.name, "2026-02-10", "2026-02-20")
			row_a = self._row(self.MS_A)
			self.assertTrue(row_a.changed_by_user)
			self.assertEqual(str(row_a.start_date), "2026-02-10")

			# 2) Bulk-reset MS_A back to the formula — flags cleared, dates back.
			reset_milestones_to_formula(self.project_id, [row_a.name])
			row_a = self._row(self.MS_A)
			self.assertFalse(row_a.changed_by_user)
			self.assertIsNone(row_a.edited_by_user)
			# Formula for week-1 milestone on a 63-day window = Jan 1 → Jan 7.
			self.assertEqual(str(row_a.start_date), "2026-01-01")
			self.assertEqual(str(row_a.end_date), "2026-01-07")

		def test_bulk_reset_leaves_unlisted_manual_rows_frozen(self):
			from nirmaan_stack.api.milestone.project_schedule import (
				update_milestone_dates,
				reset_milestones_to_formula,
			)

			# Freeze BOTH milestones.
			row_a = self._row(self.MS_A)
			row_b = self._row(self.MS_B)
			update_milestone_dates(self.project_id, row_a.name, "2026-02-01", "2026-02-05")
			update_milestone_dates(self.project_id, row_b.name, "2026-02-06", "2026-02-10")

			# Reset only MS_A; MS_B must keep its custom dates + frozen flag.
			reset_milestones_to_formula(self.project_id, [row_a.name])
			row_b = self._row(self.MS_B)
			self.assertTrue(row_b.changed_by_user)
			self.assertEqual(str(row_b.start_date), "2026-02-06")
			self.assertEqual(str(row_b.end_date), "2026-02-10")

		def test_bulk_reset_empty_list_is_noop(self):
			from nirmaan_stack.api.milestone.project_schedule import (
				update_milestone_dates,
				reset_milestones_to_formula,
			)
			row_a = self._row(self.MS_A)
			update_milestone_dates(self.project_id, row_a.name, "2026-02-01", "2026-02-05")
			reset_milestones_to_formula(self.project_id, [])
			row_a = self._row(self.MS_A)
			self.assertTrue(row_a.changed_by_user)  # untouched


if __name__ == "__main__":
	unittest.main()
