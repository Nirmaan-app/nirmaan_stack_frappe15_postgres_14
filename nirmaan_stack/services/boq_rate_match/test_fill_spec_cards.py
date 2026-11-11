# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the one-time spec-card fill-in (DEV2-B7 S1; scripts/_instruments/fill_spec_cards.py). A fake client only:
no model call.

  selection     the pool's rows minus valid cards: valid skipped / none, stale, failed chosen; an equal payload is
                left to the earlier row
  stale         a card under an older payload is MISSING (the row is carded) and the old card STAYS
  dry           writes nothing and builds / calls no client; the projection is the plan's own numbers
  options       --limit cuts in order; --boq keeps only those BoQs; newest-first (default) / oldest-first order
  re-run        after a partial run (--limit) the next run cards only the rest
  listed        a malformed reply, a failed call and a size-guard refusal are each listed with the reason
  stop          a 429 stops the run cleanly: nothing more sent, every row not sent named, the summary returned; an
                error inside a sheet the same
  never         an existing ok card is never sent and never changed - by the selection, and by cards.card_sheet
                when handed one anyway (a failed card of the same key IS updated)

The run tests write real `BoQ Row Spec Card` rows under a fixture BoQ and remove them (rollback first, then a delete
per scope; purge_boq at the end) - these suites run against the live site database.
"""
import importlib.util
import json
import re
import threading
from pathlib import Path
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

import nirmaan_stack
from nirmaan_stack.services.boq_fixture_teardown import fixture_boq_name, purge_boq
from nirmaan_stack.services.boq_rate_match import cards

_PATH = Path(nirmaan_stack.__file__).resolve().parents[1] / "scripts" / "_instruments" / "fill_spec_cards.py"
_spec = importlib.util.spec_from_file_location("fill_spec_cards_under_test", _PATH)
FSC = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(FSC)

_TEST_PROJECT = "_TEST_BOQ_PROJECT_FILL_SPEC_CARDS"
_MODEL = "model-under-test"
_SETTINGS = {"model": _MODEL, "price_in": 1.0, "price_out": 5.0, "reply_max_tokens": 32000, "calls_at_once": 1,
             "retry_wait_s": 0, "burst_failures": 10, "burst_window_s": 60, "max_request_tokens": 100000,
             "request_timeout_seconds": 300}


def _item(sheet, er, text="Supply and fix 3.5C x 95 sqmm XLPE armoured cable"):
    return {"id": er, "description": f"{text} ({sheet})",
            "ancestor_chain": [{"relation": "sheet", "description": sheet}]}


def _row(boq, sheet, er, cls=None, sha=None, disc="Electrical"):
    r = {"key": f"{boq}|{sheet}|{er}", "boq": boq, "sheet": sheet, "row": er, "disc": disc, "project_name": "P",
         "sha": sha or cards.payload_sha256(_item(sheet, er))}
    if cls:
        r["cls"] = cls
    return r


class _HTTPError(Exception):
    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.status_code = status


class _Resp:
    def __init__(self, text):
        self.content = [type("B", (), {"text": text})()]
        self.stop_reason = "end_turn"
        self.usage = type("U", (), {"input_tokens": 1000, "output_tokens": 400})()


class _Client:
    """Answers every id in the request with a card; `script` maps a call number (1-based) to an exception or 'drop
    one' (the reply leaves out the request's first row)."""

    def __init__(self, script=None, forbid=False):
        self.script, self.forbid, self.sent, self.lock = dict(script or {}), forbid, [], threading.Lock()
        self.messages = self

    def create(self, **kw):
        if self.forbid:
            raise AssertionError("a dry run must not call the model")
        content = kw["messages"][0]["content"]
        ids = [it["id"] for it in json.loads(content[content.rindex("\n\nROWS:\n") + 8:])]
        sheet = re.search(r'"relation": "sheet", "description": "([^"]*)"', content).group(1)
        with self.lock:
            self.sent.append((sheet, ids))
            act = self.script.get(len(self.sent))
        if isinstance(act, BaseException):
            raise act
        if act == "drop one":
            ids = ids[1:]
        return _Resp(json.dumps([{"id": i, "kind": {"v": "cable", "name": "LT cable"}} for i in ids]))


def _purge(boq):
    frappe.db.rollback()
    try:
        frappe.db.delete(cards.CARD_DOCTYPE, {"boq": boq})
        frappe.db.commit()
    except Exception as e:  # noqa: BLE001 -- report, never swallow silently
        frappe.db.rollback()
        print(f"test_fill_spec_cards purge failed: {e}")


# --- pure ------------------------------------------------------------------------------------------------------------

class TestSelection(FrappeTestCase):

    def test_valid_rows_are_skipped_and_none_stale_failed_are_chosen(self):
        rows = [_row("B", "S", 1), _row("B", "S", 2), _row("B", "S", 3), _row("B", "S", 4)]
        status = {rows[0]["sha"]: "ok", rows[2]["sha"]: "malformed"}
        other = {("B", "S", 2)}
        got = [FSC.classify(r, status, other) for r in rows]
        self.assertEqual(got, [FSC.VALID, FSC.STALE, FSC.FAILED, FSC.NONE])
        for r, c in zip(rows, got):
            r["cls"] = c
        groups, chosen, dup, over = FSC.select(rows)
        self.assertEqual(groups, [("B", "S", [2, 3, 4])])
        self.assertEqual((dup, over), (0, 0))

    def test_an_ok_card_wins_over_an_older_card_at_the_address(self):
        r = _row("B", "S", 1)
        self.assertEqual(FSC.classify(r, {r["sha"]: "ok"}, {("B", "S", 1)}), FSC.VALID)

    def test_an_equal_payload_is_left_to_the_earlier_row(self):
        rows = [_row("B1", "S", 1, FSC.NONE, sha="x"), _row("B2", "S", 1, FSC.NONE, sha="x"),
                _row("B2", "S", 2, FSC.NONE, sha="y")]
        groups, chosen, dup, _ = FSC.select(rows)
        self.assertEqual(groups, [("B1", "S", [1]), ("B2", "S", [2])])
        self.assertEqual(dup, 1)

    def test_limit_cuts_in_order_and_boq_keeps_only_those(self):
        rows = [_row("B1", "S", er, FSC.NONE) for er in (1, 2, 3)] + [_row("B2", "T", er, FSC.NONE) for er in (1, 2)]
        groups, chosen, _, over = FSC.select(rows, limit=4)
        self.assertEqual(groups, [("B1", "S", [1, 2, 3]), ("B2", "T", [1])])
        self.assertEqual(over, 1)
        groups, _, _, _ = FSC.select(rows, boqs={"B2"})
        self.assertEqual(groups, [("B2", "T", [1, 2])])
        self.assertEqual(FSC.select(rows, limit=0)[0], [])

    def test_newest_first_by_default_and_oldest_first_on_request(self):
        rows = [_row("B-OLD", "S", 2), _row("B-NEW", "S", 1), _row("B-OLD", "R", 5), _row("B-MID", "S", 1)]
        commits = {"B-OLD": "2026-01-01 10:00:00", "B-MID": "2026-06-01 10:00:00", "B-NEW": "2026-11-01 10:00:00"}
        self.assertEqual([r["key"] for r in FSC.order_rows(rows, commits)],
                         ["B-NEW|S|1", "B-MID|S|1", "B-OLD|R|5", "B-OLD|S|2"])
        self.assertEqual([r["key"] for r in FSC.order_rows(rows, commits, newest_first=False)],
                         ["B-OLD|R|5", "B-OLD|S|2", "B-MID|S|1", "B-NEW|S|1"])

    def test_the_projection_is_the_plans_numbers(self):
        plans = [{"calls": 2, "rows": 25, "chars": 40000}, {"calls": 1, "rows": 3, "chars": 6000},
                 {"calls": 0, "rows": 0, "chars": 0}]
        p = FSC.project(plans, {"calls_at_once": 50, "price_in": 0.1, "price_out": 0.5})
        self.assertEqual((p["sheets"], p["calls"], p["rows"], p["tokens_in"]), (2, 3, 28, 23000))
        self.assertEqual(p["tokens_out"], 28 * FSC.OUT_TOKENS_PER_ROW)
        self.assertEqual(p["usd"], round((23000 * 0.1 + 28 * FSC.OUT_TOKENS_PER_ROW * 0.5) / 1e6, 4))
        self.assertEqual(p["minutes"], round(2 * FSC.SECS_PER_CALL / 60, 1))   # one wave a sheet at 50 at once

    def test_the_rebuild_command_names_the_pool_rebuild(self):
        self.assertEqual(FSC.rebuild_command("x.site"),
                         "bench --site x.site execute nirmaan_stack.services.boq_rate_match.pool.rebuild_pool")


# --- the run, on a fixture BoQ ---------------------------------------------------------------------------------------

class TestFillRun(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT
        boq.boq_name = "Shared Test BoQ for the Spec-Card Fill-in"
        boq.insert(set_name=fixture_boq_name("FILL_SPEC_CARDS"), ignore_permissions=True, ignore_links=True)
        cls.boq = boq.name
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "boq"):
            _purge(cls.boq)
            purge_boq(cls.boq)
            frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        _purge(self.boq)
        self.addCleanup(_purge, self.boq)
        # sheet A: 25 rows (two calls); sheet B: 3 rows (one call)
        self.rows = [_row(self.boq, "A", er) for er in range(1, 26)] + [_row(self.boq, "B", er) for er in (1, 2, 3)]
        p = patch.object(cards, "sheet_items", side_effect=lambda b, sh, excel_rows=None: (
            1, [(er, _item(sh, er)) for er in sorted(excel_rows)], []))
        p.start()
        self.addCleanup(p.stop)

    def _loader(self):
        return lambda: ([dict(r) for r in self.rows], 0, {self.boq: "2026-11-01 10:00:00"})

    def _store(self, sheet, er, status="ok", sha=None, version=None, card=None):
        doc = frappe.get_doc({
            "doctype": cards.CARD_DOCTYPE, "boq": self.boq, "sheet": sheet, "excel_row": er, "commit_version": 1,
            "payload_sha256": sha or cards.payload_sha256(_item(sheet, er)),
            "prompt_version": version or cards.prompt_version(), "model": _MODEL, "status": status,
            "card_json": json.dumps(card or {"id": er, "kind": {"v": "pre-existing"}}), "tokens_in": 0,
            "tokens_out": 0, "cost_usd": 0}).insert(ignore_permissions=True)
        frappe.db.commit()
        return doc.name

    def _cards(self):
        return {r["name"]: r for r in frappe.get_all(cards.CARD_DOCTYPE, filters={"boq": self.boq},
                                                     fields=["name", "sheet", "excel_row", "payload_sha256", "status",
                                                             "card_json", "modified"])}

    def _fill(self, client, **kw):
        return FSC.fill(loader=self._loader(), settings=dict(_SETTINGS), client=client, progress=lambda *a, **k: None,
                        **kw)

    def test_dry_writes_nothing_and_projects_the_plan(self):
        self._store("A", 1)
        before = self._cards()
        with patch.object(FSC, "card_groups", side_effect=AssertionError("dry must not card")), \
             patch("nirmaan_stack.services.boq_rate_match.call_runner.make_client",
                   side_effect=AssertionError("dry must not build a client")):
            rep = FSC.fill(dry=True, loader=self._loader(), settings=dict(_SETTINGS))
        self.assertEqual(self._cards(), before)
        self.assertEqual((rep["rows"]["valid"], rep["rows"]["to_card"]), (1, 27))
        self.assertEqual((rep["projection"]["calls"], rep["projection"]["rows"], rep["projection"]["sheets"]), (3, 27, 2))
        self.assertNotIn("result", rep)

    def test_a_real_run_cards_only_the_rows_without_a_valid_card(self):
        self._store("A", 1)
        client = _Client()
        rep = self._fill(client, dry=False)
        res = rep["result"]
        self.assertEqual((len(res["carded"]), res["calls"], res["stop_reason"]), (27, 3, None))
        self.assertNotIn(1, [i for sh, ids in client.sent if sh == "A" for i in ids])
        self.assertEqual(sum(len(ids) for _, ids in client.sent), 27)
        self.assertEqual(len([c for c in self._cards().values() if c["status"] == "ok"]), 28)
        self.assertEqual(res["rows_per_call"], 9.0)

    def test_a_stale_card_counts_as_missing_and_the_old_card_stays(self):
        old = self._store("B", 2, sha="0" * 64, card={"id": 2, "kind": {"v": "old text"}})
        before = self._cards()[old]
        rep = self._fill(_Client(), dry=False, boqs=[self.boq])
        self.assertEqual(rep["rows"]["stale"], 1)
        self.assertIn(f"{self.boq}|B|2", rep["result"]["carded"])
        after = self._cards()
        self.assertEqual(after[old], before)                    # the old card is untouched
        self.assertEqual(len([c for c in after.values() if c["sheet"] == "B" and c["excel_row"] == 2]), 2)

    def test_an_ok_card_is_never_overwritten_and_a_failed_one_is_updated(self):
        ok = self._store("A", 1)
        bad = self._store("A", 2, status="malformed")
        before = self._cards()
        client = _Client()
        self._fill(client, dry=False)
        after = self._cards()
        self.assertEqual(after[ok], before[ok])                 # byte-equal, modified unchanged
        self.assertNotIn(1, [i for sh, ids in client.sent if sh == "A" for i in ids])
        self.assertEqual(after[bad]["status"], "ok")            # the negative half: a non-ok card IS re-made in place
        self.assertNotEqual(after[bad]["card_json"], before[bad]["card_json"])

    def test_handed_an_ok_row_anyway_the_card_job_keeps_the_card(self):
        ok = self._store("A", 1)
        before = self._cards()[ok]
        rows = [r for r in self.rows if r["sheet"] == "A" and r["row"] in (1, 2)]
        client = _Client()
        res = FSC.card_groups([(self.boq, "A", [1, 2])], rows, dict(_SETTINGS), client, progress=lambda *a, **k: None)
        self.assertEqual(self._cards()[ok], before)             # cards.card_sheet reuses it: never sent, never changed
        self.assertEqual(client.sent, [("A", [2])])
        self.assertEqual(sorted(res["carded"]), [f"{self.boq}|A|1", f"{self.boq}|A|2"])

    def test_a_rerun_after_a_partial_run_cards_only_the_rest(self):
        first = _Client()
        r1 = self._fill(first, dry=False, limit=10)
        self.assertEqual(len(r1["result"]["carded"]), 10)
        self.assertEqual(r1["rows"]["left_by_limit"], 18)
        second = _Client()
        r2 = self._fill(second, dry=False)
        self.assertEqual(r2["rows"]["valid"], 10)
        got = sorted((sh, i) for sh, ids in second.sent for i in ids)
        self.assertEqual(got, sorted([("A", er) for er in range(11, 26)] + [("B", er) for er in (1, 2, 3)]))
        third = _Client(forbid=True)
        r3 = self._fill(third, dry=False)
        self.assertEqual((r3["rows"]["to_card"], r3["result"]["calls"], third.sent), (0, 0, []))

    def test_malformed_failed_and_refused_rows_are_listed_with_the_reason(self):
        client = _Client(script={1: "drop one", 2: _HTTPError(500)})
        rep = self._fill(client, dry=False)
        failed = {f["key"]: f for f in rep["result"]["failed"]}
        self.assertEqual(failed[f"{self.boq}|A|1"]["status"], "malformed")
        self.assertIn("no card for this row", failed[f"{self.boq}|A|1"]["reason"])
        self.assertEqual(failed[f"{self.boq}|A|21"]["status"], "failed")
        self.assertIn("HTTP 500", failed[f"{self.boq}|A|21"]["reason"])
        self.assertEqual(len(rep["result"]["carded"]), 19 + 3)
        # the size guard: a request over max_request_tokens is refused, named, and the run goes on
        _purge(self.boq)
        tiny = dict(_SETTINGS, max_request_tokens=10)
        rep = FSC.fill(dry=False, loader=self._loader(), settings=tiny, client=_Client(), progress=lambda *a, **k: None)
        self.assertEqual(len(rep["result"]["not_sent"]), 28)
        self.assertTrue(all("refused too_large" in x["reason"] for x in rep["result"]["not_sent"]))
        self.assertIsNone(rep["result"]["stop_reason"])

    def test_a_429_stops_the_run_cleanly_with_the_summary(self):
        client = _Client(script={2: _HTTPError(429)})
        rep = self._fill(client, dry=False)
        res = rep["result"]
        self.assertEqual(res["stop_reason"], "rate_limit_429")
        self.assertEqual(len(client.sent), 2)                   # nothing sent after the 429
        self.assertEqual(len(res["carded"]), 20)                # the call that landed is stored
        self.assertEqual(sorted(f["key"] for f in res["failed"]),          # the 429'd call's rows: stored failed
                         sorted(f"{self.boq}|A|{er}" for er in range(21, 26)))
        self.assertTrue(all("429" in f["reason"] for f in res["failed"]))
        self.assertEqual(sorted(x["key"] for x in res["not_sent"]),        # every row of B, each named
                         [f"{self.boq}|B|{er}" for er in (1, 2, 3)])
        self.assertTrue(all("rate_limit_429" in x["reason"] for x in res["not_sent"]))
        self.assertEqual(len([c for c in self._cards().values() if c["status"] == "ok"]), 20)

    def test_an_error_inside_a_sheet_stops_cleanly(self):
        with patch.object(cards, "card_sheet", side_effect=RuntimeError("boom")):
            rep = self._fill(_Client(), dry=False)
        self.assertEqual(rep["result"]["stop_reason"], "error")
        self.assertIn("boom", rep["result"]["stop_detail"])
        self.assertEqual(len(rep["result"]["not_sent"]), 28)
        self.assertEqual(self._cards(), {})
