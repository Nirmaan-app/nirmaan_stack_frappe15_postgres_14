"""VAV-2b2 (2026-11-21) -- THE SERVER HALF of HVAC v81's keys: the reading questions in the VAV model request (B1, the stub proof), the
claims_filed recognition (R16, services/boq_rate_master/vav_claims.py) and its population hook, and the validators of every new key.

FIXTURES, no DB writes: the configs the v81 mint builds (`mint_hvac_v81_vav2b2.vav_config` on the v80 file + the ONE keys file
frontend/.../__fixtures__/vav2b2Keys.json) -- the v81 file is not read, so this commits before or with the asset. The R16 parity rows are
frontend/.../__fixtures__/vav2b2ClaimRows.json (a read-only dump of the 84 VAV sheets; the TS half is vav2b2ClaimsParity.test.ts).
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_vav2b2_keys
"""
import copy
import importlib.util
import json
import os
import sys
import unittest
from unittest import mock

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, vav_claims

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
APP = os.path.join(HERE, "..", "..", "..")
FIX = os.path.join(APP, "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__")
VAV = "hvac_vav_box"


def _v80():
    with open(os.path.join(DATA, "rate_master_hvac_all_v80.json"), encoding="utf-8") as f:
        return json.load(f)


def _keys():
    with open(os.path.join(FIX, "vav2b2Keys.json"), encoding="utf-8") as f:
        return json.load(f)


def _mint():
    d = os.path.join(APP, "scripts", "_instruments")
    if d not in sys.path:
        sys.path.insert(0, d)
    spec = importlib.util.spec_from_file_location("mint_hvac_v81_vav2b2", os.path.join(d, "mint_hvac_v81_vav2b2.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _configs(v81=True):
    out = {c["category_id"]: dict(copy.deepcopy(c), discipline="HVAC") for c in _v80()["category_configs"]}
    if v81:
        out[VAV] = dict(_mint().vav_config(out[VAV], _keys()), discipline="HVAC")
    return out


def _spec(cfgs, cid):
    m = {("HVAC", c["category_id"]): c for c in cfgs.values()}
    return json.dumps(extraction.build_items_spec(m[("HVAC", cid)], m, "HVAC"), sort_keys=True, ensure_ascii=False)


def _refused(test, cfg, needle):
    with test.assertRaises(Exception) as cm:
        config_validation._validate_config(cfg)
    test.assertIn(needle, str(cm.exception))


class TestV81Keys(unittest.TestCase):
    def test_01_v81_vav_config_validates_and_calculator_only_is_gone(self):
        c = _configs()[VAV]
        config_validation._validate_config(c)
        self.assertNotIn("calculator_only", c)
        self.assertIn("calculator_only", _configs(False)[VAV])   # v80 still carries it (NEGATIVE half)

    def test_02_STUB_PROOF_every_other_request_byte_identical_and_vav_asks_the_reading(self):
        a, b = _configs(False), _configs(True)
        for cid, c in a.items():
            if not c.get("list_spec"):
                continue
            same = _spec(a, cid) == _spec(b, cid)
            self.assertEqual(same, cid != VAV, cid)
        spec = json.loads(_spec(b, VAV))
        ids = [d["id"] for d in spec["attribute_definitions"]]
        for q in ("controller_mention", "controller_by_others", "dp_sensor_mention"):
            self.assertIn(q, ids)
        cm = [d for d in spec["attribute_definitions"] if d["id"] == "controller_mention"][0]
        self.assertEqual(cm["values"], ["ddc_inclusive", "ddc", "bacnet", "controller", "none"])
        self.assertIn("FOR CONTROLLING THE VAVs", cm["note"])
        vi = [d for d in spec["attribute_definitions"] if d["id"] == "vav_item"][0]
        self.assertIn("'suitable for duct connections' describes the box - that is NOT a duct connection item", vi["note"])   # R5 (19 Nov 19:06 "9a")
        sens = [s for s in spec["sections"] if s["id"] == "sensors"][0]["items_spec"]["attribute_definitions"][0]
        self.assertIn("answer it in 'DP sensor mentioned'", sens["note"])
        self.assertNotIn("Duct Static Pressure Sensor", sens["values"])   # c2 (user-only) unchanged

    def test_03_eligibility_v81_vav_joins_suggest_v80_not(self):
        # K2 (R1, PIN P81, ANSWER 28): with the switch's code gone the v80 VAV config reads eligible too (a frozen file carrying the key cannot
        # be loaded: the validator refuses it by name). BEFORE: (False, False) for v80
        with self.assertRaises(Exception) as cm:
            config_validation._validate_config(_configs(False)[VAV])
        self.assertIn("Unknown top-level config key(s): calculator_only", str(cm.exception))
        for v81, want in ((False, True), (True, True)):
            cfgs = _configs(v81)
            m = {("HVAC", c["category_id"]): c for c in cfgs.values()}
            self.assertEqual(extraction.config_is_eligible(m[("HVAC", VAV)], m), want)

    def test_04_claims_filed_is_vav_only_and_its_shape_is_checked(self):
        c = _configs()[VAV]
        other = copy.deepcopy(_configs()["hvac_ducting"])
        other["list_spec"]["pricing"]["claims_filed"] = copy.deepcopy(c["list_spec"]["pricing"]["claims_filed"])
        _refused(self, other, "claims_filed is allowed on VAV Box only")
        bad = copy.deepcopy(c)
        next(k for k in bad["list_spec"]["pricing"]["claims_filed"]["kinds"] if "share" in k)["share"] = "nope"   # "A" put two words kinds first
        _refused(self, bad, "kinds share must name a share")
        bad = copy.deepcopy(c)
        bad["list_spec"]["pricing"]["claims_filed"]["note"] = "no placeholders"
        _refused(self, bad, "note must be a sentence carrying {category} and {item}")
        bad = copy.deepcopy(c)
        bad["list_spec"]["pricing"]["claims_filed"]["kinds"][0]["prices"] = {"whole": "nope"}
        _refused(self, bad, "prices.whole must be a key of sheet_shares.whole")

    def test_05_the_new_display_keys_are_validated(self):
        c = _configs()[VAV]
        for path, val, needle in (
                (("add_group", "sections"), ["misc"], "add_group.sections must name two or more"),
                (("family_units_label",), {"Nope": "per VAV"}, "family_units_label must map families"),
                (("combination_warning", "names"), {"intro": "x"}, "combination_warning.names needs exactly"),
                (("sheet_shares", "double_count", "with"), [{"blocks": ["nope"], "families": [], "part": "panels", "line": "x"}], "double_count.with entries"),
                (("sheet_shares", "labels", "cost_word"), "", "labels.cost_word must be a non-empty string")):
            bad = copy.deepcopy(c)
            node = bad["list_spec"]["pricing"]
            for p in path[:-1]:
                node = node[p]
            node[path[-1]] = val
            _refused(self, bad, needle)

    def test_06_not_added_by_validated_and_the_2a_test_present(self):
        """ANSWER 16 (owner 2026-11-21 15:56 "1a 2a 3b"): the BACnet share has the DDC panel row's test; not_added_by's shape is checked."""
        c = _configs()[VAV]
        ss = c["list_spec"]["pricing"]["sheet_shares"]
        self.assertIn(("bacnet", "DDC panel row"), {(e["share"], e["label"]) for e in ss["separate"]["extras"]})
        self.assertEqual([(e["share"], e["label"]) for e in ss["not_added_by"]],
                         [("bacnet", "BACnet controller row"), ("bacnet", "DDC panel row"), ("bacnet", "Touch screen or master controller row"),
                          ("ddc", "DDC panel row"), ("ddc", "Touch screen or master controller row"), ("dp", "Duct static pressure sensor row")])   # + ANSWER 18 3b
        config_validation._validate_config(c)
        for i, patch, needle in (
                (0, {"label": "Nope row"}, "must name a separate-row test of that share"),
                (1, {"line": "{share} {rows}"}, "either line or priced"),
                (1, {"priced": "no placeholders"}, "must name {share}"),
                (2, {"called": [{"words": "(", "name": "x"}]}, "called[0].words")):
            bad = copy.deepcopy(c)
            bad["list_spec"]["pricing"]["sheet_shares"]["not_added_by"][i].update(patch)
            _refused(self, bad, needle)
        other = copy.deepcopy(c)
        other["list_spec"]["pricing"]["sheet_shares"]["not_added_by"] = []
        _refused(self, other, "not_added_by must be a non-empty list")


class TestClaimsRecognition(unittest.TestCase):
    """vav_claims = the Python twin of the client's own-row tests; the fixture's ts_kind came from the TS product functions."""
    @classmethod
    def setUpClass(cls):
        cls.pr = _configs()[VAV]["list_spec"]["pricing"]
        with open(os.path.join(FIX, "vav2b2ClaimRows.json"), encoding="utf-8") as f:
            cls.rows = json.load(f)["rows"]

    def _line(self, r):
        return {"text": r["text"], "unit": r["unit"], "headings": r["headings"]}

    def test_10_PARITY_the_shared_kinds_equal_the_TS_product_tests_on_every_row(self):
        diffs = []
        for r in self.rows:
            k = None
            for s in ("ddc", "bacnet", "dp"):
                if k is None and vav_claims.share_row(self.pr, s, self._line(r)):
                    k = s
            oc = self.pr["own_row_check"]
            if k is None and vav_claims.separate_row(vav_claims._oc_integrator(oc), vav_claims._integrator_extra(oc), self._line(r)):
                k = "integrator"
            for lab, kid in (("Conical piece", "conical"), ("Transformation piece", "transformation")):
                e = [x for x in oc["extras"] if x["label"] == lab][0]
                if k is None and vav_claims.separate_row(oc, e, self._line(r)):
                    k = kid
            if k != r["ts_kind"]:
                diffs.append((r["ref"], k, r["ts_kind"]))
        self.assertEqual(diffs, [])
        self.assertEqual(sum(1 for r in self.rows if r["ts_kind"]), 87)   # 84 + the three touch screen / master controller rows ("A", 15:02)

    def test_11_the_claims_on_every_Misc_Sensors_row_of_the_84_sheets(self):
        got = {r["ref"]: (vav_claims.claim_of(self.pr, self._line(r)) or {}).get("kind") for r in self.rows if r["category"] in ("hvac_misc", "hvac_sensors")}
        want = {r["ref"]: r["claim"] for r in self.rows if r["category"] in ("hvac_misc", "hvac_sensors")}
        self.assertEqual(got, want)
        self.assertEqual(sum(1 for v in got.values() if v), 102)   # 99 + "A" (00012 r258, 00093 r200 / r199); 00098 r70 bacnet -> master_controller

    def test_12_the_owner_ruled_rows(self):
        by = {r["ref"]: r for r in self.rows}
        kind = lambda ref: (vav_claims.claim_of(self.pr, self._line(by[ref])) or {}).get("kind")
        self.assertEqual(kind("BOQ-26-00313|HVAC|202"), "ddc")
        self.assertIsNone(kind("BOQ-26-00313|HVAC|203"))                       # the enclosure (01:31)
        self.assertIsNone(kind("BOQ-26-00020|HVAC_-19TH FLOOR|194"))           # the adaptor (13:40 "4 a")
        self.assertEqual(kind("BOQ-26-00436|HVAC|256"), "integrator_named")    # B1 (13:40)
        self.assertEqual(kind("BOQ-26-00425|OFFICE AIR DISTRIBUTION|139"), "installation")   # B2 (13:40)
        # "A" (owner 14:46 / ANSWER 7 A-1, A-2) replaces B3's "untouched" for the touch screen row: priced as a DDC panel
        self.assertEqual(kind("BOQ-26-00012|HVAC - Low side|258"), "touch_screen_controller")
        self.assertEqual(kind("BOQ-26-00093|4. HVAC - Option 1 (Terrace)|200"), "master_controller")
        self.assertEqual(kind("BOQ-26-00098|VAV|70"), "master_controller")      # A-2: priced as a DDC panel, stays the controller's own row
        self.assertIsNone(kind("BOQ-26-00149|HVAC-BOQ|492"))                   # B3 LAN connectivity

    def test_13_claims_for_sheet_needs_a_VAV_row_and_a_named_category(self):
        line = {"text": "Supply & installation of VAV BACnet controller/ Modbus card for BMS integration.", "unit": "Nos", "headings": []}
        self.assertEqual(vav_claims.claims_for_sheet(self.pr, VAV, {5: line}, {5: "hvac_misc", 6: VAV})[5]["kind"], "bacnet")
        self.assertEqual(vav_claims.claims_for_sheet(self.pr, VAV, {5: line}, {5: "hvac_misc"}), {})          # no VAV row on the sheet
        self.assertEqual(vav_claims.claims_for_sheet(self.pr, VAV, {5: line}, {5: "hvac_panels", 6: VAV}), {})   # not Misc / Sensors
        no_key = copy.deepcopy(self.pr)
        del no_key["claims_filed"]
        self.assertEqual(vav_claims.claims_for_sheet(no_key, VAV, {5: line}, {5: "hvac_misc", 6: VAV}), {})   # KEY ABSENT


class TestPopulationHook(unittest.TestCase):
    """extraction.assemble_population + _filed_claims with the database reads replaced (no DB): a claimed row joins the VAV group with
    its claim keys; an unclaimed Misc row stays out; no claiming config -> exactly the old population."""

    def _run(self, v81):
        cfgs = _configs(v81)
        allc = {("HVAC", c["category_id"]): c for c in cfgs.values()}
        rows = [
            {"excel_row": 1, "node_type": "Line Item", "description": "VAV box 450-800 CFM", "own_notes_raw": None, "anc_headers": ["S", "VAV"]},
            {"excel_row": 2, "node_type": "Line Item", "description": "Supply & installation of VAV BACnet controller/ Modbus card for BMS integration.",
             "own_notes_raw": None, "anc_headers": ["S"]},
            {"excel_row": 3, "node_type": "Line Item", "description": "Supply of MS supports", "own_notes_raw": None, "anc_headers": ["S"]},
        ]
        resolved = {1: (VAV, "HVAC"), 2: ("hvac_misc", "HVAC"), 3: ("hvac_misc", "HVAC")}
        with mock.patch.object(extraction, "build_sheet_context", return_value={"committed_version": 1, "rows": rows}), \
                mock.patch.object(extraction, "_resolved_categories", return_value=resolved), \
                mock.patch.object(extraction, "_rate_editable_excel_rows", return_value={1, 2, 3}), \
                mock.patch.object(extraction, "load_configs_with_alias_targets", return_value=allc), \
                mock.patch.object(extraction.frappe.db, "get_value", return_value="SHEET-1"), \
                mock.patch.object(extraction.frappe, "get_all", return_value=[{"source_row_number": 1, "unit": "Nos"}, {"source_row_number": 2, "unit": "Nos"},
                                                                              {"source_row_number": 3, "unit": "Kg"}]):
            return extraction.assemble_population("BOQ-X", "S")

    def test_20_v81_claims_the_BACnet_row_and_leaves_the_supports_row(self):
        cv, rows = self._run(True)
        by = {r["excel_row"]: r for r in rows}
        self.assertEqual(sorted(by), [1, 2])
        self.assertEqual((by[2]["category_id"], by[2]["claimed_from"], by[2]["claimed_item"], by[2]["claimed_kind"]),
                         (VAV, "hvac_misc", "BACnet controller", "bacnet"))
        self.assertNotIn("claimed_from", by[1])

    def test_21_v80_no_claiming_config_no_VAV_row_either(self):
        cv, rows = self._run(False)
        # K2 (R1, PIN P80, ANSWER 28): the switch's code gone - v80's VAV row is in the population (no claim keys); nothing claims the Misc
        # rows (v80 has no claims_filed). BEFORE: `rows == []` (VAV not eligible)
        self.assertEqual([r["excel_row"] for r in rows], [1])
        self.assertNotIn("claimed_from", rows[0])


if __name__ == "__main__":
    unittest.main()
