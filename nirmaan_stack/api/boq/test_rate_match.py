# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the match trigger, job and endpoints (DEV2-B4 S2, T1; api/boq/rate_match.py + the trigger call in
rate_master._suggest_worker). Mocks only: no model call, no job is really enqueued, the database and the cache are
reached only through patched seams (nothing is written).

  the trigger      a COMPLETE Suggest run with the switch ON -> exactly one match job, its run doc, marker  /
                   switch OFF -> None, nothing read but the switch, nothing enqueued  /  a live match run on the
                   sheet -> none started (one run per sheet)
  the worker hook  _suggest_worker: complete -> the trigger is called once with the pass's scope and the payload
                   carries "match"  /  partial (halted) -> never called  /  switch OFF -> the payload is EXACTLY the
                   pre-B4 payload (no "match" key)  /  a trigger that raises never fails the Suggest run
  the job          success -> the done payload in the status cache + "boq:match_sheet_done"  /  a failure -> the
                   run marked failed with the reason; the Suggest run is never written
  the clocks       job timeout < stale threshold < marker TTL; the stale threshold clears rq's kill grace
  the endpoints    login only; switch OFF -> {"match_enabled": False} only  /  running / done / idle; the results
                   are the ACTIVE run's, in the stored (display) order
  the 06:00 entry  hooks cron "0 6 * * *" names daily_pool_rebuild; it enqueues pool.rebuild_pool on long with its own
                   timeout (a Cron job runs on default at 300 s)  /  the */5 list carries the match healer
  no run-time rebuild (DEV2-B8 S1, POOL ONLY AT 06:00; B6's queue_pool_rebuild pins INVERTED, not deleted) the run
                   path has no rebuild queue: queue_pool_rebuild is gone and match_run calls no enqueue, build or
                   rebuild  /  the 06:00 job keeps its own deduplicated id  /  a broken queue cannot touch a run
"""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_match as RM
from nirmaan_stack.api.boq import rate_master


class _Cache:
    def __init__(self):
        self.d = {}

    def get_value(self, k):
        return self.d.get(k)

    def set_value(self, k, v, expires_in_sec=None):
        self.d[k] = v

    def delete_value(self, k):
        self.d.pop(k, None)


class TestClocks(FrappeTestCase):

    def test_the_three_move_together_in_order(self):
        self.assertLess(RM._MATCH_JOB_TIMEOUT_SEC, RM._STALE_MATCH_SECONDS)
        self.assertLess(RM._STALE_MATCH_SECONDS, RM._M_MARKER_TTL_SEC)
        self.assertGreaterEqual(RM._STALE_MATCH_SECONDS, RM._MATCH_JOB_TIMEOUT_SEC + RM._RQ_KILL_GRACE_SEC)

    def test_the_paces_are_the_measured_p90s(self):
        # DEV2-B5 S2 (mechanical inversion, the SAFE ESTIMATE ruling 11:11; B4 pinned suggest_seconds_per_row 3.12):
        # Suggest = 13 s + 53 s a batch of 20 rows (p90 fit on 189 stored runs, per batch raised once 48 -> 53 for the
        # >300-row band); matching from B4 S4's 9 sheets (65 s + 0.45 s a row)
        # DEV2-B8 S2 (mechanical, the WAIT ESTIMATE ruling 12:42): + the confirm box's matching part (49 s + 0.40 s a
        # row + 2.0 s a row that needs a new card; test_match_estimate); match_fixed / per_row stay for the time left
        self.assertEqual(RM.PACES, {"suggest_fixed_seconds": 13.0, "suggest_seconds_per_batch": 53.0, "suggest_batch_rows": 20,
                                    "match_fixed_seconds": 65.0, "match_seconds_per_row": 0.45,
                                    "estimate_match_fixed_seconds": 49.0, "estimate_match_seconds_per_row": 0.40,
                                    "estimate_match_seconds_per_card": 2.0})
        self.assertNotIn("suggest_seconds_per_row", RM.PACES)
        self.assertTrue(all(isinstance(v, (int, float)) and v > 0 for v in RM.PACES.values()))

    def test_the_time_left_never_goes_below_zero(self):
        total = RM.PACES["match_fixed_seconds"] + RM.PACES["match_seconds_per_row"] * 10
        self.assertEqual(RM.estimate_left_seconds(10, 0), int(round(total)))
        self.assertEqual(RM.estimate_left_seconds(10, total + 500), 0)


# DEV2-B5 S2: the (pass rows, seconds = run_at - creation) of the 189 stored COMPLETE Suggest runs in dev2 on
# 2026-11-03 (s2_fit.py; a completed selected-row pass sized from the capture log; BRSR-26-00043 / -00044 unsized, out)
STORED_RUNS = (
    (169, 330.2), (12, 31.5), (169, 330.7), (59, 124.3), (28, 65.3), (68, 155.5), (65, 176.4), (106, 182.5),
    (155, 247.2), (27, 48.5), (54, 131.5), (118, 179.0), (202, 348.7), (202, 343.9), (138, 231.2), (91, 144.2),
    (162, 267.3), (225, 391.6), (122, 224.5), (123, 226.6), (124, 223.5), (122, 226.0), (103, 252.9), (45, 146.5),
    (146, 316.0), (147, 292.6), (147, 311.1), (29, 44.3), (70, 141.9), (121, 280.4), (155, 282.0), (200, 451.0),
    (176, 342.7), (200, 424.4), (25, 54.4), (247, 527.7), (113, 168.6), (201, 439.7), (14, 97.9), (152, 334.4),
    (155, 329.1), (127, 260.7), (69, 170.6), (122, 217.9), (65, 193.9), (78, 183.7), (203, 406.0), (193, 729.1),
    (148, 306.6), (65, 177.4), (148, 306.0), (548, 1070.7), (310, 801.9), (260, 703.1), (97, 289.4), (99, 246.6),
    (429, 1049.3), (294, 726.3), (294, 733.6), (134, 313.9), (3, 8.1), (14, 29.0), (146, 376.6), (10, 20.5),
    (111, 246.4), (361, 579.5), (148, 329.9), (30, 101.6), (55, 150.5), (282, 713.5), (282, 729.1), (284, 726.0),
    (199, 454.2), (69, 176.2), (546, 1050.0), (145, 372.4), (13, 14.8), (546, 1066.8), (4, 9.3), (63, 164.9),
    (1, 7.7), (142, 256.3), (153, 390.6), (266, 548.7), (134, 331.6), (197, 469.7), (44, 169.6), (44, 187.6),
    (154, 386.9), (47, 86.1), (47, 87.1), (455, 1113.0), (357, 976.9), (455, 1111.9), (45, 69.1), (26, 82.1),
    (85, 122.7), (206, 540.9), (30, 62.4), (221, 487.0), (217, 492.2), (108, 179.2), (35, 82.9), (202, 418.0),
    (52, 91.2), (141, 362.8), (293, 738.2), (35, 89.7), (36, 79.3), (6, 6.6), (85, 150.6), (32, 7.9), (118, 247.8),
    (16, 50.1), (81, 209.6), (11, 38.0), (97, 223.5), (143, 292.9), (14, 24.7), (18, 42.6), (119, 242.6), (23, 46.4),
    (145, 403.2), (66, 102.7), (198, 432.4), (24, 17.1), (73, 112.3), (16, 22.3), (156, 351.0), (2, 6.4), (42, 71.6),
    (1, 4.8), (12, 61.6), (51, 114.0), (13, 30.7), (184, 422.6), (66, 151.0), (94, 166.7), (51, 160.2), (163, 362.6),
    (77, 267.5), (19, 33.2), (56, 173.2), (217, 499.7), (64, 106.4), (56, 160.1), (52, 100.4), (195, 372.7),
    (190, 443.1), (42, 116.1), (45, 89.0), (100, 201.4), (14, 60.7), (5, 20.5), (43, 104.7), (96, 198.1),
    (185, 413.5), (68, 117.9), (39, 162.2), (213, 495.4), (16, 29.8), (46, 141.8), (171, 365.9), (23, 69.3),
    (17, 29.7), (17, 31.0), (73, 174.3), (28, 76.7), (3, 8.3), (28, 74.1), (28, 74.4), (94, 177.5), (3, 7.9),
    (19, 35.6), (44, 119.0), (94, 187.3), (34, 99.1), (280, 674.7), (20, 47.1), (20, 49.7), (20, 47.6), (81, 195.3),
    (111, 222.4), (41, 127.5), (83, 197.5), (39, 131.0), (99, 247.4), (83, 238.0), (20, 202.7),
)


class TestSuggestEstimate(FrappeTestCase):
    """THE SAFE ESTIMATE (owner 2026-11-03 11:11 "give a safe number"): Suggest = fixed + ceil(rows / 20) x per batch,
    rounded UP to whole minutes; on the stored runs it covers >= 90 % in EVERY size band."""

    def test_the_formula(self):
        # 20 rows = 1 batch: ceil((13 + 53) / 60) = 2; 21 rows = 2 batches: ceil(119 / 60) = 2; 206 = 11: ceil(596 / 60) = 10
        self.assertEqual([RM.suggest_estimate_minutes(n) for n in (0, 1, 20, 21, 40, 41, 206, 361)], [1, 2, 2, 2, 2, 3, 10, 17])

    def test_the_batch_term_counts_batches_not_rows(self):
        self.assertEqual(RM.suggest_estimate_minutes(1), RM.suggest_estimate_minutes(20))
        self.assertLess(RM.suggest_estimate_minutes(20), RM.suggest_estimate_minutes(400))

    def test_coverage_is_at_least_90_percent_in_every_band(self):
        cov = RM.estimate_coverage(STORED_RUNS)
        self.assertEqual(sum(n for _, n in cov.values()), 189)
        self.assertEqual(cov, {(1, 20): (30, 31), (21, 100): (70, 74), (101, 300): (74, 75), (301, None): (9, 9)})
        for band, (covered, n) in cov.items():
            self.assertGreaterEqual(covered / n, 0.9, band)

    def test_the_unadjusted_fit_and_the_b4_pace_each_miss_a_band(self):
        fit = dict(RM.PACES, suggest_seconds_per_batch=48.0)          # the p90 fit before the one adjustment
        self.assertLess(min(c / n for c, n in RM.estimate_coverage(STORED_RUNS, fit).values()), 0.9)
        import math
        b4 = {(lo, hi): (sum(1 for r, s in STORED_RUNS if lo <= r and (hi is None or r <= hi) and max(1, math.ceil(r * 3.12 / 60)) * 60 >= s),
                         sum(1 for r, s in STORED_RUNS if lo <= r and (hi is None or r <= hi))) for lo, hi in RM.SIZE_BANDS}
        self.assertLess(b4[(1, 20)][0] / b4[(1, 20)][1], 0.9)        # B4's 3.12 s a row under-ran the small passes


class TestTrigger(FrappeTestCase):

    def setUp(self):
        frappe.utils.now()          # warm the system settings before frappe.db is patched
        self.cache = _Cache()
        self.p = [patch.object(frappe, "cache", return_value=self.cache),
                  patch.object(frappe.db, "commit"),
                  patch.object(frappe, "log_error")]
        for p in self.p:
            p.start()

    def tearDown(self):
        for p in reversed(self.p):
            p.stop()

    def test_the_switch_is_the_stored_value_whatever_the_cache_holds(self):
        # a mocked or stale cache never turns matching on (DEV2-B4 C2 fix loop: test_rate_master's harness mocks
        # frappe.cache, and a meta-based read then read the switch as ON)
        from unittest.mock import MagicMock as MM
        with patch.object(frappe, "cache", return_value=MM()):
            with patch.object(frappe.db, "get_single_value", return_value=None):
                self.assertFalse(RM.match_enabled())
            with patch.object(frappe.db, "get_single_value", return_value="0"):
                self.assertFalse(RM.match_enabled())
            with patch.object(frappe.db, "get_single_value", return_value="1"):
                self.assertTrue(RM.match_enabled())
            with patch.object(frappe.db, "get_single_value", side_effect=RuntimeError("db gone")):
                self.assertFalse(RM.match_enabled())

    def test_switch_off_returns_none_and_enqueues_nothing(self):
        with patch.object(RM, "match_enabled", return_value=False), patch.object(frappe, "enqueue") as enq, \
                patch.object(frappe.db, "get_value") as gv:
            self.assertIsNone(RM.start_after_suggest("B", "S", "run1"))
        enq.assert_not_called()
        gv.assert_not_called()

    def test_switch_on_enqueues_exactly_one_job_with_its_own_marker(self):
        doc = MagicMock()
        doc.name = "BRMR-9"
        with patch.object(RM, "match_enabled", return_value=True), patch.object(frappe, "enqueue") as enq, \
                patch.object(frappe.db, "get_value", return_value={"name": "BRSR-1", "committed_version": 4}), \
                patch.object(frappe, "get_doc", return_value=doc) as gd:
            out = RM.start_after_suggest("B", "S", "run1", only_rows=[5, 3], user="u@x")
        self.assertEqual(out, {"queued": True, "run": "BRMR-9"})
        self.assertEqual(enq.call_count, 1)
        args, kw = enq.call_args
        self.assertEqual(args[0], RM.WORKER)
        self.assertEqual((kw["queue"], kw["timeout"], kw["run_name"], kw["only_rows"]), ("long", RM._MATCH_JOB_TIMEOUT_SEC, "BRMR-9", [5, 3]))
        made = gd.call_args[0][0]
        self.assertEqual((made["status"], made["active"], made["suggest_run"], made["commit_version"]), ("queued", 0, "BRSR-1", 4))
        self.assertEqual(made["job_id"], kw["job_id"])
        m = self.cache.d[RM._marker_key("B", "S")]
        self.assertEqual((m["job_id"], m["run"]), (kw["job_id"], "BRMR-9"))

    def test_one_run_per_sheet_a_live_match_starts_none(self):
        self.cache.set_value(RM._marker_key("B", "S"), {"job_id": "j", "enqueued_at": frappe.utils.now()})
        with patch.object(RM, "match_enabled", return_value=True), patch.object(frappe, "enqueue") as enq, \
                patch.object(RM, "get_job_status", return_value="started"):
            out = RM.start_after_suggest("B", "S", "run1")
        self.assertEqual(out["queued"], False)
        enq.assert_not_called()

    def test_an_error_is_logged_and_never_raised(self):
        with patch.object(RM, "match_enabled", return_value=True), \
                patch.object(frappe.db, "get_value", side_effect=RuntimeError("db gone")), patch.object(frappe.db, "rollback"):
            out = RM.start_after_suggest("B", "S", "run1")
        self.assertEqual(out, {"queued": False, "reason": "matching could not be started"})


def _env(complete=True):
    return {"committed_version": 4, "ai_status": "ran", "results": [{"excel_row": 7, "attributes": {}}],
            "attempted_rows": [7], "population_rows": [7] if complete else [7, 8], "complete": complete,
            "halt_reason": None if complete else "usage limit"}


class TestSuggestWorkerHook(FrappeTestCase):
    """rate_master._suggest_worker calls the trigger only for a COMPLETE run; with the switch OFF its payload is the
    pre-B4 payload exactly."""

    def _run(self, env, trigger_return=None, trigger_raises=False):
        cache = _Cache()
        published = []
        calls = []

        def trig(*a, **k):
            calls.append((a, k))
            if trigger_raises:
                raise RuntimeError("boom")
            return trigger_return

        with patch.object(frappe, "cache", return_value=cache), \
                patch.object(rate_master, "_resolve_committed_version", return_value=4), \
                patch.object(rate_master, "_open_run_doc", return_value=("BRSR-1", "run1", [], [], None)), \
                patch.object(rate_master.extraction, "run_extraction", return_value=env), \
                patch.object(rate_master, "_finalise_run"), patch.object(rate_master, "_write_run_progress"), \
                patch.object(frappe.db, "commit"), patch.object(frappe, "log_error"), \
                patch.object(frappe, "publish_realtime", side_effect=lambda ev, p, **k: published.append((ev, p))), \
                patch("nirmaan_stack.api.boq.rate_match.start_after_suggest", side_effect=trig):
            rate_master._suggest_worker(boq="B", sheet_name="S", user="u@x")
        return calls, published[-1], cache

    def test_complete_calls_the_trigger_once_and_the_payload_carries_it(self):
        calls, (ev, payload), _c = self._run(_env(True), trigger_return={"queued": True, "run": "BRMR-1"})
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0][:3], ("B", "S", "run1"))
        self.assertEqual(ev, "boq:suggest_sheet_done")
        self.assertEqual(payload["match"], {"queued": True, "run": "BRMR-1"})
        self.assertEqual(payload["status"], "success")

    def test_a_halted_run_starts_no_match(self):
        calls, (_ev, payload), _c = self._run(_env(False), trigger_return={"queued": True, "run": "X"})
        self.assertEqual(calls, [])
        self.assertEqual(payload["status"], "partial")
        self.assertNotIn("match", payload)

    def test_switch_off_leaves_the_payload_exactly_as_before(self):
        calls, (_ev, payload), _c = self._run(_env(True), trigger_return=None)
        self.assertEqual(len(calls), 1)
        self.assertEqual(sorted(payload), sorted(["status", "boq", "sheet_name", "committed_version", "run_id", "ai_status",
                                                 "run_status", "results", "attempted_count", "population_count",
                                                 "halt_reason", "scoped_row_count", "pass_attempted_count"]))

    def test_a_trigger_that_raises_never_fails_the_suggest_run(self):
        calls, (_ev, payload), _c = self._run(_env(True), trigger_raises=True)
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["run_status"], "complete")
        self.assertNotIn("match", payload)


class TestMatchWorker(FrappeTestCase):

    def test_success_records_the_done_payload_and_publishes(self):
        cache, pub = _Cache(), []
        with patch.object(frappe, "cache", return_value=cache), \
                patch("nirmaan_stack.services.boq_rate_match.match_run.run_match",
                      return_value={"status": "complete", "halt_reason": None, "rows_total": 3, "rows_done": 3}), \
                patch.object(frappe, "publish_realtime", side_effect=lambda ev, p, **k: pub.append((ev, p))):
            out = RM._match_worker(run_name="BRMR-1", boq="B", sheet_name="S", suggest_run_id="run1")
        self.assertEqual((out["status"], out["run"], out["suggest_run_id"]), ("success", "BRMR-1", "run1"))
        self.assertEqual(cache.d[RM._status_key("B", "S")]["status"], "success")
        self.assertEqual(pub[-1][0], "boq:match_sheet_done")

    def test_a_failure_marks_the_match_run_failed_and_never_writes_the_suggest_run(self):
        from nirmaan_stack.services.boq_rate_match import match_run as MR
        writes = []
        with patch.object(frappe, "cache", return_value=_Cache()), \
                patch("nirmaan_stack.services.boq_rate_match.match_run.run_match", side_effect=MR.MatchRefused("switched off")), \
                patch.object(frappe.db, "set_value", side_effect=lambda *a, **k: writes.append(a)), \
                patch.object(frappe.db, "commit"), patch.object(frappe.db, "rollback"), patch.object(frappe, "log_error"), \
                patch.object(frappe, "publish_realtime"):
            out = RM._match_worker(run_name="BRMR-1", boq="B", sheet_name="S", suggest_run_id="run1")
        self.assertEqual((out["status"], out["halt_reason"]), ("error", "switched off"))
        self.assertEqual(writes, [(RM.MATCH_DOCTYPE, "BRMR-1", {"status": "failed", "halt_reason": "switched off"})])


class TestEndpoints(FrappeTestCase):

    def setUp(self):
        self.cache = _Cache()
        self.p = patch.object(frappe, "cache", return_value=self.cache)
        self.p.start()

    def tearDown(self):
        self.p.stop()

    def test_login_is_required(self):
        with patch.object(frappe.local, "session", frappe._dict(user="Guest")):
            with self.assertRaises(frappe.PermissionError):
                RM.get_match_status("B", "S")
            with self.assertRaises(frappe.PermissionError):
                RM.get_match_results("B", "S")

    def test_switch_off_says_so_and_nothing_else(self):
        with patch.object(RM, "match_enabled", return_value=False):
            self.assertEqual(RM.get_match_status("B", "S"), {"match_enabled": False})

    def test_running_done_and_idle(self):
        with patch.object(RM, "match_enabled", return_value=True):
            self.assertEqual(RM.get_match_status("B", "S")["state"], "idle")
            self.cache.set_value(RM._marker_key("B", "S"), {"job_id": "j", "enqueued_at": frappe.utils.now(), "phase": "judge",
                                                            "done": 4, "total": 10, "run": "BRMR-1", "suggest_run_id": "r"})
            with patch.object(RM, "get_job_status", return_value="started"):
                st = RM.get_match_status("B", "S")
            self.assertEqual((st["state"], st["phase"], st["done"], st["total"], st["suggest_run_id"]), ("running", "judge", 4, 10, "r"))
            self.assertIn("estimate_left_s", st)
            self.assertEqual(st["paces"], RM.PACES)
            self.cache.set_value(RM._status_key("B", "S"), {"status": "success", "run": "BRMR-1"})
            self.assertEqual(RM.get_match_status("B", "S")["state"], "done")

    def test_results_are_the_active_runs_rows_as_stored(self):
        rows = [{"excel_row": 3, "matches": [{"key": "g", "colour": "green"}, {"key": "a", "colour": "amber"}]}]
        got = [{"name": "BRMR-2", "status": "complete", "commit_version": 4, "suggest_run": "BRSR-1", "run_at": None,
                "results": json.dumps({"rows": rows}), "usage": json.dumps({"judge": {"spent_usd": 0.1}})}]
        # DEV2-B5 S3 (mechanical inversion, R-H2AI): the stored rows are returned as stored, and each shown match gains
        # `flag` (its latest "not a match" feedback; none here) and `description` (the matched row's text; none here).
        with patch.object(frappe, "get_all", return_value=got) as ga, patch.object(RM, "current_flags", return_value={}) as cf, \
                patch.object(frappe.db, "sql", return_value=[]):
            out = RM.get_match_results("B", "S")
        self.assertEqual(ga.call_args.kwargs["filters"], {"boq": "B", "sheet_name": "S", "active": 1})
        cf.assert_called_once_with("B", "S", 4)
        self.assertEqual([{**r, "matches": [{k: v for k, v in m.items() if k not in ("flag", "description")} for m in r["matches"]]}
                          for r in out["run"]["rows"]], rows)
        self.assertEqual({(m["flag"], m["description"]) for r in out["run"]["rows"] for m in r["matches"]}, {(None, None)})
        self.assertEqual(out["run"]["usage"]["judge"]["spent_usd"], 0.1)
        with patch.object(frappe, "get_all", return_value=[]):
            self.assertEqual(RM.get_match_results("B", "S"), {"run": None})


class TestSchedulerEntries(FrappeTestCase):

    def test_the_0600_cron_names_the_daily_rebuild_and_the_healer_is_in_the_five_minute_list(self):
        cron = frappe.get_hooks("scheduler_events")["cron"]
        self.assertIn("nirmaan_stack.api.boq.rate_match.daily_pool_rebuild", cron["0 6 * * *"])
        self.assertIn("nirmaan_stack.tasks.match_run_healer.heal_stale_match_runs", cron["*/5 * * * *"])
        self.assertIn("nirmaan_stack.tasks.suggest_run_healer.heal_stale_suggestion_runs", cron["*/5 * * * *"])

    def test_the_daily_rebuild_enqueues_rebuild_pool_on_long_with_its_own_timeout(self):
        with patch.object(frappe, "enqueue") as enq:
            self.assertTrue(RM.daily_pool_rebuild())
        args, kw = enq.call_args
        self.assertEqual(args[0], "nirmaan_stack.services.boq_rate_match.pool.rebuild_pool")
        self.assertEqual((kw["queue"], kw["timeout"], kw["deduplicate"]), ("long", RM.POOL_REBUILD_TIMEOUT_SEC, True))
        self.assertGreater(RM.POOL_REBUILD_TIMEOUT_SEC, 300)
        frappe.get_attr(args[0])       # the target resolves to pool.rebuild_pool (it is not called here)


class TestQueuePoolRebuild(FrappeTestCase):
    """DEV2-B8 S1 (POOL ONLY AT 06:00): INVERTED from DEV2-B6's "the one background rebuild a stale run asks for".
    The run path has no rebuild queue any more; the 06:00 job is the only automatic build."""

    def test_the_run_path_has_no_rebuild_queue_and_the_daily_job_keeps_its_id(self):
        # INVERTED (was test_it_queues_rebuild_pool_on_long_under_the_daily_jobs_id)
        self.assertFalse(hasattr(RM, "queue_pool_rebuild"))
        self.assertFalse(hasattr(RM, "POOL_REBUILD_JOB_ID"))
        with patch.object(frappe, "enqueue") as enq:
            RM.daily_pool_rebuild()
        args, kw = enq.call_args
        self.assertEqual(args[0], "nirmaan_stack.services.boq_rate_match.pool.rebuild_pool")
        self.assertEqual((kw["queue"], kw["timeout"], kw["job_id"], kw["deduplicate"]),
                         ("long", RM.POOL_REBUILD_TIMEOUT_SEC, "boq_match_pool_daily_rebuild", True))

    def test_the_match_run_calls_no_enqueue_build_or_rebuild(self):
        # INVERTED (was test_one_already_queued_or_running_queues_nothing): nothing in the run path can queue or build.
        # Every name and attribute the module's CODE uses (docstrings and comments do not count).
        import ast
        import inspect
        from nirmaan_stack.services.boq_rate_match import match_run as MR
        used = set()
        for node in ast.walk(ast.parse(inspect.getsource(MR))):
            if isinstance(node, ast.Name):
                used.add(node.id)
            elif isinstance(node, ast.Attribute):
                used.add(node.attr)
            elif isinstance(node, ast.alias):
                used.add(node.name.split(".")[-1])
        self.assertIn("load_pool", used)                     # the scan sees the pool calls the run does make
        for name in ("enqueue", "enqueue_doc", "queue_pool_rebuild", "ensure_pool", "build_pool", "rebuild_pool",
                     "save_pool", "FileLock", "Timeout"):
            self.assertNotIn(name, used, name)

    def test_a_broken_queue_cannot_touch_a_run(self):
        # INVERTED (was test_a_queue_error_never_raises): with enqueue raising, a stale run's pool rule still answers
        import os
        import shutil
        import tempfile
        from nirmaan_stack.services.boq_rate_match import match_run as MR, pool as P
        d = tempfile.mkdtemp(prefix="rm_pool_test_")
        self.addCleanup(shutil.rmtree, d, True)
        path = os.path.join(d, "match_pool_v1.pkl")
        P.save_pool(P.Pool({"format": P.POOL_FORMAT, "rows": [], "kept": set(), "sel": {}, "nxt": {},
                            "pricing": {"stamp": {"code": "old"}}, "as_of": "x"}), path)
        with patch.object(P, "_current_stamp", return_value={"code": "new"}), \
                patch.object(frappe, "enqueue", side_effect=RuntimeError("redis down")) as enq:
            pool, info = MR.job_pool(path=path)
        self.assertIsNotNone(pool)
        self.assertTrue(info["stale"].startswith("pool stale"))
        enq.assert_not_called()
