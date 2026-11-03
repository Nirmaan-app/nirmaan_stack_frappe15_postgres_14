# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the spec-card loader (DEV2-B5 S1; scripts/_instruments/load_spec_cards.py) - R-H2W. Fixtures only: no
model call; the one database test inserts into `BoQ Row Spec Card` inside the test's transaction and rolls back.

  match        sha + prompt + model all equal the current ones -> load            /  each one differing -> skip-mismatch
  no row       a key naming no current row -> skip-mismatch (never loaded)        /  a malformed key -> the same
  exists       a stored card (ANY status) for the same sha + prompt + model -> skip-exists, never overwritten
  duplicate    two lines with one payload sha -> the first loads, the second is skip-exists
  dry          --dry classifies and inserts nothing                               /  a real run inserts exactly the
               "load" cards, stored as the card job stores them (status ok, card_json = json.dumps(card, ensure_ascii=
               False), the row's commit version, tokens 0)
  key          the sheet may contain "|"
"""
import importlib.util
import json
from pathlib import Path
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

import nirmaan_stack

_PATH = Path(nirmaan_stack.__file__).resolve().parents[1] / "scripts" / "_instruments" / "load_spec_cards.py"
_spec = importlib.util.spec_from_file_location("load_spec_cards_under_test", _PATH)
LSC = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(LSC)

PV, MODEL = "pv-1", "card-model"


def _card(key, sha, pv=PV, model=MODEL, **card):
    return {"key": key, "payload_sha256": sha, "prompt_version": pv, "model": model, "card": {"id": 1, **card}}


CURRENT = {"B1|S|1": (3, "sha-1"), "B1|S|2": (3, "sha-2"), "B2|A|B|7": (1, "sha-7")}


class TestClassify(FrappeTestCase):
    def verdicts(self, cards, existing=frozenset()):
        return [(c["key"], v) for c, v, _ in LSC.classify(cards, CURRENT, set(existing), PV, MODEL)]

    def test_match_loads(self):
        self.assertEqual(self.verdicts([_card("B1|S|1", "sha-1")]), [("B1|S|1", LSC.LOAD)])

    def test_sha_differs_is_skipped(self):
        self.assertEqual(self.verdicts([_card("B1|S|1", "sha-OLD")]), [("B1|S|1", LSC.SKIP_MISMATCH)])

    def test_prompt_differs_is_skipped(self):
        self.assertEqual(self.verdicts([_card("B1|S|1", "sha-1", pv="pv-0")]), [("B1|S|1", LSC.SKIP_MISMATCH)])

    def test_model_differs_is_skipped(self):
        self.assertEqual(self.verdicts([_card("B1|S|1", "sha-1", model="other")]), [("B1|S|1", LSC.SKIP_MISMATCH)])

    def test_no_current_row_is_skipped(self):
        self.assertEqual(self.verdicts([_card("B9|S|1", "sha-1"), _card("not-a-key", "sha-1")]),
                         [("B9|S|1", LSC.SKIP_MISMATCH), ("not-a-key", LSC.SKIP_MISMATCH)])

    def test_existing_card_is_never_overwritten(self):
        self.assertEqual(self.verdicts([_card("B1|S|1", "sha-1")], existing={("sha-1", PV, MODEL)}),
                         [("B1|S|1", LSC.SKIP_EXISTS)])
        # a stored card under ANOTHER prompt does not block the load
        self.assertEqual(self.verdicts([_card("B1|S|1", "sha-1")], existing={("sha-1", "pv-0", MODEL)}),
                         [("B1|S|1", LSC.LOAD)])

    def test_duplicate_sha_in_the_file_loads_once(self):
        cur = dict(CURRENT, **{"B3|S|1": (2, "sha-1")})
        got = [(c["key"], v) for c, v, _ in LSC.classify([_card("B1|S|1", "sha-1"), _card("B3|S|1", "sha-1")], cur, set(), PV, MODEL)]
        self.assertEqual(got, [("B1|S|1", LSC.LOAD), ("B3|S|1", LSC.SKIP_EXISTS)])

    def test_counts_and_reasons(self):
        c = LSC.counts(LSC.classify([_card("B1|S|1", "sha-1"), _card("B1|S|2", "x"), _card("B9|S|1", "y")],
                                    CURRENT, set(), PV, MODEL))
        self.assertEqual((c[LSC.LOAD], c[LSC.SKIP_MISMATCH], c[LSC.SKIP_EXISTS]), (1, 2, 0))
        self.assertIn("skip-mismatch: payload sha differs from the current row", c["reasons"])

    def test_key_with_a_bar_in_the_sheet(self):
        self.assertEqual(LSC.parse_key("B2|A|B|7"), ("B2", "A|B", 7))
        self.assertIsNone(LSC.parse_key("B2|S|x"))
        self.assertEqual(self.verdicts([_card("B2|A|B|7", "sha-7")]), [("B2|A|B|7", LSC.LOAD)])


class TestRun(FrappeTestCase):
    """run() against the live doctype with the row context and settings mocked: inside the test's transaction."""

    BOQ = "BOQ-TEST-LSC-0001"

    def setUp(self):
        frappe.db.savepoint("lsc")
        from nirmaan_stack.services.boq_rate_match import cards as C
        self.C = C
        self.pv = C.prompt_version()
        self.sha_new = "f" * 63 + "1"
        self.sha_old = "f" * 63 + "2"
        # the card's boq is a Link: a bare BOQs row (no hooks) inside the savepoint satisfies it
        frappe.db.sql('insert into "tabBOQs" (name, creation, modified, owner, modified_by, docstatus, idx) '
                      "values (%s, now(), now(), 'Administrator', 'Administrator', 0, 0)", (self.BOQ,))
        # a stored MALFORMED card for sha_old: it must survive the load untouched
        frappe.db.sql(f'insert into "tab{C.CARD_DOCTYPE}" (name, boq, sheet, excel_row, commit_version, payload_sha256, '
                      'prompt_version, model, status, card_json, tokens_in, tokens_out, cost_usd, creation, modified, '
                      "owner, modified_by, docstatus, idx) values ('lsc-fixture-old', %s, 'S', 2, 3, %s, %s, %s, "
                      "'malformed', '{\"error\": \"x\"}', 5, 6, 0.1, now(), now(), 'Administrator', 'Administrator', 0, 0)",
                      (self.BOQ, self.sha_old, self.pv, MODEL))

    def tearDown(self):
        frappe.db.rollback(save_point="lsc")

    def _run(self, dry):
        cards = [_card(f"{self.BOQ}|S|1", self.sha_new, pv=self.pv, kind={"v": "item"}),
                 _card(f"{self.BOQ}|S|2", self.sha_old, pv=self.pv),
                 _card(f"{self.BOQ}|S|3", "stale", pv=self.pv)]
        cur = {f"{self.BOQ}|S|1": (3, self.sha_new), f"{self.BOQ}|S|2": (3, self.sha_old), f"{self.BOQ}|S|3": (3, "now")}
        with mock.patch.object(LSC, "current_rows", return_value=cur), \
                mock.patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_match_settings",
                           return_value={"match_card_model": MODEL}), \
                mock.patch.object(frappe.db, "commit"):
            return LSC.run(cards, dry)

    def _stored(self):
        return frappe.get_all(self.C.CARD_DOCTYPE, filters={"boq": self.BOQ}, order_by="excel_row",
                              fields=["excel_row", "payload_sha256", "status", "card_json", "commit_version", "tokens_in"])

    def test_dry_writes_nothing(self):
        rep = self._run(dry=True)
        self.assertEqual((rep["load"], rep["skip-mismatch"], rep["skip-exists"]), (1, 1, 1))
        self.assertEqual(rep["loaded"], [])
        self.assertEqual([r["excel_row"] for r in self._stored()], [2])

    def test_load_inserts_only_the_matching_card_and_keeps_the_existing_one(self):
        rep = self._run(dry=False)
        self.assertEqual([x["key"] for x in rep["loaded"]], [f"{self.BOQ}|S|1"])
        rows = self._stored()
        self.assertEqual([r["excel_row"] for r in rows], [1, 2])
        new, old = rows
        self.assertEqual((new["status"], new["payload_sha256"], new["commit_version"], new["tokens_in"]),
                         ("ok", self.sha_new, 3, 0))
        self.assertEqual(new["card_json"] if isinstance(new["card_json"], str) else json.dumps(new["card_json"]),
                         json.dumps({"id": 1, "kind": {"v": "item"}}, ensure_ascii=False))
        self.assertEqual(old["status"], "malformed")       # never overwritten, even though it is not ok
