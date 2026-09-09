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


class TestHarnessReusesVoterExtractor(unittest.TestCase):
    """T7/T8 -- the harness parse path now reuses the voter's fixed extractor (HV-2b).

    The harness carried its OWN duplicate _extract_json_array with the pre-HV-2 single-row
    bug (a bare-object reply raised), so a live cert whose final batch was a single row would
    fail by construction. The duplicate is gone; the harness imports the voter's extractor."""

    # T7 (positive) -- the HARNESS _ai_batch path parses a bare single-row object identically
    # to the same object inside a one-element array.
    def test_t7_harness_parse_path_bare_object_matches_array(self):
        items = [{"id": 42, "description": "x", "ancestor_chain": [], "notes": ""}]
        out_obj = H._ai_batch(_FakeClient(_ROW_OBJECT), "m", "prompt", items, _VALID_IDS)
        out_arr = H._ai_batch(_FakeClient(_ROW_ARRAY), "m", "prompt", items, _VALID_IDS)
        self.assertEqual(out_obj, out_arr)
        self.assertEqual(out_obj, {42: ("point_wiring", 0.9, "pts")})

    # T7 (single source of truth) -- the harness name IS the voter's function, not a copy.
    def test_t7_harness_extractor_is_voter_extractor(self):
        self.assertIs(H._extract_json_array, ai_voter._extract_json_array)

    # T8 (negative) -- a genuinely non-JSON reply through the harness parse path still raises.
    def test_t8_harness_parse_path_non_json_raises(self):
        with self.assertRaises(ValueError):
            H._extract_json_array("sorry, I could not classify these rows")


if __name__ == "__main__":
    unittest.main()


class TestTolerantParse(unittest.TestCase):
    """SR-1 -- _extract_json_array becomes STRICTLY MORE PERMISSIVE: it takes the first BALANCED
    array span and ignores trailing data, instead of slicing first-'[' .. last-']' and dying on
    json.loads' "Extra data: line 1 column N". Everything previously accepted stays accepted; a
    truncated array and genuine garbage still RAISE (error-swallowing is the harness's job)."""

    # ── the fix: trailing data after a valid array now parses ──
    def test_trailing_second_array_now_parses(self):
        # The exact production shape: a good payload followed by another bracketed block. The old
        # first-'[' .. last-']' slice spanned BOTH and raised "Extra data".
        text = '[{"id": 1, "category_id": "wiring_cabling", "confidence": 0.8}]\n\n[{"note": "ignore me"}]'
        parsed = ai_voter._extract_json_array(text)
        self.assertEqual([el["id"] for el in parsed], [1])

    def test_trailing_prose_with_bracket_now_parses(self):
        text = '[{"id": 7, "category_id": "point_wiring", "confidence": 0.5}]\nDone [see notes].'
        parsed = ai_voter._extract_json_array(text)
        self.assertEqual(parsed[0]["id"], 7)

    def test_old_slice_would_have_failed_here(self):
        """Non-vacuity: the pre-SR-1 slice really did raise on this input."""
        text = '[{"id": 1, "category_id": "wiring_cabling", "confidence": 0.8}]\n\n[{"note": "x"}]'
        with self.assertRaises(ValueError):
            json.loads(text[text.find("[") : text.rfind("]") + 1])
        self.assertEqual(len(ai_voter._extract_json_array(text)), 1)  # ... and now it parses

    # ── brackets inside string values must not break the balance scan ──
    def test_bracket_inside_string_value(self):
        text = '[{"id": 2, "category_id": "wiring_cabling", "brief_reason": "cable [3C] x 2.5"}]'
        parsed = ai_voter._extract_json_array(text)
        self.assertEqual(parsed[0]["brief_reason"], "cable [3C] x 2.5")

    def test_escaped_quote_inside_string_value(self):
        text = r'[{"id": 3, "category_id": "earthing", "brief_reason": "a \"quoted\" ] brace"}]'
        parsed = ai_voter._extract_json_array(text)
        self.assertEqual(parsed[0]["id"], 3)

    # ── everything previously accepted is STILL accepted (strictly-more-permissive) ──
    def test_regression_plain_array(self):
        text = '[{"id": 1, "category_id": "wiring_cabling", "confidence": 0.8, "brief_reason": "c"},' \
               ' {"id": 2, "category_id": "db_switchgear", "confidence": 0.7, "brief_reason": "b"}]'
        self.assertEqual([el["id"] for el in ai_voter._extract_json_array(text)], [1, 2])

    def test_regression_prose_around_array(self):
        text = 'Here is the JSON:\n[' + _ROW_OBJECT + ']\nDone.'
        self.assertEqual(ai_voter._extract_json_array(text)[0]["id"], 42)

    def test_regression_bare_object_still_wrapped(self):
        parsed = ai_voter._extract_json_array(_ROW_OBJECT)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["id"], 42)

    # ── NEGATIVES: real failures still raise, never silently degrade to [] ──
    def test_truncated_array_raises(self):
        """A cut-off reply (max_tokens) must RAISE -- never silently yield only its first element,
        and never fall through to the bare-object path."""
        text = '[{"id": 1, "category_id": "wiring_cabling"}, {"id": 2, "category_id": "ear'
        with self.assertRaises(ValueError):
            ai_voter._extract_json_array(text)

    def test_truncated_array_does_not_degrade_to_first_object(self):
        text = '[{"id": 1, "category_id": "wiring_cabling"}, {"id": 2, "cat'
        try:
            got = ai_voter._extract_json_array(text)
        except ValueError:
            got = None
        self.assertIsNone(got, "a truncated array must raise, not return a partial list")

    def test_non_json_still_raises(self):
        with self.assertRaises(ValueError):
            ai_voter._extract_json_array("sorry, I could not classify these rows")

    def test_broken_json_still_raises(self):
        with self.assertRaises(ValueError):
            ai_voter._extract_json_array("{id: 42 no quotes here}")

    def test_never_returns_empty_on_garbage(self):
        for junk in ("", "no json at all", "]["):
            with self.assertRaises(ValueError):
                ai_voter._extract_json_array(junk)

    # ── the shared consumers ──
    def test_voter_batch_consumes_trailing_data_reply(self):
        text = '[{"id": 42, "category_id": "point_wiring", "confidence": 0.9, "brief_reason": "pts"}]\ntrailing [junk]'
        out = ai_voter._ai_batch(_FakeClient(text), "m", "prompt", [], _VALID_IDS)
        self.assertEqual(out, {42: ("point_wiring", 0.9, "pts")})

    def test_harness_still_shares_the_same_function(self):
        """The certified harness imports this function by identity, so it inherits the tolerance
        BY DESIGN -- this pin is what guarantees there is never a second copy."""
        from nirmaan_stack.services.boq_category.harness import electrical_classification_harness as H

        self.assertIs(H._extract_json_array, ai_voter._extract_json_array)


# ── 2026-09-08: a bracketed list of SCALARS inside prose is not the row array ──────────────────
#
# The real reply that halted the 2026-09-07 whole-sheet run (BOQ-26-00224, junction_box_raceway
# batch, 15 rows stranded), taken from the capture log `boq_rate_extraction_capture.jsonl`: the
# model prefaced its answer with prose quoting the allowed values (attempt 1 of 3, verbatim incl. the
# arrow glyphs it wrote), and `_extract_json_array`
# returned `[350, 250, 200, 150, 100, 300]` as the payload; `extraction._extract_batch` then did
# `int(el["id"])` on an int -> TypeError x3 -> ExtractionHalted. The model was not misbehaving.
_HALTED_REPLY_2026_09_07 = (
    "Looking at each row, the face sizes are non-standard and must map to the allowed values [350, 250, 200, 150, 100, 300].\n"
    "\n"
    "Row 359: 175x175 \u2192 face 175, not an allowed value \u2192 null\n"
    "Row 361: 275x275 \u2192 275, not allowed \u2192 null\n"
    "Row 363: 375x375 \u2192 375, not allowed \u2192 null\n"
    "Row 365: 475x475 \u2192 475, not allowed \u2192 null\n"
    "Row 367: 125x1255 \u2192 125/1255 (larger 1255), not allowed \u2192 null\n"
    "\n"
    "None match the allowed values, so all return null.\n"
    "\n"
    "[{\"id\": 359, \"attributes\": {\"face_mm\": {\"value\": null, \"confidence\": 0.9}}}, {\"id\": 361, \"attributes\": {\"face_mm\": {\"value\": null, \"confidence\": 0.9}}}, {\"id\": 363, \"attributes\": {\"face_mm\": {\"value\": null, \"confidence\": 0.9}}}, {\"id\": 365, \"attributes\": {\"face_mm\": {\"value\": null, \"confidence\": 0.9}}}, {\"id\": 367, \"attributes\": {\"face_mm\": {\"value\": null, \"confidence\": 0.9}}}]"
)


class TestScalarListSkip(unittest.TestCase):
    """The parser takes the first balanced span that parses as a LIST OF DICTS (or the empty list);
    a balanced span that parses as a list of anything else -- the model quoting its allowed
    values, a range, a list of labels -- is skipped and the scan continues. Both users of the
    parser (the classifier voter / harness and the rate extractor) inherit this by identity."""

    # ── THE PIN THAT PROVES THE DEFECT FIXED: the real 2026-09-07 reply parses to the ROW ARRAY ──
    def test_real_halted_reply_parses_to_the_row_array(self):
        parsed = ai_voter._extract_json_array(_HALTED_REPLY_2026_09_07)
        self.assertEqual([el["id"] for el in parsed], [359, 361, 363, 365, 367])
        self.assertTrue(all(el["attributes"]["face_mm"]["value"] is None for el in parsed))
        self.assertEqual(parsed[0]["attributes"]["face_mm"]["confidence"], 0.9)

    def test_old_form_really_returned_the_scalar_list(self):
        """Non-vacuity: the first balanced span IS the scalar list, and it parses as JSON."""
        t = _HALTED_REPLY_2026_09_07
        i = t.find("[")
        end = ai_voter._balanced_span(t, i, "[", "]")
        self.assertEqual(json.loads(t[i:end]), [350, 250, 200, 150, 100, 300])

    # ── a list of scalars ALONE -> an honest failure, never a crash ──
    def test_scalars_only_reply_raises_cleanly(self):
        text = "The allowed values are [350, 250, 200, 150, 100, 300] and none of the rows fit."
        with self.assertRaises(ValueError) as cm:
            ai_voter._extract_json_array(text)
        self.assertIn("no parseable JSON array", str(cm.exception))
        self.assertNotIsInstance(cm.exception, TypeError)

    def test_scalars_only_then_bare_object_still_takes_the_object_path(self):
        """The bare-object fallback (HV-2) is reached only when NO usable array was found -- a
        skipped scalar list does not block it."""
        text = "Allowed: [1, 2, 3]\n" + _ROW_OBJECT
        parsed = ai_voter._extract_json_array(text)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["id"], 42)

    # ── THE INVARIANT: a reply that is only a valid row array is byte-identical ──
    def test_plain_row_array_byte_identical(self):
        text = '[{"id": 1, "category_id": "wiring_cabling", "confidence": 0.8},' \
               ' {"id": 2, "category_id": "db_switchgear", "confidence": 0.7}]'
        self.assertEqual(ai_voter._extract_json_array(text), json.loads(text))

    def test_empty_array_still_returns_empty(self):
        """`[]` has no non-dict element, so it is still the (empty) payload -- unchanged."""
        self.assertEqual(ai_voter._extract_json_array("[]"), [])

    # ── a bracketed list of STRINGS in prose -> the same skip ──
    def test_prose_string_list_is_skipped(self):
        text = ('Allowed conduit types are ["PVC", "MS", "GI"]; row 7 says HDPE, so null.\n'
                '[{"id": 7, "category_id": "conduit_piping", "confidence": 0.4}]')
        self.assertEqual([el["id"] for el in ai_voter._extract_json_array(text)], [7])

    def test_prose_mixed_list_is_skipped(self):
        text = 'Values [1, "2M", null] do not apply.\n[{"id": 9, "category_id": "earthing", "confidence": 0.6}]'
        self.assertEqual(ai_voter._extract_json_array(text)[0]["id"], 9)

    # ── nested lists INSIDE the row array are not mistaken for the array ──
    def test_nested_list_inside_row_array_is_kept(self):
        text = '[{"id": 5, "category_id": "cabletray_raceway", "sizes": [100, 150], "confidence": 0.9}]'
        parsed = ai_voter._extract_json_array(text)
        self.assertEqual(parsed[0]["sizes"], [100, 150])
        self.assertEqual(len(parsed), 1)

    def test_prose_nested_scalar_lists_then_row_array(self):
        text = 'Ranges [[100, 150], [200, 300]] considered.\n[{"id": 6, "category_id": "earthing", "confidence": 0.5}]'
        self.assertEqual(ai_voter._extract_json_array(text)[0]["id"], 6)

    # ── the existing NEGATIVES hold: truncation and garbage still raise ──
    def test_truncated_after_a_skipped_list_still_raises(self):
        text = 'Allowed [1, 2].\n[{"id": 1, "category_id": "wiring_cabling"}, {"id": 2, "cat'
        with self.assertRaises(ValueError):
            ai_voter._extract_json_array(text)

    # ── THE CLASSIFIER'S OWN BEHAVIOUR: the voter batch and the harness are unchanged ──
    def test_voter_batch_unchanged_on_a_plain_reply(self):
        text = '[{"id": 42, "category_id": "point_wiring", "confidence": 0.9, "brief_reason": "pts"}]'
        out = ai_voter._ai_batch(_FakeClient(text), "m", "prompt", [], _VALID_IDS)
        self.assertEqual(out, {42: ("point_wiring", 0.9, "pts")})

    def test_voter_batch_now_survives_a_prefaced_reply(self):
        """The same wire on the classifier: a voter reply that reasons out loud with a bracketed
        list no longer feeds an int to `int(el["id"])`."""
        text = ('Candidates were [1, 2, 3].\n'
                '[{"id": 42, "category_id": "point_wiring", "confidence": 0.9, "brief_reason": "pts"}]')
        out = ai_voter._ai_batch(_FakeClient(text), "m", "prompt", [], _VALID_IDS)
        self.assertEqual(out, {42: ("point_wiring", 0.9, "pts")})

    def test_harness_shares_the_function_still(self):
        from nirmaan_stack.services.boq_category.harness import electrical_classification_harness as H
        self.assertIs(H._extract_json_array, ai_voter._extract_json_array)
