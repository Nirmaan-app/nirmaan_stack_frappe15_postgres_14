# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""SLICE 12e-5b2 AC3 (owner R3, 2026-10-15: "ok") -- A REPLY ELEMENT WITHOUT A ROW ID IS DROPPED BY NAME.

12e-5b's re-read of BOQ-26-00231 / HVAC BOQ (Piping, batch 2) raised `KeyError('id')`: one element of the model's
reply carried no "id". `_extract_batch` read `int(el["id"])`, the exception failed the whole batch, the retry
classifier called it transient, and the batch was asked again (a paid call). Now such an element is recorded in
`drops["items_no_id"]` and skipped; every other element of the same reply is kept; nothing is raised and nothing
is retried. An id that is a number but was not sent stays in `ids_not_in_batch`, exactly as before.

Pure in-process pins (no DB, no model): the stub client counts its calls; the capture path is a temp file.
"""

import json
import os
import tempfile
from unittest import mock

from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.test_classify import _FakeClient
from nirmaan_stack.services.boq_rate_master import extraction, loader


class _Resp:
    class _U:
        input_tokens = 10
        output_tokens = 20

    def __init__(self, text):
        self.content = [type("B", (), {"text": text})()]
        self.stop_reason = "end_turn"
        self.usage = _Resp._U()


def _asset(name):
    with open(os.path.join(os.path.dirname(loader.__file__), "data", name), encoding="utf-8") as fh:
        return json.load(fh)


_V40 = _asset("rate_master_hvac_all_v40.json")
_CFGS = {("HVAC", c["category_id"]): dict(c, discipline="HVAC") for c in _V40["category_configs"]}
_ATTR_DEFS = [{"id": "material", "type": "choice", "values": ["COPPER", "ALUMINIUM"]}]


def _rows(*excel_rows):
    return [{"excel_row": r, "description": "%d mm dia copper pipe with 19 mm nitrile" % (10 + r), "ancestors": [],
             "sheet_name": "HVAC BOQ", "committed_version": 1, "category_id": "hvac_piping", "discipline": "HVAC",
             "own_notes_raw": [], "attached_notes": "", "append_notes_raw": []} for r in excel_rows]


def _pipe(rid=None, size="12.7 mm"):
    el = {"items": [{"pipe_type": {"value": "Copper", "confidence": 0.9}, "size_mm": {"value": size, "confidence": 0.9}}]}
    if rid is not None:
        el["id"] = rid
    return el


class TestReplyElementWithoutId(FrappeTestCase):
    def setUp(self):
        self._dir = tempfile.mkdtemp()
        self.path = os.path.join(self._dir, "capture.jsonl")
        self.calls = 0

    def _batch_record(self):
        with open(self.path, encoding="utf-8") as fh:
            recs = [json.loads(x) for x in fh if x.strip()]
        self.assertEqual([r["kind"] for r in recs], ["batch"], "one batch, no failed attempt, no retry")
        return recs[0]

    def _run(self, reply, rows, items=True):
        def responder(call, kwargs):
            self.calls += 1
            return _Resp(json.dumps(reply))

        with mock.patch.object(extraction, "_capture_path", return_value=self.path), mock.patch.object(extraction.time, "sleep"):
            if items:
                g = extraction._group_context(_CFGS, "HVAC", "hvac_piping")
                self.assertIs(g["items_spec"].get("second_opinion"), False, "v40 Piping: second opinion off, so ONE call per batch")
                return extraction._extract_batch(_FakeClient(responder), "m", g["prompt"], g["defs"], rows, g["synonyms"], g["defaults"],
                                                 g["none_guidance"], g["slot_spec"], g["resolution_rules"], g["rules"],
                                                 items_spec=g["items_spec"], capture_ctx={"boq": "BOQ-26-00231"})
            return extraction._extract_batch(_FakeClient(responder), "m", "P", _ATTR_DEFS, rows, capture_ctx={"boq": "BOQ-26-00231"})

    def test_an_item_list_element_with_no_id_is_dropped_by_name_and_the_rest_kept(self):
        """The 00231 batch-2 shape: one element without "id" among good ones. Before: KeyError('id'), batch retried."""
        out = self._run([_pipe(130), _pipe(None, "15.9 mm"), _pipe(131, "19.05 mm")], _rows(130, 131))
        self.assertEqual(self.calls, 1, "no retry for a reply element without an id")
        self.assertEqual(sorted(out), [130, 131], "every element that names a sent row is kept")
        drops = self._batch_record()["drops"]
        self.assertEqual(len(drops["items_no_id"]), 1)
        self.assertIn("15.9 mm", drops["items_no_id"][0]["raw"], "the dropped element is recorded as the model sent it")
        self.assertEqual(drops["ids_not_in_batch"], [])

    def test_every_unusable_id_shape_is_dropped_the_same_way(self):
        # (an array holding a NON-object is never taken as the row array -- `_extract_json_array` skips it since
        # 2026-09-08 -- so only objects reach this loop; a non-object is pinned on `_reply_row_id` below)
        reply = [_pipe(130), {"id": None, "items": []}, {"id": "abc", "items": []}, {"id": [1], "items": []}, {"ID": 131, "items": []}]
        out = self._run(reply, _rows(130, 131))
        self.assertEqual(self.calls, 1)
        self.assertEqual(sorted(out), [130])
        self.assertEqual(len(self._batch_record()["drops"]["items_no_id"]), 4)

    def test_attribute_mode_too(self):
        out = self._run([{"attributes": {"material": {"value": "COPPER", "confidence": 0.9}}},
                         {"id": 2, "attributes": {"material": {"value": "COPPER", "confidence": 0.9}}}], _rows(2), items=False)
        self.assertEqual(self.calls, 1)
        self.assertEqual(sorted(out), [2])
        self.assertEqual(len(self._batch_record()["drops"]["items_no_id"]), 1)

    def test_NEGATIVE_an_id_not_sent_stays_in_ids_not_in_batch_and_a_good_reply_records_nothing(self):
        out = self._run([_pipe(130), _pipe(99)], _rows(130))
        self.assertEqual(sorted(out), [130])
        drops = self._batch_record()["drops"]
        self.assertEqual(drops["ids_not_in_batch"], [99])
        self.assertEqual(drops["items_no_id"], [])

    def test_NEGATIVE_a_string_number_id_is_read_as_before(self):
        """`int(el["id"])` always accepted "130"; the reader keeps that."""
        self.assertEqual(extraction._reply_row_id({"id": "130"}), 130)
        self.assertEqual(extraction._reply_row_id({"id": 130}), 130)
        for bad in ({}, {"id": None}, {"id": "x"}, {"id": [1]}, "s", 3, None):
            self.assertIsNone(extraction._reply_row_id(bad))

    def test_the_review_checks_transient_vocabulary_is_untouched(self):
        """AC3 changes no transient handling: `_TRANSIENT_MARKERS` (boq_ai_assist, shared with the review check) is
        read, never written, and `_is_transient` still retries an unrecognised error."""
        from nirmaan_stack.services.boq_ai_assist import _TRANSIENT_MARKERS
        self.assertIsInstance(_TRANSIENT_MARKERS, tuple)
        self.assertTrue(extraction._is_transient(KeyError("id")), "an unrecognised error still retries, as before")
