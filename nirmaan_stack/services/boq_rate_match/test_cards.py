# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the spec-card store (DEV2-B1, T1). A mock client only: no model call.

  batching     at most 20 rows a request, in sheet order               /  20 rows are one request, 21 are two
  request      prompt + guidance + rows, byte for byte; the prompt file is DEV2-S8's p1_card_prompt.txt (sha pinned)
  reuse        an unchanged row with an ok card is not sent            /  a changed payload, a changed prompt or a
                                                                          malformed card IS sent again
  store        a parsed card is ok; a missing / bad reply is stored malformed (never dropped); a failed call failed
  refusal      an empty card model refuses before anything is read or sent
  commit job   switched off -> nothing; re-committed since -> skipped

The store tests write real `BoQ Row Spec Card` rows under a fixture BoQ (services/boq_fixture_teardown) and remove
them (rollback first, then a delete per scope; purge_boq at the end) -- these suites run against the live site
database.
"""
import hashlib
import json
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import ai_settings
from nirmaan_stack.services.boq_rate_match import call_runner, cards
from nirmaan_stack.services.boq_fixture_teardown import fixture_boq_name, purge_boq
from nirmaan_stack.services.boq_rate_master import extraction

_BOQ = "_TEST_BOQ_SPEC_CARDS_B1"      # the plan-only tests never write; the store tests use a fixture BoQ
_TEST_PROJECT = "_TEST_BOQ_PROJECT_SPEC_CARDS"
_SHEET = "Test Sheet "     # trailing space on purpose (#152: verbatim)
_PROMPT_SHA = "39ebd9d8ef67bdabbff207a96abb625931484cdc2c159de6f66120898da4246a"   # DEV2-S8 p1_card_prompt.txt
_SETTINGS = {"model": "model-under-test", "price_in": 1.0, "price_out": 5.0, "reply_max_tokens": 32000,
             "calls_at_once": 4, "retry_wait_s": 0, "burst_failures": 10, "burst_window_s": 60,
             "cost_cap_usd": 5.0, "request_timeout_seconds": 300}


def _item(er, desc="Supply and fix 3.5C x 95 sqmm XLPE armoured cable"):
    return {"id": er, "description": desc,
            "ancestor_chain": [{"relation": "sheet", "description": _SHEET},
                               {"relation": "parent", "distance": 1, "tier": "full", "node_type": "Preamble",
                                "description": "LT CABLES"}]}


def _purge(boq):
    frappe.db.rollback()
    try:
        frappe.db.delete(cards.CARD_DOCTYPE, {"boq": boq})
        frappe.db.commit()
    except Exception as e:  # noqa: BLE001 -- report, never swallow silently
        frappe.db.rollback()
        print(f"test_cards purge failed: {e}")


def _resp(text, tin=1000, tout=500):
    return SimpleNamespace(content=[SimpleNamespace(text=text)], stop_reason="end_turn",
                           usage=SimpleNamespace(input_tokens=tin, output_tokens=tout))


class _Client:
    def __init__(self, replies):
        self.replies = list(replies)
        self.sent = []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        self.sent.append(kw)
        r = self.replies.pop(0)
        if isinstance(r, BaseException):
            raise r
        return r


class TestRequest(FrappeTestCase):

    def test_the_prompt_file_is_dev2_s8s_card_prompt(self):
        self.assertEqual(hashlib.sha256(cards.PROMPT_PATH.read_bytes()).hexdigest(), _PROMPT_SHA)
        self.assertEqual(cards.prompt_version(), _PROMPT_SHA)
        self.assertNotIn(b"\r", cards.PROMPT_PATH.read_bytes())

    def test_the_request_is_prompt_guidance_and_rows(self):
        items = [_item(7), _item(9, "Cable tray 300 x 50")]
        want = (cards.PROMPT_PATH.read_bytes().decode("utf-8") + extraction._ROW_CONTEXT_SHAPE_GUIDANCE
                + "\n\nROWS:\n" + json.dumps(items, ensure_ascii=False))
        self.assertEqual(cards.request_content(items), want)

    def test_the_payload_hash_is_the_exact_block(self):
        it = _item(7, "Câble 95 mm²")
        self.assertEqual(cards.payload_sha256(it),
                         hashlib.sha256(json.dumps(it, ensure_ascii=False).encode("utf-8")).hexdigest())
        self.assertNotEqual(cards.payload_sha256(it), cards.payload_sha256(_item(8, "Câble 95 mm²")))


class TestBatching(FrappeTestCase):

    def test_at_most_twenty_rows_a_request_in_order(self):
        items = list(range(1, 46))
        got = cards.batches(items)
        self.assertEqual([len(b) for b in got], [20, 20, 5])
        self.assertEqual([x for b in got for x in b], items)

    def test_twenty_rows_are_one_request_and_twenty_one_are_two(self):
        self.assertEqual(len(cards.batches(list(range(20)))), 1)
        self.assertEqual(len(cards.batches(list(range(21)))), 2)

    def test_the_plan_batches_per_sheet_in_sheet_order(self):
        items = [(er, _item(er)) for er in range(10, 55)]
        with patch.object(cards, "sheet_items", return_value=(3, items, [])), \
             patch.object(cards, "existing_cards", return_value={}):
            plan = cards.plan_sheet(_BOQ, _SHEET, "m")
        self.assertEqual([len(b["rows"]) for b in plan["batches"]], [20, 20, 5])
        self.assertEqual([r for b in plan["batches"] for r in b["rows"]], list(range(10, 55)))
        self.assertEqual(plan["batches"][0]["content"], cards.request_content([it for _, it in items[:20]]))


class _StoreCase(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT
        boq.boq_name = "Shared Test BoQ for Spec Cards"
        boq.insert(set_name=fixture_boq_name("SPEC_CARDS"), ignore_permissions=True, ignore_links=True)
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

    def _stored(self, er, desc=None, status="ok", version=None, model="m"):
        it = _item(er, desc) if desc else _item(er)
        frappe.get_doc({
            "doctype": cards.CARD_DOCTYPE, "boq": self.boq, "sheet": _SHEET, "excel_row": er, "commit_version": 1,
            "payload_sha256": cards.payload_sha256(it), "prompt_version": version or cards.prompt_version(),
            "model": model, "status": status, "card_json": json.dumps({"id": er}),
            "tokens_in": 0, "tokens_out": 0, "cost_usd": 0,
        }).insert(ignore_permissions=True)
        frappe.db.commit()


class TestReuse(_StoreCase):

    def _plan(self, items, model="m"):
        with patch.object(cards, "sheet_items", return_value=(1, items, [])):
            return cards.plan_sheet(self.boq, _SHEET, model)

    def test_an_unchanged_row_with_an_ok_card_is_not_sent(self):
        self._stored(5)
        plan = self._plan([(5, _item(5)), (6, _item(6))])
        self.assertEqual(plan["reused"], [5])
        self.assertEqual([r for b in plan["batches"] for r in b["rows"]], [6])

    def test_a_changed_payload_is_carded_again(self):
        self._stored(5)
        plan = self._plan([(5, _item(5, "Supply and fix 3.5C x 120 sqmm XLPE armoured cable"))])
        self.assertEqual(plan["reused"], [])
        self.assertEqual([r for b in plan["batches"] for r in b["rows"]], [5])

    def test_a_changed_prompt_is_carded_again(self):
        self._stored(5, version="0" * 64)
        plan = self._plan([(5, _item(5))])
        self.assertEqual(plan["reused"], [])

    def test_another_model_is_carded_again(self):
        self._stored(5, model="another-model")
        plan = self._plan([(5, _item(5))], model="m")
        self.assertEqual(plan["reused"], [])

    def test_a_malformed_card_is_carded_again(self):
        self._stored(5, status=cards.STATUS_MALFORMED)
        plan = self._plan([(5, _item(5))])
        self.assertEqual(plan["reused"], [])
        self.assertEqual([r for b in plan["batches"] for r in b["rows"]], [5])


class TestStore(_StoreCase):

    def _run(self, items, replies):
        client = _Client(replies)
        with patch.object(cards, "sheet_items", return_value=(2, items, [])):
            out = cards.card_sheet(self.boq, _SHEET, client=client, settings=dict(_SETTINGS))
        rows = {r["excel_row"]: r for r in frappe.get_all(
            cards.CARD_DOCTYPE, filters={"boq": self.boq}, fields=["excel_row", "status", "card_json", "model",
                                                                "tokens_in", "tokens_out", "cost_usd",
                                                                "commit_version", "prompt_version"])}
        return out, rows, client

    def test_a_parsed_card_is_ok_and_a_missing_row_is_stored_malformed(self):
        reply = json.dumps([{"id": 1, "kind": {"v": "cable"}}, {"id": 2, "kind": {"v": "item"}}])
        out, rows, client = self._run([(1, _item(1)), (2, _item(2)), (3, _item(3))], [_resp(reply)])
        self.assertEqual(sorted(rows), [1, 2, 3])
        self.assertEqual((rows[1]["status"], rows[2]["status"], rows[3]["status"]), ("ok", "ok", "malformed"))
        self.assertEqual(frappe.parse_json(rows[1]["card_json"])["kind"]["v"], "cable")
        self.assertIn("error", frappe.parse_json(rows[3]["card_json"]))
        self.assertEqual((out["ok"], out["malformed"], out["failed"]), (2, 1, 0))
        # usage: the request's tokens and $ shared equally; model, prompt version and committed version stamped
        self.assertEqual(rows[1]["tokens_in"], round(1000 / 3))
        self.assertAlmostEqual(rows[1]["cost_usd"], (1000 * 1.0 + 500 * 5.0) / 1e6 / 3, places=9)
        self.assertEqual((rows[1]["model"], rows[1]["commit_version"]), ("model-under-test", 2))
        self.assertEqual(rows[1]["prompt_version"], _PROMPT_SHA)
        self.assertEqual(client.sent[0]["max_tokens"], 32000)

    def test_a_reply_that_does_not_parse_stores_every_row_malformed(self):
        out, rows, _ = self._run([(1, _item(1)), (2, _item(2))], [_resp("sorry, I cannot")])
        self.assertEqual({r["status"] for r in rows.values()}, {"malformed"})
        self.assertEqual(frappe.parse_json(rows[1]["card_json"])["reply_text"], "sorry, I cannot")

    def test_a_failed_call_stores_every_row_failed(self):
        err = Exception("bad request")
        err.status_code = 400
        out, rows, _ = self._run([(1, _item(1)), (2, _item(2))], [err])
        self.assertEqual({r["status"] for r in rows.values()}, {"failed"})
        self.assertEqual(out["failed"], 2)

    def test_a_malformed_card_is_overwritten_in_place_when_carded_again(self):
        self._stored(4, status=cards.STATUS_MALFORMED, model="model-under-test")
        before = frappe.get_all(cards.CARD_DOCTYPE, filters={"boq": self.boq}, pluck="name")
        out, rows, _ = self._run([(4, _item(4))], [_resp(json.dumps([{"id": 4, "kind": {"v": "cable"}}]))])
        after = frappe.get_all(cards.CARD_DOCTYPE, filters={"boq": self.boq}, pluck="name")
        self.assertEqual(before, after)
        self.assertEqual(rows[4]["status"], "ok")

    def test_requests_go_through_the_runner_with_the_card_settings(self):
        seen = {}
        real = call_runner.run

        def spy(reqs, **kw):
            seen["reqs"], seen["kw"] = reqs, kw
            return real(reqs, **kw)

        with patch.object(call_runner, "run", side_effect=spy):
            self._run([(1, _item(1))], [_resp(json.dumps([{"id": 1, "kind": {"v": "item"}}]))])
        self.assertEqual(seen["reqs"][0].model, "model-under-test")
        self.assertEqual(seen["reqs"][0].max_tokens, 32000)
        self.assertEqual(seen["kw"]["cap_usd"], 5.0)
        self.assertEqual(seen["kw"]["limits"].calls_at_once, 4)


class TestRefusal(FrappeTestCase):

    def test_an_empty_card_model_refuses_before_anything_is_read_or_sent(self):
        empty = {f: None for f in ai_settings.MATCH_FIELDS}
        empty.update(match_enabled=True, match_cards_at_commit=True, match_calls_at_once=50,
                     match_reply_max_tokens=1024, match_card_reply_max_tokens=32000, match_retry_wait_s=5,
                     match_burst_failures=10, match_burst_window_s=60, match_cost_cap_usd=5.0,
                     match_card_price_in=0.1, match_card_price_out=0.5)
        with patch.object(ai_settings, "get_boq_match_settings", return_value=empty), \
             patch.object(cards, "plan_sheet") as plan, patch.object(call_runner, "run") as run:
            with self.assertRaises(ai_settings.MatchSettingsIncomplete) as ctx:
                cards.card_sheet(_BOQ, _SHEET)
        self.assertIn("Card model", str(ctx.exception))
        plan.assert_not_called()
        run.assert_not_called()


class TestCommitJob(FrappeTestCase):

    def test_the_job_does_nothing_when_switched_off(self):
        with patch.object(ai_settings, "match_cards_at_commit_on", return_value=False), \
             patch.object(cards, "card_sheet") as card:
            self.assertIsNone(cards.card_committed_sheet(_BOQ, _SHEET, 1))
        card.assert_not_called()

    def test_a_sheet_committed_again_since_is_skipped(self):
        with patch.object(ai_settings, "match_cards_at_commit_on", return_value=True), \
             patch.object(frappe.db, "get_value", return_value=2), \
             patch.object(cards, "card_sheet") as card:
            out = cards.card_committed_sheet(_BOQ, _SHEET, 1)
        self.assertIn("skipped", out)
        card.assert_not_called()


class TestParse(FrappeTestCase):

    def test_parse_reply(self):
        cards_, err = cards.parse_reply('prose [{"id": 3, "kind": {"v": "item"}}, {"id": 99}] tail', [3, 4])
        self.assertIsNone(err)
        self.assertEqual(list(cards_), ["3"])
        self.assertEqual(cards.parse_reply("no array", [1]), ({}, "no JSON array in the reply"))
        self.assertTrue(cards.parse_reply("[{bad json]", [1])[1].startswith("the reply's JSON does not parse"))
