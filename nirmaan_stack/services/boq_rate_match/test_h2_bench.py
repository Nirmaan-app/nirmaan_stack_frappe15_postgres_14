# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the H2 bench's scorer (DEV2-B3, T1; scripts/_instruments/h2_bench.py). Fixtures only: no model call,
no database read or write, no bench file (a temporary folder at most).

  top 5 / first   a known-same row or a copy of it (same group) counts   /  a row of another group never does
  reach           a known row the target may not be offered leaves the denominator; a target with no verdict too
                  (as DEV2-S8 x_s8.score), counted apart
  first verdict   the first row's verdict through a copy; the newest verdict file wins for a pair
  traps           size changed: original first AND SAME is the failure  /  first but CLOSE is not
                  reworded: original first  /  S0: a known row called SAME
  GO              the thresholds 177 / 156 / 63 / 54
  trap targets    a trap (not a pool row) carries ITS OWN card from the bench card file   /  a card-less trap: none
  budget skip     (DEV2-B4) a call over the test budget is SKIPPED, named and counted, the run goes on  /  within the
                  budget nothing is skipped; the refusal is the runner's CallerRefused, never a plain error
  extra verdicts  (DEV2-B4) a later verdict file given by path wins for a pair  /  without it the manifest's stands
  stored cards    (DEV2-B6) --stored-cards builds the bench pool with the site's stored cards (pool.StoredCards) in
                  its own file  /  without it the bench file's cards and the bench_pool_v<N>.pkl file, as before
  the guard       (DEV2-B6) a call reserves chars / 2 + the measured p90 reply, not max_tokens: no refusal while real use
                  is well under the caps  /  a REAL total at the cap -> every later call refused, the run says so  /
                  the old worst-case reservation (32,000 per call in flight) would have refused here
"""
import importlib.util
import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

from frappe.tests.utils import FrappeTestCase

import nirmaan_stack

_PATH = Path(nirmaan_stack.__file__).resolve().parents[1] / "scripts" / "_instruments" / "h2_bench.py"
_spec = importlib.util.spec_from_file_location("h2_bench_under_test", _PATH)
HB = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(HB)


def _bench():
    b = HB.Bench.__new__(HB.Bench)
    b.tg = {"T001": {"key": "B1|S|1", "kind": "target"}, "T002": {"key": "B1|S|2", "kind": "target"},
            "T003": {"key": "B1|S|3", "kind": "target"}, "T004": {"key": "B1|S|4", "kind": "target"},
            "H001": {"key": "B1|S|5", "kind": "target"},
            "MUT-001": {"key": "MUT-001", "kind": "mutation_trap", "of": "B2|S|1"},
            "PAR-001": {"key": "PAR-001", "kind": "paraphrase_trap", "of": "B2|S|1"}}
    b.s0 = {"S0-001": {"key": "S0-001", "kind": "s0_trap", "of": "B2|S|2"}}
    b.s0r = {"S0-001": {"target": "T002", "of": "B2|S|2", "how": "changed"}}
    b.traps = [{"trap_id": "MUT-001", "kind": "mutation", "of": "B2|S|1"},
               {"trap_id": "PAR-001", "kind": "paraphrase", "of": "B2|S|1"}]
    pt = {"own_boq": "B1", "extra": []}
    b.p5 = {"per_target": {t: dict(pt) for t in b.tg}}
    b.p0 = {"per_target": {"S0-001": dict(pt)}}
    b.kept5 = b.kept0 = {"B2|S|1", "B2|S|1c", "B2|S|2", "B3|S|1", "B3|S|2"}
    b.ks = {"T001": {"rows": {"B2|S|1": {}}}, "T002": {"rows": {"B2|S|2": {}}},
            "T003": {"rows": {"B1|S|9": {}}},           # its own BoQ: never offered -> out of the denominator
            "T004": {"rows": {"B3|S|1": {}}}, "H001": {"rows": {"B3|S|2": {}}}}
    b.vv = {"T001|B3|S|1": "CLOSE", "T002|B2|S|2c": "SAME"}
    return b


def _pool():
    keys = ["B2|S|1", "B2|S|1c", "B2|S|2", "B2|S|2c", "B3|S|1", "B3|S|2", "B1|S|9", "B9|S|9"]
    groups = {"B2|S|1": 0, "B2|S|1c": 0, "B2|S|2": 1, "B2|S|2c": 1, "B3|S|1": 2, "B3|S|2": 3, "B1|S|9": 4, "B9|S|9": 5}
    rows = [{"key": k, "group": groups[k]} for k in keys]
    members = {}
    for k, g in groups.items():
        members.setdefault(g, []).append(k)
    return SimpleNamespace(rows=rows, byk={k: i for i, k in enumerate(keys)}, index={"members": members})


class TestScore(FrappeTestCase):

    def setUp(self):
        self.sc = HB.Scorer(_bench(), _pool())

    def test_top5_and_first_count_a_known_row_or_its_copy(self):
        order = {"T001": ["B3|S|1", "B2|S|1c", "B9|S|9"],      # a copy at 2: top 5 yes, first no
                 "T002": ["B2|S|2", "B9|S|9"],                 # first
                 "T003": ["B1|S|9"],                           # unreachable: not counted
                 "H001": ["B9|S|9", "B3|S|1"]}                 # another group only: no
        s = self.sc.score(order, ["T001", "T002", "T003", "T004"])
        self.assertEqual((s["denominator"], s["top5"], s["first"]), (2, 2, 1))
        self.assertEqual(s["no verdict (left out)"], 1, "T004 is reachable but has no order")
        h = self.sc.score(order, ["H001"])
        self.assertEqual((h["denominator"], h["top5"], h["first"]), (1, 0, 0))

    def test_the_first_rows_verdict_through_a_copy(self):
        self.assertEqual(self.sc.verdict_of("T002", "B2|S|2"), ("SAME", True))
        self.assertEqual(self.sc.verdict_of("T001", "B3|S|1"), ("CLOSE", False))
        self.assertEqual(self.sc.verdict_of("T001", "B9|S|9"), (None, False))
        ov = self.sc.overall({"T001": ["B3|S|1"]}, {"T001": {"B3|S|1": {"v": "SAME"}}}, ["T001"])
        self.assertEqual(ov["shown first as SAME, verdict CLOSE or DIFFERENT"], 1)

    def test_traps(self):
        verd = {"MUT-001": {"B2|S|1": {"v": "SAME", "pos": 0}}, "PAR-001": {"B2|S|1": {"v": "CLOSE", "pos": 0}},
                "S0-001": {"B2|S|2": {"v": "SAME", "pos": 0}}}
        order = {"MUT-001": ["B2|S|1"], "PAR-001": ["B2|S|1"], "S0-001": ["B2|S|2"]}
        t = self.sc.traps(verd, order)
        self.assertEqual(t["mutation"]["original first and SAME (the failure)"], 1)
        self.assertEqual(t["paraphrase"]["original first"], 1)
        self.assertEqual(t["s0"]["flipped called SAME"], 1)
        verd["MUT-001"]["B2|S|1"]["v"] = "CLOSE"
        self.assertEqual(self.sc.traps(verd, order)["mutation"]["original first and SAME (the failure)"], 0)

    def test_go_needs_all_four_thresholds(self):
        b = _bench()
        b.set_of = lambda t: "bench" if t.startswith("T") else "heldout"
        sc = SimpleNamespace(score=lambda o, ts: ({"top5": 177, "first": 156} if ts and ts[0].startswith("T") else {"top5": 63, "first": 54}),
                             overall=lambda *a: {}, traps=lambda *a: {})
        orders = {"T001": {"ok": True, "n1b": [], "raw": [], "shown": []}, "H001": {"ok": True, "n1b": [], "raw": [], "shown": []}}
        self.assertTrue(HB.table(sc, orders, {}, b)["go"])
        sc.score = lambda o, ts: ({"top5": 177, "first": 155} if ts and ts[0].startswith("T") else {"top5": 63, "first": 54})
        self.assertFalse(HB.table(sc, orders, {}, b)["go"])


class TestTargets(FrappeTestCase):

    def test_a_trap_target_carries_its_own_card_from_the_bench_file(self):
        b = _bench()
        b.tg = {"MUT-001": {"key": "MUT-001", "kind": "mutation_trap", "of": "B2|S|1", "payload": {"description": "x"}},
                "PAR-001": {"key": "PAR-001", "kind": "paraphrase_trap", "of": "B2|S|1", "payload": {"description": "y"}}}
        b.s0 = {}
        b.p5 = {"per_target": {t: {"own_boq": "B1", "extra": []} for t in b.tg}}
        b.set_of = HB.Bench.set_of.__get__(b)
        pool = _pool()
        pool.rows[pool.byk["B2|S|1"]]["unit_raw"] = "Nos"
        pool.index["cards"] = {"B2|S|1": {"kind": {"v": "pool row card"}}}     # the pool knows only pool rows
        with tempfile.TemporaryDirectory() as d:
            b.cards = os.path.join(d, "cards.jsonl")
            with open(b.cards, "w", encoding="utf-8") as f:
                f.write(json.dumps({"key": "MUT-001", "card": {"kind": {"v": "trap card"}}}) + chr(10))
            got = {t["id"]: t for t in HB.targets(b, pool)}
        self.assertEqual(got["MUT-001"]["card"], {"kind": {"v": "trap card"}})
        self.assertIsNone(got["PAR-001"]["card"])
        self.assertEqual(got["MUT-001"]["unit_raw"], "Nos")


class _Raw:
    """The SDK's with_raw_response shape: headers + parse()."""

    def __init__(self, text="{}"):
        self.headers = {"anthropic-ratelimit-requests-remaining": "9"}
        self._resp = SimpleNamespace(content=[SimpleNamespace(text=text)], stop_reason="end_turn",
                                     usage=SimpleNamespace(input_tokens=10, output_tokens=5,
                                                           cache_read_input_tokens=0, cache_creation_input_tokens=0))

    def parse(self):
        return self._resp


def _inner():
    sent = []

    def create(**kw):
        sent.append(kw["messages"][0]["content"].split("|", 1)[0])
        return _Raw()
    return SimpleNamespace(messages=SimpleNamespace(with_raw_response=SimpleNamespace(create=create))), sent


class TestBudgetSkip(FrappeTestCase):
    """DEV2-B4 (owner answer 3 to DEV2-B3 Q3): a call the test budget refuses is SKIPPED - named, counted - and the
    run goes on; the runner never reads it as a connection error."""

    def _reqs(self, names):
        from nirmaan_stack.services.boq_rate_match import call_runner as cr
        return [cr.CallRequest(name=n, content=(n + "|").ljust(200, "x"), model="m", max_tokens=100, price_in=1.0,
                               price_out=2.0) for n in names]

    def _limits(self):
        from nirmaan_stack.services.boq_rate_match import call_runner as cr
        return cr.Limits(calls_at_once=1, retry_wait_s=0, burst_failures=1, burst_window_s=60, max_request_tokens=10 ** 6)

    def test_an_over_budget_call_is_skipped_counted_and_the_run_goes_on(self):
        from nirmaan_stack.services.boq_rate_match import call_runner as cr
        inner, sent = _inner()
        client = HB.RecordingClient(inner, max_calls=2)          # the third call would pass the budget
        out = cr.run(self._reqs(["A", "B", "C", "D"]), limits=self._limits(), client=client)
        self.assertIsNone(out.stop_reason)
        self.assertEqual(out.not_sent, [])
        self.assertEqual(sent, ["A", "B"])
        self.assertEqual([r["name"] for r in out.refused], ["C", "D"])
        self.assertTrue(all(r["reason"] == cr.REFUSED_BY_CALLER for r in out.refused))
        self.assertEqual(len(client.skipped), 2)
        self.assertIn("test budget", client.skipped[0])

    def test_within_the_budget_nothing_is_skipped(self):
        from nirmaan_stack.services.boq_rate_match import call_runner as cr
        inner, sent = _inner()
        client = HB.RecordingClient(inner, max_calls=4, max_tokens=10 ** 6, max_usd=10.0)
        out = cr.run(self._reqs(["A", "B", "C", "D"]), limits=self._limits(), client=client)
        self.assertEqual(sent, ["A", "B", "C", "D"])
        self.assertEqual((out.refused, client.skipped, out.stop_reason), ([], [], None))

    def test_the_refusal_is_the_runners_own_type_not_a_plain_error(self):
        from nirmaan_stack.services.boq_rate_match import call_runner as cr
        inner, _sent = _inner()
        client = HB.RecordingClient(inner, max_calls=0)
        with self.assertRaises(cr.CallerRefused):
            client.create(model="m", max_tokens=1, messages=[{"role": "user", "content": "A|x"}])


class TestExtraVerdicts(FrappeTestCase):

    def test_a_later_file_given_by_path_is_read_after_the_manifests_and_wins(self):
        b = HB.Bench.__new__(HB.Bench)
        with tempfile.TemporaryDirectory() as d:
            manifest = {"files": {}, "as_of": "2026-11-01 02:00:00", "seed": 1}
            # the minimal bench: only what __init__ reads; every data file is an empty shape
            data = {"bench_testset.json": {"targets": []}, "bench_key.json": {"targets": []},
                    "heldout_s5.json": {"targets": []}, "w2_targets_s5.json": [], "s0_targets.json": [],
                    "s0_traps.json": {"traps": []}, "bench_traps.json": [], "pool_s5.json": {"kept": []},
                    "pool_s0.json": {"kept": []}, "known_same_s6.json": {"bench": {"targets": {}}, "heldout": {"targets": {}}},
                    "H2_S8_Unjudged_Verdicts_2026-11-02.json": {"R1": {"target_ref": "T1", "candidate_key": "K", "copies": [], "consensus": "SAME"}}}
            for n, v in data.items():
                with open(os.path.join(d, n), "w", encoding="utf-8") as f:
                    json.dump(v, f)
                manifest["files"][n] = HB.sha256(os.path.join(d, n))
            with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as f:
                json.dump(manifest, f)
            extra = os.path.join(d, "later.json")
            with open(extra, "w", encoding="utf-8") as f:
                json.dump({"R9": {"target_ref": "T1", "candidate_key": "K", "copies": ["K2"], "consensus": "CLOSE"}}, f)
            b0 = HB.Bench(d)
            b1 = HB.Bench(d, [extra])
        self.assertEqual(b0.vv["T1|K"], "SAME")
        self.assertEqual((b1.vv["T1|K"], b1.vv["T1|K2"]), ("CLOSE", "CLOSE"))
        self.assertEqual(b1.extra_verdicts[0]["entries"], 1)
        self.assertEqual(b0.extra_verdicts, [])


def _inner_usage(tin, tout):
    sent = []

    class Raw:
        headers = {}

        def parse(self):
            return SimpleNamespace(content=[SimpleNamespace(text="{}")], stop_reason="end_turn",
                                   usage=SimpleNamespace(input_tokens=tin, output_tokens=tout,
                                                         cache_read_input_tokens=0, cache_creation_input_tokens=0))

    def create(**kw):
        sent.append(kw["messages"][0]["content"].split("|", 1)[0])
        return Raw()
    return SimpleNamespace(messages=SimpleNamespace(with_raw_response=SimpleNamespace(create=create))), sent


class TestBudgetGuard(FrappeTestCase):
    """DEV2-B6 S1 (owner answer 2 to DEV2-B5): reserve the measured p90 reply; the caps stay hard on the REAL totals."""

    def _reqs(self, names, judge=True, max_tokens=32000):
        from nirmaan_stack.services.boq_rate_match import call_runner as cr
        body = "\n\nCANDIDATES:\n" if judge else ""
        return [cr.CallRequest(name=n, content=(n + "|" + body).ljust(2000, "x"), model="m", max_tokens=max_tokens,
                               price_in=0.1, price_out=0.5) for n in names]

    def _limits(self, at_once=1):
        from nirmaan_stack.services.boq_rate_match import call_runner as cr
        return cr.Limits(calls_at_once=at_once, retry_wait_s=0, burst_failures=1, burst_window_s=60, max_request_tokens=10 ** 6)

    def test_the_reserve_is_the_measured_p90_of_its_kind_never_above_max_tokens(self):
        self.assertEqual(HB.reply_reserve("T\n\nCANDIDATES:\n1", 32000), 3920)
        self.assertEqual(HB.reply_reserve("a card request", 32000), 13819)
        self.assertEqual(HB.reply_reserve("x CANDIDATES: y", 100), 100)

    def test_no_refusal_while_real_use_is_well_under_the_cap(self):
        # 10 judge calls of ~1,000 + 3,000 real tokens = ~40,000 real against a 60,000 cap. The OLD guard reserved
        # chars / 2 + 32,000 = 33,000 a call: the second call would already have been refused (33,000 x 2 > 60,000).
        from nirmaan_stack.services.boq_rate_match import call_runner as cr
        inner, sent = _inner_usage(1000, 3000)
        client = HB.RecordingClient(inner, max_tokens=60000, max_usd=10.0)
        out = cr.run(self._reqs([f"J{i}" for i in range(10)]), limits=self._limits(), client=client)
        self.assertEqual(len(sent), 10)
        self.assertEqual((out.refused, client.skipped, client.reached), ([], [], None))
        self.assertEqual(client.tokens, 40000)

    def test_the_old_worst_case_reservation_is_gone(self):
        inner, _sent = _inner_usage(1000, 3000)
        client = HB.RecordingClient(inner, max_tokens=40000)
        client.r_tokens = 33000                       # one call in flight under the OLD reservation (1,000 + 32,000)
        # a second call: chars / 2 = 1,000 + the p90 3,920 = 4,920 -> 37,920 <= 40,000: sent (the old guard: 66,000 > 40,000)
        client.create(model="m", max_tokens=32000, messages=[{"role": "user", "content": "J|\n\nCANDIDATES:\n".ljust(2000, "x")}])
        self.assertEqual(client.skipped, [])

    def test_a_real_total_at_the_cap_stops_every_later_call_and_says_so(self):
        from nirmaan_stack.services.boq_rate_match import call_runner as cr
        inner, sent = _inner_usage(1000, 5000)        # 6,000 real tokens a call (a reply above the p90)
        client = HB.RecordingClient(inner, max_tokens=12000)
        out = cr.run(self._reqs(["A", "B", "C", "D", "E"]), limits=self._limits(), client=client)
        # B is sent (6,000 real + its reserve 1,000 + 3,920 <= 12,000); its reply brings the real total to the cap
        self.assertEqual(sent, ["A", "B"])
        self.assertEqual(client.tokens, 12000)
        self.assertIn("reached a cap", client.reached)
        self.assertEqual([r["name"] for r in out.refused], ["C", "D", "E"])
        self.assertTrue(all("test budget reached" in w for w in client.skipped))
        self.assertIsNone(out.stop_reason)            # the run goes on and ends; nothing is read as an error

    def test_a_real_usd_total_at_the_cap_stops_too(self):
        inner, sent = _inner_usage(10000, 0)          # $0.001 a call at 0.1 / M in
        client = HB.RecordingClient(inner, max_usd=0.002, price_in=0.1, price_out=0.5)
        for n in ("A", "B", "C"):
            try:
                client.create(model="m", max_tokens=10, messages=[{"role": "user", "content": n + "|x"}])
            except Exception as e:  # noqa: BLE001
                from nirmaan_stack.services.boq_rate_match import call_runner as cr
                self.assertIsInstance(e, cr.CallerRefused)
        self.assertEqual(sent, ["A", "B"])
        self.assertIsNotNone(client.reached)


class TestStoredCards(FrappeTestCase):
    """DEV2-B6: the final bench on the app path - dev2's stored cards in the pool and the payload."""

    def _pool_call(self, stored):
        from unittest import mock
        from nirmaan_stack.services.boq_rate_match import pool as P
        bench = SimpleNamespace(folder="/tmp/x", as_of="2026-11-01 02:00:00", cards="/tmp/x/haiku_cards_all.jsonl")
        with mock.patch.object(P, "ensure_pool", return_value=("pool", False)) as ep,                 mock.patch.object(P, "build_pool", return_value="built") as bp:
            HB.bench_pool(bench, stored_cards=stored)
            path = ep.call_args[1]["path"]
            ep.call_args[1]["builder"]()
        return path, bp.call_args[1]["card_source"], P

    def test_stored_cards_use_the_products_reader_in_their_own_file(self):
        path, src, P = self._pool_call(True)
        self.assertTrue(path.endswith(f"bench_pool_stored_v{P.POOL_FORMAT}.pkl"))
        self.assertIsInstance(src, P.StoredCards)

    def test_without_it_the_bench_files_cards_as_before(self):
        path, src, P = self._pool_call(False)
        self.assertTrue(path.endswith(f"bench_pool_v{P.POOL_FORMAT}.pkl"))
        self.assertNotIsInstance(src, P.StoredCards)
