"""VAV-FIX (2026-11-25; the final fix slice of the VAV Box build) -- THE SERVER HALF of HVAC v88: S1 `defaults.<attr>.boq_rows_only` on VAV Box's
three ruled defaults (owner 2026-11-20 17:53 "a"; 2026-11-25 00:37: the Calculator starts blank), S3 the no-unit bar's one sentence, S4 rules page
line 52 without its internal label. v88 validates; no item and no other category's config changes; NO model request moves (T7); no pricer-facing
HVAC text carries R4's patterns (T4); the validator refuses a malformed `boq_rows_only` (negative).

FIXTURES, no DB writes: v88 is built in memory (`mint_hvac_v82_vav2c1.apply_config` on the v87 file + frontend/.../__fixtures__/vavfixEdits.json)
-- the v88 file is not read, so this runs the same before the mint and after it.
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_vavfix_keys
"""
import copy
import importlib.util
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


def _texts():
    spec = importlib.util.spec_from_file_location("pricer_texts_vavfix", os.path.join(APP, "scripts", "pricer_texts.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


TEXTS = _texts()
# R4's patterns (the prompt's list) beside the label file's kinds; a Pricing Input / field id inside a working line is drawn as its NAME, so a
# `key` label is none there (VAV-2c1's ruled treatment, test_vav2c1_keys._labelled)
R4 = [re.compile(p) for p in (r"chat-Claude", r"\bANSWERS?\b", r"\bQR-", r"\b(?:K-)?FIX-?\d*\b", r"\bVAV-\d", r"\bK-FIX\b", r"(?<![\w-])D-[1-4](?!\d)")]
TIME = re.compile(r"(?<![\d:.-])\d{1,2}:\d{2}(?![\d:])")
DATE = re.compile(r"20\d\d-\d\d-\d\d|\b\d{1,2}\s+(?:Nov|Oct|Sep|Dec|Aug)\w*\b", re.I)


def _v87():
    with open(os.path.join(DATA, "rate_master_hvac_all_v87.json"), encoding="utf-8") as f:
        return json.load(f)


def _edits():
    with open(os.path.join(FIX, "vavfixEdits.json"), encoding="utf-8") as f:
        return json.load(f)


def _v88():
    a, k = _v87(), _edits()
    a["category_configs"] = [MINT.apply_config(c, [e for e in k["configs"] if e["c"] == c["category_id"]]) for c in a["category_configs"]]
    return a


def _r4_hits(asset):
    """Every pricer-facing (shown) HVAC text carrying an R4 pattern: (category, key path, what). The AI's reading guidance and the category notes
    are on no screen (`where` says so) and are left alone, as ruled 2026-11-22 13:03."""
    out = []
    for cat, path, text in TEXTS.walk(asset):
        if TEXTS.where(cat, path, text)[0] is None:
            continue
        what = [x for x in TEXTS.labels(text) if not x.startswith("key:")]
        what += [m.group(0) for rx in R4 for m in rx.finditer(text)]
        what += [m.group(0) for m in TIME.finditer(text) if not DATE.search(text[:m.start()])]
        if what:
            out.append((cat, TEXTS.key(path), what))
    return out


class TestVavfixKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v87, cls.v88 = _v87(), _v88()

    def test_01_every_v88_config_validates_and_undoing_the_edits_gives_v87_back(self):
        for c in self.v88["category_configs"]:
            config_validation._validate_config(dict(c, discipline="HVAC"))
        k = _edits()
        for a, b in zip(self.v87["category_configs"], self.v88["category_configs"]):
            mine = [e for e in k["configs"] if e["c"] == a["category_id"]]
            back = MINT.apply_config(b, [dict(e, **{"from": e["to"], "to": e["from"]}) for e in reversed(mine)])
            self.assertEqual(json.dumps(back, sort_keys=True), json.dumps(a, sort_keys=True), a["category_id"])

    def test_02_no_item_changes_and_only_vav_box_config(self):
        self.assertEqual(json.dumps(self.v87["items"], sort_keys=True), json.dumps(self.v88["items"], sort_keys=True))
        changed = sorted(c["category_id"] for c in self.v88["category_configs"]
                         if json.dumps(c, sort_keys=True) != json.dumps(_cfg(self.v87, c["category_id"]), sort_keys=True))
        self.assertEqual(changed, [VAV])
        self.assertEqual(len(_edits()["configs"]), 5)
        self.assertEqual(_edits()["pricing_inputs"], {})

    def test_03_T7_no_model_request_moves_v87_to_v88(self):
        r87, r88 = _requests(self.v87), _requests(self.v88)
        self.assertEqual(sorted(r87), sorted(r88))
        self.assertEqual([k for k in r87 if r87[k] != r88[k]], [])
        g87, g88 = _contexts(self.v87), _contexts(self.v88)
        self.assertEqual([k for k in g87 if g87[k] != g88[k]], [])

    def test_04_T7_NEGATIVE_a_planted_undeclared_change_goes_red(self):
        bad = copy.deepcopy(self.v88)
        vav = _cfg(bad, VAV)
        # a planted change to the reading guidance (part of the model request) is seen by the request comparison
        vav["list_spec"]["attribute_definitions"][2]["note"] += " Planted."
        r87, rb = _requests(self.v87), _requests(bad)
        self.assertEqual([k for k in r87 if r87[k] != rb[k]], [VAV])
        # a planted change to an item's rate is seen by the item comparison
        bad2 = copy.deepcopy(self.v88)
        it = next(i for i in bad2["items"] if isinstance((i.get("rates") or {}).get("supply_markup"), (int, float)))
        it["rates"]["supply_markup"] += 0.01
        self.assertNotEqual(json.dumps(self.v87["items"], sort_keys=True), json.dumps(bad2["items"], sort_keys=True))

    def test_05_T4_no_pricer_facing_hvac_text_carries_an_r4_pattern_red_on_v87(self):
        self.assertEqual(_r4_hits(self.v88), [])
        red = _r4_hits(self.v87)
        self.assertEqual([(c, p) for c, p, _ in red], [(VAV, "list_spec/pricing/derivation_reasons/50/why")])
        # the AI's reading guidance and the category notes are byte-identical (left alone, 13:03)
        a = {(c, TEXTS.key(p)): t for c, p, t in TEXTS.walk(self.v87) if TEXTS.where(c, p, t)[0] is None}
        b = {(c, TEXTS.key(p)): t for c, p, t in TEXTS.walk(self.v88) if TEXTS.where(c, p, t)[0] is None}
        self.assertEqual({k: v for k, v in a.items() if "boq_rows_only" not in k[1]}, {k: v for k, v in b.items() if "boq_rows_only" not in k[1]})

    def test_06_S1_boq_rows_only_on_vav_box_three_defaults_only(self):
        for c in self.v88["category_configs"]:
            ds = (((c.get("list_spec") or {}).get("pricing") or {}).get("defaults")) or {}
            got = sorted(k for k, d in ds.items() if d.get("boq_rows_only"))
            self.assertEqual(got, ["integrator_included", "shape", "vav_type"] if c["category_id"] == VAV else [], c["category_id"])
        for k, d in _cfg(self.v88, VAV)["list_spec"]["pricing"]["defaults"].items():
            self.assertIs(d["absent_as_none"], True, k)

    def test_07_NEGATIVE_the_validator_refuses_a_malformed_boq_rows_only(self):
        for bad_value, absent in (("yes", True), (1, True), (True, False), (True, None)):
            c = copy.deepcopy(_cfg(self.v88, VAV))
            d = c["list_spec"]["pricing"]["defaults"]["shape"]
            d["boq_rows_only"] = bad_value
            if absent is None:
                d.pop("absent_as_none")
            else:
                d["absent_as_none"] = absent
            with self.assertRaises(frappe.ValidationError, msg=repr((bad_value, absent))):
                config_validation._validate_config(dict(c, discipline="HVAC"))
        # KEY ABSENT stays valid (v87 as it is) and false is valid
        config_validation._validate_config(dict(_cfg(self.v87, VAV), discipline="HVAC"))
        c = copy.deepcopy(_cfg(self.v88, VAV))
        c["list_spec"]["pricing"]["defaults"]["shape"]["boq_rows_only"] = False
        config_validation._validate_config(dict(c, discipline="HVAC"))

    def test_08_S3_S4_texts_exact(self):
        pr = _cfg(self.v88, VAV)["list_spec"]["pricing"]
        self.assertEqual(pr["blank_unit_bar"], {"title": "Warning: no unit on this row",
                                                "line": "The BoQ gives no unit for this row. It is priced per number (Nos). Check the unit before using this rate."})
        why = pr["derivation_reasons"][50]["why"]
        self.assertTrue(why.startswith("owner 2026-11-24 19:53 \"A2 fix\""), why)
        self.assertNotIn("chat-Claude", why)
        self.assertNotIn("ANSWER", why)
