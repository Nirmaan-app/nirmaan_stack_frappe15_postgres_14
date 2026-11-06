# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for THE POOL RULE of the match run (DEV2-B8 S1, POOL ONLY AT 06:00; services/boq_rate_match/match_run.job_pool
and run_match's no-pool path). Split from test_match_run.py (500-line rule); the harness is that module's. Temp
pool files and mocks only: no model call, the database is never written, nothing is really enqueued.

  the pool rule    (DEV2-B8 S1, POOL ONLY AT 06:00; B6's "one rebuild queued" pins INVERTED, not deleted) stale ->
                   USED, "pool stale" + the stamp it used noted, NOTHING queued  /  two stale runs -> nothing queued  /
                   older than 24 h -> used, nothing queued  /  missing, unreadable or another format -> NOT built,
                   "pool not ready"  /  no file while the 06:00 build holds the lock -> "pool not ready" at once  /
                   fresh -> used  /  the 06:00 job (pool.rebuild_pool) still builds, and the next run uses it  /  the
                   run's usage.pool carries the notes
  no pool file     (DEV2-B8 S1) the run asks NOTHING (no card call, no judge call, no client made), every row in scope
                   carries "pool not ready: ..." as its no_verdict, the run ends COMPLETE (never halted)  /  a
                   selected-row pass still carries the other rows
"""
import json
import os
import shutil
import tempfile
import time
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_match import match_run as MR
from nirmaan_stack.services.boq_rate_match.test_match_run import _Harness


class TestJobPool(FrappeTestCase):
    """THE POOL RULE (DEV2-B8 S1, POOL ONLY AT 06:00): a user's run never builds the pool and never queues a rebuild.
    Every case patches frappe.enqueue to prove nothing is queued from the run path."""

    def setUp(self):
        from nirmaan_stack.services.boq_rate_match import pool as P
        self.P = P
        self.dir = tempfile.mkdtemp(prefix="job_pool_test_")
        self.path = os.path.join(self.dir, "match_pool_v1.pkl")
        self.builds, self.enqueued = 0, []
        self.stamp = {"code": "c1", "asset": "a1"}

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _builder(self, *a, **k):
        self.builds += 1
        return self.P.Pool({"format": self.P.POOL_FORMAT, "rows": [], "kept": set(), "sel": {}, "nxt": {},
                            "pricing": {"stamp": dict(self.stamp)}, "as_of": "x", "n": self.builds, "secs": {},
                            "driving": {"available": True, "reason": None}})

    def _run(self):
        with patch.object(self.P, "_current_stamp", return_value=dict(self.stamp)), \
                patch.object(self.P, "build_pool", side_effect=self._builder), \
                patch.object(frappe, "enqueue", side_effect=lambda *a, **k: self.enqueued.append((a, k))):
            return MR.job_pool(path=self.path)

    def _write_cached(self):
        self.P.save_pool(self._builder(), self.path)
        self.builds = 0

    def test_fresh_and_current_is_used_and_nothing_is_queued(self):
        self._write_cached()
        pool, info = self._run()
        self.assertEqual((pool.n, self.builds, self.enqueued), (1, 0, []))
        self.assertEqual((info["stale"], info["rebuilt"], info["rebuild_queued"], info["not_ready"]),
                         (None, False, False, None))

    def test_a_stale_stamp_is_used_noted_and_nothing_queued(self):
        # INVERTED (DEV2-B8 S1; was ..._and_one_rebuild_queued): used and noted as before, but NOTHING is queued
        self._write_cached()
        self.stamp = {"code": "c1", "asset": "a2"}           # the asset part moved (DEV2-B5 pass 2's case)
        pool, info = self._run()
        self.assertEqual(pool.n, 1)                           # the cached pool, as it is
        self.assertEqual(self.builds, 0)                      # never built inline
        self.assertEqual(self.enqueued, [])                   # never queued
        self.assertTrue(info["stale"].startswith("pool stale"))
        self.assertIn("pricing stamp changed", info["stale"])
        self.assertEqual(info["stamp_used"], {"code": "c1", "asset": "a1"})
        self.assertEqual(info["stamp_current"], {"code": "c1", "asset": "a2"})
        self.assertFalse(info["rebuild_queued"])
        self.assertFalse(info["rebuilt"])

    def test_two_stale_runs_queue_nothing(self):
        # INVERTED (DEV2-B8 S1; was ..._queue_one_rebuild_through_the_real_queue_function): two stale runs, 0 queued
        from nirmaan_stack.api.boq import rate_match as RM
        self._write_cached()
        self.stamp = {"code": "c2", "asset": "a1"}
        _, first = self._run()
        _, second = self._run()
        self.assertEqual(self.enqueued, [])
        self.assertEqual((first["rebuild_queued"], second["rebuild_queued"]), (False, False))
        self.assertTrue(first["stale"] and second["stale"])
        self.assertEqual(self.builds, 0)
        self.assertFalse(hasattr(RM, "queue_pool_rebuild"))  # the run path's queue function is gone

    def test_older_than_24_hours_is_used_and_nothing_queued(self):
        # INVERTED (DEV2-B8 S1; was ..._used_and_queued)
        self._write_cached()
        old = time.time() - self.P.POOL_MAX_AGE_SEC - 60
        os.utime(self.path, (old, old))
        pool, info = self._run()
        self.assertEqual((pool.n, self.builds, self.enqueued), (1, 0, []))
        self.assertIn("older than 24 h", info["stale"])

    def test_a_missing_file_is_not_built_and_the_run_is_told_pool_not_ready(self):
        # INVERTED (DEV2-B8 S1; was test_a_missing_file_is_built_inline_and_nothing_queued)
        pool, info = self._run()
        self.assertIsNone(pool)
        self.assertEqual((self.builds, self.enqueued, info["rebuilt"]), (0, [], False))
        self.assertTrue(info["not_ready"].startswith("pool not ready"))
        self.assertFalse(os.path.exists(self.path))           # no file written

    def test_an_unreadable_file_is_not_built(self):
        # INVERTED (DEV2-B8 S1; was test_an_unreadable_file_is_built_inline)
        with open(self.path, "wb") as f:
            f.write(b"not a pickle")
        pool, info = self._run()
        self.assertIsNone(pool)
        self.assertEqual((self.builds, self.enqueued, info["rebuilt"]), (0, [], False))
        self.assertIn("cannot be read", info["not_ready"])
        with open(self.path, "rb") as f:
            self.assertEqual(f.read(), b"not a pickle")      # left as it is for the 06:00 job

    def test_another_format_is_not_built(self):
        self._write_cached()
        with patch.object(self.P, "POOL_FORMAT", self.P.POOL_FORMAT + 1):
            pool, info = self._run()
        self.assertIsNone(pool)
        self.assertEqual((self.builds, self.enqueued), (0, []))
        self.assertIn("another format", info["not_ready"])

    def test_no_file_while_the_0600_build_holds_the_lock_is_pool_not_ready_at_once(self):
        # INVERTED (DEV2-B8 S1; was test_no_file_and_a_lock_timeout_is_pool_not_ready, which waited on the lock and
        # raised MatchRefused): the run never touches the lock, so it answers at once and never raises
        from filelock import FileLock
        with FileLock(self.path + ".lock"):
            t = time.time()
            pool, info = self._run()
            self.assertLess(time.time() - t, 2.0)
        self.assertIsNone(pool)
        self.assertTrue(info["not_ready"].startswith("pool not ready"))
        self.assertEqual(self.builds, 0)

    def test_the_0600_job_still_builds_and_the_next_run_uses_it(self):
        pool, _ = self._run()
        self.assertIsNone(pool)
        with patch.object(self.P, "pool_path", return_value=self.path), \
                patch.object(self.P, "_current_stamp", return_value=dict(self.stamp)), \
                patch.object(self.P, "build_pool", side_effect=self._builder):
            out = self.P.rebuild_pool()                       # what daily_pool_rebuild enqueues at 06:00
        self.assertEqual((self.builds, out["path"]), (1, self.path))
        pool, info = self._run()
        self.assertEqual((pool.n, info["not_ready"], info["stale"]), (1, None, None))
        self.assertEqual(self.builds, 1)                      # the run itself built nothing

    def test_the_run_notes_the_pool_rule_in_usage_pool(self):
        with _Harness(self) as h:
            MR.run_match("BRMR-1")
        use = json.loads(h.final()["usage"])
        self.assertEqual(use["pool"]["stale"], "pool stale: pricing stamp changed")
        self.assertEqual(use["pool"]["stamp_used"], {"code": "c1", "asset": "a1"})
        self.assertFalse(use["pool"]["rebuild_queued"])       # INVERTED (DEV2-B8 S1; was assertTrue)
        self.assertEqual(use["pool"]["rows"], 6)


class TestNoPoolFile(FrappeTestCase):
    """DEV2-B8 S1: with no usable pool file the run asks nothing and every row says "pool not ready"."""

    def test_every_row_says_pool_not_ready_and_nothing_is_asked(self):
        with _Harness(self, no_pool=True) as h:
            out = MR.run_match("BRMR-1")
        self.assertEqual(out["status"], "complete")
        self.assertEqual((h.cards_asked, h.judged, h.clients), ([], [], []))   # no card call, no judge, no client
        fin = h.final()
        self.assertEqual((fin["status"], fin["active"], fin["halt_reason"]), ("complete", 1, None))
        rows = json.loads(fin["results"])["rows"]
        self.assertEqual([r["excel_row"] for r in rows], [10, 11, 12, 13])
        for r in rows:
            self.assertEqual((r["status"], r["matches"], r["carried"]), ("no verdict", [], False))
            self.assertTrue(r["no_verdict"].startswith("pool not ready"))
        use = json.loads(fin["usage"])
        self.assertEqual((use["judge"]["calls"], use["judge"]["spent_usd"], use["cards"]), (0, 0.0, {}))
        self.assertEqual((use["pool"]["rows"], use["pool"]["rebuild_queued"]), (0, False))
        self.assertTrue(use["pool"]["not_ready"].startswith("pool not ready"))
        self.assertIn((MR.MATCH_DOCTYPE, "BRMR-OLD", "active", 0), [w[:4] for w in h.writes])
        self.assertEqual([w for w in h.writes if w[0] == MR.SUGGEST_DOCTYPE], [])

    def test_a_selected_row_pass_with_no_pool_still_carries_the_other_rows(self):
        prev = {"name": "BRMR-OLD", "commit_version": 3, "results": json.dumps({"rows": [
            {"excel_row": r, "matches": [{"key": "OLD"}], "carried": False} for r in (10, 11, 12, 13)]})}
        with _Harness(self, prev=prev, no_pool=True) as h:
            out = MR.run_match("BRMR-1", only_rows=[11])
        rows = {r["excel_row"]: r for r in json.loads(h.final()["results"])["rows"]}
        self.assertTrue(rows[11]["no_verdict"].startswith("pool not ready"))
        self.assertTrue(all(rows[r]["carried"] and rows[r]["matches"][0]["key"] == "OLD" for r in (10, 12, 13)))
        self.assertEqual(out["usage"]["carried_from"], "BRMR-OLD")
        self.assertEqual(h.cards_asked, [])

    def test_with_a_pool_the_same_harness_does_ask(self):
        # the negative of the two above: the asking path is still the one with a pool
        with _Harness(self) as h:
            MR.run_match("BRMR-1")
        self.assertEqual((h.cards_asked, len(h.judged), len(h.clients)), ([[10, 11, 12, 13]], 1, 1))
