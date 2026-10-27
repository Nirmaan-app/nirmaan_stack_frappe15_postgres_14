"""ADP-5d (owner rulings 2026-10-23 23:24-23:43; Phase A Q1-Q5, 2026-10-24) -- the keys the slice adds to
`list_spec.pricing`, accepted in their ruled form and refused in every other:

  `stream_heading_default` (R6b)  the damper answer a row's stream cannot decide prices as the family default;
  `text_notes` (R9 / R13)         a working line drawn from the row's text;
  `companion_items` (R4)          an item code adds beside a named one (the return air baffle's grille);
  `number_defaults.rule_by_family` (R21)  the line one family says instead of the default's rule.

The ruled forms below are the SAME text as `frontend/.../adp5d.test.ts` and HVAC v54 (pinned there by
`test_adp5d_question.py`). Pure: the validator reads no database. Run: bench --site localhost run-tests --module
nirmaan_stack.services.boq_rate_master.test_config_validation_adp5d
"""
import copy
import json
import os
import unittest

from nirmaan_stack.services.boq_rate_master import config_validation

DATA = os.path.join(os.path.dirname(__file__), "data")

DAMPER_FAMILIES = ["curved grille", "floor grille", "linear grille", "round diffuser", "slot diffuser", "square diffuser"]
STREAM_HEADING_DEFAULT = [{
    "attr": "damper", "streams_attr": "air", "families": DAMPER_FAMILIES, "words": ["damper", "vcd", "volume control"],
    "line": "heading names supply and return air, this row names neither -> damper as default ({value})",
    "rule": "R6b: the heading directly above names supply and return air, the row names neither and no damper, and the heading does not give its damper to both streams or to no stream -> the damper as the family default (owner 2026-10-23 23:24; ring fence Q1 (B) 2026-10-24)",
}]
COMPANION_ITEMS = [{
    "families": ["cross-talk"], "words": ["return air baffle"], "unit_class": "count",
    "item": {"family": "linear grille", "damper": "without", "air": "return", "size_mm": "300 x 300"},
    "line": "return air baffle -> one return air grille added (linear grille, without damper, 300 x 300: no grille size stated)",
    "rule": "R4: a return air baffle is a Z-piece plus one return air grille without damper, 300 x 300 where no size is stated, one per row unit (owner 2026-10-23 23:28 / 23:29; Q3 2026-10-24)",
}]
TEXT_NOTES = [
    {"families": ["VCD"], "from_text": "headings", "pattern": r"control\s+panel", "when": {"attr": "variant", "equals": "motorised"},
     "line": "control panel, actuator and cabling named in the heading: not included - add by hand",
     "rule": "R9 option (c): a motorised VCD prices alone; the heading's control panel, actuator and cabling are not included (owner 2026-10-23 23:32; reach Q4 tight 2026-10-24)"},
    {"families": ["square diffuser"], "from_text": "own_and_headings", "unit_classes": ["area"],
     "pattern": r"^(?![\s\S]*\b(?:square|rectangular|round|circular)\b)|\b(?:round|circular)\b[\s\S]*\b(?:square|rectangular)\b|\b(?:square|rectangular)\b[\s\S]*\b(?:round|circular)\b",
     "line": "shape not stated (or round/square offered): priced as square diffuser - change if round",
     "rule": "R13: a per-sq.m diffuser whose shape is not settled prices as a square diffuser, with this note (owner 2026-10-23 23:37)"},
]
FLOOR_GRILLE_LINE = "size not stated: priced at 300 x 300 - change if different (owner 2026-10-23 23:43)"


def _asset(n):
    with open(os.path.join(DATA, "rate_master_hvac_all_v%d.json" % n), encoding="utf-8") as f:
        return json.load(f)


def _cfg(payload, cid):
    c = next(c for c in payload["category_configs"] if c["category_id"] == cid)
    return dict(copy.deepcopy(c), discipline=payload["discipline"])


def add_adp5d(pr):
    """The ruled ADP-5d keys added to an ADP `list_spec.pricing` block, in place. Used by the tests and the v54 build."""
    pr["stream_heading_default"] = copy.deepcopy(STREAM_HEADING_DEFAULT)
    pr["text_notes"] = copy.deepcopy(TEXT_NOTES)
    pr["companion_items"] = copy.deepcopy(COMPANION_ITEMS)
    for a in ("face_w_mm", "face_h_mm"):
        nd = pr["number_defaults"][a]
        nd["families"] = list(nd["families"]) + ["floor grille"]
        nd["rule_by_family"] = {"floor grille": FLOOR_GRILLE_LINE}
    return pr


class TestAdp5dConfigKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v53 = _asset(53)

    def _adp(self):
        c = _cfg(self.v53, "hvac_adp")
        add_adp5d(c["list_spec"]["pricing"])
        return c

    def _pr(self, c):
        return c["list_spec"]["pricing"]

    def _refuses(self, cfg, *words):
        with self.assertRaises(Exception) as cm:
            config_validation._validate_config(cfg)
        for w in words:
            self.assertIn(w, str(cm.exception))

    # ---- positive ---------------------------------------------------------------------------------------
    def test_01_v53_and_the_ruled_forms_validate(self):
        config_validation._validate_config(_cfg(self.v53, "hvac_adp"))
        config_validation._validate_config(self._adp())

    def test_02_the_keys_are_admitted_and_their_entry_keys_are_closed(self):
        for k in ("stream_heading_default", "text_notes", "companion_items"):
            self.assertIn(k, config_validation._PRICING_KEYS)
        self.assertEqual(config_validation._PRICING_STREAM_HEADING_KEYS, {"attr", "streams_attr", "families", "words", "line", "rule"})
        self.assertEqual(config_validation._PRICING_TEXT_NOTE_KEYS, {"families", "from_text", "pattern", "unit_classes", "when", "line", "rule"})
        self.assertEqual(config_validation._PRICING_COMPANION_KEYS, {"families", "words", "unit_class", "item", "line", "rule"})
        self.assertIn("rule_by_family", config_validation._PRICING_NUMBER_DEFAULT_KEYS)

    # ---- negative: stream_heading_default ----------------------------------------------------------------
    def test_03_stream_heading_default_shapes(self):
        for bad in ({}, [], None):
            c = self._adp(); self._pr(c)["stream_heading_default"] = bad
            self._refuses(c, "stream_heading_default must be a non-empty list")
        c = self._adp(); self._pr(c)["stream_heading_default"][0]["when"] = {}
        self._refuses(c, "stream_heading_default[0]: unknown key(s): when")
        c = self._adp(); del self._pr(c)["stream_heading_default"][0]["streams_attr"]
        self._refuses(c, "stream_heading_default[0] must carry")
        c = self._adp(); self._pr(c)["stream_heading_default"][0]["attr"] = "size_mm"
        self._refuses(c, "stream_heading_default[0].attr must be a choice attribute")
        c = self._adp(); self._pr(c)["stream_heading_default"][0]["streams_attr"] = "ul"
        self._refuses(c, "streams_attr must be a choice definition whose values include supply and return")
        c = self._adp(); self._pr(c)["stream_heading_default"][0]["families"] = ["linear grilles"]
        self._refuses(c, "stream_heading_default[0].families must be a non-empty list of priceable families")
        c = self._adp(); self._pr(c)["stream_heading_default"][0]["words"] = []
        self._refuses(c, "stream_heading_default[0].words must be a non-empty list of words")
        c = self._adp(); self._pr(c)["stream_heading_default"][0]["line"] = " "
        self._refuses(c, "stream_heading_default[0].line must be a non-empty string")

    def test_04_stream_heading_default_needs_a_ruled_default_per_family(self):
        c = self._adp(); self._pr(c)["stream_heading_default"][0]["families"].append("VCD")
        self._refuses(c, "'VCD' has no ruled default for 'damper'")

    # ---- negative: text_notes ----------------------------------------------------------------------------
    def test_05_text_notes_shapes(self):
        for bad in ({}, [], None):
            c = self._adp(); self._pr(c)["text_notes"] = bad
            self._refuses(c, "text_notes must be a non-empty list")
        c = self._adp(); self._pr(c)["text_notes"][0]["from_attr"] = "variant"
        self._refuses(c, "text_notes[0]: unknown key(s): from_attr")
        c = self._adp(); del self._pr(c)["text_notes"][1]["rule"]
        self._refuses(c, "text_notes[1] must carry")
        c = self._adp(); self._pr(c)["text_notes"][0]["from_text"] = "row"
        self._refuses(c, "text_notes[0].from_text must be one of headings, own_and_headings")
        c = self._adp(); self._pr(c)["text_notes"][0]["pattern"] = "control (panel"
        self._refuses(c, "text_notes[0].pattern must be a regular expression")
        c = self._adp(); self._pr(c)["text_notes"][1]["unit_classes"] = ["sqm"]
        self._refuses(c, "text_notes[1].unit_classes must be a non-empty list of unit_classes keys")
        c = self._adp(); self._pr(c)["text_notes"][0]["when"] = {"attr": "variant"}
        self._refuses(c, "text_notes[0].when must be {attr, equals}")
        c = self._adp(); self._pr(c)["text_notes"][0]["families"] = ["MVCD"]
        self._refuses(c, "text_notes[0].families must be a non-empty list of priceable families")

    # ---- negative: companion_items -----------------------------------------------------------------------
    def test_06_companion_items_shapes(self):
        for bad in ({}, [], None):
            c = self._adp(); self._pr(c)["companion_items"] = bad
            self._refuses(c, "companion_items must be a non-empty list")
        c = self._adp(); self._pr(c)["companion_items"][0]["qty"] = 1
        self._refuses(c, "companion_items[0]: unknown key(s): qty")
        c = self._adp(); self._pr(c)["companion_items"][0]["unit_class"] = "nos"
        self._refuses(c, "companion_items[0].unit_class must be a unit_classes key")
        c = self._adp(); self._pr(c)["companion_items"][0]["item"]["grille_size"] = "300 x 300"
        self._refuses(c, "companion_items[0].item must map item attribute ids to non-empty values")
        c = self._adp(); self._pr(c)["companion_items"][0]["item"]["family"] = "cross-talk"
        self._refuses(c, "companion_items[0].item.family must be a priceable family other than the ones it is added to")
        c = self._adp(); self._pr(c)["companion_items"][0]["words"] = ["return air baffle", ""]
        self._refuses(c, "companion_items[0].words must be a non-empty list of phrases")

    # ---- negative: number_defaults.rule_by_family --------------------------------------------------------
    def test_07_rule_by_family_names_families_the_default_applies_to(self):
        c = self._adp(); self._pr(c)["number_defaults"]["face_w_mm"]["rule_by_family"] = {"linear grille": "x"}
        self._refuses(c, "number_defaults['face_w_mm'].rule_by_family must map families the default applies to")
        c = self._adp(); self._pr(c)["number_defaults"]["face_h_mm"]["rule_by_family"] = {"floor grille": ""}
        self._refuses(c, "number_defaults['face_h_mm'].rule_by_family must map families the default applies to")


if __name__ == "__main__":
    unittest.main()
