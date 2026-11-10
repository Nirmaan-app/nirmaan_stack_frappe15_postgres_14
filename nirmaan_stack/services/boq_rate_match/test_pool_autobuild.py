# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for THE POOL AUTO-BUILD AFTER A DEPLOY (DEV2-B9 S1; services/boq_rate_match/pool_autobuild.py, run by the
5-minute match healer). Owner 2026-11-10 "Auto-build after deploy". Temp pool paths and mocks only: nothing is really
enqueued, the live pool file is never touched, the database is never written, no model call.

  fires once     no file -> exactly ONE enqueue: pool.rebuild_pool on long, the 06:00 job's timeout and FIXED job id,
                 deduplicated, one log line  /  an unreadable file -> one  /  another format -> one  /  the folder is
                 missing (a deploy removed it) -> one
  never twice    a second check while the rebuild is queued -> none  /  while the build lock is held -> none  /  the
                 fixed job id, method, queue and timeout equal rate_match.daily_pool_rebuild's
  retries        (review F1; Nitesh "the pool should exist in production") a failed build is retried until a file is
                 usable, after 10 min, 30 min, 1 h, 2 h, then every 6 h - never every 5 min / a usable file clears the
                 count / a failed 06:00 build waits the first step / a failure with no end time is timed from its
                 enqueue / finished but the file is gone -> one
  never daytime  a usable file -> none, stale or not (older than 24 h, or its pricing stamp changed) / fresh -> none
  cheap          an unchanged file is fully loaded once, then proved by its (size, mtime); a new file is proved again
  runs           a user's run with no file still queues nothing and builds nothing (B8 pin kept)
  the healer     (owner answer 3 to B9-Q2, "H") the scheduler's call (no boqs) runs the check once, after the healing; a
                 test's narrowed call does not; a failing check never stops the healing; a failing healing still runs
                 the check
"""
import os
import shutil
import tempfile
import time
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from filelock import FileLock
from frappe.tests.utils import FrappeTestCase
from rq.job import JobStatus
from rq.utils import utcnow

from nirmaan_stack.services.boq_rate_match import pool as P
from nirmaan_stack.services.boq_rate_match import pool_autobuild as AB


def _pool(fmt=None):
    return P.Pool({"format": P.POOL_FORMAT if fmt is None else fmt, "rows": [], "kept": set(), "sel": {}, "nxt": {},
                   "as_of": "x", "pricing": {"stamp": {"code": "c", "asset": "a"}}, "secs": {},
                   "driving": {"available": True, "reason": None}})


def _job(status, ended_ago_sec=None, enqueued_ago_sec=0):
    """A stand-in for RQ's record of the fixed job id: its status and when it ended / was enqueued."""
    now = utcnow()
    return SimpleNamespace(get_status=lambda: status, enqueued_at=now - timedelta(seconds=enqueued_ago_sec),
                           ended_at=None if ended_ago_sec is None else now - timedelta(seconds=ended_ago_sec))


class TestAutobuild(FrappeTestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pool_autobuild_test_")
        self.path = os.path.join(self.dir, "boq_rate_match", f"match_pool_v{P.POOL_FORMAT}.pkl")
        self.enqueued, self.memo, self.job = [], {"v": None}, None
        self.tries_key = f"{AB._TRIES_KEY}_test_{frappe.generate_hash(length=10)}"   # this test's own, short-lived

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _check(self, **extra):
        with patch.object(P, "pool_path", return_value=self.path), \
                patch.object(AB, "_TRIES_KEY", self.tries_key), patch.object(AB, "_TRIES_TTL_SEC", 600), \
                patch.object(frappe, "enqueue", side_effect=lambda *a, **k: self.enqueued.append((a, k))), \
                patch("frappe.utils.background_jobs.get_job",
                      side_effect=lambda jid: self.job if jid == AB.REBUILD_JOB_ID else None), \
                patch.object(AB, "_memo_get", side_effect=lambda: self.memo["v"]), \
                patch.object(AB, "_memo_set", side_effect=lambda v: self.memo.update(v=v)), \
                patch.object(P, "build_pool", side_effect=AssertionError("the check never builds inline")):
            return AB.autobuild_pool()

    def _write(self, pool=None):
        P.save_pool(pool or _pool(), self.path)

    def _assert_one_enqueue(self):
        from nirmaan_stack.api.boq.rate_match import POOL_REBUILD_TIMEOUT_SEC
        self.assertEqual(len(self.enqueued), 1)
        a, k = self.enqueued[0]
        self.assertEqual(a, ("nirmaan_stack.services.boq_rate_match.pool.rebuild_pool",))
        self.assertEqual(k, {"queue": "long", "timeout": POOL_REBUILD_TIMEOUT_SEC, "job_id": "boq_match_pool_daily_rebuild",
                             "deduplicate": True})

    # ---- fires once ----
    def test_no_file_queues_exactly_one_rebuild_under_the_fixed_id(self):
        with patch.object(AB.frappe, "logger") as lg:
            out = self._check()
        self.assertEqual(out, {"queued": True, "why": "no pool file"})
        self._assert_one_enqueue()
        lg.return_value.info.assert_called_once()                         # one log line when it queues

    def test_a_missing_folder_is_made_and_one_rebuild_queued(self):
        self.assertFalse(os.path.isdir(os.path.dirname(self.path)))
        out = self._check()
        self.assertTrue(out["queued"])
        self.assertTrue(os.path.isdir(os.path.dirname(self.path)))
        self._assert_one_enqueue()

    def test_an_unreadable_file_queues_one(self):
        os.makedirs(os.path.dirname(self.path))
        with open(self.path, "wb") as f:
            f.write(b"not a pickle")
        out = self._check()
        self.assertTrue(out["queued"])
        self.assertIn("cannot be read", out["why"])
        self._assert_one_enqueue()

    def test_another_format_queues_one(self):
        self._write(_pool(fmt=P.POOL_FORMAT + 98))
        out = self._check()
        self.assertTrue(out["queued"])
        self.assertIn("another format", out["why"])
        self._assert_one_enqueue()

    # ---- never twice ----
    def test_a_second_check_while_the_rebuild_is_queued_queues_none(self):
        self._check()
        self.job = _job(JobStatus.QUEUED)                                 # the first one is now queued
        out = self._check()
        self.assertFalse(out["queued"])
        self.assertIn("already queued", out["why"])
        self.assertEqual(len(self.enqueued), 1)

    def test_a_check_while_the_rebuild_runs_queues_none(self):
        self.job = _job(JobStatus.STARTED)
        out = self._check()
        self.assertFalse(out["queued"])
        self.assertIn("already queued", out["why"])
        self.assertEqual(self.enqueued, [])

    def test_a_check_while_the_build_lock_is_held_queues_none(self):
        os.makedirs(os.path.dirname(self.path))
        with FileLock(self.path + ".lock"):                               # a build is running (rebuild_pool holds it)
            out = self._check()
        self.assertEqual(out, {"queued": False, "why": "a pool build is running"})
        self.assertEqual(self.enqueued, [])

    def test_the_fixed_job_id_is_the_0600_jobs(self):
        from nirmaan_stack.api.boq import rate_match
        seen = []
        with patch.object(frappe, "enqueue", side_effect=lambda *a, **k: seen.append((a, k))):
            rate_match.daily_pool_rebuild()
        self._check()
        self.assertEqual(seen, self.enqueued)                             # same method, queue, timeout, job id, dedupe

    # ---- retries after a failed build ----
    def test_a_failing_build_is_retried_after_growing_waits_and_never_every_5_minutes(self):
        self.assertTrue(self._check()["queued"])                          # try 1
        for try_no, wait_min in enumerate((10, 30, 60, 120, 360, 360), start=2):
            self.job = _job(JobStatus.FAILED, ended_ago_sec=(wait_min - 5) * 60)   # failed; the file is still missing
            out = self._check()
            self.assertFalse(out["queued"], f"try {try_no} came {wait_min - 5} min after a failure")
            self.assertIn(f"next try {wait_min} min after it", out["why"])
            self.job = _job(JobStatus.FAILED, ended_ago_sec=wait_min * 60)
            self.assertTrue(self._check()["queued"], f"try {try_no} is due {wait_min} min after a failure")
        self.assertEqual(len(self.enqueued), 7)

    def test_a_usable_file_clears_the_try_count(self):
        frappe.cache().set_value(self.tries_key, 5, expires_in_sec=600)
        self._write()
        self.assertEqual(self._check(), {"queued": False, "why": None})
        self.path = os.path.join(self.dir, "after_next_deploy", os.path.basename(self.path))   # missing again
        self.job = _job(JobStatus.FAILED, ended_ago_sec=10 * 60)
        self.assertTrue(self._check()["queued"])                          # back to the 10 min step, not 6 h

    def test_a_failed_0600_build_waits_the_first_step(self):
        self.job = _job(JobStatus.FAILED, ended_ago_sec=9 * 60)           # no auto-build try yet
        self.assertFalse(self._check()["queued"])
        self.job = _job(JobStatus.FAILED, ended_ago_sec=10 * 60)
        self.assertTrue(self._check()["queued"])

    def test_a_failure_with_no_end_time_waits_from_its_enqueue(self):
        self.job = _job(JobStatus.FAILED, ended_ago_sec=None, enqueued_ago_sec=60)
        self.assertFalse(self._check()["queued"])
        self.job = _job(JobStatus.FAILED, ended_ago_sec=None, enqueued_ago_sec=10 * 60)
        self.assertTrue(self._check()["queued"])

    def test_a_build_that_finished_but_whose_file_is_gone_is_queued_again(self):
        self.job = _job(JobStatus.FINISHED, ended_ago_sec=60)            # e.g. a deploy removed the file after 06:00
        self.assertTrue(self._check()["queued"])
        self._assert_one_enqueue()

    # ---- never daytime while a usable pool exists ----
    def test_a_fresh_file_queues_none(self):
        self._write()
        self.assertEqual(self._check(), {"queued": False, "why": None})
        self.assertEqual(self.enqueued, [])

    def test_a_stale_usable_file_queues_none(self):
        self._write()
        old = time.time() - 3 * 86400
        os.utime(self.path, (old, old))                                   # older than 24 h (and any stamp): still usable
        with patch.object(P, "_current_stamp", return_value={"code": "other", "asset": "other"}):
            out = self._check()
        self.assertEqual(out, {"queued": False, "why": None})
        self.assertEqual(self.enqueued, [])

    # ---- cheap ----
    def test_an_unchanged_file_is_loaded_once_and_a_new_file_is_proved_again(self):
        self._write()
        real = P.load_pool
        with patch.object(P, "load_pool", side_effect=real) as lp:
            self._check()
            self._check()
            self.assertEqual(lp.call_count, 1)                            # the second check is a stat only
            os.utime(self.path, (time.time() + 5, time.time() + 5))      # the 06:00 job wrote a new file
            self._check()
            self.assertEqual(lp.call_count, 2)
        self.assertEqual(self.enqueued, [])

    # ---- runs ----
    def test_a_users_run_with_no_file_queues_nothing_and_builds_nothing(self):
        from nirmaan_stack.services.boq_rate_match import match_run as MR
        no = AssertionError("a user's run must not build or queue")
        with patch.object(P, "_current_stamp", return_value={"code": "c", "asset": "a"}), \
                patch.object(P, "build_pool", side_effect=no), patch.object(AB, "autobuild_pool", side_effect=no), \
                patch.object(frappe, "enqueue", side_effect=no):
            pool, info = MR.job_pool(path=self.path)
        self.assertIsNone(pool)
        self.assertTrue(info["not_ready"].startswith("pool not ready"))


class TestHealerCarriesTheCheck(FrappeTestCase):
    """tasks/match_run_healer.heal_stale_match_runs (the registered 5-minute job) runs the check on the scheduler's call."""

    def test_the_schedulers_call_runs_the_check_once(self):
        from nirmaan_stack.tasks import match_run_healer as H
        with patch.object(AB, "autobuild_pool", return_value={"queued": False, "why": None}) as ab, \
                patch.object(H.frappe, "get_all", return_value=[]):
            self.assertEqual(H.heal_stale_match_runs(), [])
        ab.assert_called_once_with()

    def test_a_narrowed_call_does_not_run_the_check(self):
        from nirmaan_stack.tasks import match_run_healer as H
        with patch.object(AB, "autobuild_pool") as ab, patch.object(H.frappe, "get_all", return_value=[]):
            H.heal_stale_match_runs(boqs=["NONE"])
        ab.assert_not_called()

    def test_a_failing_check_never_stops_the_healing(self):
        from nirmaan_stack.tasks import match_run_healer as H
        with patch.object(AB, "autobuild_pool", side_effect=RuntimeError("boom")), \
                patch.object(H.frappe, "get_all", return_value=[]) as ga, patch.object(H.frappe, "log_error") as le:
            self.assertEqual(H.heal_stale_match_runs(), [])
        # the healing still ran its own query (frappe's meta loading may call get_all too when its cache is cold)
        self.assertIn("BoQ Rate Match Run", [c.args[0] for c in ga.call_args_list if c.args])
        le.assert_called_once()

    def test_a_failing_healing_still_runs_the_check_after_it(self):
        from nirmaan_stack.tasks import match_run_healer as H
        with patch.object(AB, "autobuild_pool", return_value={"queued": False, "why": None}) as ab, \
                patch.object(H.frappe, "get_all", side_effect=RuntimeError("db gone")):
            with self.assertRaises(RuntimeError):
                H.heal_stale_match_runs()
        ab.assert_called_once_with()
