# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for services/boq_ai_assist.py (Slice AI-2b).

Pure-Python: the Anthropic client is MOCKED -- NO test makes a live API call.
Covers input serialisation, output parsing (parent translation + defensive drops),
and the run_ai_pass retry / empty-response behaviour.
"""
import json
import unittest
from types import SimpleNamespace
from unittest import mock

from nirmaan_stack.services.boq_ai_assist import (
    _NonRetryable,
    build_rows_payload,
    parse_ai_response,
    run_ai_pass,
)


def _rows():
    """A root preamble (excel 5) + a child line_item (excel 6)."""
    return [
        {
            "row_index": 0, "source_row_number": 5,
            "classification": "preamble", "effective_classification": "preamble",
            "level": 1, "parent_index": -1, "effective_parent_index": None,
            "sl_no_value": "1", "description": "LT CABLES", "unit": None,
        },
        {
            "row_index": 1, "source_row_number": 6,
            "classification": "line_item", "effective_classification": "line_item",
            "level": None, "parent_index": 0, "effective_parent_index": 0,
            "sl_no_value": "1.1", "description": "3.5C x 240 sqmm cable", "unit": "m",
        },
    ]


def _text_block(s):
    return SimpleNamespace(type="text", text=s)


def _fake_response(array_payload, stop_reason="end_turn", input_tokens=12, output_tokens=8):
    return SimpleNamespace(
        content=[_text_block(json.dumps(array_payload))],
        usage=SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens),
        stop_reason=stop_reason,
    )


_SETTINGS = {"model": "claude-test", "max_tokens": 1000, "request_timeout_seconds": 30}


class TestBuildRowsPayload(unittest.TestCase):

    def test_build_rows_payload_shape(self):
        json_str, _ = build_rows_payload(_rows())
        arr = json.loads(json_str)
        self.assertEqual(len(arr), 2)
        root, child = arr[0], arr[1]
        # excel_row == source_row_number
        self.assertEqual(root["excel_row"], 5)
        self.assertEqual(child["excel_row"], 6)
        # parent_excel_row is the PARENT's source_row_number, None for root
        self.assertIsNone(root["parent_excel_row"], "root row has no parent")
        self.assertEqual(child["parent_excel_row"], 5,
                         "child's parent_excel_row must be the parent's excel row (5), not index 0")
        # other surfaced keys
        self.assertEqual(child["classification"], "line_item")
        self.assertEqual(child["sl_no"], "1.1")
        self.assertEqual(child["unit"], "m")
        self.assertEqual(root["level"], 1)

    def test_build_rows_payload_idx_map(self):
        _, idx_map = build_rows_payload(_rows())
        self.assertEqual(idx_map, {5: 0, 6: 1},
                         "idx_map maps excel_row (source_row_number) -> internal row_index")


class TestParseAIResponse(unittest.TestCase):

    def setUp(self):
        self.idx_map = {5: 0, 6: 1}

    def test_parse_ai_response_parent_translation(self):
        text = json.dumps([{
            "excel_row": 6, "suggested_classification": None, "classification_confidence": None,
            "suggested_parent": 5, "parent_confidence": "High", "explanation": "belongs under sec",
        }])
        out = parse_ai_response(text, self.idx_map)
        self.assertEqual(len(out), 1)
        s = out[0]
        self.assertEqual(s["row_index"], 1, "excel_row 6 -> internal row_index 1")
        self.assertEqual(s["ai_suggested_parent"], 0,
                         "suggested_parent excel_row 5 -> internal row_index 0")
        self.assertEqual(s["ai_parent_confidence"], "High")
        self.assertIsNone(s["ai_suggested_classification"])

    def test_parse_ai_response_null_parent_is_root_sentinel(self):
        text = json.dumps([{
            "excel_row": 6, "suggested_classification": None, "classification_confidence": None,
            "suggested_parent": None, "parent_confidence": "Medium", "explanation": "is a root",
        }])
        out = parse_ai_response(text, self.idx_map)
        self.assertEqual(out[0]["ai_suggested_parent"], -1,
                         "suggested_parent null -> -1 (root sentinel)")

    def test_parse_ai_response_no_change_parent(self):
        text = json.dumps([{
            "excel_row": 6, "suggested_classification": "preamble",
            "classification_confidence": "Low",
            "suggested_parent": "NO_CHANGE", "parent_confidence": None, "explanation": "reclass",
        }])
        out = parse_ai_response(text, self.idx_map)
        self.assertIsNone(out[0]["ai_suggested_parent"],
                          "NO_CHANGE -> ai_suggested_parent None (no parent suggestion)")
        self.assertEqual(out[0]["ai_suggested_classification"], "preamble")

    def test_parse_ai_response_strips_code_fences(self):
        inner = json.dumps([{
            "excel_row": 6, "suggested_classification": None, "classification_confidence": None,
            "suggested_parent": 5, "parent_confidence": "High", "explanation": "x",
        }])
        text = "```json\n" + inner + "\n```"
        out = parse_ai_response(text, self.idx_map)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["ai_suggested_parent"], 0)

    # -- prose tolerance (AI-2e: the real model returns prose before the array) --

    def test_parse_ai_response_extracts_array_from_leading_prose(self):
        # T_P1: prose BEFORE the array is stripped.
        inner = json.dumps([{
            "excel_row": 6, "suggested_classification": None, "classification_confidence": None,
            "suggested_parent": 5, "parent_confidence": "High", "explanation": "x",
        }])
        text = "Looking at the structure, the key issues are:\n\n1. blah blah\n\n" + inner
        out = parse_ai_response(text, self.idx_map)
        self.assertEqual(len(out), 1, "the array must be extracted from leading prose")
        self.assertEqual(out[0]["ai_suggested_parent"], 0)

    def test_parse_ai_response_extracts_array_with_trailing_prose(self):
        # T_P2: prose AFTER the array is ignored.
        inner = json.dumps([{
            "excel_row": 6, "suggested_classification": None, "classification_confidence": None,
            "suggested_parent": 5, "parent_confidence": "High", "explanation": "x",
        }])
        text = inner + "\n\nLet me know if you need more detail."
        out = parse_ai_response(text, self.idx_map)
        self.assertEqual(len(out), 1, "trailing prose after the array must be ignored")
        self.assertEqual(out[0]["ai_suggested_parent"], 0)

    def test_parse_ai_response_bracket_inside_explanation_string(self):
        # T_P3: a literal "[" / "]" inside a JSON string value must not break the
        # balanced bracket scan.
        text = json.dumps([{
            "excel_row": 6, "suggested_classification": "note", "classification_confidence": "High",
            "suggested_parent": "NO_CHANGE", "parent_confidence": None,
            "explanation": "row [18] is a note, see section ]bracket[ test",
        }])
        out = parse_ai_response(text, self.idx_map)
        self.assertEqual(len(out), 1, "string-literal brackets must not break the scan")
        self.assertEqual(out[0]["ai_suggested_classification"], "note")
        self.assertEqual(out[0]["ai_explanation"], "row [18] is a note, see section ]bracket[ test")

    def test_parse_ai_response_prose_then_array_real_cert_shape(self):
        # T_P4: reproduce the live-cert failure shape -- a multi-line prose preamble
        # followed by a multi-element array; all elements parse + map to row_index.
        inner = json.dumps([
            {"excel_row": 5, "suggested_classification": "preamble",
             "classification_confidence": "High", "suggested_parent": "NO_CHANGE",
             "parent_confidence": None, "explanation": "section header"},
            {"excel_row": 6, "suggested_classification": None,
             "classification_confidence": None, "suggested_parent": 5,
             "parent_confidence": "Medium", "explanation": "belongs under row 5"},
        ])
        text = (
            "Looking at the structure of this sheet, I can see a few areas where the "
            "parser's hierarchy looks off.\n\n"
            "Let me identify clear structural corrections.\n\n"
            + inner
        )
        out = parse_ai_response(text, self.idx_map)
        self.assertEqual(len(out), 2, "both elements must parse out of the prose-prefixed array")
        self.assertEqual(out[0]["row_index"], 0, "excel_row 5 -> internal row_index 0")
        self.assertEqual(out[1]["row_index"], 1, "excel_row 6 -> internal row_index 1")
        self.assertEqual(out[1]["ai_suggested_parent"], 0,
                         "suggested_parent excel_row 5 -> internal row_index 0")

    def test_parse_ai_response_genuine_garbage_still_raises(self):
        # T_P5: text with NO "[" at all is genuine garbage -> still _NonRetryable.
        text = "I could not find any structural issues worth reporting in this sheet."
        with self.assertRaises(_NonRetryable):
            parse_ai_response(text, self.idx_map)

    def test_parse_ai_response_bare_array_still_works(self):
        # T_P6 (regression): a plain bare array with no prose/fences still parses.
        text = json.dumps([{
            "excel_row": 6, "suggested_classification": None, "classification_confidence": None,
            "suggested_parent": 5, "parent_confidence": "High", "explanation": "x",
        }])
        out = parse_ai_response(text, self.idx_map)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["ai_suggested_parent"], 0)

    # T_P7 (fenced array still works) is covered by
    # test_parse_ai_response_strips_code_fences above -- the fence-strip fast path is
    # unchanged; not duplicated here.

    def test_parse_ai_response_drops_unknown_excel_row(self):
        text = json.dumps([{
            "excel_row": 999, "suggested_classification": "note", "classification_confidence": "High",
            "suggested_parent": "NO_CHANGE", "parent_confidence": None, "explanation": "hallucinated",
        }])
        out = parse_ai_response(text, self.idx_map)
        self.assertEqual(out, [], "an element with an unknown excel_row is skipped entirely")

    def test_parse_ai_response_rejects_invalid_classification(self):
        # subtotal_marker is parser-only -> classification dropped; parent suggestion kept.
        text = json.dumps([{
            "excel_row": 6, "suggested_classification": "subtotal_marker",
            "classification_confidence": "High",
            "suggested_parent": 5, "parent_confidence": "Medium", "explanation": "x",
        }])
        out = parse_ai_response(text, self.idx_map)
        self.assertEqual(len(out), 1)
        self.assertIsNone(out[0]["ai_suggested_classification"],
                          "invalid classification (subtotal_marker) must be dropped")
        self.assertIsNone(out[0]["ai_classification_confidence"])
        self.assertEqual(out[0]["ai_suggested_parent"], 0,
                         "the parent suggestion must be kept when classification is dropped")
        self.assertEqual(out[0]["ai_parent_confidence"], "Medium")

    # -- root flag (AI-2d) --

    def test_parse_root_sets_is_root_flag(self):
        # AI_P1: suggested_parent null -> ai_suggested_is_root True AND -1 retained
        # as the no-parent-index sentinel.
        text = json.dumps([{
            "excel_row": 6, "suggested_classification": None, "classification_confidence": None,
            "suggested_parent": None, "parent_confidence": "High", "explanation": "is a root",
        }])
        out = parse_ai_response(text, self.idx_map)
        self.assertTrue(out[0]["ai_suggested_is_root"],
                        "a null suggested_parent must set ai_suggested_is_root True")
        self.assertEqual(out[0]["ai_suggested_parent"], -1,
                         "ai_suggested_parent stays -1 (no parent-index suggestion)")

    def test_parse_root_keeps_parent_confidence(self):
        # AI_P2: a root suggestion is a parent opinion -> keep its confidence.
        text = json.dumps([{
            "excel_row": 6, "suggested_classification": None, "classification_confidence": None,
            "suggested_parent": None, "parent_confidence": "High", "explanation": "root",
        }])
        out = parse_ai_response(text, self.idx_map)
        self.assertEqual(out[0]["ai_parent_confidence"], "High",
                         "a root suggestion must keep ai_parent_confidence (guard fixed)")

    def test_parse_no_change_is_root_false(self):
        # AI_P3: NO_CHANGE -> ai_suggested_is_root False.
        text = json.dumps([{
            "excel_row": 6, "suggested_classification": "preamble",
            "classification_confidence": "Low",
            "suggested_parent": "NO_CHANGE", "parent_confidence": None, "explanation": "reclass",
        }])
        out = parse_ai_response(text, self.idx_map)
        self.assertFalse(out[0]["ai_suggested_is_root"],
                         "NO_CHANGE must leave ai_suggested_is_root False")

    def test_parse_real_parent_is_root_false(self):
        # AI_P4: a real excel_row parent -> ai_suggested_is_root False.
        text = json.dumps([{
            "excel_row": 6, "suggested_classification": None, "classification_confidence": None,
            "suggested_parent": 5, "parent_confidence": "High", "explanation": "belongs under sec",
        }])
        out = parse_ai_response(text, self.idx_map)
        self.assertFalse(out[0]["ai_suggested_is_root"],
                         "a real parent suggestion must leave ai_suggested_is_root False")


class TestRunAIPass(unittest.TestCase):

    def test_run_ai_pass_mocks_client_returns_suggestions(self):
        payload = [{
            "excel_row": 6, "suggested_classification": "preamble", "classification_confidence": "Medium",
            "suggested_parent": 5, "parent_confidence": "High", "explanation": "should nest under 5",
        }]
        with mock.patch("anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value.messages.create.return_value = _fake_response(payload)
            out = run_ai_pass("Electrical", _rows(), _SETTINGS, "fake-key")

        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["row_index"], 1)
        self.assertEqual(out[0]["ai_suggested_classification"], "preamble")
        self.assertEqual(out[0]["ai_suggested_parent"], 0)
        self.assertEqual(out[0]["ai_explanation"], "should nest under 5")

    def test_run_ai_pass_retries_on_transient_then_succeeds(self):
        payload = []  # empty array = no suggestions (valid)
        good = _fake_response(payload)
        with mock.patch("anthropic.Anthropic") as MockAnthropic, \
                mock.patch("nirmaan_stack.services.boq_ai_assist.time.sleep") as msleep:
            create = MockAnthropic.return_value.messages.create
            # 529 = Anthropic overloaded; first attempt transient, second succeeds.
            create.side_effect = [Exception("Error code 529: overloaded_error"), good]
            out = run_ai_pass("Sheet", _rows(), _SETTINGS, "fake-key")

        self.assertEqual(out, [], "after a retry the (empty) suggestion list is returned")
        self.assertEqual(create.call_count, 2, "must have retried exactly once")
        self.assertTrue(msleep.called, "backoff sleep must fire on the transient retry")

    def test_run_ai_pass_raises_nonretryable_on_empty_response(self):
        empty = SimpleNamespace(
            content=[],  # no text blocks
            usage=SimpleNamespace(input_tokens=1, output_tokens=0),
            stop_reason="end_turn",
        )
        with mock.patch("anthropic.Anthropic") as MockAnthropic, \
                mock.patch("frappe.log_error"):
            MockAnthropic.return_value.messages.create.return_value = empty
            with self.assertRaises(_NonRetryable):
                run_ai_pass("Sheet", _rows(), _SETTINGS, "fake-key")
