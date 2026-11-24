"""DU-3 K2 (2026-11-16) -- HVAC v75 = v74 + THE ONE FIX SLICE FROM THE DU-2 REVIEW (owner rulings 2026-11-16 14:15-16:38; QR-1 18:06; QR-2 /
QR-3 21:19 / 21:29). Minted by `scripts/_instruments/mint_hvac_v75_du3.py`.

  01  v75 IS the mint's own transformation of v74: + the threshold Pricing Input; hvac_ducting and hvac_valve_package changed; every other
      item and config equal to v74's; NEGATIVE: one character.
  02  THE QUESTION: every item-list request is byte-identical to v74's (nothing new reaches the model - no re-read needed).
  03  THE DECLARED LINES: the code rules (= frontend CODE_RULES) each with a line and a reason; sheet_insulation is the R1 shape (the G-3
      keys retired); the Valve Package changes only its pair_note.
  04  VALIDATES (+ the threshold input exists); the eligible set = v74's.   05  v75 is the newest; the series 1..75 has no gap.
  06  LIVE (after the load): the active Ducting and Valve Package configs equal v75's; 744 active HVAC items; the threshold = 0.9.
Run: bench --site localhost run-tests --module nirmaan_stack.api.boq.test_hvac_v75_du3
"""
import copy
import importlib.util
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader
from nirmaan_stack.services.boq_rate_master.vav2c1_undo_support import as_v81

PREV = "rate_master_hvac_all_v74.json"   # the previous asset
CUR = "rate_master_hvac_all_v75.json"    # this asset
DUCT, VALVE = "hvac_ducting", "hvac_valve_package"
THRESHOLD = "ducting_insulation_coverage_threshold"
# = frontend derivationCoverage CODE_RULES.hvac_duct_item (G3 became R1; DU-3 adds the last four)
DUCT_CODE_RULES = ["DR3", "DR12", "DR4", "DR2", "DR7", "R1", "G1", "DR14", "O10", "R-NOTE-ORDER", "R-PIR", "R-LABOUR",
                   "R-GAUGE-FORMS", "R-OWN-BAND", "R-LABOUR-GAUGE", "R-REVERSE-PAIR"]


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(_asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _mint():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts", "_instruments", "mint_hvac_v75_du3.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v75_du3", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestHvacAssetV75(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.prev = _read(PREV)
        cls.cur = _read(CUR)
        cls.mint = _mint()
        cls.cfg_prev = {c["category_id"]: c for c in cls.prev["category_configs"]}
        cls.cfg = {c["category_id"]: c for c in cls.cur["category_configs"]}

    def test_01_only_the_declared_changes(self):
        final = copy.deepcopy(self.prev)
        idx = {c["category_id"]: n for n, c in enumerate(final["category_configs"])}
        final["category_configs"][idx[DUCT]] = self.mint.ducting_config(self.prev["category_configs"][idx[DUCT]])
        final["category_configs"][idx[VALVE]] = self.mint.valve_config(self.prev["category_configs"][idx[VALVE]])
        final["items"].append(self.cur["items"][-1])
        self.assertEqual(_norm(self.cur), _norm(final))
        self.assertEqual(_norm(self.cur["items"][:-1]), _norm(self.prev["items"]))
        new = self.cur["items"][-1]
        self.assertEqual((new["kind"], new["attributes"]["item"], new["rates"]), ("hvac_pricing_input", THRESHOLD, {"factor": 0.9}))
        for cid, a in self.cfg_prev.items():
            if cid not in (DUCT, VALVE):
                self.assertEqual(_norm(a), _norm(self.cfg[cid]), cid)
        bad = copy.deepcopy(self.cur)
        {c["category_id"]: c for c in bad["category_configs"]}[DUCT]["list_spec"]["pricing"]["sheet_insulation"]["lines"]["covered"] += "x"
        self.assertNotEqual(_norm(bad), _norm(final))

    def test_02_the_question(self):
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        for k, c in cfgs_prev.items():
            if c.get("list_spec"):
                self.assertEqual(json.dumps(extraction.build_items_spec(cfgs[k], cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(c, cfgs_prev, "HVAC"), sort_keys=True), k)

    def test_03_the_declared_lines(self):
        pr = self.cfg[DUCT]["list_spec"]["pricing"]
        self.assertEqual([r["rule"] for r in pr["rule_lines"]], DUCT_CODE_RULES)
        reasons = {r.get("rule") for r in pr["derivation_reasons"] if r.get("rule")}
        self.assertTrue(set(DUCT_CODE_RULES) <= reasons, set(DUCT_CODE_RULES) - reasons)
        titles = {r.get("title") for r in pr["derivation_reasons"] if r.get("title")}
        self.assertTrue({"^A row whose own words name painting", "^A double-skin duct row", "^A GI duct the BoQ calls fire rated",
                         "^Extra insulation asked only on part of the duct length", "^A duct row naming two insulations", "^A heading naming aluminium"} <= titles)
        si = pr["sheet_insulation"]
        self.assertEqual(si["threshold_input"], THRESHOLD)
        for retired in ("acoustic_words", "doubtful_heading_words", "mode", "high", "low"):
            self.assertNotIn(retired, si)
        self.assertNotIn("G3", reasons)
        # the Valve Package: ONLY its scope's pair_note (QR-1 Q7 (a))
        v_prev, v_cur = copy.deepcopy(self.cfg_prev[VALVE]), copy.deepcopy(self.cfg[VALVE])
        self.assertTrue(v_cur["list_spec"]["pricing"]["scope"]["supply_row"].pop("pair_note").startswith("Installation not priced in this row"))
        self.assertEqual(_norm(v_prev), _norm(v_cur))
        self.assertIs(self.cfg[DUCT]["list_spec"]["second_opinion"], False)
        self.assertIs(self.cfg[VALVE]["list_spec"]["second_opinion"], False)

    def test_04_validates_eligible(self):
        stored = list(_stored(self.cur).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.cur["items"]), [])
        self.assertEqual(config_validation.scope_problems(stored, self.cur["items"]), [])
        self.assertIn(THRESHOLD, config_validation.extras_input_ids(self.cfg[DUCT]))
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        self.assertEqual(sorted(k[1] for k, c in cfgs.items() if extraction.config_is_eligible(c, cfgs)),
                         sorted(k[1] for k, c in cfgs_prev.items() if extraction.config_is_eligible(c, cfgs_prev)))

    def test_05_v75_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(CUR))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 85)  # VAV-2c3 FIX (HVAC v85 minted + loaded; mechanical authority; PIN FIX-A): BEFORE nums[-1] == 84; VAV-2c3 K2 (HVAC v84 minted + loaded; mechanical authority; PIN K2-A): BEFORE nums[-1] == 83; VAV-2c2 K2 (HVAC v83 minted + loaded; mechanical authority; PIN K2-A, ANSWER 24): BEFORE nums[-1] == 82; VAV-2c1 K2 (HVAC v82 minted + loaded; mechanical authority; PIN K2-C, ANSWER 29): BEFORE nums[-1] == 81; VAV-2b2 K2 (HVAC v81 minted + loaded; mechanical authority): BEFORE nums[-1] == 80; VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE nums[-1] == 79; VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE nums[-1] == 78; VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE nums[-1] == 77; VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE nums[-1] == 76; VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE nums[-1] == 75
        self.assertEqual(nums, list(range(1, 86)))  # VAV-2c3 FIX (HVAC v85 minted + loaded; mechanical authority; PIN FIX-A): BEFORE list(range(1, 85)); VAV-2c3 K2 (HVAC v84 minted + loaded; mechanical authority; PIN K2-A): BEFORE list(range(1, 84)); VAV-2c2 K2 (HVAC v83 minted + loaded; mechanical authority; PIN K2-A, ANSWER 24): BEFORE list(range(1, 83)); VAV-2c1 K2 (HVAC v82 minted + loaded; mechanical authority; PIN K2-C, ANSWER 29): BEFORE list(range(1, 82)); VAV-2b2 K2 (HVAC v81 minted + loaded; mechanical authority): BEFORE list(range(1, 81)); VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE list(range(1, 80)); VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE list(range(1, 79)); VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE list(range(1, 78)); VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE list(range(1, 77)); VAV-1 K2 (HVAC v76 minted + loaded; mechanical authority): BEFORE list(range(1, 76))
        self.assertTrue(os.path.exists(_asset_path(PREV)))

    def test_06_live_catalogue_is_v75(self):
        # VAV-2a2 K2 (HVAC v78 LOADED; mechanical authority): the live Valve Package config is v78's (the E13 thermowell line, the two VR9 tags out; owner QR-V (a));
        # Ducting is still v75's byte for byte. BEFORE: both compared with v75's config
        with open(_asset_path("rate_master_hvac_all_v78.json"), "r", encoding="utf-8") as fh:
            v78 = {c["category_id"]: c for c in json.load(fh)["category_configs"]}
        self.assertNotEqual(_norm(self.cfg[VALVE]), _norm(v78[VALVE]))
        for cid in (DUCT, VALVE):
            row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", cid))
            self.assertTrue(row, cid)
            live = as_v81(json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0], cid)   # VAV-2c1 K2 (HVAC v82 LOADED; PIN K2-C C2, ANSWER 29): this slice's text edits undone. BEFORE: as read
            self.assertEqual(_norm(live), _norm(v78[cid] if cid == VALVE else self.cfg[cid]), cid)
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 853)  # VAV-2b1 K2 (HVAC v79 LOADED; mechanical authority): BEFORE 848 (+ the DDC Panel/ Controller, the Duct Static Pressure Sensor, 3 VAV-2b1 Pricing Inputs); VAV-2a K2 (HVAC v77 LOADED; mechanical authority): BEFORE 840 (+ 8 VAV-2a Pricing Inputs); VAV-1 K2 (HVAC v76 LOADED; mechanical authority): BEFORE 744 (+ 91 VAV, 2 Misc, 2 Sensors, 1 Pricing Input)
        f = frappe.db.sql("""select rates from "tabBoQ Rate Master Item" where active=1 and discipline='HVAC' and kind='hvac_pricing_input'
                             and attributes::text like %s""", ('%"' + THRESHOLD + '"%',))
        self.assertTrue(f)
        rates = json.loads(f[0][0]) if isinstance(f[0][0], str) else f[0][0]
        self.assertEqual(rates.get("factor"), 0.9)
