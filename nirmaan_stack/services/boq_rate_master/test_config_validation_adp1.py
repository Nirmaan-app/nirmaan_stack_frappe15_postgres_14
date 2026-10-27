"""ADP-1 (owner rulings H3 / H4 / F1, 2026-10-19) -- the config keys the slice adds to `list_spec.pricing`, accepted in
their one ruled form and refused in every other: the number reader's `typed_only` / `length_from` / `label` /
`not_stocked` / `bare_above_largest` and unit "m", and a conversion option's `show_numbers` / `name_missing`.

Pure: the validator reads no database. Run: bench --site localhost run-tests --module
nirmaan_stack.services.boq_rate_master.test_config_validation_adp1
"""
import copy
import json
import os
import unittest

from nirmaan_stack.services.boq_rate_master import config_validation

DATA = os.path.join(os.path.dirname(__file__), "data")


def _v46():
    with open(os.path.join(DATA, "rate_master_hvac_all_v46.json"), encoding="utf-8") as f:
        return json.load(f)


def _cfg(payload, cid):
    c = next(c for c in payload["category_configs"] if c["category_id"] == cid)
    return dict(copy.deepcopy(c), discipline=payload["discipline"])


def _with_adp1(adp):
    """The ADP-1 keys on the ADP config, in their ruled form (the asset v47 carries the same)."""
    pr = adp["list_spec"]["pricing"]
    pr["numbers"]["piece_length_m"] = {"from": ["piece_length_m"], "name": "piece length", "unit": "m",
                                       "typed_only": True, "length_from": "size_mm", "label": "Piece length (m)"}
    pr["numbers"]["slot_count"]["not_stocked"] = "No SKU for a {value}-slot diffuser - price this row by hand"
    pr["match_attrs"].append("piece_length_m")
    pr["panel_controls"]["piece_length_m"] = "text"
    pr["number_defaults"] = {"piece_length_m": {"value": 1, "families": ["slot diffuser"],
                                                "rule": "no piece length stated - priced at 1 m (owner H3, 2026-10-19)"}}
    opt = pr["families"]["mixing box / LP plenum"]["convert"]["count"][0]
    opt["show_numbers"] = True
    opt["name_missing"] = True
    return adp


class TestAdp1ConfigKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v46 = _v46()

    def _adp(self):
        return _with_adp1(_cfg(self.v46, "hvac_adp"))

    def _refuses(self, cfg, *words):
        with self.assertRaises(Exception) as cm:
            config_validation._validate_config(cfg)
        for w in words:
            self.assertIn(w, str(cm.exception))

    # ---- positive ---------------------------------------------------------------------------------------
    def test_01_v46_and_the_adp1_form_validate(self):
        config_validation._validate_config(_cfg(self.v46, "hvac_adp"))
        config_validation._validate_config(self._adp())
        ins = _cfg(self.v46, "hvac_insulation")
        ins["list_spec"]["pricing"]["numbers"]["pipe_size_mm"]["bare_above_largest"] = "refuse"
        config_validation._validate_config(ins)

    def test_02_every_asset_on_disk_still_validates_its_units(self):
        """The closed unit set admits every unit any asset on disk declares (mm 313, nm 40, sqm 40, none 80)."""
        seen = set()
        for name in sorted(os.listdir(DATA)):
            if not name.endswith(".json"):
                continue
            with open(os.path.join(DATA, name), encoding="utf-8") as f:
                payload = json.load(f)
            cfgs = payload.get("category_configs") or ([payload["category_config"]] if payload.get("category_config") else [])
            for c in cfgs:
                for rd in (((c.get("list_spec") or {}).get("pricing") or {}).get("numbers") or {}).values():
                    if "unit" in rd:
                        seen.add(rd["unit"])
        self.assertTrue(seen <= config_validation._PRICING_NUMBER_UNITS, seen)
        self.assertEqual(config_validation._PRICING_NUMBER_UNITS, {"mm", "nm", "sqm", "m"})

    # ---- negative: each key, outside its ruled form ---------------------------------------------------------
    def test_03_typed_only_names_ONE_box_that_is_not_a_definition(self):
        for frm in (["piece_length_m", "size_mm"], ["size_mm"], []):
            c = self._adp()
            c["list_spec"]["pricing"]["numbers"]["piece_length_m"]["from"] = frm
            self._refuses(c, "typed_only")

    def test_04_typed_only_needs_a_label_and_is_exactly_true(self):
        c = self._adp()
        del c["list_spec"]["pricing"]["numbers"]["piece_length_m"]["label"]
        self._refuses(c, "label")
        c = self._adp()
        c["list_spec"]["pricing"]["numbers"]["piece_length_m"]["typed_only"] = "yes"
        self._refuses(c, "typed_only must be exactly true")

    def test_05_without_typed_only_a_box_that_is_no_definition_still_refuses(self):
        c = self._adp()
        del c["list_spec"]["pricing"]["numbers"]["piece_length_m"]["typed_only"]
        self._refuses(c, "from must list text item attribute definitions")

    def test_06_length_from_needs_typed_only_and_a_text_definition(self):
        c = self._adp()
        c["list_spec"]["pricing"]["numbers"]["piece_length_m"]["length_from"] = "nope"
        self._refuses(c, "length_from")
        c = self._adp()
        c["list_spec"]["pricing"]["numbers"]["dia_mm"]["length_from"] = "size_mm"
        self._refuses(c, "length_from")

    def test_07_not_stocked_is_a_sentence(self):
        c = self._adp()
        c["list_spec"]["pricing"]["numbers"]["slot_count"]["not_stocked"] = ""
        self._refuses(c, "not_stocked")

    def test_08_bare_above_largest_is_refuse_on_an_inches_axis(self):
        ins = _cfg(self.v46, "hvac_insulation")
        ins["list_spec"]["pricing"]["numbers"]["pipe_size_mm"]["bare_above_largest"] = "price"
        self._refuses(ins, "bare_above_largest")
        ins = _cfg(self.v46, "hvac_insulation")
        ins["list_spec"]["pricing"]["numbers"]["thickness_mm"]["bare_above_largest"] = "refuse"
        self._refuses(ins, "bare_above_largest")

    def test_09_an_unknown_unit_refuses(self):
        c = self._adp()
        c["list_spec"]["pricing"]["numbers"]["piece_length_m"]["unit"] = "metres"
        self._refuses(c, "unit must be one of")

    def test_10_show_numbers_and_name_missing_are_exactly_true(self):
        for key in ("show_numbers", "name_missing"):
            c = self._adp()
            c["list_spec"]["pricing"]["families"]["mixing box / LP plenum"]["convert"]["count"][0][key] = 1
            self._refuses(c, key)
        c = self._adp()
        c["list_spec"]["pricing"]["families"]["mixing box / LP plenum"]["convert"]["count"][0]["show_more"] = True
        self._refuses(c, "show_numbers / name_missing")

    def test_11_the_number_default_of_a_typed_only_reader_validates_only_for_a_real_family(self):
        c = self._adp()
        c["list_spec"]["pricing"]["number_defaults"]["piece_length_m"]["families"] = ["slot diffusers"]
        self._refuses(c, "not a family")
