"""VAV-2c3 FIX (2026-11-24; PIN FIX-0, ANSWER 9 / 10) -- THE SERVER HALF of HVAC v85: VAV Box's three ruled defaults (DefaultSpec, the pattern the
other categories use) validate; EVERY category's model request and group context byte-identical v84 vs v85 (condition (a)); no item and no
other category's config changes.

FIXTURES, no DB writes: v85 is built in memory (`mint_hvac_v82_vav2c1.apply_config` on the v84 file + frontend/.../__fixtures__/
vav2c3bEdits.json) -- the v85 file is not read.
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_vav2c3b_keys
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


def _v84():
    with open(os.path.join(DATA, "rate_master_hvac_all_v84.json"), encoding="utf-8") as f:
        return json.load(f)


def _edits():
    with open(os.path.join(FIX, "vav2c3bEdits.json"), encoding="utf-8") as f:
        return json.load(f)


def _v85():
    a, k = _v84(), _edits()
    a["category_configs"] = [MINT.apply_config(c, [e for e in k["configs"] if e["c"] == c["category_id"]]) for c in a["category_configs"]]
    return a


def _cfg(asset, cat):
    return next(c for c in asset["category_configs"] if c["category_id"] == cat)


def _requests(asset):
    """Every category's model request (the items spec, list_spec categories) and the prompt-facing group context of every category."""
    stored = [dict(c, discipline=asset["discipline"]) for c in asset["category_configs"]]
    cfgs = {(asset["discipline"], c["category_id"]): c for c in stored}
    out = {}
    for c in stored:
        if c.get("list_spec"):
            out[c["category_id"]] = json.dumps(extraction.build_items_spec(cfgs[(c["discipline"], c["category_id"])], cfgs, c["discipline"]),
                                               sort_keys=True, ensure_ascii=False)
    return out


class TestVav2c3bKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v84, cls.v85 = _v84(), _v85()

    def _valid(self, cfg):
        config_validation._validate_config(dict(cfg, discipline="HVAC"))

    def test_01_every_v85_config_validates(self):
        for c in self.v85["category_configs"]:
            self._valid(c)

    def test_02_no_item_changes(self):
        self.assertEqual(json.dumps(self.v84["items"], sort_keys=True), json.dumps(self.v85["items"], sort_keys=True))

    def test_03_every_model_request_and_group_context_byte_identical(self):
        r84, r85 = _requests(self.v84), _requests(self.v85)
        self.assertEqual([k for k in r84 if r84[k] != r85.get(k)], [])
        def ctx(asset):
            stored = [dict(c, discipline=asset["discipline"]) for c in asset["category_configs"]]
            cfgs = {(asset["discipline"], c["category_id"]): c for c in stored}
            return {c["category_id"]: json.dumps(extraction._group_context(cfgs, c["discipline"], c["category_id"]), sort_keys=True, default=str,
                                                 ensure_ascii=False) for c in stored}
        g84, g85 = ctx(self.v84), ctx(self.v85)
        self.assertEqual(len(g84), 16)
        self.assertEqual([k for k in g84 if g84[k] != g85[k]], [])

    def test_04_only_vav_box_changes_and_only_its_defaults(self):
        changed = sorted(c["category_id"] for c in self.v85["category_configs"]
                         if json.dumps(c, sort_keys=True) != json.dumps(_cfg(self.v84, c["category_id"]), sort_keys=True))
        self.assertEqual(changed, [VAV])
        a, b = copy.deepcopy(_cfg(self.v84, VAV)), copy.deepcopy(_cfg(self.v85, VAV))
        a["list_spec"]["pricing"].pop("defaults"); b["list_spec"]["pricing"].pop("defaults")
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))
        d = _cfg(self.v85, VAV)["list_spec"]["pricing"]["defaults"]
        self.assertEqual(d["integrator_included"]["value"], "No")
        self.assertEqual(d["vav_type"]["value"], "Nothing specific mentioned")
        self.assertEqual(d["shape"]["value"], "Rectangular")
        for k in ("integrator_included", "vav_type", "shape"):
            self.assertIs(d[k]["absent_as_none"], True, k)
            self.assertTrue(d[k]["rule"])

    def test_05_negative_v84_has_no_integrator_or_type_default(self):
        d = _cfg(self.v84, VAV)["list_spec"]["pricing"]["defaults"]
        self.assertNotIn("integrator_included", d)
        self.assertNotIn("vav_type", d)
        self.assertNotIn("absent_as_none", d["shape"])
