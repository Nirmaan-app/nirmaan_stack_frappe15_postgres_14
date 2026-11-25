# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for THE POOL BUILD JOB's clock, fail-safe and stage log (#1741; services/boq_rate_match/pool_job.py).
build_pool runs end to end on an empty corpus with its node steps replaced; a fake clock stands in for time. Temp pool
paths only; frappe.log_error and the commit after it are recorded, never written.

  fail-safe   the driving step gets the time left until the job limit minus the 900 s tail reserve / under 60 s left
              it is skipped / a timeout or a skip still saves a pool marked driving unavailable, with ONE WARNING and
              ONE Error Log row "Match pool built without driving fields" / with time to spare, no alarm
  signal      one INFO line per stage as it ENDS (a stage's line is out before the next stage runs), one summary line;
              past 50 % of the job limit one WARNING and one Error Log row, once; the logger is set to INFO
  secs        pool.secs keeps today's keys
"""
import logging
import os
import shutil
import subprocess
import tempfile
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_match import pool as P
from nirmaan_stack.services.boq_rate_match import pool_autobuild as AB
from nirmaan_stack.services.boq_rate_match import pool_job as J
from nirmaan_stack.services.boq_rate_match import pricing_step as PS

LIMIT = 3600
SECS_KEYS = {"corpus", "inputs", "pricing_step", "driving_fields", "readings_view", "selection_index", "total"}


class FakeTime:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class TestPoolJob(FrappeTestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pool_job_test_")
        self.path = os.path.join(self.dir, "boq_rate_match", f"match_pool_v{P.POOL_FORMAT}.pkl")
        self.time = FakeTime()
        self.cost = {}             # seconds each stage takes on the fake clock
        self.events, self.errors, self.commits, self.driving_calls = [], [], [], []
        self.logger = frappe.logger("boq_rate_match")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _spend(self, stage):
        self.events.append(("run", stage))
        self.time.t += self.cost.get(stage, 1)

    def _corpus(self, progress=None):
        self._spend("corpus")
        return {}, [], [], {}, {}, []

    def _price_rows(self, *a, **k):
        self._spend("pricing_step")
        return {"rows": {}, "available": True, "reason": None, "stamp": None}

    def _measure(self, *a, timeout=None, **k):
        self.driving_calls.append(timeout)
        self._spend("driving_fields")
        return {"available": True, "reason": None, "stamp": None, "lists": {}, "categories": {}}

    def _rebuild(self, measure=None, lock_wait=0):
        clock = J.BuildClock(limit=LIMIT, now=self.time)
        self.time.t += lock_wait                                         # RQ's clock runs while the job waits
        handler = _Recorder(self.events)
        self.logger.addHandler(handler)
        try:
            with patch.object(P, "pool_path", return_value=self.path), patch.object(P, "_corpus", side_effect=self._corpus), \
                    patch.object(P, "check_swg_table"), patch.object(P, "build_index", return_value={}), \
                    patch.object(PS, "load_asset", return_value=({"configs": {}}, "v")), \
                    patch.object(PS, "sheet_inputs", return_value=({}, [])), \
                    patch.object(PS, "price_rows", side_effect=self._price_rows), \
                    patch.object(PS, "measure_driving_fields", side_effect=measure or self._measure), \
                    patch.object(frappe, "log_error", side_effect=lambda **k: self.errors.append(k)), \
                    patch.object(frappe.db, "commit", side_effect=lambda: self.commits.append(1)):
                return J.rebuild(force=True, clock=clock)
        finally:
            self.logger.removeHandler(handler)

    def _lines(self, level):
        return [m for kind, m in self.events if kind == level]

    # ---- fail-safe ----
    def test_the_driving_step_gets_the_time_left_minus_the_tail_reserve(self):
        self.cost = {"corpus": 100, "pricing_step": 200}
        self._rebuild(lock_wait=300)
        self.assertEqual(self.driving_calls, [LIMIT - 300 - 100 - 200 - J.TAIL_RESERVE_SEC])
        self.assertEqual(self.errors, [])

    def test_under_60_s_left_the_driving_step_is_skipped_and_the_pool_saved_unavailable(self):
        self.cost = {"corpus": 0, "pricing_step": LIMIT - J.TAIL_RESERVE_SEC - 300 - 30}     # 30 s would be left
        out = self._rebuild(lock_wait=300)
        self.assertEqual(self.driving_calls, [])
        self.assertTrue(out["built"])
        self.assertFalse(out["driving"]["available"])
        self.assertIn("skipped", out["driving"]["reason"])
        saved = P.load_pool(self.path)
        self.assertFalse(saved.driving["available"])
        self.assertEqual(saved.driving["lists"], {})
        self.assertEqual([e["title"] for e in self.errors],                # past half by then too: its own alarm
                         ["Match pool build past half its time limit", "Match pool built without driving fields"])
        self.assertEqual(len([m for m in self._lines("WARNING") if "without driving fields" in m]), 1)

    def test_a_driving_timeout_still_saves_a_pool_marked_unavailable(self):
        def node_times_out(*a, timeout=None, **k):
            self._spend("driving_fields")
            raise subprocess.TimeoutExpired("node", timeout)

        def measure(*a, **k):                                             # the real step, its node run timing out
            with patch.object(PS, "read_code_stamp", return_value={"code_hash": "c"}), \
                    patch.object(PS, "node_binary", return_value="node"), patch.object(PS.subprocess, "run", side_effect=node_times_out):
                return real(*a, **k)

        real = PS.measure_driving_fields
        out = self._rebuild(measure=measure)
        self.assertTrue(out["built"])
        self.assertFalse(P.load_pool(self.path).driving["available"])
        self.assertIn("timed out", out["driving"]["reason"])
        self.assertEqual([e["title"] for e in self.errors], ["Match pool built without driving fields"])
        self.assertEqual(len([m for m in self._lines("WARNING") if "without driving fields" in m]), 1)
        self.assertTrue(self.commits)                                    # the row outlives a job killed later

    # ---- signal ----
    def test_each_stage_line_is_logged_as_the_stage_ends_then_one_summary(self):
        self._rebuild()
        build = [(k, m) for k, m in self.events if k == "run" or (k == "INFO" and m.startswith("match pool build:"))]
        order = [(k, m if k == "run" else m.split("stage ")[1].split(" ")[0] if "stage " in m else "summary")
                 for k, m in build]
        self.assertEqual(order, [("run", "corpus"), ("INFO", "corpus"), ("INFO", "inputs"),
                                 ("run", "pricing_step"), ("INFO", "pricing_step"),
                                 ("run", "driving_fields"), ("INFO", "driving_fields"),
                                 ("INFO", "readings_view"), ("INFO", "selection_index"), ("INFO", "summary")])
        self.assertIn("done", self._lines("INFO")[-1])
        self.assertEqual(self.errors, [])

    def test_past_half_the_limit_one_warning_and_one_error_log_row(self):
        self.cost = {"corpus": LIMIT // 2 + 1, "pricing_step": 5}
        self._rebuild()
        self.assertEqual([e["title"] for e in self.errors], ["Match pool build past half its time limit"])
        self.assertEqual(len([m for m in self._lines("WARNING") if "half" in m]), 1)

    def test_the_logger_is_set_to_info(self):
        self.logger.setLevel(logging.ERROR)                               # Frappe's default off the dev server
        self._rebuild()
        self.assertEqual(self.logger.level, logging.INFO)

    def test_secs_keeps_todays_keys(self):
        self.cost = {"corpus": 7, "pricing_step": 3}
        out = self._rebuild(lock_wait=50)
        self.assertEqual(set(out["secs"]), SECS_KEYS)
        self.assertEqual((out["secs"]["corpus"], out["secs"]["pricing_step"]), (7, 3))
        self.assertEqual(out["secs"]["total"], 7 + 3 + 1)                 # the build's own time, lock wait apart


class _Recorder(logging.Handler):
    def __init__(self, events):
        super().__init__(level=logging.DEBUG)
        self.events = events

    def emit(self, record):
        self.events.append((record.levelname, record.getMessage()))
