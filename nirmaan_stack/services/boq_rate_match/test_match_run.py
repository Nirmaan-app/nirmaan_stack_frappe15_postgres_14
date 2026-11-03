# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the match run (DEV2-B4 S2, T1; services/boq_rate_match/match_run.py + match_targets.py). Mocks and fixtures
only: no model call, and the database is never written (every read and write the run makes goes through a patched seam).

  display order    green, then amber, then red; within a colour the judge's own order  /  DIFFERENT never shown
  the entry        a match carries the candidate's boq / sheet / excel_row, verdict, colour, N1b note, the stored rates,
                   unit and date priced; the judge's raw order is kept  /  no verdict and no candidates are named
  the pass         every row of a whole-sheet run is matched; cards are asked for the target rows only (reuse is
                   card_sheet's own); a BoQ's identical rows share one judge call
  only_rows        those rows only; every other row CARRIED from the previous active run at the same version  /  a
                   previous run at another version carries nothing
  complete         active=1 and the prior active run retired  /  a runner stop -> halted, active stays 0
  fails closed     switch off / Suggest run not active -> MatchRefused before any read of the pool  /  the Suggest run
                   is never written
  forked lanes     the lists from N forked processes = the lists from one process, in target order
"""
import json
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_match import match_run as MR
from nirmaan_stack.services.boq_rate_match import match_targets as MTG


def _vmap():
    # judge's own order (pos): c3 first, then c1, c4, c2, c5
    return {"P|S|1": {"v": "CLOSE", "pos": 1}, "P|S|2": {"v": "SAME", "pos": 3}, "P|S|3": {"v": "UNCLEAR", "pos": 0},
            "P|S|4": {"v": "SAME", "pos": 2}, "P|S|5": {"v": "DIFFERENT", "pos": 4},
            "P|S|6": {"v": "CLOSE", "pos": 5, "n1b": {"rule": "a", "field": "size_mm"}}}


def _pool():
    rows = [{"key": f"P|S|{i}", "boq": "P", "sheet": "S", "row": i, "unit_raw": "Nos",
             "rates": {"supply_rate": 10.0 * i, "install_rate": 2.0, "combined_rate": 10.0 * i + 2},
             "rate_at": {"supply_rate": "2026-10-0%d 10:00:00" % i, "install_rate": "2026-10-01 09:00:00"}} for i in range(1, 7)]
    return SimpleNamespace(rows=rows, byk={r["key"]: i for i, r in enumerate(rows)}, as_of="2026-11-03 06:00:00",
                           driving={"lists": {}})


class TestDisplayOrder(FrappeTestCase):

    def test_green_then_amber_then_red_each_in_the_judges_order(self):
        shown = MR.display_order(_vmap())
        self.assertEqual([m["key"] for m in shown], ["P|S|4", "P|S|2", "P|S|3", "P|S|1", "P|S|6"])
        self.assertEqual([m["colour"] for m in shown], ["green", "green", "amber", "red", "red"])

    def test_different_is_never_shown(self):
        self.assertNotIn("P|S|5", [m["key"] for m in MR.display_order(_vmap())])
        only_diff = {"P|S|5": {"v": "DIFFERENT", "pos": 0}}
        self.assertEqual(MR.display_order(only_diff), [])

    def test_the_old_rank_order_is_not_the_display_order(self):
        # the negative half: judge.ordered (SAME > CLOSE > UNCLEAR) puts red before amber; the display order does not
        from nirmaan_stack.services.boq_rate_match import judge as J
        old = [k for k in J.ordered(_vmap()) if _vmap()[k]["v"] != "DIFFERENT"]
        self.assertNotEqual(old, [m["key"] for m in MR.display_order(_vmap())])


class TestEntry(FrappeTestCase):

    def test_a_match_carries_identity_rates_unit_and_date_priced(self):
        m = MR.match_entry({"key": "P|S|2", "verdict": "SAME", "colour": "green", "n1b": None}, _pool())
        self.assertEqual((m["boq"], m["sheet_name"], m["excel_row"]), ("P", "S", 2))
        self.assertEqual((m["supply_rate"], m["install_rate"], m["total_rate"], m["unit"]), (20.0, 2.0, 22.0, "Nos"))
        self.assertEqual(m["priced_at"], "2026-10-02 10:00:00")
        self.assertEqual((m["verdict"], m["colour"]), ("SAME", "green"))

    def test_the_row_entry_keeps_the_judges_raw_order_and_names_the_empty_cases(self):
        t = {"excel_row": 7, "key": "T|S|7"}
        raw = {"P|S|1": {"v": "SAME", "pos": 1}, "P|S|2": {"v": "DIFFERENT", "pos": 0}}
        x = {"no_verdict": None, "verdicts": {"P|S|1": {"v": "SAME", "pos": 1}, "P|S|2": {"v": "DIFFERENT", "pos": 0}},
             "raw_verdicts": raw}
        e = MR.row_entry(t, x, _pool())
        self.assertEqual(e["status"], "matched")
        self.assertEqual([m["key"] for m in e["matches"]], ["P|S|1"])
        self.assertEqual(e["judge_order"], [{"key": "P|S|2", "verdict": "DIFFERENT"}, {"key": "P|S|1", "verdict": "SAME"}])
        self.assertEqual(MR.row_entry(t, None, _pool())["status"], "no candidates")
        nv = MR.row_entry(t, {"no_verdict": "the model refused"}, _pool())
        self.assertEqual((nv["status"], nv["no_verdict"], nv["matches"]), ("no verdict", "the model refused", []))
        only_diff = MR.row_entry(t, {"no_verdict": None, "verdicts": {"P|S|2": {"v": "DIFFERENT", "pos": 0}},
                                     "raw_verdicts": {"P|S|2": {"v": "DIFFERENT", "pos": 0}}}, _pool())
        self.assertEqual((only_diff["status"], only_diff["matches"]), ("no match shown", []))


# ---- run_match, every seam patched ------------------------------------------------------------------------------
SUGGEST = {"name": "BRSR-1", "active": 1, "status": "complete", "committed_version": 3, "boq": "T", "sheet_name": "S",
           "results": json.dumps([{"excel_row": r} for r in (10, 11, 12, 13)])}


def _target(er, same=False):
    return {"key": f"T|S|{er}", "id": f"T|S|{er}", "excel_row": er, "self": "same row" if same else f"row {er}",
            "parent": "p", "upper": "u", "desc": "row", "unit": "nos"}


class _Harness:
    """Patches every seam of run_match; records the writes."""

    def __init__(self, test, *, enabled=True, suggest=None, prev=None, stop=None, same_text=False):
        self.writes, self.cards_asked = [], []
        self.t = test
        run = {"boq": "T", "sheet_name": "S", "commit_version": None, "suggest_run": "BRSR-1"}
        srun = SUGGEST if suggest is None else suggest

        real_get_value, real_get_all = frappe.db.get_value, frappe.get_all

        def get_value(dt, *a, **k):
            # only the two run doctypes are faked; every other read (System Settings, meta) is the real one
            if dt == MR.MATCH_DOCTYPE:
                return run
            if dt == MR.SUGGEST_DOCTYPE:
                return srun
            return real_get_value(dt, *a, **k)

        def get_all(dt, *a, filters=None, fields=None, order_by=None, limit=None, pluck=None, **k):
            if dt != MR.MATCH_DOCTYPE:
                return real_get_all(dt, *a, filters=filters, fields=fields, order_by=order_by, limit=limit, pluck=pluck, **k)
            if pluck:
                return ["BRMR-OLD"]
            return [prev] if prev else []

        def build_targets(boq, sheet, scope, pool, asset):
            return [_target(er, same_text) for er in scope], \
                {"not_in_run": [], "pricing_available": True, "pricing_reason": None, "with_card": len(scope)}

        def judge_items(items, seed, settings, client):
            out = {}
            for it in items:
                out[it["target"]["id"]] = {"no_verdict": None, "verdicts": {"P|S|1": {"v": "SAME", "pos": 0}},
                                           "raw_verdicts": {"P|S|1": {"v": "SAME", "pos": 0}}}
            return {"targets": out, "run": {"stop_reason": stop, "stop_detail": "429 x" if stop else None,
                                            "tokens_in": 100, "tokens_out": 10, "spent_usd": 0.01}}

        def card_sheet(boq, sheet, excel_rows=None, client=None, settings=None):
            self.cards_asked.append(list(excel_rows))
            return {"reused": 1, "ok": len(excel_rows) - 1, "spent_usd": 0.002, "tokens_in": 50, "tokens_out": 5}

        js = {"model": "j", "reply_max_tokens": 10, "price_in": 0.1, "price_out": 0.5}
        self.p = [
            patch.object(frappe.db, "get_value", side_effect=get_value),
            patch.object(frappe.db, "set_value", side_effect=lambda *a, **k: self.writes.append(a)),
            patch.object(frappe.db, "commit"),
            patch.object(frappe, "get_all", side_effect=get_all),
            patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_match_settings", return_value={"match_enabled": enabled}),
            patch("nirmaan_stack.api.boq.wizard.ai_settings.require_match_settings", return_value=js),
            patch("nirmaan_stack.api.boq.wizard.ai_settings.match_lane_workers", return_value=2),
            patch("nirmaan_stack.services.boq_rate_match.pool.ensure_pool", return_value=(_pool(), False)),
            patch("nirmaan_stack.services.boq_rate_match.pricing_step.load_asset", return_value=({"configs": {}}, "v")),
            patch("nirmaan_stack.services.boq_rate_match.cards.card_sheet", side_effect=card_sheet),
            patch.object(MTG, "build_targets", side_effect=build_targets),
            patch.object(MTG, "lanes_forked", side_effect=lambda ts, pool, n: [[{"key": "P|S|1"}] for _ in ts]),
            patch("nirmaan_stack.services.boq_rate_match.judge.prepare",
                  side_effect=lambda lists, pool, asset=None: ([{"target": t, "candidates": [{"key": "P|S|1"}]} for t, _e in lists], {})),
            patch("nirmaan_stack.services.boq_rate_match.judge.requests_for",
                  side_effect=lambda items, seed, s: ([{"id": it["target"]["id"], "content": it["target"]["id"]} for it in items], [])),
            patch("nirmaan_stack.services.boq_rate_match.judge.judge_items", side_effect=judge_items),
            patch("nirmaan_stack.services.boq_rate_match.call_runner.make_client", return_value=SimpleNamespace()),
        ]

    def __enter__(self):
        frappe.utils.now()          # warm the system settings before frappe.db is patched
        for p in self.p:
            p.start()
        return self

    def __exit__(self, *a):
        for p in reversed(self.p):
            p.stop()

    def final(self):
        return [w for w in self.writes if w[0] == MR.MATCH_DOCTYPE and isinstance(w[2], dict) and "results" in w[2]][-1][2]


class TestRunMatch(FrappeTestCase):

    def test_a_whole_sheet_run_matches_every_row_and_cards_only_those(self):
        with _Harness(self) as h:
            out = MR.run_match("BRMR-1")
        self.assertEqual(out["status"], "complete")
        self.assertEqual(h.cards_asked, [[10, 11, 12, 13]])
        fin = h.final()
        rows = json.loads(fin["results"])["rows"]
        self.assertEqual([r["excel_row"] for r in rows], [10, 11, 12, 13])
        self.assertTrue(all(r["matches"][0]["key"] == "P|S|1" and not r["carried"] for r in rows))
        self.assertEqual((fin["status"], fin["active"]), ("complete", 1))
        use = json.loads(fin["usage"])
        self.assertEqual((use["cards"]["spent_usd"], use["judge"]["spent_usd"]), (0.002, 0.01))
        self.assertIn("lanes", use["seconds"])
        # the prior active run is retired, and the Suggest run is never written
        self.assertIn((MR.MATCH_DOCTYPE, "BRMR-OLD", "active", 0), [w[:4] for w in h.writes])
        self.assertEqual([w for w in h.writes if w[0] == MR.SUGGEST_DOCTYPE], [])

    def test_identical_rows_share_one_judge_call(self):
        with _Harness(self, same_text=True) as h:
            out = MR.run_match("BRMR-1")
        self.assertEqual(out["usage"]["judge"]["calls"], 1)
        self.assertEqual(out["usage"]["rows"]["judged_once"], 1)
        rows = json.loads(h.final()["results"])["rows"]
        self.assertEqual([r["same_as_row"] for r in rows], [None, 10, 10, 10])
        self.assertTrue(all(r["matches"][0]["key"] == "P|S|1" for r in rows))

    def test_only_rows_matches_those_and_carries_the_rest_at_the_same_version(self):
        prev = {"name": "BRMR-OLD", "commit_version": 3, "results": json.dumps({"rows": [
            {"excel_row": r, "matches": [{"key": "OLD"}], "carried": False} for r in (10, 11, 12, 13)]})}
        with _Harness(self, prev=prev) as h:
            out = MR.run_match("BRMR-1", only_rows=[11, 99])
        self.assertEqual(h.cards_asked, [[11]])
        rows = {r["excel_row"]: r for r in json.loads(h.final()["results"])["rows"]}
        self.assertEqual(sorted(rows), [10, 11, 12, 13])
        self.assertEqual(rows[11]["matches"][0]["key"], "P|S|1")
        self.assertFalse(rows[11]["carried"])
        self.assertTrue(all(rows[r]["carried"] and rows[r]["matches"][0]["key"] == "OLD" for r in (10, 12, 13)))
        self.assertEqual(out["usage"]["carried_from"], "BRMR-OLD")

    def test_a_previous_run_at_another_version_carries_nothing(self):
        prev = {"name": "BRMR-OLD", "commit_version": 2, "results": json.dumps({"rows": [{"excel_row": 10}]})}
        with _Harness(self, prev=prev) as h:
            MR.run_match("BRMR-1", only_rows=[11])
        rows = json.loads(h.final()["results"])["rows"]
        self.assertEqual([r["excel_row"] for r in rows], [11])

    def test_a_resume_matches_the_rows_the_previous_run_has_not(self):
        prev = {"name": "BRMR-OLD", "commit_version": 3, "results": json.dumps({"rows": [
            {"excel_row": r, "matches": []} for r in (10, 11)]})}
        with _Harness(self, prev=prev) as h:
            MR.run_match("BRMR-1", resume=True)
        self.assertEqual(h.cards_asked, [[12, 13]])

    def test_a_runner_stop_halts_and_keeps_active_zero(self):
        with _Harness(self, stop="rate_limit_429") as h:
            out = MR.run_match("BRMR-1")
        fin = h.final()
        self.assertEqual((out["status"], fin["status"]), ("halted", "halted"))
        self.assertNotIn("active", fin)
        self.assertIn("rate_limit_429", fin["halt_reason"])

    def test_switch_off_refuses_before_the_pool_is_read(self):
        with _Harness(self, enabled=False) as h, patch("nirmaan_stack.services.boq_rate_match.pool.ensure_pool") as ep:
            with self.assertRaises(MR.MatchRefused):
                MR.run_match("BRMR-1")
            ep.assert_not_called()
        self.assertEqual(h.writes, [])

    def test_a_suggest_run_that_is_no_longer_active_refuses(self):
        with _Harness(self, suggest=dict(SUGGEST, active=0)) as h:
            with self.assertRaises(MR.MatchRefused):
                MR.run_match("BRMR-1")
        self.assertEqual(h.writes, [])


def _fake_candidates(t, pool):
    return {"entries": [{"key": f"{t['key']}>{i}", "w": len(t["key"]) * i} for i in range(3)]}


class TestForkedLanes(FrappeTestCase):

    def test_forked_lists_equal_one_process_in_target_order(self):
        targets = [{"key": f"K{i}"} for i in range(7)]
        with patch.object(MTG.L, "candidates", side_effect=_fake_candidates):
            one = MTG.lanes_forked(targets, object(), 1)
        with patch.object(MTG.L, "candidates", new=_fake_candidates):
            two = MTG.lanes_forked(targets, object(), 2)
            three = MTG.lanes_forked(targets, object(), 3)
        self.assertEqual(one, two)
        self.assertEqual(one, three)
        self.assertEqual(one[4][0]["key"], "K4>0")

    def test_the_forked_path_really_forks(self):
        import os
        pids = []

        def cand(t, pool):
            return {"entries": [{"pid": os.getpid()}]}

        with patch.object(MTG.L, "candidates", new=cand):
            out = MTG.lanes_forked([{"key": "a"}, {"key": "b"}, {"key": "c"}, {"key": "d"}], object(), 2)
        pids = {e[0]["pid"] for e in out}
        self.assertNotIn(os.getpid(), pids)
        self.assertEqual(len(pids), 2)

    def test_the_rules_key_is_signature_plus_values(self):
        self.assertEqual(MTG.rules_key({"priced": True, "signature": "S", "values_after_rules": {"b": 1, "a": 2}}),
                         'S|{"a": 2, "b": 1}')
        self.assertIsNone(MTG.rules_key({"priced": False, "signature": "S"}))
        self.assertIsNone(MTG.rules_key(None))
