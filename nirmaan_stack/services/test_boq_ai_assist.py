# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for services/boq_ai_assist.py (Slice AI-2b).

Pure-Python: the Anthropic client is MOCKED -- NO test makes a live API call.
Covers input serialisation, output parsing (parent translation + defensive drops),
and the run_ai_pass retry / empty-response behaviour.
"""
import hashlib
import json
import os
import unittest
from types import SimpleNamespace
from unittest import mock

from nirmaan_stack.services.boq_ai_assist import (
    _AI_PASS_PROMPT_TEMPLATE,
    PROMPT_VERSION,
    _NonRetryable,
    _build_row_payload,
    _effective_level_for_payload,
    _render_chunk_prompt,
    _row_has_qty,
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
        # R1 (Approach C): the per-row `level` is an INTERNAL spine signal -- STRIPPED
        # from the model wire. build_rows_payload returns the wire form (no `level`).
        self.assertNotIn("level", root, "the model no longer receives a per-row level")
        self.assertNotIn("level", child)

    def test_build_rows_payload_idx_map(self):
        _, idx_map = build_rows_payload(_rows())
        self.assertEqual(idx_map, {5: 0, 6: 1},
                         "idx_map maps excel_row (source_row_number) -> internal row_index")


class TestEffectiveLevelPayload(unittest.TestCase):
    """R1 (Approach C): the payload `level` is the EFFECTIVE (edit-aware) nesting depth,
    kept as an INTERNAL spine signal and stripped from the model wire."""

    def test_effective_level_preferred_over_parser(self):
        # effective_level present (worker-enriched) -> used; parser `level` IGNORED.
        row = {"row_index": 0, "source_row_number": 5, "classification": "preamble",
               "effective_classification": "preamble", "effective_parent_index": None,
               "level": 9, "effective_level": 2}
        p = _build_row_payload(row, {0: 5})
        self.assertEqual(p["level"], 2,
                         "the INTERNAL payload carries the EFFECTIVE level, not parser 9")

    def test_parser_level_fallback_when_no_effective_key(self):
        # No effective_level key (service called standalone) -> fall back to parser level.
        row = {"row_index": 0, "source_row_number": 5, "classification": "preamble",
               "level": 3}
        self.assertEqual(_effective_level_for_payload(row), 3)

    def test_effective_level_none_is_honoured(self):
        # A non-preamble derives effective_level None -> that None is used (NOT the parser
        # fallback): the key is PRESENT, so a line_item is level-less on the wire's spine.
        row = {"row_index": 1, "source_row_number": 6, "classification": "line_item",
               "level": 7, "effective_level": None}
        self.assertIsNone(_effective_level_for_payload(row),
                          "present effective_level=None wins over the parser fallback")

    def test_internal_level_present_but_wire_strips_it(self):
        rows = [{
            "row_index": 0, "source_row_number": 5, "classification": "preamble",
            "effective_classification": "preamble", "effective_parent_index": None,
            "level": 1, "effective_level": 1, "sl_no_value": "1",
            "description": "LT CABLES", "unit": None,
        }]
        # Internal element keeps level (spine fuel); the wire (build_rows_payload) drops it.
        self.assertEqual(_build_row_payload(rows[0], {0: 5})["level"], 1)
        json_str, _ = build_rows_payload(rows)
        self.assertNotIn("level", json.loads(json_str)[0])


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


class TestPromptParentingPins(unittest.TestCase):
    """PINS for _AI_PASS_PROMPT_TEMPLATE's parenting rules (EA-6c, owner ruling P5).

    The prompts were entirely unpinned: wording could change with nothing going red. These
    freeze the load-bearing passages so a reword is a DELIBERATE, visible test diff.

    STATE AS PINNED HERE = PRE-EA-6c. Unlike Gemini, Claude's prompt states nothing FALSE --
    it is SILENT on where a note parents, and measurement showed it already suggests a
    line_item parent for ~26% of note rows. EA-6c adds W4 (the note rule) and W3 (the
    line_item rule); when it does, THESE TESTS ARE UPDATED IN THE SAME COMMIT.
    """

    def test_line_item_parenting_line_is_pinned(self):
        """Still TRUE after EA-6c -- line items DO parent to preambles, and W3 hardens it."""
        self.assertIn(
            "- line_items are parented to the preamble (section) they belong to.\n",
            _AI_PASS_PROMPT_TEMPLATE,
        )

    def test_preamble_children_line_is_pinned(self):
        """The preamble-centric framing W4 sits directly after."""
        self.assertIn(
            "- A preamble's children are the rows that sit under it until the next preamble "
            "of equal or higher level.\n",
            _AI_PASS_PROMPT_TEMPLATE,
        )

    def test_note_parenting_rule_is_pinned(self):
        """W4 -- ADDED by EA-6c. Was `test_prompt_is_currently_silent_on_note_parenting`,
        which asserted this sentence's ABSENCE; flipping it here IS the visible wording diff
        the pin-first discipline (P5) exists to produce.

        Claude previously said nothing about where a note parents, and already suggested a
        line_item parent for ~26% of note rows anyway. This states the slice-1 rule outright.
        """
        self.assertIn(
            "- A note is parented to the nearest preamble or line_item above it - "
            "whichever row it actually describes.\n",
            _AI_PASS_PROMPT_TEMPLATE,
        )

    def test_line_item_parent_rule_is_pinned(self):
        """W3 -- REWORDED 2026-08-19 (ADR-0008 Amendment A, owner Option B). Still the
        IDENTICAL sentence on both engines (one rule, zero drift).

        WAS: "A line_item is never the parent of another line_item. Only a preamble may
        parent a line_item." That matched the finalize gate at the time. The gate has since
        been NARROWED -- structural error #8 no longer fires for item-under-item -- so the
        old sentence told the model a prohibition the product no longer enforces. The owner
        chose to state the permission EXPLICITLY (Option B) rather than fall silent, so the
        model can propose the nesting where a bill genuinely shows one.
        """
        self.assertIn(
            "- A line_item may be the parent of another line_item when the child row is a "
            "sub-component or a breakdown of it; otherwise a line_item's parent is the "
            "preamble heading its section.\n",
            _AI_PASS_PROMPT_TEMPLATE,
        )
        self.assertNotIn(
            "A line_item is never the parent of another line_item",
            _AI_PASS_PROMPT_TEMPLATE,
            "the retired prohibition must not survive anywhere in the prompt",
        )

    def test_children_instruction_is_pinned(self):
        """Load-bearing and UNTOUCHED by EA-6c: suggestions stay single-row, so an accepted
        suggestion can never separate a note from its parent (the ride-along guarantee)."""
        self.assertIn(
            "do NOT also suggest re-parenting that preamble's existing children",
            _AI_PASS_PROMPT_TEMPLATE,
        )

    def test_open_sections_carry_block_is_pinned(self):
        """The cross-chunk carry. W5 is DEAD (no tail carry exists), so this must stay TRUE
        and unchanged -- no carry sentence may be added."""
        self.assertIn(
            "- OPEN SECTIONS lists the section headers (preambles) still open above this "
            "slice, with their excel_row and level",
            _AI_PASS_PROMPT_TEMPLATE,
        )
        self.assertIn(
            "Only suggest a suggested_parent that is an excel_row present in THIS slice or "
            "listed under OPEN SECTIONS",
            _AI_PASS_PROMPT_TEMPLATE,
        )

    def test_prompt_is_silent_on_note_under_note(self):
        """W6 NEGATIVE, pinned BOTH sides of the reword: silence is the mechanism (P7). W4
        names only preamble/line_item as note targets; an explicit prohibition is forbidden."""
        lowered = _AI_PASS_PROMPT_TEMPLATE.lower()
        for phrase in ("note under a note", "note-under-note", "parent of another note",
                       "notes may not parent", "note as a parent"):
            self.assertNotIn(phrase, lowered, f"prompt must stay SILENT on {phrase!r}")


class TestGuidedPromptPins(unittest.TestCase):
    """PINS for the GUIDED prompt (prompt v2, slice S1b; owner ruling R4: "go with your
    suggestions" on rewording the six definitions).

    Written BEFORE the template changed (pin first, reword second): at that commit point
    every test here was RED against the old template. The literals are byte-equal to F1's
    record of the measured prompt (sepoct_f1/v2_replaced_passage.json, run_claude_f1.py
    lines 51-63) -- the wording the accuracy figures were measured with. A reword must
    change these literals deliberately.
    """

    # The six row-type meanings (meanings_v4), one line each, in template order.
    _MEANINGS = (
        "- \"line_item\" — A work entry the client prices: it names a deliverable (supply, fixing, SITC of a fixture, a damper, insulation, a cable, a panel, a pipe size) and usually carries a serial number, a unit and a quantity. A row with a serial number AND a unit is an item even when it reads like a long sentence. Reviewers also call these line_items: a size or capacity sub-line under an item ('80 NB', 'c) 80mm dia', 'Fire extinguisher capacity - 4.5 Kg', 'a 150 mm dia pipe Metre') even with a lettered or missing serial, and an equipment schedule line with a unit; a sub-line that carries a unit is never a subtotal.\n",
        "- \"preamble\" — A section or sub-section heading that groups the rows beneath it: a short title such as 'Electrical Works', 'FAS Works', 'HVAC Works', 'Floor Box', 'UNITS IN PVC / MS ENCLOSURE', with no unit and no quantity, sometimes with a letter or number serial. A heading can also be an un-numbered lead-in sentence ('Supply, installation, testing & commissioning of MS pipes ... for pipes') that the sized rows below complete. A row with a serial number AND a unit or quantity is an item, not a heading.\n",
        "- \"note\" — Explanatory or condition text attached to a section or item: full sentences about scope, material quality, test certificates, pricing conditions, 'shall be' clauses, specification paragraphs (numbered 1, i, vi, vii or un-numbered). It has no unit and no quantity. Tax lines ('GST @18% on supply value'), 'TOTAL VALUE FOR ...' lines that are not an actual subtotal row, and a 'Notes' label row are notes. A breakdown line with a unit under a panel or item ('Outgoing - 32/63A, 3P, MCB - 5 No's') is a note when it only describes the item above and is not priced on its own.\n",
        "- \"spacer\" — A blank layout row: no serial number, no description, no unit and no quantity.\n",
        "- \"subtotal_marker\" — A total, subtotal or carried-forward line such as 'TOTAL', 'Sub total' or 'Total carried to summary', with no unit and no quantity. A lettered size sub-item with a unit ('a 150 mm dia Metre', 'b 1200 MM long No.') is a line_item, never a subtotal; a 'TOTAL VALUE FOR <section>' heading-like line with roman serial is a note unless it is the actual total row of that section.\n",
        "- \"header_repeat\" — A repeated column-header row (e.g. ITEM | DESCRIPTION | UNIT | QTY) appearing again in the middle of the sheet.\n",
    )

    # The six definitions v2 RETIRED. None may survive.
    _RETIRED = (
        "- \"line_item\" — a priceable work item (has or will have a quantity, rate, amount). e.g. \"3.5C x 240 sqmm Al cable\", \"300 mm Round Diffuser\"\n",
        "- \"preamble\" — a section or sub-section HEADER that groups line items beneath it. e.g. \"LT CABLES\", \"HVAC - High Side Works\", \"Ducting\". Preambles are never priced themselves; they organise the items under them.\n",
        "- \"note\" — descriptive text, a remark, or a specification note that is not itself a work item and not a section header. e.g. \"Note:\", \"Consider Carrier Make\", \"All materials shall be as per standards\"\n",
        "- \"spacer\" — an empty or blank row\n",
        "- \"subtotal_marker\" — a row showing a section total (e.g. \"TOTAL\")\n",
        "- \"header_repeat\" — a repeated column-header row\n",
    )

    # The has_qty / GUIDANCE paragraph, directly before the rows -- and the template's end.
    _PARAGRAPH = (
        "Each row also carries has_qty (true when the original quantity cell holds a "
        "non-zero number).\n"
        "After the rows, GUIDANCE (JSON, keyed by excel_row) gives for each row: "
        "similar_reviewed_rows - up to 5 rows from OTHER BoQs that reviewers have already "
        "classified (fields sl_no, description, unit, has_qty, correct_row_type), to be used "
        "as worked examples; and candidate_parents - earlier rows of THIS sheet that are the "
        "most likely parents (\"row <excel_row> | sl <sl_no> | <description>\"), plus "
        "\"none (top level)\". Prefer a parent from candidate_parents; the parser's current "
        "parent is listed first.\n"
        "Rows (JSON):\n{ROWS_JSON}"
    )

    def _definitions_block(self):
        start = _AI_PASS_PROMPT_TEMPLATE.index('- "line_item" — ')
        return _AI_PASS_PROMPT_TEMPLATE[start:_AI_PASS_PROMPT_TEMPLATE.index("\n\n## Hierarchy")]

    def test_six_meanings_passages_are_pinned(self):
        """Each of the six meanings, verbatim, and the six as ONE contiguous block in order
        (line_item, preamble, note, spacer, subtotal_marker, header_repeat)."""
        for line in self._MEANINGS:
            self.assertIn(line, _AI_PASS_PROMPT_TEMPLATE, f"meaning not pinned: {line[:40]!r}")
        self.assertIn("".join(self._MEANINGS), _AI_PASS_PROMPT_TEMPLATE,
                      "the six meanings must sit together, in order")

    def test_retired_definitions_are_gone(self):
        """NEGATIVE: none of the six pre-v2 definitions survives beside its replacement."""
        for line in self._RETIRED:
            self.assertNotIn(line, _AI_PASS_PROMPT_TEMPLATE,
                             f"retired definition still present: {line[:40]!r}")

    def test_has_qty_guidance_paragraph_is_pinned_before_the_rows(self):
        """The paragraph that explains has_qty and GUIDANCE sits directly before
        "Rows (JSON):" and is the END of the template (the GUIDANCE block itself is
        appended per chunk, after the rows)."""
        self.assertIn(self._PARAGRAPH, _AI_PASS_PROMPT_TEMPLATE)
        self.assertTrue(_AI_PASS_PROMPT_TEMPLATE.endswith(self._PARAGRAPH))
        self.assertEqual(_AI_PASS_PROMPT_TEMPLATE.count("Rows (JSON):"), 1)

    def test_definitions_block_names_no_rate_or_amount(self):
        """NEGATIVE: the definitions the model reads never say rate or amount (the old
        line_item definition did: "has or will have a quantity, rate, amount")."""
        import re
        block = self._definitions_block().lower()
        for word in ("rate", "amount"):
            self.assertIsNone(re.search(rf"\b{word}s?\b", block),
                              f"the definitions block must not mention {word!r}")


_WIRE_KEYS = ["excel_row", "classification", "parent_excel_row", "sl_no", "description",
              "unit", "has_qty"]


class TestClaudeWirePin(unittest.TestCase):
    """PIN for the Claude WIRE ROW (prompt v2): exactly 7 keys, in this order -- the 6 of
    prompt v1 + has_qty -- and has_qty is a true / false. Nothing else about a row reaches
    the model: never a quantity, a rate or an amount, whatever the review row carries.
    (Gemini's wire is pinned separately by test_boq_gemini_assist.TestWirePayloadPin.)"""

    def _wire(self, rows):
        json_str, _ = build_rows_payload(rows)
        return json.loads(json_str)

    def test_wire_row_is_exactly_the_seven_keys_in_order(self):
        for el in self._wire(_rows()):
            self.assertEqual(list(el), _WIRE_KEYS)

    def test_chunked_path_sends_the_same_seven_keys(self):
        """The prompt the client receives (not only build_rows_payload) carries 7-key rows."""
        with mock.patch("anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value.messages.create.return_value = _fake_response([])
            run_ai_pass("Electrical", _rows(), _SETTINGS, "fake-key")
            prompt = MockAnthropic.return_value.messages.create.call_args.kwargs["messages"][0]["content"]
        rows_json = prompt.split("Rows (JSON):\n", 1)[1].split("\n\nGUIDANCE (JSON):\n", 1)[0]
        for el in json.loads(rows_json):
            self.assertEqual(list(el), _WIRE_KEYS)

    def test_has_qty_true_and_false(self):
        base = _rows()[1]
        cases = [
            ({"qty_total": 12.5}, True),
            ({"qty_total": "3"}, True),
            ({"qty_total": 0}, False),
            ({"qty_total": 0.0, "qty_by_area": None}, False),
            ({"qty_total": None, "qty_by_area": {"Tower A": 4, "Tower B": 0}}, True),
            ({"qty_total": None, "qty_by_area": '{"Tower A": 0, "Tower B": 0}'}, False),
            ({"qty_total": None, "qty_by_area": '[{"area": "T1", "qty": 2}]'}, True),
            ({"qty_total": None, "qty_by_area": [{"area": "T1", "qty": 0}]}, False),
            ({"qty_total": "n/a", "qty_by_area": "not json"}, False),
            ({}, False),    # the fields absent (service called standalone)
        ]
        for extra, expected in cases:
            with self.subTest(extra=extra):
                self.assertIs(_row_has_qty({**base, **extra}), expected)
                self.assertIs(self._wire([{**base, **extra}])[0]["has_qty"], expected)

    def test_no_quantity_rate_or_amount_value_leaks(self):
        """NEGATIVE: a review row loaded with quantity, rate and amount fields puts NONE of
        those keys and NONE of those values on the wire or anywhere in the prompt."""
        loaded = {
            **_rows()[1],
            "qty_total": 98765.4321, "qty_by_area": {"Tower A": 43210.9876},
            "rate": 11111.25, "rate_supply": 22222.25, "rate_install": 33333.25,
            "amount": 44444.25, "amount_total": 55555.25, "qty": 66666.25, "price": 77777.25,
        }
        el = self._wire([loaded])[0]
        self.assertEqual(list(el), _WIRE_KEYS)
        self.assertIs(el["has_qty"], True)
        with mock.patch("anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value.messages.create.return_value = _fake_response([])
            run_ai_pass("Electrical", [_rows()[0], loaded], _SETTINGS, "fake-key")
            prompt = MockAnthropic.return_value.messages.create.call_args.kwargs["messages"][0]["content"]
        dynamic = prompt.split("Rows (JSON):\n", 1)[1]
        for leak in ("98765", "43210", "11111", "22222", "33333", "44444", "55555", "66666",
                     "77777", "qty_total", "qty_by_area", "rate", "amount", "price"):
            self.assertNotIn(leak, dynamic, f"{leak!r} leaked onto the wire")


class TestGuidedPromptFixture(unittest.TestCase):
    """The RENDERER pinned byte-for-byte on a real sheet: BOQ-26-00244 / CCTV (25 rows),
    with the wire rows and the frozen aids exactly as F1 sent them, must render the prompt
    F1 measured -- sha256 799d00a1...fe3423, 43,699 characters. Any change to the template,
    the slot filling, the row / GUIDANCE serialisation or their order turns this red.

    The fixture holds those 25 wire rows and their aids ONLY (no rate, no amount)."""

    _SHA = "799d00a146294326bf4cd5fc447a3861d493c9ffdd654f68e2f04b08fdfe3423"
    _CHARS = 43699

    @classmethod
    def setUpClass(cls):
        path = os.path.join(os.path.dirname(__file__), "boq_ai_fixtures", "guided_prompt_cctv.json")
        with open(path, encoding="utf-8") as f:
            cls.fx = json.load(f)

    def _render(self, **overrides):
        fx = {**self.fx, **overrides}
        guidance = {int(k): v for k, v in fx["guidance"].items()}
        return _render_chunk_prompt(fx["sheet_name"], fx["wire_rows"], fx["context"], guidance)

    def test_fixture_is_the_named_sheet_and_nothing_else(self):
        self.assertEqual(self.fx["sheet_name"], "CCTV")
        self.assertEqual(len(self.fx["wire_rows"]), 25)
        self.assertEqual(sorted(self.fx["guidance"]),
                         sorted(str(r["excel_row"]) for r in self.fx["wire_rows"]))
        for r in self.fx["wire_rows"]:
            self.assertEqual(list(r), _WIRE_KEYS)
        for g in self.fx["guidance"].values():
            self.assertEqual(list(g), ["similar_reviewed_rows", "candidate_parents"])
            for e in g["similar_reviewed_rows"]:
                self.assertEqual(
                    list(e), ["sl_no", "description", "unit", "has_qty", "correct_row_type"])

    def test_renders_the_measured_prompt_byte_for_byte(self):
        prompt = self._render()
        sha = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        self.assertEqual((sha, len(prompt)), (self._SHA, self._CHARS))
        self.assertEqual((self.fx["prompt_sha256"], self.fx["prompt_chars"]), (self._SHA, self._CHARS))

    def test_any_change_to_the_inputs_changes_the_hash(self):
        """NEGATIVE: the hash really depends on the rows, the aids and the context."""
        rows = [dict(r) for r in self.fx["wire_rows"]]
        rows[0]["has_qty"] = not rows[0]["has_qty"]
        first = sorted(self.fx["guidance"])[0]
        guidance = {**self.fx["guidance"], first: {"similar_reviewed_rows": [], "candidate_parents": []}}
        for label, changed in (
            ("wire row", self._render(wire_rows=rows)),
            ("guidance", self._render(guidance=guidance)),
            ("context", self._render(context="OPEN SECTIONS: (none)")),
            ("sheet name", self._render(sheet_name="CCTV ")),
        ):
            self.assertNotEqual(hashlib.sha256(changed.encode("utf-8")).hexdigest(), self._SHA, label)


class TestGuidanceBlock(unittest.TestCase):
    """The GUIDANCE block: appended after the rows on every call, keyed by excel_row in
    row order, with empty lists for a row the caller gave no guidance for."""

    def _prompt(self, guidance):
        with mock.patch("anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value.messages.create.return_value = _fake_response([])
            if guidance is None:
                run_ai_pass("Electrical", _rows(), _SETTINGS, "fake-key")
            else:
                run_ai_pass("Electrical", _rows(), _SETTINGS, "fake-key", guidance=guidance)
            return MockAnthropic.return_value.messages.create.call_args.kwargs["messages"][0]["content"]

    def test_block_carries_the_injected_guidance(self):
        example = {"sl_no": "2.1", "description": "4 core cable", "unit": "m", "has_qty": True,
                   "correct_row_type": "line_item"}
        guidance = {6: {"similar_reviewed_rows": [example],
                        "candidate_parents": ["row 5 | sl 1 | LT CABLES", "none (top level)"]}}
        tail = self._prompt(guidance).split("\n\nGUIDANCE (JSON):\n", 1)
        self.assertEqual(len(tail), 2, "the GUIDANCE block must follow the rows")
        block = json.loads(tail[1])
        self.assertEqual(list(block), ["5", "6"], "keyed by excel_row, in row order")
        self.assertEqual(block["6"], guidance[6])
        self.assertEqual(block["5"], {"similar_reviewed_rows": [], "candidate_parents": []})

    def test_block_is_present_and_empty_without_guidance(self):
        block = json.loads(self._prompt(None).split("\n\nGUIDANCE (JSON):\n", 1)[1])
        empty = {"similar_reviewed_rows": [], "candidate_parents": []}
        self.assertEqual(block, {"5": empty, "6": empty})

    def test_extra_keys_in_the_guidance_never_reach_the_model(self):
        """NEGATIVE: only the two named lists are copied -- a stray source field is dropped."""
        guidance = {5: {"similar_reviewed_rows": [], "candidate_parents": [],
                        "similar_reviewed_rows_src": [{"_boq": "BOQ-26-99999"}]}}
        prompt = self._prompt(guidance)
        self.assertNotIn("BOQ-26-99999", prompt)
        self.assertNotIn("similar_reviewed_rows_src", prompt)

    def test_prompt_version_is_v2(self):
        self.assertEqual(PROMPT_VERSION, "v2")


# ===========================================================================
# S2: failure classification, key scrubbing, the progress callback, retries
# ===========================================================================

class TestFailureClassification(unittest.TestCase):

    def _status(self, cls, code, text="provider said no"):
        import httpx
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        return cls(text, response=httpx.Response(code, request=request), body=None)

    def _wrapped(self, provider_error):
        """As _classify_chunk raises it: _NonRetryable FROM the provider's own exception."""
        try:
            try:
                raise provider_error
            except Exception as exc:
                raise _NonRetryable(str(exc)) from exc
        except _NonRetryable as wrapped:
            return wrapped

    def test_each_provider_failure_gets_its_category(self):
        import anthropic
        import httpx
        from nirmaan_stack.services.boq_ai_assist import classify_failure
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        cases = [
            (anthropic.APITimeoutError(request=request), "request timeout"),
            (self._status(anthropic.RateLimitError, 429), "rate limit"),
            (self._status(anthropic.InternalServerError, 529), "service overloaded"),
            (self._status(anthropic.InternalServerError, 503), "service overloaded"),
            (self._status(anthropic.InternalServerError, 500), "API error"),
            (self._status(anthropic.BadRequestError, 400), "API error"),
            (self._status(anthropic.AuthenticationError, 401), "API error"),
            (anthropic.APIConnectionError(request=request), "API error"),
        ]
        for error, expected in cases:
            for exc in (error, self._wrapped(error)):
                self.assertEqual(classify_failure(exc)[0], expected, repr(exc))

    def test_an_api_error_message_carries_the_status_code(self):
        import anthropic
        from nirmaan_stack.services.boq_ai_assist import classify_failure
        category, message = classify_failure(self._wrapped(self._status(anthropic.BadRequestError, 400)))
        self.assertEqual(category, "API error")
        self.assertIn("status 400", message)

    def test_job_timeout_wins_over_everything_else(self):
        from rq.timeouts import JobTimeoutException
        from nirmaan_stack.services.boq_ai_assist import classify_failure
        category, message = classify_failure(JobTimeoutException("Task exceeded maximum timeout value"))
        self.assertEqual(category, "job timeout")
        self.assertIn("time limit", message)

    def test_unreadable_answer_versus_internal_error(self):
        from nirmaan_stack.services.boq_ai_assist import classify_failure
        with self.assertRaises(_NonRetryable) as bad_json:
            parse_ai_response("not json", {}, None)
        self.assertEqual(classify_failure(bad_json.exception)[0], "unreadable answer")
        self.assertEqual(classify_failure(_NonRetryable("empty response"))[0], "unreadable answer")
        category, message = classify_failure(self._wrapped(KeyError("row_index")))
        self.assertEqual(category, "internal error")
        self.assertIn("KeyError", message)
        category, message = classify_failure(ValueError("bad settings"))
        self.assertEqual((category, message), ("internal error", "ValueError: bad settings"))

    def test_scrub_keys_removes_given_secrets_and_anything_key_shaped(self):
        from nirmaan_stack.services.boq_ai_assist import scrub_keys
        shaped = "sk-ant-" + "a1B2" * 8
        text = scrub_keys(f"auth failed for {shaped} and for hunter2; again {shaped}", ["hunter2", None, ""])
        self.assertNotIn(shaped, text)
        self.assertNotIn("hunter2", text)
        self.assertEqual(text.count("[key removed]"), 3)
        self.assertEqual(scrub_keys(None), "")
        self.assertEqual(scrub_keys("nothing secret here"), "nothing secret here")


class TestProgressAndRetries(unittest.TestCase):

    def _events(self):
        events = []
        return events, (lambda event, **data: events.append((event, data)))

    def test_progress_reports_the_start_every_attempt_and_every_chunk(self):
        events, progress = self._events()
        with mock.patch("anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value.messages.create.return_value = _fake_response([])
            run_ai_pass("Electrical", _rows(), _SETTINGS, "fake-key", progress=progress)
        self.assertEqual(events, [
            ("start", {"chunks_total": 1}),
            ("attempt", {"chunk": 1, "attempt": 1}),
            ("chunk", {"chunks_done": 1, "input_tokens": 12, "output_tokens": 8}),
        ])

    def test_an_attempt_is_reported_before_every_retry(self):
        events, progress = self._events()
        with mock.patch("anthropic.Anthropic") as MockAnthropic, \
             mock.patch("nirmaan_stack.services.boq_ai_assist.time.sleep"):
            MockAnthropic.return_value.messages.create.side_effect = [
                Exception("Error code: 529 - overloaded"), _fake_response([]),
            ]
            run_ai_pass("Electrical", _rows(), _SETTINGS, "fake-key", progress=progress)
        self.assertEqual([e for e in events if e[0] == "attempt"],
                         [("attempt", {"chunk": 1, "attempt": 1}), ("attempt", {"chunk": 1, "attempt": 2})])

    def test_a_failing_progress_callback_never_breaks_the_pass(self):
        def progress(event, **data):
            raise RuntimeError("run log is down")

        with mock.patch("anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value.messages.create.return_value = _fake_response([])
            self.assertEqual(run_ai_pass("Electrical", _rows(), _SETTINGS, "fake-key", progress=progress), [])

    def test_the_client_is_created_with_its_own_retries_off(self):
        with mock.patch("anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value.messages.create.return_value = _fake_response([])
            run_ai_pass("Electrical", _rows(), _SETTINGS, "fake-key")
        MockAnthropic.assert_called_once_with(api_key="fake-key", max_retries=0)

    def test_the_job_time_limit_is_never_retried_or_re_wrapped(self):
        from rq.timeouts import JobTimeoutException
        with mock.patch("anthropic.Anthropic") as MockAnthropic, \
             mock.patch("nirmaan_stack.services.boq_ai_assist.time.sleep") as sleep, \
             mock.patch("frappe.log_error"):
            create = MockAnthropic.return_value.messages.create
            create.side_effect = JobTimeoutException("Task exceeded maximum timeout value (1200 seconds)")
            with self.assertRaises(JobTimeoutException):
                run_ai_pass("Electrical", _rows(), _SETTINGS, "fake-key")
        self.assertEqual(create.call_count, 1)
        self.assertFalse(sleep.called)

    def test_an_ordinary_timeout_is_still_retried_three_times(self):
        """NEGATIVE of the test above: only the JOB's limit skips the retry loop."""
        with mock.patch("anthropic.Anthropic") as MockAnthropic, \
             mock.patch("nirmaan_stack.services.boq_ai_assist.time.sleep"), \
             mock.patch("frappe.log_error"):
            create = MockAnthropic.return_value.messages.create
            create.side_effect = TimeoutError("Request timed out.")
            with self.assertRaises(_NonRetryable):
                run_ai_pass("Electrical", _rows(), _SETTINGS, "fake-key")
        self.assertEqual(create.call_count, 3)

    def test_the_service_error_log_text_carries_no_key(self):
        shaped = "sk-ant-" + "Z9" * 12
        with mock.patch("anthropic.Anthropic") as MockAnthropic, \
             mock.patch("frappe.log_error") as log:
            MockAnthropic.return_value.messages.create.side_effect = ValueError(f"bad header {shaped}")
            with self.assertRaises(_NonRetryable):
                run_ai_pass("Electrical", _rows(), _SETTINGS, "fake-key")
        self.assertNotIn(shaped, log.call_args.kwargs["message"])
        self.assertIn("[key removed]", log.call_args.kwargs["message"])
