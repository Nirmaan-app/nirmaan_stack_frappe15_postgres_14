"""VAV-2c3 FIX-2 (2026-11-24; ANSWER 21 / 22, the owner present 21:55 "yes") -- THE SERVER HALF of HVAC v87: A2 narrowed to ROUND / OVAL /
CIRCULAR naming the box (the `chain_values` words, the shape reading guidance, the A2 Derivation reason). v87 validates; no item and no other
category's config changes; the DECLARED model-request change is VAV Box's alone; the words no longer name DIA / diameter / the diameter sign.

FIXTURES, no DB writes: v87 is built in memory (`mint_hvac_v82_vav2c1.apply_config` on the v86 file + frontend/.../__fixtures__/
vav2c3dEdits.json) -- the v87 file is not read.
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_vav2c3d_keys
"""
import json
import os
import re
import unittest

import frappe

from nirmaan_stack.services.boq_rate_master import config_validation
from nirmaan_stack.services.boq_rate_master.test_vav2c3c_keys import MINT, VAV, _cfg, _contexts, _requests

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
APP = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FIX = os.path.join(APP, "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__")


def _v86():
    with open(os.path.join(DATA, "rate_master_hvac_all_v86.json"), encoding="utf-8") as f:
        return json.load(f)


def _v87():
    a = _v86()
    with open(os.path.join(FIX, "vav2c3dEdits.json"), encoding="utf-8") as f:
        k = json.load(f)
    a["category_configs"] = [MINT.apply_config(c, [e for e in k["configs"] if e["c"] == c["category_id"]]) for c in a["category_configs"]]
    return a


class TestVav2c3dKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v86, cls.v87 = _v86(), _v87()

    def test_01_every_v87_config_validates(self):
        for c in self.v87["category_configs"]:
            config_validation._validate_config(dict(c, discipline="HVAC"))

    def test_02_no_item_changes_and_only_vav_box_config(self):
        self.assertEqual(json.dumps(self.v86["items"], sort_keys=True), json.dumps(self.v87["items"], sort_keys=True))
        changed = sorted(c["category_id"] for c in self.v87["category_configs"]
                         if json.dumps(c, sort_keys=True) != json.dumps(_cfg(self.v86, c["category_id"]), sort_keys=True))
        self.assertEqual(changed, [VAV])

    def test_03_declared_request_change_vav_box_only(self):
        r86, r87 = _requests(self.v86), _requests(self.v87)
        self.assertEqual([k for k in r86 if r86[k] != r87.get(k)], [VAV])
        g86, g87 = _contexts(self.v86), _contexts(self.v87)
        self.assertEqual([k for k in g86 if g86[k] != g87[k]], [VAV])
        self.assertIn("A box the BoQ calls round, oval or circular is Oval", r87[VAV] + g87[VAV])
        self.assertNotIn("'DIA' / diameter or the diameter sign written for the box - is Oval", r87[VAV] + g87[VAV])

    def test_04_the_a2_words_name_the_shape_only(self):
        rule = next(r for r in _cfg(self.v87, VAV)["list_spec"]["pricing"]["chain_values"] if r["id"] == "round_box")
        rx = re.compile(rule["words"], re.I)
        for said in ("ROUND Boxes", "oval box", "Circular VAV"):
            self.assertTrue(rx.search(said), said)
        for said in ("DIA NEED MATCH", "19\" dia", "6 Ø inch box", "25 mm diameter", "ground floor"):
            self.assertIsNone(rx.search(said), said)
        # NEGATIVE: v86's words did take DIA
        old = next(r for r in _cfg(self.v86, VAV)["list_spec"]["pricing"]["chain_values"] if r["id"] == "round_box")
        self.assertTrue(re.search(old["words"], "DIA NEED MATCH", re.I))
