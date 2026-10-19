"""ADP-2 (owner rulings H5 / H7 / B3, 2026-10-19 / 2026-10-20) -- the config the slice changes in `list_spec.pricing`,
accepted in its one ruled form and refused in every other: the number reader's new `box_side` (H7 / Q2: a plenum's typed
side is filled from ONE side of the box the size states), beside the existing keys the slice uses as they are
(`derive_when_none` widened to every damper family, the `dropdown_or_other` neck control, the area reader).

Pure: the validator reads no database. Run: bench --site localhost run-tests --module
nirmaan_stack.services.boq_rate_master.test_config_validation_adp2
"""
import copy
import json
import os
import unittest

from nirmaan_stack.services.boq_rate_master import config_validation

DATA = os.path.join(os.path.dirname(__file__), "data")
DAMPER_FAMILIES = ["curved grille", "floor grille", "linear grille", "round diffuser", "slot diffuser", "square diffuser"]
PLENUM_NUMBERS = {
    "plenum_area_sqm": {"from": ["plenum_area_sqm"], "name": "area", "unit": "sqm", "range": "max", "typed_only": True,
                        "length_from": "area_band", "label": "Area (sq.m)"},
    "plenum_length_mm": {"from": ["plenum_length_mm"], "name": "length", "unit": "mm", "typed_only": True,
                         "length_from": "size_mm", "box_side": "length", "label": "Length (mm)"},
    "plenum_width_mm": {"from": ["plenum_width_mm"], "name": "width", "unit": "mm", "typed_only": True,
                        "length_from": "size_mm", "box_side": "width", "label": "Width (mm)"},
    "plenum_height_mm": {"from": ["plenum_height_mm"], "name": "height", "unit": "mm", "typed_only": True,
                         "length_from": "size_mm", "box_side": "height", "label": "Height (mm)"},
}


def _v47():
    with open(os.path.join(DATA, "rate_master_hvac_all_v47.json"), encoding="utf-8") as f:
        return json.load(f)


def _cfg(payload, cid):
    c = next(c for c in payload["category_configs"] if c["category_id"] == cid)
    return dict(copy.deepcopy(c), discipline=payload["discipline"])


def _with_adp2(adp):
    """The ADP-2 keys on the ADP config, in their ruled form (the asset v48 carries the same)."""
    pr = adp["list_spec"]["pricing"]
    pr["derive_when_none"] = [{"attr": "damper", "families": list(DAMPER_FAMILIES), "when": {"attr": "air", "equals": air},
                               "then": "with" if air == "supply" else "without",
                               "rule": f"{air} air, damper not mentioned -> {'with' if air == 'supply' else 'without'} damper"}
                              for air in ("supply", "return", "exhaust", "fresh")]
    pr["numbers"].update(copy.deepcopy(PLENUM_NUMBERS))
    pr["match_attrs"] += list(PLENUM_NUMBERS)
    pr["panel_controls"].update({k: "text" for k in PLENUM_NUMBERS})
    pr["panel_controls"]["neck_mm"] = "dropdown_or_other"
    return adp


class TestAdp2ConfigKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v47 = _v47()

    def _adp(self):
        return _with_adp2(_cfg(self.v47, "hvac_adp"))

    def _refuses(self, cfg, *words):
        with self.assertRaises(Exception) as cm:
            config_validation._validate_config(cfg)
        for w in words:
            self.assertIn(w, str(cm.exception))

    # ---- positive ---------------------------------------------------------------------------------------
    def test_01_v47_and_the_adp2_form_validate(self):
        config_validation._validate_config(_cfg(self.v47, "hvac_adp"))
        config_validation._validate_config(self._adp())

    def test_02_each_box_side_is_accepted(self):
        for side in ("length", "width", "height"):
            cfg = self._adp()
            cfg["list_spec"]["pricing"]["numbers"]["plenum_length_mm"]["box_side"] = side
            config_validation._validate_config(cfg)

    def test_03_an_area_reader_filled_from_the_area_band_needs_no_box_side(self):
        cfg = self._adp()
        self.assertNotIn("box_side", cfg["list_spec"]["pricing"]["numbers"]["plenum_area_sqm"])
        config_validation._validate_config(cfg)

    def test_04_derive_when_none_on_every_damper_family_and_every_air_stream(self):
        cfg = self._adp()
        self.assertEqual([r["when"]["equals"] for r in cfg["list_spec"]["pricing"]["derive_when_none"]], ["supply", "return", "exhaust", "fresh"])
        config_validation._validate_config(cfg)

    # ---- negative ---------------------------------------------------------------------------------------
    def test_05_a_box_side_that_is_not_length_width_or_height_is_refused(self):
        for bad in ("depth", "Length", "", 1, None):
            cfg = self._adp()
            cfg["list_spec"]["pricing"]["numbers"]["plenum_length_mm"]["box_side"] = bad
            self._refuses(cfg, "box_side must be length / width / height")

    def test_06_a_box_side_without_length_from_is_refused(self):
        cfg = self._adp()
        del cfg["list_spec"]["pricing"]["numbers"]["plenum_width_mm"]["length_from"]
        self._refuses(cfg, "box_side")

    def test_07_a_box_side_on_a_reader_not_in_mm_is_refused(self):
        cfg = self._adp()
        cfg["list_spec"]["pricing"]["numbers"]["plenum_height_mm"]["unit"] = "m"
        self._refuses(cfg, "box_side")

    def test_08_a_box_side_on_a_model_read_number_is_refused(self):
        cfg = self._adp()
        rd = cfg["list_spec"]["pricing"]["numbers"]["face_w_mm"]
        rd["box_side"] = "width"
        rd["length_from"] = "size_mm"
        self._refuses(cfg, "length_from needs typed_only")

    def test_09_a_misspelt_key_is_still_unknown(self):
        cfg = self._adp()
        cfg["list_spec"]["pricing"]["numbers"]["plenum_length_mm"]["box_sides"] = "length"
        self._refuses(cfg, "unknown key(s): box_sides")

    def test_10_a_derive_rule_on_an_air_stream_the_question_does_not_offer_is_refused(self):
        cfg = self._adp()
        cfg["list_spec"]["pricing"]["derive_when_none"][3]["when"]["equals"] = "mixed"
        self._refuses(cfg, "derive_when_none[3].when")


if __name__ == "__main__":
    unittest.main()
