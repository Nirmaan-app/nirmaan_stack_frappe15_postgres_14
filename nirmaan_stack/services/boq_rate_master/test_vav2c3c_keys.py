"""VAV-2c3 FIX-2 (2026-11-24; ANSWER 19, the owner 19:53 / 20:00 / 20:06 "lets proceed") -- THE SERVER HALF of HVAC v86: the new keys validate
(`defaults.<attr>.note`, `pricing.chain_values`, `pricing.blank_unit_bar`, `scope.rule.install_heading_not`, `sheet_shares.whole[].fixed_when`)
and malformed ones are refused; the DECLARED model-request change: ONLY VAV Box's request and group context change (the reading guidance),
every other category's is byte-identical v85 vs v86; no item and no other category's config changes.

FIXTURES, no DB writes: v86 is built in memory (`mint_hvac_v82_vav2c1.apply_config` on the v85 file + frontend/.../__fixtures__/
vav2c3cEdits.json) -- the v86 file is not read.
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_vav2c3c_keys
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


def _v85():
    with open(os.path.join(DATA, "rate_master_hvac_all_v85.json"), encoding="utf-8") as f:
        return json.load(f)


def _edits():
    with open(os.path.join(FIX, "vav2c3cEdits.json"), encoding="utf-8") as f:
        return json.load(f)


def _v86():
    a, k = _v85(), _edits()
    a["category_configs"] = [MINT.apply_config(c, [e for e in k["configs"] if e["c"] == c["category_id"]]) for c in a["category_configs"]]
    return a


def _cfg(asset, cat):
    return next(c for c in asset["category_configs"] if c["category_id"] == cat)


def _requests(asset):
    stored = [dict(c, discipline=asset["discipline"]) for c in asset["category_configs"]]
    cfgs = {(asset["discipline"], c["category_id"]): c for c in stored}
    return {c["category_id"]: json.dumps(extraction.build_items_spec(cfgs[(c["discipline"], c["category_id"])], cfgs, c["discipline"]), sort_keys=True,
                                         ensure_ascii=False) for c in stored if c.get("list_spec")}


def _contexts(asset):
    stored = [dict(c, discipline=asset["discipline"]) for c in asset["category_configs"]]
    cfgs = {(asset["discipline"], c["category_id"]): c for c in stored}
    return {c["category_id"]: json.dumps(extraction._group_context(cfgs, c["discipline"], c["category_id"]), sort_keys=True, default=str,
                                         ensure_ascii=False) for c in stored}


class TestVav2c3cKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v85, cls.v86 = _v85(), _v86()

    def _valid(self, cfg):
        config_validation._validate_config(dict(cfg, discipline="HVAC"))

    def _refused(self, mutate):
        c = copy.deepcopy(_cfg(self.v86, VAV))
        mutate(c["list_spec"])
        with self.assertRaises(Exception):
            self._valid(c)

    def test_01_every_v86_config_validates(self):
        for c in self.v86["category_configs"]:
            self._valid(c)

    def test_02_no_item_changes_and_only_vav_box_config(self):
        self.assertEqual(json.dumps(self.v85["items"], sort_keys=True), json.dumps(self.v86["items"], sort_keys=True))
        changed = sorted(c["category_id"] for c in self.v86["category_configs"]
                         if json.dumps(c, sort_keys=True) != json.dumps(_cfg(self.v85, c["category_id"]), sort_keys=True))
        self.assertEqual(changed, [VAV])

    def test_03_declared_request_change_vav_box_only(self):
        r85, r86 = _requests(self.v85), _requests(self.v86)
        self.assertEqual([k for k in r85 if r85[k] != r86.get(k)], [VAV])
        g85, g86 = _contexts(self.v85), _contexts(self.v86)
        self.assertEqual(len(g85), 16)
        self.assertEqual([k for k in g85 if g85[k] != g86[k]], [VAV])
        req = r86[VAV]
        for words in ("A router or an integrator named in the row", "A round box", "is not 'Installation only'",
                      "controller for BACnet integration above the VAV boxes is the BACnet over IP controller",
                      "A direct-output temperature sensor supplied with the VAVs is the Digital Thermostat"):
            self.assertIn(words, req + g86[VAV], words)

    def test_04_the_keys_as_declared(self):
        p = _cfg(self.v86, VAV)["list_spec"]["pricing"]
        self.assertEqual(p["defaults"]["integrator_included"]["note"], "Integrator not mentioned in the BoQ - priced without it (assumed).")
        self.assertEqual(p["defaults"]["vav_type"]["note"], "Type not named - priced as Nothing specific mentioned (assumed).")
        self.assertEqual(p["defaults"]["shape"]["note"], "Shape not stated - priced as Rectangular (assumed).")
        self.assertEqual([r["id"] for r in p["chain_values"]], ["router_integrator", "round_box", "direct_output_sensor"])
        self.assertNotIn("blank_unit_refuses", p)
        self.assertEqual(p["blank_unit_bar"]["line"], "WARNING: The BoQ gives no unit for this row. Priced per number (Nos). Check the unit before using this rate.")
        self.assertTrue(p["scope"]["rule"]["install_heading_not"])
        bw = next(w for w in p["sheet_shares"]["whole"] if w["key"] == "bacnet_whole")
        self.assertEqual(bw["fixed_when"]["fixed"], {"controllers": 1})
        # NEGATIVE: v85 carries none of them
        p85 = _cfg(self.v85, VAV)["list_spec"]["pricing"]
        self.assertNotIn("chain_values", p85)
        self.assertNotIn("blank_unit_bar", p85)
        self.assertIs(p85["blank_unit_refuses"], True)

    def test_05_malformed_keys_are_refused(self):
        P = lambda ls: ls["pricing"]
        self._refused(lambda ls: P(ls)["defaults"]["shape"].__setitem__("note", ""))
        self._refused(lambda ls: P(ls)["chain_values"][0].pop("families"))                        # neither families nor section
        self._refused(lambda ls: P(ls)["chain_values"][0].__setitem__("section", "misc"))           # both
        self._refused(lambda ls: P(ls)["chain_values"][0].__setitem__("families", ["no such family"]))
        self._refused(lambda ls: P(ls)["chain_values"][1].__setitem__("words", "(unclosed"))
        self._refused(lambda ls: P(ls)["chain_values"][1].__setitem__("when", []))
        self._refused(lambda ls: P(ls)["chain_values"][2].__setitem__("section", "no_such_section"))
        self._refused(lambda ls: P(ls)["chain_values"].append(copy.deepcopy(P(ls)["chain_values"][0])))  # duplicate id
        self._refused(lambda ls: P(ls).__setitem__("blank_unit_refuses", True))                     # bar beside the refusal
        self._refused(lambda ls: P(ls)["blank_unit_bar"].pop("line"))
        self._refused(lambda ls: P(ls)["scope"]["rule"].__setitem__("install_heading_not", "(unclosed"))
        self._refused(lambda ls: next(w for w in P(ls)["sheet_shares"]["whole"] if w["key"] == "bacnet_whole")["fixed_when"].__setitem__("fixed", {"panels": 1}))
        self._refused(lambda ls: next(w for w in P(ls)["sheet_shares"]["whole"] if w["key"] == "bacnet_whole")["fixed_when"].__setitem__("words", "(unclosed"))
