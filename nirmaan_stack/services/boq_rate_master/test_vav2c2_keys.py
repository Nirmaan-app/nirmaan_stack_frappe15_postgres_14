"""VAV-2c2 (2026-11-24) -- THE SERVER HALF of HVAC v83: the validators of the new keys (`scope.chosen_lines`, `scope.rule`, the Calculator's
two `sheet_shares.labels` lines), each accepted as built and refused by name when malformed; T4: every item-list category's model request
byte-identical v82 vs v83 except hvac_vav_box, which moves ONLY by its two point-4 reading fields; no item of the catalogue changes.

FIXTURES, no DB writes: v83 is built in memory (`mint_hvac_v82_vav2c1.apply_config` on the v82 file + frontend/.../__fixtures__/
vav2c2Edits.json) -- the v83 file is not read, so this commits before or with the asset.
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_vav2c2_keys
"""
import copy
import importlib.util
import json
import os
import sys
import unittest

import frappe

from nirmaan_stack.services.boq_rate_master import config_validation, extraction

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
APP = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FIX = os.path.join(APP, "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__")
VAV = "hvac_vav_box"


def _load(name, *parts):
    d = os.path.join(APP, *parts)
    if d not in sys.path:
        sys.path.insert(0, d)
    spec = importlib.util.spec_from_file_location(name, os.path.join(d, name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MINT = _load("mint_hvac_v82_vav2c1", "scripts", "_instruments")


def _v82():
    with open(os.path.join(DATA, "rate_master_hvac_all_v82.json"), encoding="utf-8") as f:
        return json.load(f)


def _edits():
    with open(os.path.join(FIX, "vav2c2Edits.json"), encoding="utf-8") as f:
        return json.load(f)


def _v83():
    a, k = _v82(), _edits()
    a["category_configs"] = [MINT.apply_config(c, [e for e in k["configs"] if e["c"] == c["category_id"]]) for c in a["category_configs"]]
    return a


def _cfg(asset, cat):
    return next(c for c in asset["category_configs"] if c["category_id"] == cat)


def _requests(asset):
    stored = [dict(c, discipline=asset["discipline"]) for c in asset["category_configs"]]
    cfgs = {(asset["discipline"], c["category_id"]): c for c in stored}
    return {c["category_id"]: json.dumps(extraction.build_items_spec(cfgs[(c["discipline"], c["category_id"])], cfgs, c["discipline"]),
                                         sort_keys=True, ensure_ascii=False) for c in stored if c.get("list_spec")}


class TestVav2c2Keys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v82, cls.v83 = _v82(), _v83()

    def _valid(self, cfg):
        config_validation._validate_config(dict(cfg, discipline="HVAC"))

    def test_01_every_v83_config_validates(self):
        for c in self.v83["category_configs"]:
            self._valid(c)

    def test_02_no_item_changes(self):
        self.assertEqual(json.dumps(self.v82["items"], sort_keys=True), json.dumps(self.v83["items"], sort_keys=True))

    def test_03_requests_only_vav_and_only_its_reading_fields(self):
        """T4: 9 categories; only hvac_vav_box differs, and it equals v82's request with ONLY the reading-fields edit applied."""
        r82, r83 = _requests(self.v82), _requests(self.v83)
        self.assertEqual(sorted(k for k in r82 if r82[k] != r83.get(k)), [VAV])
        ro = copy.deepcopy(self.v82)
        reading = [e for e in _edits()["configs"] if e["c"] == VAV and e["p"] == ["list_spec", "attribute_definitions"]]
        self.assertEqual(len(reading), 1)
        ro["category_configs"] = [MINT.apply_config(c, reading) if c["category_id"] == VAV else c for c in ro["category_configs"]]
        self.assertEqual(_requests(ro)[VAV], r83[VAV])
        ids = [d["id"] for d in _cfg(self.v83, VAV)["list_spec"]["attribute_definitions"]][-2:]
        self.assertEqual(ids, ["needs_installing", "no_install_reason"])
        self.assertIn("attic stock", r83[VAV])

    def _scope(self, cfg, cat):
        pr = cfg["list_spec"]["pricing"]
        return pr["extras"]["scope"] if cat == "hvac_vrf" else pr["scope"]

    def test_04_rule_refused_by_name(self):
        base = _cfg(self.v83, VAV)
        cases = [
            (lambda r: r.pop("box_families"), "rule needs exactly"),
            (lambda r: r.__setitem__("install_start", "(unclosed"), "install_start is not a valid pattern"),
            (lambda r: r.__setitem__("box_families", []), "box_families must be a non-empty list"),
            (lambda r: r["notes"].__setitem__("D", "Supply only: installation is priced elsewhere."), "notes.D must name {n}"),
            (lambda r: r["notes"].__setitem__("E_qty", r["notes"]["E_qty"].replace("{q_box}", "45")), "notes.E_qty must name {q_box}"),
            (lambda r: r["notes"]["F_said"].pop("by_others"), "F_said needs exactly"),
            (lambda r: r.__setitem__("needs_installing", {"attr": "x"}), "needs_installing needs exactly"),
        ]
        for break_, msg in cases:
            c = copy.deepcopy(base)
            break_(c["list_spec"]["pricing"]["scope"]["rule"])
            with self.assertRaises(frappe.ValidationError) as cm:
                self._valid(c)
            self.assertIn(msg, str(cm.exception))

    def test_05_chosen_lines_refused_by_name(self):
        for cat in ("hvac_vav_box", "hvac_vrf"):
            c = copy.deepcopy(_cfg(self.v83, cat))
            self._scope(c, cat)["chosen_lines"]["not_a_line"] = "x"
            with self.assertRaises(frappe.ValidationError) as cm:
                self._valid(c)
            self.assertIn("chosen_lines needs one or more of the scope's lines", str(cm.exception))
        c = copy.deepcopy(_cfg(self.v83, "hvac_ducting"))
        self._scope(c, "hvac_ducting")["chosen_lines"]["supply_only_note"] = ""
        with self.assertRaises(frappe.ValidationError):
            self._valid(c)

    def test_06_unknown_scope_key_still_refused(self):
        """NEGATIVE: the two keys are the only ones added -- a third unknown key is refused as before."""
        c = copy.deepcopy(_cfg(self.v83, VAV))
        c["list_spec"]["pricing"]["scope"]["rules"] = {}
        with self.assertRaises(frappe.ValidationError):
            self._valid(c)

    def test_07_v82_has_none_of_the_keys(self):
        """the keys are v83's: v82's configs carry none of them (so the rule cannot act before the load)"""
        for cat in ("hvac_vav_box", "hvac_ducting", "hvac_valve_package", "hvac_vrf"):
            sc = self._scope(_cfg(self.v82, cat), cat)
            self.assertNotIn("rule", sc)
            self.assertNotIn("chosen_lines", sc)
        self.assertIn("rule", self._scope(_cfg(self.v83, VAV), VAV))
        for cat in ("hvac_ducting", "hvac_valve_package", "hvac_vrf"):
            self.assertNotIn("rule", self._scope(_cfg(self.v83, cat), cat), cat)


if __name__ == "__main__":
    unittest.main()
