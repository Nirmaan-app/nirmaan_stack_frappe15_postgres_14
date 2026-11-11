# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the judge and N1b (DEV2-B3, T1). A mock client only: no model call, no database write.

  request      byte-equal to a J10h request built by DEV2-S8's own scratch code (j8_prompts.j8 + j8_common.blk /
               card_of / after_of_rec) from synthetic rows (sha pinned; no client text); the prompt file is J10h's
               at 20 candidates (sha pinned); the count phrases move with n
  shuffle      J10h's string, the seed recorded with the request         /  another seed, another order
  parse        a good reply                                              /  missing, extra, repeated, malformed id, unknown
                                                                            verdict, no object, cut at max_tokens -> no verdict
  N1b          (a) a read field differs, (b) no config + own-row number, (c) a read number   /  each one's negative
  colours      SAME green, UNCLEAR amber, CLOSE red, DIFFERENT dropped; N1b's CLOSE is red with its note
  run          judge settings on every request; spend per target; a bad reply = no verdict; a too-large request
               not sent and named; an empty judge model refuses before anything is read or built
"""
import hashlib
import json
from types import SimpleNamespace
from unittest.mock import patch

from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import ai_settings
from nirmaan_stack.services.boq_rate_match import call_runner, judge as J, judge_n1b as N1B

SEED = 20261101 + 921
PROMPT_SHA = "56647963043c4628b889cccd27f04acb664e0598cd62a256c82ab12e9ffa125d"     # J10h's prompt, n = 20
FIXTURE_SHA = "905e6f48211c2cb4b1ade1647fe0912b17380b5b155c18b72aa5ef3961919008"    # DEV2-S8 code, rows below
FIXTURE_ORDER = ["FIX-C|S|3", "FIX-B|S|2", "FIX-A|S|1"]

T_PAY = {"id": 7, "description": "Supply and laying of 4C x 16 sq.mm copper armoured cable",
         "ancestor_chain": [{"relation": "sheet", "description": "Fixture Sheet"},
                            {"relation": "parent", "distance": 1, "tier": "full", "node_type": "Preamble", "description": "LT CABLES"}]}
REC_T = {"priced": True, "lines": [["cable_boq", "(pipeline cable_boq)", "(pipeline cable_boq, no matched row)", 1],
                                   ["cable_boq", "ref:cable_arm", "cable_arm", 1],
                                   ["cable_boq", "rmi-1", "cable: COPPER ARMOURED 4 16 x 1", 1]],
         "finals": [{"item": None, "id": "core", "value": "4"}, {"item": None, "id": "thickness_sqmm", "value": "16"},
                    {"item": None, "id": "__qty__", "value": 1}, {"item": None, "id": "cover", "value": None}]}
REC_A = {"priced": True, "lines": [["cable_boq", "rmi-1", "cable: COPPER ARMOURED 4 16 x 1", 1]],
         "finals": [{"item": None, "id": "core", "value": "4"}, {"item": None, "id": "thickness_sqmm", "value": "16"}]}


def _row(key, desc, unit, card=None, rec=None):
    pay = {"id": int(key.rsplit("|", 1)[1]) + 10, "description": desc, "ancestor_chain": [{"relation": "sheet", "description": "Cables"}]}
    return {"key": key, "payload": pay, "unit": unit, "card": card, "rec": rec, "after": N1B.after_values(rec)}


def _fixture():
    target = {"id": "FIXTURE-T1", "payload": T_PAY, "unit": "Mtr",
              "card": {"id": 7, "kind": {"v": "cable"}, "dims": [{"v": "4C x 16 sqmm", "src": "row"}]},
              "rec": REC_T, "after": N1B.after_values(REC_T), "has_config": True}
    cands = [_row("FIX-A|S|1", "4C x 16 sqmm Cu armoured cable", "Mtr", {"id": 11, "kind": {"v": "cable"}}, REC_A),
             _row("FIX-B|S|2", "4C x 25 sqmm Cu armoured cable – XLPE", "RM", {"id": 12, "kind": {"v": "cable"}, "material": {"v": "XLPE"}}),
             _row("FIX-C|S|3", "End termination for 4C x 16 sqmm cable", "Nos", None, {"priced": False, "lines": [], "finals": []})]
    return target, cands


def _reply(vs, order, tin=1000, tout=300, stop="end_turn"):
    text = json.dumps({"verdicts": [{"c": c, "v": v} for c, v in vs], "order": order})
    return SimpleNamespace(content=[SimpleNamespace(text=text)], stop_reason=stop,
                           usage=SimpleNamespace(input_tokens=tin, output_tokens=tout))


class FakeClient:
    def __init__(self, replies):
        self.replies, self.sent = replies, []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        self.sent.append(kw)
        r = self.replies.get(kw["messages"][0]["content"].split("\n\nTARGET:\n", 1)[1][:40], self.replies.get("*"))
        if isinstance(r, Exception):
            raise r
        return r


_SETTINGS = {"model": "judge-model-under-test", "price_in": 1.0, "price_out": 5.0, "reply_max_tokens": 32000,
             "calls_at_once": 2, "retry_wait_s": 0, "burst_failures": 10, "burst_window_s": 60,
             "max_request_tokens": 100000, "request_timeout_seconds": 300}


class TestRequest(FrappeTestCase):

    def test_the_prompt_file_is_j10h_at_twenty_candidates(self):
        self.assertEqual(hashlib.sha256(J.PROMPT_PATH.read_bytes()).hexdigest(), PROMPT_SHA)
        p = J.judge_prompt(13)
        self.assertIn("and 13 candidate rows", p)
        self.assertIn("all 13 verdicts", p)
        self.assertIn("all 13 numbers", p)
        self.assertNotIn("all 20 ", p)

    def test_the_request_is_byte_equal_to_dev2_s8_j10h(self):
        target, cands = _fixture()
        r = J.build_request(target, cands, SEED)
        self.assertEqual(r["candidates"], FIXTURE_ORDER)
        self.assertEqual(hashlib.sha256(r["content"].encode("utf-8")).hexdigest(), FIXTURE_SHA)

    def test_each_block_carries_only_text_unit_card(self):
        target, cands = _fixture()
        r = J.build_request(target, cands, SEED)
        blocks = [json.loads(b) for b in r["content"].split("\n\nCANDIDATES:\n", 1)[1].split("\n")]
        self.assertEqual([set(b) for b in blocks], [{"c", "text", "unit", "card"}] * 3)
        self.assertIsNone(blocks[0]["card"], "a row with no card is sent card: null, its values after the rules too")
        self.assertEqual(blocks[2]["card"]["values after the pricing rules"],
                         {"items": ["cable: COPPER ARMOURED 4 16 x 1 x 1"], "fields": {"core": "4", "thickness_sqmm": "16"}})
        self.assertNotIn("id", blocks[2]["card"])

    def test_the_shuffle_is_recorded_and_moves_with_the_seed(self):
        target, cands = _fixture()
        cands = cands + [_row(f"FIX-{i}|S|{i}", f"row {i}", "Nos") for i in range(4, 12)]
        a, b = J.build_request(target, cands, SEED), J.build_request(target, cands, SEED + 1)
        self.assertEqual((a["shuffle"], a["seed"]), (f"{SEED}|j8|FIXTURE-T1", SEED))
        self.assertNotEqual(a["candidates"], b["candidates"])
        self.assertEqual(sorted(a["candidates"]), sorted(b["candidates"]))


class TestParse(FrappeTestCase):

    def _p(self, text, n=3, stop="end_turn"):
        return J.parse_reply(text, n, stop)

    def test_a_good_reply(self):
        vs, order, err = self._p('{"verdicts": [{"c": 1, "v": "SAME"}, {"c": 2, "v": "CLOSE"}, {"c": 3, "v": "DIFFERENT"}], "order": [2, 1, 3]}')
        self.assertIsNone(err)
        self.assertEqual((vs, order), ({1: "SAME", 2: "CLOSE", 3: "DIFFERENT"}, [2, 1, 3]))

    def test_every_bad_reply_is_no_verdict(self):
        bad = {
            "missing": '{"verdicts": [{"c": 1, "v": "SAME"}, {"c": 2, "v": "CLOSE"}], "order": [1, 2, 3]}',
            "extra": '{"verdicts": [{"c": 1, "v": "SAME"}, {"c": 2, "v": "CLOSE"}, {"c": 3, "v": "CLOSE"}, {"c": 4, "v": "SAME"}], "order": [1, 2, 3]}',
            "repeated": '{"verdicts": [{"c": 1, "v": "SAME"}, {"c": 1, "v": "CLOSE"}, {"c": 3, "v": "CLOSE"}], "order": [1, 2, 3]}',
            "malformed id": '{"verdicts": [{"c": "1", "v": "SAME"}, {"c": 2, "v": "CLOSE"}, {"c": 3, "v": "CLOSE"}], "order": [1, 2, 3]}',
            "order short": '{"verdicts": [{"c": 1, "v": "SAME"}, {"c": 2, "v": "CLOSE"}, {"c": 3, "v": "CLOSE"}], "order": [1, 2]}',
            "unknown verdict": '{"verdicts": [{"c": 1, "v": "MAYBE"}, {"c": 2, "v": "CLOSE"}, {"c": 3, "v": "CLOSE"}], "order": [1, 2, 3]}',
            "no object": "I cannot judge these rows.",
            "not json": '{"verdicts": [}',
        }
        for name, text in bad.items():
            vs, order, err = self._p(text)
            self.assertIsNotNone(err, name)
            self.assertEqual((vs, order), (None, None), name)
        ok = '{"verdicts": [{"c": 1, "v": "SAME"}, {"c": 2, "v": "CLOSE"}, {"c": 3, "v": "CLOSE"}], "order": [1, 2, 3]}'
        self.assertEqual(self._p(ok, stop="max_tokens")[2], "the reply was cut at max_tokens")


class TestN1b(FrappeTestCase):
    # DEV2-S5 n1.py / DEV2-S6 n1b.py's own cases, unchanged

    @staticmethod
    def rec(priced=True, item=None, **kw):
        return {"priced": priced, "finals": [{"item": item, "id": k, "value": v} for k, v in kw.items()], "lines": []}

    @staticmethod
    def p(s, h=None):
        return {"description": s, "ancestor_chain": ([{"distance": 1, "description": h}] if h else [])}

    def test_rule_a_fires_and_does_not(self):
        r = N1B.check(self.rec(thickness_mm="1.6"), self.rec(thickness_mm="2"), self.p("x"), self.p("x"), True)
        self.assertEqual(r["rule"], "a")
        self.assertIsNone(N1B.check(self.rec(face_mm="100"), self.rec(face_mm="100"), self.p("100 x 100 x 50 mm box"),
                                    self.p("100 x 100 x 75 mm box"), True), "R-H2T: a spec the rules do not read")
        self.assertIsNone(N1B.check(self.rec(size_mm=25), self.rec(size_mm="25.0"), self.p(""), self.p(""), True), "R-H2Q")
        self.assertIsNone(N1B.check(self.rec(cover="None"), self.rec(cover="Yes"), self.p(""), self.p(""), True), "a blank")

    def test_rule_b_fires_and_does_not(self):
        self.assertEqual(N1B.check(None, None, self.p("10 sq.mm cable"), self.p("16 sq.mm cable"), False)["rule"], "b")
        self.assertIsNone(N1B.check(None, None, self.p("flexible pipe"), self.p("19 mm flexible pipe"), False))
        self.assertIsNone(N1B.check(None, None, self.p("armoured cable"), self.p("unarmoured cable"), False))
        self.assertIsNone(N1B.check(None, None, self.p("18 SWG tray"), self.p("1.2 mm thick tray"), False))

    def test_rule_c_fires_and_does_not(self):
        self.assertEqual(N1B.check(None, self.rec(face_mm="100"), self.p("150 X 150 X 50mm Size"),
                                   self.p("100 X 100 X 50mm Size"), True)["rule"], "c")
        self.assertIsNone(N1B.check(None, self.rec(face_mm="100"), self.p("100 X 100 X 50/80mm Size"),
                                    self.p("100 X 100 X 50/75mm Size"), True), "MUT-076: depth is not read")
        self.assertIsNone(N1B.check(None, None, self.p("25 sq.mm cable"), self.p("35 sq.mm cable"), True),
                          "a configured target, no reading either side: the judge stands")


class TestColours(FrappeTestCase):

    def test_the_colour_mapping_and_the_different_drop(self):
        vm = {"a": {"v": "CLOSE", "pos": 0}, "b": {"v": "SAME", "pos": 3}, "c": {"v": "DIFFERENT", "pos": 1},
              "d": {"v": "UNCLEAR", "pos": 2}, "e": {"v": "CLOSE", "pos": 4, "n1b": {"rule": "a", "field": "core", "target": "4", "candidate": "3"}}}
        self.assertEqual(J.ordered(vm), ["b", "a", "e", "d", "c"])
        m = J.matches(vm)
        self.assertEqual([(x["key"], x["verdict"], x["colour"]) for x in m],
                         [("b", "SAME", "green"), ("a", "CLOSE", "red"), ("e", "CLOSE", "red"), ("d", "UNCLEAR", "amber")])
        self.assertEqual(m[2]["n1b"], "size check (a): core 4 vs 3")
        self.assertIsNone(m[0]["n1b"])


class TestRun(FrappeTestCase):

    def test_a_target_is_judged_through_the_runner_with_the_judge_settings(self):
        target, cands = _fixture()
        # the order sent is C, B, A: C DIFFERENT, B SAME (N1b: no reading on B, the target configured -> rule c on
        # 16 vs 25, a number the target's rules read -> CLOSE), A SAME
        client = FakeClient({"*": _reply([(1, "DIFFERENT"), (2, "SAME"), (3, "SAME")], [2, 3, 1])})
        out = J.judge_items([{"target": target, "candidates": cands}], seed=SEED, settings=_SETTINGS, client=client)
        self.assertEqual((client.sent[0]["model"], client.sent[0]["max_tokens"]), ("judge-model-under-test", 32000))
        t = out["targets"]["FIXTURE-T1"]
        self.assertIsNone(t["no_verdict"])
        self.assertEqual([(m["key"], m["verdict"], m["colour"]) for m in t["matches"]],
                         [("FIX-A|S|1", "SAME", "green"), ("FIX-B|S|2", "CLOSE", "red")])
        self.assertEqual(t["verdicts"]["FIX-B|S|2"]["n1b"]["rule"], "c")
        self.assertEqual(t["raw_order"], ["FIX-B|S|2", "FIX-A|S|1", "FIX-C|S|3"])
        self.assertEqual((t["spend"]["tokens_in"], t["spend"]["tokens_out"]), (1000, 300))
        self.assertAlmostEqual(t["spend"]["cost_usd"], (1000 * 1.0 + 300 * 5.0) / 1e6)
        self.assertEqual((out["seed"], out["prompt_version"]), (SEED, PROMPT_SHA))

    def test_a_bad_reply_is_no_verdict_never_guessed(self):
        target, cands = _fixture()
        client = FakeClient({"*": _reply([(1, "SAME"), (2, "SAME")], [1, 2])})
        t = J.judge_items([{"target": target, "candidates": cands}], seed=SEED, settings=_SETTINGS, client=client)["targets"]["FIXTURE-T1"]
        self.assertEqual(t["no_verdict"], "the verdicts do not cover the candidates exactly once")
        self.assertEqual((t["matches"], t["order"]), ([], []))

    def test_a_too_large_request_is_not_sent_and_named(self):
        target, cands = _fixture()
        client = FakeClient({"*": _reply([(1, "SAME"), (2, "SAME"), (3, "SAME")], [1, 2, 3])})
        out = J.judge_items([{"target": target, "candidates": cands}], seed=SEED, settings=dict(_SETTINGS, max_request_tokens=100),
                            client=client)
        self.assertEqual(client.sent, [])
        self.assertTrue(out["targets"]["FIXTURE-T1"]["no_verdict"].startswith("not sent: too_large"))

    def test_an_empty_judge_model_refuses_before_anything_is_read(self):
        empty = {f: None for f in ai_settings.MATCH_FIELDS}
        empty.update(match_enabled=False, match_cards_at_commit=False, match_calls_at_once=50, match_reply_max_tokens=32000,
                     match_card_reply_max_tokens=32000, match_retry_wait_s=5, match_burst_failures=10,
                     match_burst_window_s=60, match_max_request_tokens=100000, match_judge_price_in=0.1, match_judge_price_out=0.5)
        with patch.object(ai_settings, "get_boq_match_settings", return_value=empty), \
             patch.object(J, "prepare") as prep, patch.object(J, "pricing_recs") as recs, \
             patch.object(call_runner, "run") as run:
            with self.assertRaises(ai_settings.MatchSettingsIncomplete) as ctx:
                J.judge_lists([({"key": "x"}, [])], pool=None, seed=SEED)
        self.assertIn("Judge model", str(ctx.exception))
        prep.assert_not_called()
        recs.assert_not_called()
        run.assert_not_called()
