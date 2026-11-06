# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the spec-card export (DEV2-B6 S1; scripts/_instruments/export_spec_cards.py) and the go-live loader
rehearsal (S5). No model call. The database tests run inside a savepoint / the test's transaction and roll back;
frappe.db.commit is patched out wherever the loader would commit.

  the line      a stored row -> {key, payload_sha256, prompt_version, model, card} (card_json parsed, str or dict)
  the file      ordered by boq, sheet, excel_row, name; the summary counts rows / keys / shas and hashes the bytes
  round trip    export -> the loader's classify against the same rows = ALL skip-exists (0 load, 0 mismatch)  /  the
                same file against an empty store = all load (the round trip is not vacuous)  /  a row changed since
                -> skip-mismatch, never a load
  only ok       read_rows exports ok cards only; a malformed / failed one never
  REHEARSAL     (S5, live rows, rolled back) one BoQ's card rows deleted and re-loaded from the export: exactly those
                rows load, card_json byte-equal, and the card count is unchanged afterwards
"""
import importlib.util
import json
import os
import tempfile
from pathlib import Path
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

import nirmaan_stack

_DIR = Path(nirmaan_stack.__file__).resolve().parents[1] / "scripts" / "_instruments"


def _load(name):
    spec = importlib.util.spec_from_file_location(f"{name}_under_test", _DIR / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ESC = _load("export_spec_cards")
LSC = _load("load_spec_cards")
PV, MODEL = "pv-1", "card-model"


def _row(boq, sheet, er, sha, name=None, card=None, as_text=True):
    c = card or {"id": er, "kind": "item", "text": "Cable 4 sq mm ✓"}
    return {"name": name or f"n-{boq}-{er}", "boq": boq, "sheet": sheet, "excel_row": er, "payload_sha256": sha,
            "prompt_version": PV, "model": MODEL, "card_json": json.dumps(c, ensure_ascii=False) if as_text else c}


ROWS = [_row("B2", "S", 5, "sha-25"), _row("B1", "S|x", 2, "sha-12"), _row("B1", "S|x", 1, "sha-11", as_text=False)]


class TestExportFile(FrappeTestCase):

    def test_a_row_becomes_the_loaders_line(self):
        line = ESC.card_line(ROWS[0])
        self.assertEqual(line, {"key": "B2|S|5", "payload_sha256": "sha-25", "prompt_version": PV, "model": MODEL,
                                "card": {"id": 5, "kind": "item", "text": "Cable 4 sq mm ✓"}})
        self.assertEqual(ESC.card_line(ROWS[2])["card"]["id"], 1)          # a card_json already parsed (dict)
        self.assertEqual(LSC.parse_key(ESC.card_line(ROWS[1])["key"]), ("B1", "S|x", 2))   # a "|" in the sheet

    def test_the_file_is_ordered_and_summarised(self):
        lines = ESC.export_lines(ROWS)
        self.assertEqual([json.loads(x)["key"] for x in lines], ["B1|S|x|1", "B1|S|x|2", "B2|S|5"])
        data = ESC.file_bytes(lines)
        s = ESC.summary(lines, data)
        self.assertEqual((s["rows"], s["distinct_keys"], s["distinct_payload_sha256"]), (3, 3, 3))
        self.assertEqual((s["by_boq"], s["models"], s["prompt_versions"]), ({"B1": 2, "B2": 1}, {MODEL: 3}, {PV: 3}))
        import hashlib
        self.assertEqual(s["sha256"], hashlib.sha256(data).hexdigest())
        self.assertIn("✓".encode("utf-8"), data)                            # client text kept as written

    def test_write_export_writes_the_file_and_its_summary(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "cards.jsonl")
            rep = ESC.write_export(ROWS, out)
            self.assertEqual(rep["rows"], 3)
            self.assertEqual(json.load(open(out + ".summary.json", encoding="utf-8"))["sha256"], rep["sha256"])
            self.assertEqual(len(LSC.read_cards(out)), 3)


class TestRoundTrip(FrappeTestCase):
    """export -> the loader's --dry on the same rows: every line skip-exists."""

    def _classify(self, rows, current, existing):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "cards.jsonl")
            ESC.write_export(rows, out)
            cards = LSC.read_cards(out)
        return LSC.counts(LSC.classify(cards, current, existing, PV, MODEL))

    def test_the_same_rows_are_all_skip_exists(self):
        current = {f"{r['boq']}|{r['sheet']}|{r['excel_row']}": (1, r["payload_sha256"]) for r in ROWS}
        existing = {(r["payload_sha256"], PV, MODEL) for r in ROWS}
        c = self._classify(ROWS, current, existing)
        self.assertEqual((c[LSC.LOAD], c[LSC.SKIP_MISMATCH], c[LSC.SKIP_EXISTS]), (0, 0, 3))

    def test_against_an_empty_store_every_line_loads(self):
        current = {f"{r['boq']}|{r['sheet']}|{r['excel_row']}": (1, r["payload_sha256"]) for r in ROWS}
        c = self._classify(ROWS, current, set())
        self.assertEqual((c[LSC.LOAD], c[LSC.SKIP_MISMATCH], c[LSC.SKIP_EXISTS]), (3, 0, 0))

    def test_a_row_changed_since_is_a_mismatch_never_a_load(self):
        current = {"B2|S|5": (2, "sha-NEW"), "B1|S|x|2": (1, "sha-12"), "B1|S|x|1": (1, "sha-11")}
        c = self._classify(ROWS, current, set())
        self.assertEqual((c[LSC.LOAD], c[LSC.SKIP_MISMATCH]), (2, 1))


class TestReadRows(FrappeTestCase):
    """read_rows against the live doctype, inside a savepoint: ok cards only."""

    BOQ = "BOQ-TEST-ESC-0001"

    def setUp(self):
        from nirmaan_stack.services.boq_rate_match import cards as C
        self.C = C
        frappe.db.savepoint("esc")
        frappe.db.sql('insert into "tabBOQs" (name, creation, modified, owner, modified_by, docstatus, idx) '
                      "values (%s, now(), now(), 'Administrator', 'Administrator', 0, 0)", (self.BOQ,))
        for name, er, status in (("esc-fixture-ok", 1, "ok"), ("esc-fixture-bad", 2, "malformed"), ("esc-fixture-fail", 3, "failed")):
            frappe.db.sql(f'insert into "tab{C.CARD_DOCTYPE}" (name, boq, sheet, excel_row, commit_version, payload_sha256, '
                          'prompt_version, model, status, card_json, tokens_in, tokens_out, cost_usd, creation, modified, '
                          "owner, modified_by, docstatus, idx) values (%s, %s, 'S', %s, 1, %s, %s, %s, %s, %s, 0, 0, 0, "
                          "now(), now(), 'Administrator', 'Administrator', 0, 0)",
                          (name, self.BOQ, er, f"esc-sha-{er}", PV, MODEL, status, json.dumps({"id": er})))

    def tearDown(self):
        frappe.db.rollback(save_point="esc")

    def test_only_ok_cards_are_exported(self):
        mine = [r for r in ESC.read_rows() if r["boq"] == self.BOQ]
        self.assertEqual([r["name"] for r in mine], ["esc-fixture-ok"])
        self.assertEqual(ESC.card_line(mine[0])["card"], {"id": 1})


class TestLoaderRehearsal(FrappeTestCase):
    """S5 - THE LOADER REHEARSAL on the site's own cards: inside a transaction that is rolled back, one BoQ's card rows
    are deleted and re-loaded from the export. Skipped on a site with no current cards (a fresh test site)."""

    def _pick(self, by_boq):
        """The smallest BoQ (by card rows, at least 2) whose every card is for its row as it is now (a re-load can
        only bring back cards whose row is unchanged - R-H2W)."""
        for boq, rows in sorted(by_boq.items(), key=lambda kv: (len(kv[1]), kv[0])):
            if len(rows) < 2:
                continue
            lines = [ESC.card_line(r) for r in rows]
            cur = LSC.current_rows(lines)
            if all(cur.get(x["key"], (None, None))[1] == x["payload_sha256"] for x in lines):
                return boq, rows
        return None, None

    def _texts(self, boq):
        from nirmaan_stack.services.boq_rate_match import cards as C
        return {r[0]: r[1:] for r in frappe.db.sql(
            f'select payload_sha256, prompt_version, model, sheet, excel_row, status, card_json::text from "tab{C.CARD_DOCTYPE}" '
            "where boq = %s and status = 'ok'", (boq,))}

    def test_one_boqs_cards_deleted_and_reloaded_from_the_export_come_back_byte_equal(self):
        from nirmaan_stack.api.boq.wizard import ai_settings
        from nirmaan_stack.services.boq_rate_match import cards as C

        model = ai_settings.get_boq_match_settings().get("match_card_model")
        pv = C.prompt_version()
        rows = [r for r in ESC.read_rows() if r["prompt_version"] == pv and r["model"] == model]
        by_boq = {}
        for r in rows:
            by_boq.setdefault(r["boq"], []).append(r)
        boq, mine = self._pick(by_boq)
        if not boq:
            self.skipTest("no BoQ whose cards are all current on this site")
        count_before = frappe.db.count(C.CARD_DOCTYPE)
        before = self._texts(boq)
        lines = [json.loads(x) for x in ESC.export_lines(mine)]
        frappe.db.savepoint("rehearsal")
        try:
            frappe.db.sql(f'delete from "tab{C.CARD_DOCTYPE}" where boq = %s and status = %s', (boq, C.STATUS_OK))
            with mock.patch.object(frappe.db, "commit"):
                rep = LSC.run(lines, dry=False)
            after = self._texts(boq)
            self.assertEqual((rep[LSC.LOAD], rep[LSC.SKIP_MISMATCH], rep[LSC.SKIP_EXISTS]), (len(mine), 0, 0))
            self.assertEqual(sorted(x["key"] for x in rep["loaded"]), sorted(x["key"] for x in lines))
            self.assertEqual(after, before)            # every field, card_json BYTE-EQUAL as stored text
        finally:
            frappe.db.rollback(save_point="rehearsal")
        self.assertEqual(frappe.db.count(C.CARD_DOCTYPE), count_before)
        self.assertEqual(self._texts(boq), before)
