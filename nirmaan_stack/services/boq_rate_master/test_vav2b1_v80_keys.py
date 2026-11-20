"""VAV-2b1 v80 (owner 2026-11-21 01:07 / 01:09 "yes for both" / 01:16 / 01:21 "b"; chat-Claude's calls 01:10 / 01:23) -- THE SERVER HALF of
v80's keys: `list_spec.pricing.user_addable` and `sheet_shares.lines.not_box_row` on hvac_vav_box, the Duct Static Pressure Sensor family on
hvac_sensors, and (c2) a user-only family never asked of the model.

FIXTURES, no DB writes: the configs the v80 mint builds (`mint_hvac_v80_vav2b1.vav_config` / `sensors_config` on the v79 file + the ONE keys
file frontend/.../__fixtures__/vav2b1KeysV80.json) -- the v80 file is not read, so this commits before or with the asset.
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_vav2b1_v80_keys
"""
import copy
import importlib.util
import json
import os
import sys
import unittest

from nirmaan_stack.services.boq_rate_master import config_validation, extraction

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
APP = os.path.join(HERE, "..", "..", "..")
KEYS_PATH = os.path.join(APP, "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__", "vav2b1KeysV80.json")
VAV, SENS = "hvac_vav_box", "hvac_sensors"
DSP = "Duct Static Pressure Sensor"


def _v79():
    with open(os.path.join(DATA, "rate_master_hvac_all_v79.json"), encoding="utf-8") as f:
        return json.load(f)


def _keys():
    with open(KEYS_PATH, encoding="utf-8") as f:
        return json.load(f)


def _mint():
    d = os.path.join(APP, "scripts", "_instruments")
    if d not in sys.path:
        sys.path.insert(0, d)
    spec = importlib.util.spec_from_file_location("mint_hvac_v80_vav2b1", os.path.join(d, "mint_hvac_v80_vav2b1.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _configs(v80=True):
    a = _v79()
    out = {c["category_id"]: dict(copy.deepcopy(c), discipline="HVAC") for c in a["category_configs"]}
    if v80:
        m, k = _mint(), _keys()
        out[VAV] = dict(m.vav_config(out[VAV], k), discipline="HVAC")
        out[SENS] = dict(m.sensors_config(out[SENS], k), discipline="HVAC")
    return out


def _refused(test, cfg, needle):
    with test.assertRaises(Exception) as cm:
        config_validation._validate_config(cfg)
    test.assertIn(needle, str(cm.exception))


class TestVav2b1V80Keys(unittest.TestCase):
    def test_01_POSITIVE_v80_vav_and_sensors_validate(self):
        c = _configs()
        config_validation._validate_config(c[VAV])
        config_validation._validate_config(c[SENS])
        pr = c[VAV]["list_spec"]["pricing"]
        # owner 01:36 "A": the BACnet controller's full rate is the whole block (sheet_shares.whole), not a plain item
        self.assertEqual([u["family"] for u in pr["user_addable"]], [DSP])
        self.assertEqual([w["key"] for w in pr["sheet_shares"]["whole"]], ["bacnet_whole", "ddc_whole"])
        self.assertEqual(pr["sheet_shares"]["whole"][1]["fixed"], {"panels": 1})
        self.assertIn(DSP, pr["withdrawn_families"])
        self.assertIn(DSP, c[SENS]["list_spec"]["pricing"]["families"])
        self.assertTrue(c[VAV]["calculator_only"])

    def test_02_NEGATIVE_user_addable_shape_refused_by_name(self):
        for bad, needle in (([], "non-empty list"), ([{"family": "VAV box"}], "a withdrawn family"),
                            ([{"family": DSP, "share": "nope"}], "share must name a share"),
                            ([{"family": DSP, "line": "x"}], "with its share"),
                            ([{"family": DSP}, {"family": DSP}], "each once")):
            c = _configs()[VAV]
            c["list_spec"]["pricing"]["user_addable"] = bad
            _refused(self, c, needle)

    def test_02b_NEGATIVE_sheet_shares_whole_shape_refused_by_name(self):
        for mut, needle in ((lambda w: w.__setitem__("share", "nope"), "must name a share"),
                            (lambda w: w.__setitem__("key", "bacnet"), "new, unique edit key"),
                            (lambda w: w.__setitem__("prefill_line", "no tokens"), "must name {V}"),
                            (lambda w: w.__setitem__("fixed", {"nope": 1}), "fixed must map parts"),
                            (lambda w: w.__setitem__("count_without_vavs", 0), "positive whole number"),
                            (lambda w: w.pop("label"), "entries need")):
            c = _configs()[VAV]
            mut(c["list_spec"]["pricing"]["sheet_shares"]["whole"][0])
            _refused(self, c, needle)

    def test_02c_the_DDC_own_row_words_leave_an_enclosure_or_plug_top_FOR_a_DDC_controller(self):
        import re
        e = [x for x in _configs()[VAV]["list_spec"]["pricing"]["sheet_shares"]["separate"]["extras"] if x["label"] == "DDC panel row"][0]
        nw = re.compile(e["not_words"], re.I)
        self.assertFalse(nw.search("Supply, Installation, Testing & Commissioning of DDC Controller with I/O module etc. as per the technical specification"))
        self.assertTrue(nw.search("Supply, Installation, Testing & Commissioning of Enclosure for DDC Controller & other accessories as per the technical s"))
        self.assertTrue(nw.search("Supply and installation of Plug tops for each VAV's and DDC Panels"))
        # VACUITY: v79's words did not leave them
        e79 = [x for x in _configs(False)[VAV]["list_spec"]["pricing"]["sheet_shares"]["separate"]["extras"] if x["label"] == "DDC panel row"][0]
        self.assertFalse(re.search(e79["not_words"], "Supply, Installation, Testing & Commissioning of Enclosure for DDC Controller & other accessories", re.I))

    def test_03_the_not_box_row_line_is_optional_and_must_be_a_sentence(self):
        c = _configs()[VAV]
        del c["list_spec"]["pricing"]["sheet_shares"]["lines"]["not_box_row"]
        config_validation._validate_config(c)
        c["list_spec"]["pricing"]["sheet_shares"]["lines"]["not_box_row"] = ""
        with self.assertRaises(Exception):
            config_validation._validate_config(c)

    def test_04_C2_every_model_request_v79_vs_v80_byte_identical_but_sensors_own_by_its_one_value(self):
        b, n = _configs(False), _configs(True)
        cb = {("HVAC", k): v for k, v in b.items()}
        cn = {("HVAC", k): v for k, v in n.items()}
        rq = lambda cs, cf: {k: json.dumps(extraction.build_items_spec(cf[("HVAC", k)], cf, "HVAC"), sort_keys=True) for k in cs if cs[k].get("list_spec")}
        rb, rn = rq(b, cb), rq(n, cn)
        self.assertEqual(sorted(k for k in rb if rb[k] != rn[k]), [SENS])
        self.assertEqual(rb[VAV], rn[VAV])   # the VAV request -- its sensors part included -- does not ask for the Duct Static Pressure Sensor
        self.assertNotIn(DSP, rn[VAV])
        s = json.loads(rn[SENS])
        for d in s["attribute_definitions"]:
            if d["id"] == s["family_attribute_id"]:
                d["values"].remove(DSP)
        self.assertEqual(json.dumps(s, sort_keys=True), rb[SENS])
        # VACUITY: without user_addable the section WOULD ask for it
        n2 = copy.deepcopy(n)
        del n2[VAV]["list_spec"]["pricing"]["user_addable"]
        cn2 = {("HVAC", k): v for k, v in n2.items()}
        self.assertIn(DSP, json.dumps(extraction.build_items_spec(cn2[("HVAC", VAV)], cn2, "HVAC")))

    def test_05_the_borrowers_of_sensors_are_VAV_alone_and_none_other_gains_the_sensor(self):
        b, n = _configs(False), _configs(True)
        borrows = lambda cs: sorted(k for k, c in cs.items() if any(isinstance(s, dict) and s.get("category_id") == SENS
                                                                   for s in ((c.get("list_spec") or {}).get("sections") or [])))
        self.assertEqual(borrows(b), [VAV])
        self.assertEqual(borrows(n), [VAV])
        for k in n:
            if k not in (VAV, SENS):
                self.assertEqual(json.dumps(n[k], sort_keys=True), json.dumps(b[k], sort_keys=True), k)

    def test_06_eligible_set_unchanged_and_VAV_SENS_out(self):
        b, n = _configs(False), _configs(True)
        el = lambda cs: sorted(k for k, c in cs.items() if extraction.config_is_eligible(c, {("HVAC", x): y for x, y in cs.items()}))
        self.assertEqual(el(b), el(n))
        self.assertNotIn(VAV, el(n))
        self.assertNotIn(SENS, el(n))


if __name__ == "__main__":
    unittest.main()
