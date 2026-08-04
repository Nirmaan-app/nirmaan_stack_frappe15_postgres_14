# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for services/boq_gemini_assist.py -- the Gemini service's pure core.

Pure-Python: the google-genai client is never built and NO test makes a live API call.

WHY THIS FILE EXISTS (EA-6b): the Gemini service had no service-level test file at all,
so its two load-bearing properties -- the chunk-cut rule and the WIRE PAYLOAD shape --
were entirely unpinned. The cut-rule fix (score -> effective classification) needed both.

THE WIRE-PAYLOAD PIN IS THE INVARIANT'S ENFORCEMENT (owner ruling: independence = (a),
WIRE independence). Before EA-6b, "the model never sees the parser's verdict" was
guaranteed structurally, by `_GEMINI_FETCH_FIELDS` simply not fetching the verdict
columns. EA-6b fetches `classification` / `human_classification` so the CHUNKER can cut
on them out-of-band -- which removes that structural guarantee. TestWirePayloadPin
replaces it: it freezes the exact payload key set and proves a verdict-carrying input row
still emits a verdict-free payload. If it ever goes red, the model is about to be shown
the parser's verdict.
"""
import unittest

from nirmaan_stack.services.boq_gemini_assist import (
    _BOQ_CLASSIFY_PROMPT,
    _CHUNK_HARD_MAX,
    _CHUNK_TARGET,
    _CHUNK_THRESHOLD,
    build_row_payload,
    chunk_rows,
)


# The COMPLETE wire contract: every key build_row_payload may emit. Frozen deliberately --
# this list is the thing the model is allowed to see, and nothing else.
_WIRE_KEYS = {
    "id", "excel_row", "description", "sl_no", "unit",
    "has_qty", "has_rate", "has_amount",
    "preamble_candidate_score", "is_rate_only", "is_synthetic",
}

# Verdict columns EA-6b added to the API-layer fetch for chunk cutting. None may ever
# reach the wire.
_VERDICT_KEYS = {
    "classification", "human_classification", "effective_classification",
    "parent_index", "human_parent", "human_is_root", "effective_parent_index", "level",
}


def _full_row(idx, **kw):
    """A row with EVERY build_row_payload input populated, so the emitted payload carries
    the complete key set (the builder drops None values)."""
    row = {
        "row_index": idx,
        "source_row_number": idx + 2,
        "description": f"row {idx}",
        "sl_no_value": f"{idx}",
        "unit": "Nos",
        "qty_total": 1,
        "rate_supply": 1,
        "rate_install": 1,
        "rate_combined": 1,
        "amount_total": 1,
        "amount_supply": 1,
        "amount_install": 1,
        "preamble_candidate_score": 0,
        "is_rate_only": 0,
        "is_synthetic": 0,
    }
    row.update(kw)
    return row


class TestWirePayloadPin(unittest.TestCase):
    """The EA-6b invariant: Gemini's WIRE PAYLOAD never carries the parser's verdict."""

    def test_payload_key_set_is_exactly_the_wire_contract(self):
        """Freeze the full field list. A NEW key reaching the wire fails here."""
        self.assertEqual(set(build_row_payload(_full_row(0)).keys()), _WIRE_KEYS)

    def test_verdict_fields_on_the_input_row_never_reach_the_payload(self):
        """THE ENFORCEMENT. EA-6b fetches the verdict for chunk cutting; this proves it
        stays out-of-band. build_row_payload is whitelist-based (an explicit dict, no
        passthrough), so a verdict-carrying row must emit a verdict-free payload."""
        row = _full_row(
            0,
            classification="preamble",
            human_classification="line_item",
            effective_classification="preamble",
            parent_index=3,
            human_parent=4,
            human_is_root=0,
            effective_parent_index=3,
            level=1,
        )
        payload = build_row_payload(row)
        self.assertEqual(set(payload.keys()), _WIRE_KEYS)
        for k in _VERDICT_KEYS:
            self.assertNotIn(k, payload, f"{k!r} LEAKED to the Gemini wire payload")

    def test_payload_is_byte_identical_with_and_without_verdict_fields(self):
        """The A/B control property: adding verdict fields to the input changes NOTHING
        the model sees. This is what keeps the wording slice's Gemini control clean."""
        plain = build_row_payload(_full_row(7))
        enriched = build_row_payload(
            _full_row(7, classification="preamble", human_classification="note",
                      effective_classification="preamble", parent_index=1)
        )
        self.assertEqual(plain, enriched)


class TestChunkCutRule(unittest.TestCase):
    """EA-6b: cuts land on the effective CLASSIFICATION, not preamble_candidate_score.

    The defect: cutting on the score (a SIGNAL) put cuts mid-section, stranding notes from
    the row they describe -- 774 cases on 97 of 110 sheets, median 2 rows behind the cut.
    Cutting on the classification (as Claude already does) took every count to 0.
    """

    @staticmethod
    def _payloads(n, **per_index):
        """Real WIRE payloads (build_row_payload output) -- what chunk_rows actually sees."""
        out = [build_row_payload(_full_row(i)) for i in range(n)]
        for i, patch in per_index.items():
            out[int(i)].update(patch)
        return out

    @staticmethod
    def _flags(n, preamble_positions):
        return [i in preamble_positions for i in range(n)]

    def test_cuts_land_on_a_preamble_flagged_row(self):
        """POSITIVE: past target size, the cut falls exactly at the next flagged row."""
        n = _CHUNK_THRESHOLD + 60
        payloads = self._payloads(n)
        cut_at = _CHUNK_TARGET + 5
        chunks = chunk_rows(payloads, section_flags=self._flags(n, {cut_at}))
        self.assertEqual(len(chunks), 2)
        self.assertEqual(len(chunks[0]), cut_at, "chunk 1 must end just before the flagged row")
        self.assertEqual(chunks[1][0]["id"], cut_at, "chunk 2 must START at the flagged row")

    def test_high_score_row_no_longer_attracts_a_cut(self):
        """NEGATIVE -- THE DEFECT ITSELF.

        A row with preamble_candidate_score > 0 that is NOT classified preamble must no
        longer pull a cut. Sized deliberately BELOW the hard max so the ONLY thing that
        could cut is the score: pre-EA-6b this produced two chunks (a mid-section cut at
        the scorer); now it must produce exactly ONE.
        """
        n = _CHUNK_THRESHOLD + 60          # 180 -- above target, below the 200 ceiling
        scorer = _CHUNK_TARGET + 5
        payloads = self._payloads(n, **{str(scorer): {"preamble_candidate_score": 5}})
        chunks = chunk_rows(payloads, section_flags=[False] * n)  # nothing is a preamble
        self.assertEqual(
            len(chunks), 1,
            "a score>0 row must NOT attract a cut once cutting is classification-based",
        )
        self.assertEqual(len(chunks[0]), n, "every row stays in the single chunk")

    def test_ceiling_fallback_when_no_preamble_within_hard_max(self):
        """A section longer than the cap still terminates at _CHUNK_HARD_MAX."""
        n = _CHUNK_HARD_MAX + 50
        payloads = self._payloads(n)
        chunks = chunk_rows(payloads, section_flags=[False] * n)
        self.assertEqual(len(chunks[0]), _CHUNK_HARD_MAX)
        for c in chunks:
            self.assertLessEqual(len(c), _CHUNK_HARD_MAX)

    def test_under_threshold_is_a_single_chunk(self):
        """Backwards-compat: the single-call path is unchanged."""
        payloads = self._payloads(_CHUNK_THRESHOLD)
        self.assertEqual(len(chunk_rows(payloads, section_flags=[True] * _CHUNK_THRESHOLD)), 1)
        self.assertEqual(chunk_rows([], section_flags=[]), [])

    def test_absent_section_flags_degrade_to_no_section_cuts(self):
        """Defensive: section_flags omitted -> no section cuts, ceiling only. Keeps a
        stale caller from silently reinstating score-based behaviour."""
        n = _CHUNK_HARD_MAX + 20
        payloads = self._payloads(n, **{str(_CHUNK_TARGET + 3): {"preamble_candidate_score": 9}})
        chunks = chunk_rows(payloads)
        self.assertEqual(len(chunks[0]), _CHUNK_HARD_MAX)


class TestPromptParentingPins(unittest.TestCase):
    """PINS for _BOQ_CLASSIFY_PROMPT's parenting rules (EA-6c, owner ruling P5).

    The prompts were entirely unpinned: wording could change with nothing going red. These
    freeze the load-bearing passages so a reword is a DELIBERATE, visible test diff.

    STATE AS PINNED HERE = PRE-EA-6c (the slice-1-FALSE wording). Gemini forbids a
    note->line_item parent three times and obeys perfectly -- measured 600/600 suggested
    parents were rows Gemini itself classified preamble. EA-6c replaces these three
    absolutes (W1) and adds the line_item-parent rule (W3); when it does, THESE TESTS ARE
    UPDATED IN THE SAME COMMIT so the diff shows exactly what the model was told before
    and after.
    """

    def test_preamble_line_is_pinned(self):
        """W1 target #1 -- REWORDED by EA-6c. Was "The ONLY valid parent" (false since
        EA-6a slice 1); now names notes as a legitimate child too."""
        self.assertIn(
            "- preamble: a section header that groups the rows beneath it. The parent of "
            "line_items and often of notes.\n",
            _BOQ_CLASSIFY_PROMPT,
        )
        self.assertNotIn("The ONLY valid parent", _BOQ_CLASSIFY_PROMPT)

    def test_line_item_line_is_pinned(self):
        """W1 target #2 -- REWORDED by EA-6c. Was the blanket "Never a parent"; now the
        narrower truth: never of another line_item, but may parent a note."""
        self.assertIn(
            "- line_item: a priced/quantified work entry. Never a parent of another "
            "line_item, but may be the parent of a note that describes it.\n",
            _BOQ_CLASSIFY_PROMPT,
        )
        self.assertNotIn("(a leaf). Never a parent.", _BOQ_CLASSIFY_PROMPT)

    def test_parenting_rule_is_pinned(self):
        """W1 target #3 -- REPLACED by EA-6c. Was "Only preambles are valid parents"
        (false since slice 1); now states the nearest-wins rule for notes."""
        self.assertIn(
            "- A line_item's parent is the preamble heading its section. A note's parent "
            "is the nearest preamble or line_item above it - whichever it actually "
            "describes.\n",
            _BOQ_CLASSIFY_PROMPT,
        )
        self.assertNotIn("Only preambles are valid parents", _BOQ_CLASSIFY_PROMPT)

    def test_line_item_parent_rule_is_pinned(self):
        """W3 -- ADDED by EA-6c, IDENTICAL sentence on both engines (one rule, zero drift).
        Verbatim-equal to the Claude pin in services/test_boq_ai_assist.py."""
        self.assertIn(
            "- A line_item is never the parent of another line_item. Only a preamble may "
            "parent a line_item.\n",
            _BOQ_CLASSIFY_PROMPT,
        )

    def test_note_line_is_pinned_and_stays_untouched(self):
        """W2: this line is ALREADY slice-1-compatible ('a section/item') and must SURVIVE
        the reword unchanged -- it is the one place the current prompt contradicts its own
        three absolutes."""
        self.assertIn(
            "- note: explanatory text attached to a section/item.\n",
            _BOQ_CLASSIFY_PROMPT,
        )

    def test_known_preambles_carry_block_is_pinned(self):
        """The cross-chunk carry sentence. W5 is DEAD (no tail carry exists), so this must
        stay TRUE and unchanged -- no carry sentence may be added."""
        self.assertIn(
            "- Preambles already identified earlier in this sheet are listed under KNOWN "
            "PREAMBLES with their `id` and description. You MAY reference them as a parent_id. "
            "Do NOT invent ids that are not a row in this request or a KNOWN PREAMBLE.\n",
            _BOQ_CLASSIFY_PROMPT,
        )

    def test_prompt_is_silent_on_note_under_note(self):
        """W6 NEGATIVE, pinned BOTH sides of the reword: the prompt must never discuss a
        note parenting another note. W1 names only preamble/line_item as note targets, and
        silence is the mechanism -- an explicit prohibition is what P7 forbids."""
        lowered = _BOQ_CLASSIFY_PROMPT.lower()
        for phrase in ("note under a note", "note-under-note", "parent of another note",
                       "notes may not parent", "note as a parent"):
            self.assertNotIn(phrase, lowered, f"prompt must stay SILENT on {phrase!r}")


if __name__ == "__main__":
    unittest.main()
