"""SLICE 12e-4d AC4 -- the text check treats a curly quote mark and a straight one as the same character.

The 12e-4c run flagged "not found in the row text" on six rows (BOQ-26-00073 / HVAC rows 53-58) whose
`material_as_written` was in the row: the heading writes Class ‘O’ with curly marks and the model returned
Class 'O' with straight ones. Owner, 2026-10-14: "fix". The check (`extraction.apply_row_text_check`) now folds the
named set -- ‘ ’ ′ read as ', “ ” ″ read as " -- on both sides before it compares. Nothing else
moves: the value is kept as returned, a flag's raw text is the value as returned, and the request sent to the model
is not built here at all.

The check is PURE (items + the row's payload + the items spec in, flags out), so every case is a direct call --
no DB, no AI, no fixtures.
"""

import inspect

from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import extraction

SPEC = {"attribute_definitions": [
    {"id": "material_as_written", "label": "Material as written", "type": "text"},
    {"id": "cladding", "label": "Cladding", "type": "choice", "values": ["None", "No"]},
]}
CURLY_TO_STRAIGHT = {"‘": "'", "’": "'", "′": "'", "“": '"', "”": '"', "″": '"'}
# BOQ-26-00073 / HVAC row 53 as the 12e-4c batch showed it to the model (heading trimmed to the words that matter)
ROW_53 = {
    "id": 53,
    "description": "22.3 mm O.D (wall Thickness-1.0 mm) (insulation : 13/19 mm)",
    "ancestor_chain": [
        {"relation": "sheet", "description": "HVAC"},
        {"relation": "parent", "distance": 1, "description": "copper piping duly insulated with Close cell elastomeric Nitrile rubber Class ‘O’ tubular insulation of thickness 13 or 19 mm"},
    ],
}
AS_RETURNED = "Close cell elastomeric Nitrile rubber Class 'O' tubular insulation"


def _item(value, attr="material_as_written"):
    return {"attributes": {attr: {"value": value, "confidence": 0.9}}}


def _check(items, payload, spec=SPEC, rid=53):
    drops = {"items_not_in_row_text": {}}
    flags = extraction.apply_row_text_check(items, payload, spec, drops, rid)
    return flags, drops


def _payload(text):
    return {"id": 1, "description": text, "ancestor_chain": []}


class TestRowTextCheckQuotes12e4d(FrappeTestCase):
    def test_row_53_the_heading_curly_the_answer_straight_is_found(self):
        """The 12e-4c finding itself: Class ‘O’ in the heading, Class 'O' returned -> no flag (BEFORE: one flag)."""
        flags, drops = _check([_item("None", "cladding"), _item(AS_RETURNED)], ROW_53)
        self.assertEqual(flags, [])
        self.assertEqual(drops["items_not_in_row_text"], {})

    def test_every_mark_of_the_set_both_directions(self):
        """Each of the six marks, curly in the row and straight in the value, and the other way round."""
        for curly, straight in CURLY_TO_STRAIGHT.items():
            for row_mark, value_mark in ((curly, straight), (straight, curly)):
                text = f"insulation Class {row_mark}O{row_mark} tubular"
                flags, _ = _check([_item(f"Class {value_mark}O{value_mark}")], _payload(text), rid=1)
                self.assertEqual(flags, [], (hex(ord(curly)), row_mark, value_mark))
        # an inch mark and a foot mark: 3″ and 2′ read as 3" and 2'
        self.assertEqual(_check([_item('3" pipe')], _payload("3″ pipe"), rid=1)[0], [])
        self.assertEqual(_check([_item("2' run")], _payload("2′ run"), rid=1)[0], [])

    def test_negative_a_value_not_in_the_row_is_still_flagged_and_kept(self):
        item = _item("Class 'X' tubular insulation")
        flags, drops = _check([item], ROW_53)
        self.assertEqual([(f["attr"], f["reason"], f["raw"]) for f in flags],
                         [("material_as_written", extraction.COERCE_NOT_IN_ROW_TEXT, "Class 'X' tubular insulation")])
        self.assertEqual(drops["items_not_in_row_text"], {"53": [{"item": 0, "attr": "material_as_written", "raw": "Class 'X' tubular insulation"}]})
        self.assertEqual(item["attributes"]["material_as_written"]["value"], "Class 'X' tubular insulation")   # never a drop

    def test_negative_only_the_named_set_folds(self):
        """A mark outside the six -- a backtick, an acute accent, a guillemet, a low-9 quote -- is still its own character."""
        for other in ("`", "´", "«", "‚", "„"):
            flags, _ = _check([_item("Class 'O'")], _payload(f"Class {other}O{other}"), rid=1)
            self.assertEqual(len(flags), 1, hex(ord(other)))

    def test_negative_the_value_and_the_raw_text_are_as_returned(self):
        """The fold is for the comparison only: a curly value stays curly in the item and in a flag's raw text."""
        item = _item("Class ‘Z’ foam")
        flags, drops = _check([item], ROW_53)
        self.assertEqual(item["attributes"]["material_as_written"]["value"], "Class ‘Z’ foam")
        self.assertEqual(flags[0]["raw"], "Class ‘Z’ foam")
        self.assertEqual(drops["items_not_in_row_text"]["53"][0]["raw"], "Class ‘Z’ foam")

    def test_a_section_item_is_checked_on_its_own_definitions_with_the_same_fold(self):
        spec = {"attribute_definitions": [{"id": "size_mm", "label": "Size", "type": "text"}],
                "sections": [{"id": "insulation", "items_spec": SPEC}]}
        sec = {**_item(AS_RETURNED), extraction.SECTION_MARK: "insulation"}
        self.assertEqual(_check([sec], ROW_53, spec)[0], [])

    def test_scope_the_fold_lives_in_the_check_alone(self):
        """Nothing that builds the request reads the fold: `_norm_text` is unchanged and the table is local to the check."""
        self.assertEqual(extraction._norm_text("Class ‘O’"), "class ‘o’")
        self.assertIn("quote_fold", inspect.getsource(extraction.apply_row_text_check))
        module_src = inspect.getsource(extraction)
        self.assertEqual(module_src.count("quote_fold = str.maketrans("), 1)
        self.assertNotIn("quote_fold", inspect.getsource(extraction.second_opinion_content))
        self.assertNotIn("quote_fold", inspect.getsource(extraction._payload_strings))
