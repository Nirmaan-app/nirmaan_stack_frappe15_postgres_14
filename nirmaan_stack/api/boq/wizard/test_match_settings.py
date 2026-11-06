# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt
"""Tests for the historical-matching settings (DEV2-B1, T1): the match getter, the refusal, the commit gate.

The Single is never written: every case feeds the reader through the one seam it uses
(frappe.db.get_singles_dict / frappe.db.get_single_value), so the site's real settings are never read into an
assertion and never changed (CODING_STANDARDS: single-doctype state). The API key is not touched at all.

  getter     nothing stored -> the doctype's declared defaults; models and prices -> None (no code default)
             stored values -> typed values
  refusal    an empty model, an empty price or an unusable limit refuses with a plain message naming it
             a complete set is returned, with the kind's own reply cap (defaults 32000 both since DEV2-B3; a stored judge cap is the judge's only)
  gate       commit gate ON only when BOTH switches are on; fails closed on a read error
  untouched  get_boq_ai_settings returns exactly its old keys; the existing `model` field keeps its default
"""
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import ai_settings as s

_COMPLETE = {
    "match_card_model": "card-model-x", "match_judge_model": "judge-model-y",
    "match_card_price_in": "0.1", "match_card_price_out": "0.5",
    "match_judge_price_in": "0.2", "match_judge_price_out": "0.9",
}


def _stored(d):
    return patch.object(frappe.db, "get_singles_dict", return_value=frappe._dict(d))


class TestMatchGetter(FrappeTestCase):

    def test_every_match_field_is_on_the_doctype(self):
        meta = frappe.get_meta(s.SETTINGS_DOCTYPE)
        self.assertEqual([f for f in s.MATCH_FIELDS if not meta.get_field(f)], [])

    def test_nothing_stored_reads_the_doctype_defaults_and_no_model_or_price(self):
        with _stored({}):
            got = s.get_boq_match_settings()
        self.assertEqual(
            {k: got[k] for k in ("match_enabled", "match_cards_at_commit", "match_calls_at_once",
                                 "match_reply_max_tokens", "match_card_reply_max_tokens", "match_retry_wait_s",
                                 "match_burst_failures", "match_burst_window_s", "match_max_request_tokens")},
            {"match_enabled": False, "match_cards_at_commit": False, "match_calls_at_once": 50,
             "match_reply_max_tokens": 32000, "match_card_reply_max_tokens": 32000, "match_retry_wait_s": 5,
             "match_burst_failures": 10, "match_burst_window_s": 60, "match_max_request_tokens": 100000})
        # INVERTED (DEV2-B3, owner 2026-11-02 23:23): the cost cap is gone from the getter and the doctype
        self.assertNotIn("match_cost_cap_usd", got)
        for f in ("match_card_model", "match_judge_model", "match_card_price_in", "match_card_price_out",
                  "match_judge_price_in", "match_judge_price_out"):
            self.assertIsNone(got[f], f"{f} must have no default (model names and prices live in the setting only)")

    def test_stored_values_are_read_and_typed(self):
        with _stored(dict(_COMPLETE, match_calls_at_once="7", match_enabled="1", match_max_request_tokens="80000")):
            got = s.get_boq_match_settings()
        self.assertEqual(got["match_card_model"], "card-model-x")
        self.assertEqual(got["match_calls_at_once"], 7)
        self.assertIs(got["match_enabled"], True)
        self.assertEqual(got["match_card_price_out"], 0.5)
        self.assertEqual(got["match_max_request_tokens"], 80000)


class TestLaneWorkers(FrappeTestCase):
    """DEV2-B4: match_lane_workers - the forked lane processes of the match job (doctype default 2)."""

    def test_nothing_stored_reads_two(self):
        with _stored({}):
            self.assertEqual(s.match_lane_workers(), 2)
            self.assertEqual(s.get_boq_match_settings()["match_lane_workers"], 2)

    def test_a_stored_value_is_read_typed(self):
        with _stored({"match_lane_workers": "3"}):
            self.assertEqual(s.match_lane_workers(), 3)

    def test_zero_refuses_naming_the_field(self):
        with _stored({"match_lane_workers": "0"}):
            with self.assertRaises(s.MatchSettingsIncomplete) as ctx:
                s.match_lane_workers()
        self.assertIn("Lane workers (processes)", str(ctx.exception))


class TestMatchRefusal(FrappeTestCase):

    def test_an_empty_model_refuses_with_a_plain_message(self):
        with _stored(dict(_COMPLETE, match_card_model="")):
            with self.assertRaises(s.MatchSettingsIncomplete) as ctx:
                s.require_match_settings("card")
        self.assertIn("Card model is empty", str(ctx.exception))

    def test_an_empty_price_refuses(self):
        with _stored(dict(_COMPLETE, match_judge_price_out=None)):
            with self.assertRaises(s.MatchSettingsIncomplete) as ctx:
                s.require_match_settings("judge")
        self.assertIn("Judge model price out", str(ctx.exception))

    def test_a_zero_limit_refuses(self):
        with _stored(dict(_COMPLETE, match_calls_at_once="0")):
            with self.assertRaises(s.MatchSettingsIncomplete):
                s.require_match_settings("card")

    def test_a_zero_size_guard_refuses(self):
        with _stored(dict(_COMPLETE, match_max_request_tokens="0")):
            with self.assertRaises(s.MatchSettingsIncomplete) as ctx:
                s.require_match_settings("judge")
        self.assertIn("Largest request", str(ctx.exception))

    def test_no_cost_cap_field_or_refusal_exists(self):
        # INVERTED (DEV2-B3, owner 2026-11-02 23:23: "it should not be a part of the code or setting")
        self.assertNotIn("match_cost_cap_usd", s.MATCH_FIELDS)
        self.assertIsNone(frappe.get_meta(s.SETTINGS_DOCTYPE).get_field("match_cost_cap_usd"))
        with _stored(dict(_COMPLETE, match_cost_cap_usd="0")):
            got = s.require_match_settings("card")
        self.assertNotIn("cost_cap_usd", got)

    def test_a_complete_set_is_returned_with_the_kinds_own_reply_cap(self):
        with _stored(dict(_COMPLETE, match_reply_max_tokens="2048")):
            card = s.require_match_settings("card")
            judge = s.require_match_settings("judge")
        self.assertEqual((card["model"], card["price_in"], card["price_out"]), ("card-model-x", 0.1, 0.5))
        self.assertEqual((judge["model"], judge["price_in"], judge["price_out"]), ("judge-model-y", 0.2, 0.9))
        # DEV2-B3 (owner answer 1, option A): the judge default is 32000 too, so a stored judge value proves the split
        self.assertEqual((card["reply_max_tokens"], judge["reply_max_tokens"]), (32000, 2048))
        self.assertEqual((card["calls_at_once"], card["retry_wait_s"], card["burst_failures"],
                          card["burst_window_s"], card["max_request_tokens"]), (50, 5, 10, 60, 100000))


class TestCommitGate(FrappeTestCase):

    def _gate(self, enabled, at_commit):
        vals = {"match_enabled": enabled, "match_cards_at_commit": at_commit}
        with patch.object(frappe.db, "get_single_value", side_effect=lambda dt, f, cache=True: vals[f]):
            return s.match_cards_at_commit_on()

    def test_the_gate_is_on_only_when_both_switches_are_on(self):
        self.assertIs(self._gate(1, 1), True)
        self.assertIs(self._gate(1, 0), False)
        self.assertIs(self._gate(0, 1), False)
        self.assertIs(self._gate(0, 0), False)

    def test_the_gate_fails_closed_on_a_read_error(self):
        with patch.object(frappe.db, "get_single_value", side_effect=RuntimeError("db down")):
            self.assertIs(s.match_cards_at_commit_on(), False)


class TestExistingSettingsUntouched(FrappeTestCase):

    def test_get_boq_ai_settings_keeps_its_keys_and_the_model_default(self):
        got = s.get_boq_ai_settings()
        # the full shape, or its fail-closed shape on a read error -- never a match field
        self.assertIn(set(got), [{"enabled", "provider", "model", "max_tokens", "request_timeout_seconds"},
                                 {"enabled", "request_timeout_seconds"}])
        self.assertEqual(frappe.get_meta(s.SETTINGS_DOCTYPE).get_field("model").default, "claude-sonnet-4-6")
