"""VAV-2c3 (2026-11-24) -- THE SERVER HALF of HVAC v84: the validators of the two new keys (`scope.calculator_scope_box_only`,
`scope.rule.install_row_texts`), each accepted as built and refused by name when malformed; T3 (server side): EVERY category's model request
byte-identical v83 vs v84 (R5: "every model request byte-identical to v83's"); no item of the catalogue changes.

FIXTURES, no DB writes: v84 is built in memory (`mint_hvac_v82_vav2c1.apply_config` on the v83 file + frontend/.../__fixtures__/
vav2c3Edits.json) -- the v84 file is not read, so this commits before the asset.
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_vav2c3_keys
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


def _v83():
    with open(os.path.join(DATA, "rate_master_hvac_all_v83.json"), encoding="utf-8") as f:
        return json.load(f)


def _edits():
    with open(os.path.join(FIX, "vav2c3Edits.json"), encoding="utf-8") as f:
        return json.load(f)


def _v84():
    a, k = _v83(), _edits()
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


class TestVav2c3Keys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v83, cls.v84 = _v83(), _v84()

    def _valid(self, cfg):
        config_validation._validate_config(dict(cfg, discipline="HVAC"))

    def _scope(self, cfg):
        return cfg["list_spec"]["pricing"]["scope"]

    def test_01_every_v84_config_validates(self):
        for c in self.v84["category_configs"]:
            self._valid(c)

    def test_02_no_item_changes(self):
        self.assertEqual(json.dumps(self.v83["items"], sort_keys=True), json.dumps(self.v84["items"], sort_keys=True))

    def test_03_every_model_request_byte_identical(self):
        """T3 / PF2: every category's model request v83 == v84 (the edits are screen texts and two screen keys only)."""
        r83, r84 = _requests(self.v83), _requests(self.v84)
        self.assertEqual(sorted(r83), sorted(r84))
        self.assertGreaterEqual(len(r83), 9)
        self.assertEqual([k for k in r83 if r83[k] != r84[k]], [])

    def test_03b_every_group_context_byte_identical(self):
        """T3 / PF2: the whole group context a batch is built from (prompt, definitions, synonyms, defaults, rules, items spec) -- every
        category, v83 == v84."""
        def ctx(asset):
            stored = [dict(c, discipline=asset["discipline"]) for c in asset["category_configs"]]
            cfgs = {(asset["discipline"], c["category_id"]): c for c in stored}
            return {c["category_id"]: json.dumps(extraction._group_context(cfgs, c["discipline"], c["category_id"]), sort_keys=True, default=str,
                                                 ensure_ascii=False) for c in stored}
        g83, g84 = ctx(self.v83), ctx(self.v84)
        self.assertEqual(len(g83), 16)
        self.assertEqual([k for k in g83 if g83[k] != g84[k]], [])

    def test_04_calculator_switch_accepted_and_refused_by_name(self):
        self.assertIs(self._scope(_cfg(self.v84, VAV))["calculator_scope_box_only"], True)
        c = copy.deepcopy(_cfg(self.v84, VAV))
        self._scope(c)["calculator_scope_box_only"] = False
        with self.assertRaises(frappe.ValidationError) as cm:
            self._valid(c)
        self.assertIn("calculator_scope_box_only must be true", str(cm.exception))

    def test_05_install_row_texts_refused_by_name(self):
        base = _cfg(self.v84, VAV)
        cases = [
            (lambda t: t.__setitem__("sheet_shares.lines.not_a_text", "x"), "install_row_texts needs one or more of"),
            (lambda t: t.__setitem__("sheet_shares.lines.blank_rows", "Some box rows have no quantity."), "install_row_texts.sheet_shares.lines.blank_rows must name {n}"),
            (lambda t: t.__setitem__("integrator_cabling.lines.priced_separately", t["integrator_cabling.lines.priced_separately"].replace("{that_row}", "that row")),
             "priced_separately must name {that_row}"),
            (lambda t: t.__setitem__("sheet_shares.labels.per_box", ""), "per_box must be a non-empty sentence"),
            (lambda t: t.clear(), "install_row_texts needs one or more of"),
        ]
        for break_, msg in cases:
            c = copy.deepcopy(base)
            break_(self._scope(c)["rule"]["install_row_texts"])
            with self.assertRaises(frappe.ValidationError) as cm:
                self._valid(c)
            self.assertIn(msg, str(cm.exception))

    def test_06_v83_without_the_keys_still_validates(self):
        """NEGATIVE: both keys are OPTIONAL -- v83 (neither) validates as before."""
        for c in self.v83["category_configs"]:
            self._valid(c)
        self.assertNotIn("calculator_scope_box_only", self._scope(_cfg(self.v83, VAV)))
        self.assertNotIn("install_row_texts", self._scope(_cfg(self.v83, VAV))["rule"])

    def test_07_edits_file_is_what_v84_holds(self):
        """The six declared edits, each applied (to = what v84 holds), nothing else in the configs."""
        k = _edits()["configs"]
        self.assertEqual(len(k), 6)
        for e in k:
            node = _cfg(self.v84, e["c"])
            for p in e["p"]:
                node = node[p]
            self.assertEqual(node, e["to"])
        changed = sorted(c["category_id"] for c in self.v84["category_configs"]
                         if json.dumps(c, sort_keys=True) != json.dumps(_cfg(self.v83, c["category_id"]), sort_keys=True))
        self.assertEqual(changed, ["hvac_ducting", "hvac_valve_package", "hvac_vav_box", "hvac_vrf"])
