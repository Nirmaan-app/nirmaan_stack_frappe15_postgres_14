"""ADP-3b (owner B1; D1-D4, 2026-10-20 22:25 "ok to all") -- the config the slice changes in `list_spec.pricing`, accepted in
its one ruled form and refused in every other: the number reader's new `face_side` (a face's width / height typed in its
own box, filled from ONE SIDE of the face the size states), with the depth axis retired (D4).

Pure: the validator reads no database. Run: bench --site localhost run-tests --module
nirmaan_stack.services.boq_rate_master.test_config_validation_adp3b
"""
import copy
import json
import os
import unittest

from nirmaan_stack.services.boq_rate_master import config_validation

DATA = os.path.join(os.path.dirname(__file__), "data")
FACE_NUMBERS = {
    "face_w_mm": {"from": ["face_w_mm"], "name": "width", "unit": "mm", "typed_only": True, "length_from": "size_mm",
                  "face_side": "width", "label": "Width (mm)"},
    "face_h_mm": {"from": ["face_h_mm"], "name": "height", "unit": "mm", "typed_only": True, "length_from": "size_mm",
                  "face_side": "height", "label": "Height (mm)"},
}


def _v48():
    with open(os.path.join(DATA, "rate_master_hvac_all_v48.json"), encoding="utf-8") as f:
        return json.load(f)


def _cfg(payload, cid):
    c = next(c for c in payload["category_configs"] if c["category_id"] == cid)
    return dict(copy.deepcopy(c), discipline=payload["discipline"])


def _with_adp3b(adp):
    """The ADP-3b keys on the ADP config, in their ruled form (the asset v49 carries the same)."""
    pr = adp["list_spec"]["pricing"]
    pr["numbers"].update(copy.deepcopy(FACE_NUMBERS))
    del pr["numbers"]["depth_mm"]
    pr["match_attrs"] = [a for a in pr["match_attrs"] if a != "depth_mm"]
    pr["panel_controls"].pop("depth_mm")
    pr["panel_notes"]["face_w_mm"] = [{"text": "Type the width the BoQ states, in mm."}]
    pr["panel_notes"]["face_h_mm"] = [{"text": "Type the height the BoQ states, in mm."}]
    return adp


class TestAdp3bConfigKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v48 = _v48()

    def _adp(self):
        return _with_adp3b(_cfg(self.v48, "hvac_adp"))

    def _refuses(self, cfg, *words):
        with self.assertRaises(Exception) as cm:
            config_validation._validate_config(cfg)
        for w in words:
            self.assertIn(w, str(cm.exception))

    # ---- positive ---------------------------------------------------------------------------------------
    def test_01_v48_and_the_adp3b_form_validate(self):
        config_validation._validate_config(_cfg(self.v48, "hvac_adp"))
        config_validation._validate_config(self._adp())

    def test_02_each_face_side_is_accepted(self):
        for side in ("width", "height"):
            cfg = self._adp()
            cfg["list_spec"]["pricing"]["numbers"]["face_w_mm"]["face_side"] = side
            config_validation._validate_config(cfg)

    def test_03_the_depth_axis_retired_still_validates_and_no_reader_names_it(self):
        cfg = self._adp()
        config_validation._validate_config(cfg)
        pr = cfg["list_spec"]["pricing"]
        # the four places D4 names; cross-talk's `crosstalk_assumed_depth_mm` is a Pricing Input, not the depth axis
        self.assertNotIn("depth_mm", pr["numbers"])
        self.assertNotIn("depth_mm", pr["match_attrs"])
        self.assertNotIn("depth_mm", pr["panel_controls"])
        self.assertNotIn("depth_mm", json.dumps(pr["panel_notes"]))

    # ---- negative ---------------------------------------------------------------------------------------
    def test_04_a_face_side_that_is_not_width_or_height_is_refused(self):
        for bad in ("depth", "length", "Width", "", None, 1):
            cfg = self._adp()
            cfg["list_spec"]["pricing"]["numbers"]["face_w_mm"]["face_side"] = bad
            self._refuses(cfg, "face_side must be width / height")

    def test_05_a_face_side_without_length_from_is_refused(self):
        cfg = self._adp()
        del cfg["list_spec"]["pricing"]["numbers"]["face_h_mm"]["length_from"]
        self._refuses(cfg, "face_side")

    def test_06_a_face_side_not_in_mm_is_refused(self):
        cfg = self._adp()
        cfg["list_spec"]["pricing"]["numbers"]["face_h_mm"]["unit"] = "m"
        self._refuses(cfg, "face_side")

    def test_07_a_face_side_beside_a_box_side_is_refused(self):
        cfg = self._adp()
        cfg["list_spec"]["pricing"]["numbers"]["face_w_mm"]["box_side"] = "width"
        self._refuses(cfg, "never beside box_side")

    def test_08_a_face_side_on_a_model_read_number_is_refused(self):
        cfg = self._adp()
        rd = cfg["list_spec"]["pricing"]["numbers"]["face_w_mm"]
        del rd["typed_only"]
        rd["from"] = ["size_mm"]
        self._refuses(cfg, "length_from needs typed_only")

    def test_09_a_misspelt_key_is_still_unknown(self):
        cfg = self._adp()
        cfg["list_spec"]["pricing"]["numbers"]["face_w_mm"]["face_sides"] = "width"
        self._refuses(cfg, "unknown key(s): face_sides")


if __name__ == "__main__":
    unittest.main()
