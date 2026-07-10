# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""HV-2 unit tests: voter single-row-batch parse tolerance + harness hardening.

Pure unittest, NO frappe, NO live AI (mirrors test_runner_electrical). Covers:

  Voter parse (ai_voter._extract_json_array / _ai_batch):
    T1  bare-object reply  -> parsed as a one-element list; downstream {id:(cat,conf,reason)}
        BYTE-IDENTICAL to the same object delivered inside a one-element array (single-row fix).
    T2  well-formed array reply -> unchanged behaviour (regression guard).
    T3  genuinely malformed / non-JSON reply -> still raises loudly (no error swallowing).

  Harness hardening (electrical_classification_harness):
    T4  a stubbed sheet that raises -> recorded FAILED, subsequent sheets STILL processed,
        the summary names it (per-sheet isolation).
    T5  an all-green stub run -> (ok, []) shape, every sheet processed in order (control).
    T6  _write_progress writes _PROGRESS.json (in a TEMP dir, never _classification_review/)
        with the expected keys, refreshed after each batch.

The voter parse fix is parse-shape tolerance ONLY: id/category validation stays downstream,
so a one-element array and a bare object must produce identical batch output (T1 == T2 path).
"""
import json
import os
import tempfile
import unittest

from nirmaan_stack.services.boq_category import ai_voter
from nirmaan_stack.services.boq_category.harness import electrical_classification_harness as H


# --- fakes: a minimal Anthropic-shaped client returning a fixed reply text ------------
class _FakeBlock:
    def __init__(self, text):
        self.text = text


class _FakeResp:
    def __init__(self, text):
        self.content = [_FakeBlock(text)]


class _FakeClient:
    """Stands in for anthropic.Anthropic: client.messages.create(...) -> resp.content[*].text."""
    def __init__(self, text):
        self._text = text
        self.messages = self

    def create(self, **_kw):
        return _FakeResp(self._text)


_ROW_OBJECT = '{"id": 42, "category_id": "point_wiring", "confidence": 0.9, "brief_reason": "pts"}'
_ROW_ARRAY = "[" + _ROW_OBJECT + "]"
_VALID_IDS = {"point_wiring", "wiring_cabling", "db_switchgear"}


class TestVoterParse(unittest.TestCase):
    """T1/T2/T3 -- single-row-batch object tolerance at the one extraction seam."""

    # T1 -- bare object -> one-element list, downstream identical to a one-element array
    def test_t1_bare_object_wrapped_as_one_element_list(self):
        parsed = ai_voter._extract_json_array(_ROW_OBJECT)
        self.assertIsInstance(parsed, list)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["id"], 42)

    def test_t1_bare_object_downstream_identical_to_array(self):
        items = [{"id": 42, "description": "x", "ancestor_chain": [], "notes": ""}]
        out_obj = ai_voter._ai_batch(_FakeClient(_ROW_OBJECT), "m", "prompt", items, _VALID_IDS)
        out_arr = ai_voter._ai_batch(_FakeClient(_ROW_ARRAY), "m", "prompt", items, _VALID_IDS)
        self.assertEqual(out_obj, out_arr)
        self.assertEqual(out_obj, {42: ("point_wiring", 0.9, "pts")})

    # T2 -- well-formed array reply is unchanged (regression)
    def test_t2_array_reply_unchanged(self):
        text = '[{"id": 1, "category_id": "wiring_cabling", "confidence": 0.8, "brief_reason": "c"},' \
               ' {"id": 2, "category_id": "db_switchgear", "confidence": 0.7, "brief_reason": "b"}]'
        parsed = ai_voter._extract_json_array(text)
        self.assertEqual([el["id"] for el in parsed], [1, 2])
        out = ai_voter._ai_batch(_FakeClient(text), "m", "prompt", [], _VALID_IDS)
        self.assertEqual(out, {1: ("wiring_cabling", 0.8, "c"), 2: ("db_switchgear", 0.7, "b")})

    def test_t2_array_with_prose_around_it_unchanged(self):
        # a reply with prose framing the array behaves exactly as before the fix
        text = 'Here is the JSON:\n[' + _ROW_OBJECT + ']\nDone.'
        parsed = ai_voter._extract_json_array(text)
        self.assertEqual(parsed[0]["id"], 42)

    # T3 -- genuinely malformed / non-JSON -> still raises loudly
    def test_t3_non_json_reply_raises(self):
        with self.assertRaises(ValueError):
            ai_voter._extract_json_array("sorry, I could not classify these rows")

    def test_t3_unterminated_object_raises(self):
        # a stray '{' with no closing brace has no array and no complete object -> raises
        with self.assertRaises(ValueError):
            ai_voter._extract_json_array('{"id": 42, "category_id":')

    def test_t3_broken_json_object_raises(self):
        # braces present but the content is not valid JSON -> json.loads raises (not swallowed)
        with self.assertRaises(ValueError):
            ai_voter._extract_json_array("{id: 42 no quotes here}")


class TestHarnessIsolation(unittest.TestCase):
    """T4/T5 -- per-sheet failure isolation via _process_all_sheets."""

    # T4 -- one sheet raises: recorded FAILED, later sheets still processed
    def test_t4_one_sheet_fails_others_continue(self):
        processed = []

        def process_one(spec):
            if spec["sheet_name"] == "BAD":
                raise RuntimeError("boom on this sheet")
            processed.append(spec["sheet_name"])

        specs = [
            {"boq": "BOQ-A", "sheet_name": "S1"},
            {"boq": "BOQ-A", "sheet_name": "BAD"},
            {"boq": "BOQ-B", "sheet_name": "S2"},
        ]
        ok, failed = H._process_all_sheets(specs, process_one)
        self.assertEqual(ok, 2)
        self.assertEqual(processed, ["S1", "S2"])  # the sheet AFTER the failure still ran
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["boq"], "BOQ-A")
        self.assertEqual(failed[0]["sheet_name"], "BAD")
        self.assertIn("boom on this sheet", failed[0]["error"])

    # T5 -- all-green run: (ok, []) shape, every sheet processed in order
    def test_t5_all_green_shape_unchanged(self):
        processed = []

        def process_one(spec):
            processed.append(spec["sheet_name"])

        specs = [{"boq": "B", "sheet_name": "S1"}, {"boq": "B", "sheet_name": "S2"}]
        ok, failed = H._process_all_sheets(specs, process_one)
        self.assertEqual(ok, 2)
        self.assertEqual(failed, [])
        self.assertEqual(processed, ["S1", "S2"])


class TestHarnessProgress(unittest.TestCase):
    """T6 -- _write_progress emits _PROGRESS.json with the expected keys, refreshed per batch."""

    _KEYS = ("boq", "sheet_name", "batch", "batches_total", "rows_done", "rows_total", "timestamp")

    def test_t6_progress_file_written_with_keys(self):
        with tempfile.TemporaryDirectory() as d:
            # batch 1 of 3
            H._write_progress(d, boq="BOQ-A", sheet_name="S1", batch=1, batches_total=3,
                              rows_done=20, rows_total=55)
            path = os.path.join(d, "_PROGRESS.json")
            self.assertTrue(os.path.exists(path))
            data = json.load(open(path, encoding="utf-8"))
            for k in self._KEYS:
                self.assertIn(k, data, msg=f"missing progress key {k!r}")
            self.assertEqual(data["rows_total"], 55)
            self.assertEqual(data["batch"], 1)

            # after the NEXT batch the same file is refreshed in place (batch 2)
            H._write_progress(d, boq="BOQ-A", sheet_name="S1", batch=2, batches_total=3,
                              rows_done=40, rows_total=55)
            data2 = json.load(open(path, encoding="utf-8"))
            self.assertEqual(data2["batch"], 2)
            self.assertEqual(data2["rows_done"], 40)

    def test_t6_progress_writes_into_given_folder_only(self):
        # the progress file lands in the folder handed in (the run's OWN output dir), nowhere else
        with tempfile.TemporaryDirectory() as d:
            H._write_progress(d, status="done", sheets_ok=5, sheets_failed=0, failed=[])
            self.assertEqual(os.listdir(d), ["_PROGRESS.json"])
            data = json.load(open(os.path.join(d, "_PROGRESS.json"), encoding="utf-8"))
            self.assertEqual(data["status"], "done")
            self.assertIn("timestamp", data)


if __name__ == "__main__":
    unittest.main()
