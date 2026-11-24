"""VAV-1 (2026-11-19) -- HVAC v76 = v75 + THE VAV BOX PRICE SHEET (VAV-D0 design; owner rulings 2026-11-18 22:16 - 2026-11-19 01:39).
Minted by `scripts/_instruments/mint_hvac_v76_vav1.py` (the VAV Box tab read from the 2 Nov workbook; its lines pinned in
frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vav1VavBoxTab.json).

  01  v76 IS the mint's own transformation of v75: + hvac_vav_box, + hvac_sensors (borrow-only), hvac_misc + 2 families; every v75 item
      and every other v75 config byte-identical, in order; the 96 new items appended; NEGATIVE: one character.
  02  THE ITEMS: 91 VAV items (86 tab lines with the CLEAN BCS of the fixture + the 5 owner SKUs), 2 Misc (Misc 22 -> 24), 2 Sensors,
      the installation-only uplift input = 0; 'AHRI Certified' spelled right; no figure of the five borrowed items in VAV.
  03  THE QUESTION: every v75 category's item-list request is byte-identical (Valve Package and Ducting borrow Misc offered-only); only
      Misc's OWN request changes, and Misc is never asked (not eligible).
  04  VALIDATES; B3: neither VAV Box nor Sensors nor Misc is eligible for extraction (a VAV-filed row is not sent to Suggest).
  05  v76 is the newest; the series 1..76 has no gap.
  06  LIVE (after the load): the active VAV Box / Sensors / Misc configs equal v76's; 840 active HVAC items; the uplift input = 0.
Run: bench --site localhost run-tests --module nirmaan_stack.api.boq.test_hvac_v76_vav1
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

PREV = "rate_master_hvac_all_v75.json"   # the previous asset
CUR = "rate_master_hvac_all_v76.json"    # this asset
VAV, SENS, MISC = "hvac_vav_box", "hvac_sensors", "hvac_misc"
UPLIFT = "vav_install_only_uplift"
FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "boq-wizard", "rate-helper",
                       "__fixtures__", "vav1VavBoxTab.json")


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(_asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _mint():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts", "_instruments", "mint_hvac_v76_vav1.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v76_vav1", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


class TestHvacAssetV76(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.prev = _read(PREV)
        cls.cur = _read(CUR)
        cls.mint = _mint()
        cls.cfg_prev = {c["category_id"]: c for c in cls.prev["category_configs"]}
        cls.cfg = {c["category_id"]: c for c in cls.cur["category_configs"]}
        cls.new = cls.cur["items"][len(cls.prev["items"]):]
        with open(FIXTURE, encoding="utf-8") as fh:
            cls.tab = json.load(fh)
        cls.mode = "calculator_only" if cls.cfg[VAV].get("calculator_only") is True else ("catalogue" if not cls.cfg[VAV]["attribute_definitions"] else "live")

    def test_01_only_the_declared_changes(self):
        final = copy.deepcopy(self.prev)
        idx = {c["category_id"]: n for n, c in enumerate(final["category_configs"])}
        final["category_configs"][idx[MISC]] = self.mint.misc_config(self.prev["category_configs"][idx[MISC]])
        final["category_configs"] += [self.mint.vav_config(self.mode), self.mint.sensors_config(self.prev["category_configs"][idx[MISC]])]
        final["items"] += self.new
        self.assertEqual(_norm(self.cur), _norm(final))
        self.assertEqual(_norm(self.cur["items"][:len(self.prev["items"])]), _norm(self.prev["items"]))
        for cid, a in self.cfg_prev.items():
            if cid != MISC:
                self.assertEqual(_norm(a), _norm(self.cfg[cid]), cid)
        self.assertEqual([c["category_id"] for c in self.cur["category_configs"]][-2:], [VAV, SENS])
        bad = copy.deepcopy(self.cur)
        bad["items"][-1]["rates"]["factor"] = 0.01
        self.assertNotEqual(_norm(bad), _norm(final))

    def test_02_the_items(self):
        kinds = [i["kind"] for i in self.new]
        self.assertEqual((kinds.count("hvac_vav_item"), kinds.count("hvac_misc_item"), kinds.count("hvac_sensor_item"), kinds.count("hvac_pricing_input")),
                         (91, 2, 2, 1))
        self.assertEqual(len(self.cur["items"]), 840)
        vav = [i for i in self.new if i["kind"] == "hvac_vav_item"]
        by_row = {i["source"]["row"]: i for i in vav if i["source"]["row"]}
        self.assertEqual(sorted(by_row), list(range(2, 88)))
        for r in self.tab["vav_box_tab"]:
            it = by_row[r["row"]]
            self.assertEqual(it["rates"], {"cost_supply": round(r["bcs_supply"], 6), "supply_markup": 0.4,
                                           "cost_install": round(r["bcs_install"], 6), "install_markup": 0.6}, r["row"])
            self.assertTrue(float(it["rates"]["cost_supply"]).is_integer(), r["row"])
        new_skus = {i["attributes"]["vav_item"]: (i["rates"]["cost_supply"], i["rates"]["cost_install"], i["unit"]) for i in vav if not i["source"]["row"]}
        self.assertEqual(new_skus, {"BACnet over IP controller": (33000.0, 2000.0, "Nos"), "Duct connection": (1200.0, 0.0, "Nos"),
                                    "Conical piece": (1200.0, 0.0, "Nos"), "Integrator cabling": (140.0, 0.0, "Mtr"),
                                    "VAV installation - any size": (0.0, 1500.0, "Nos")})
        self.assertNotIn("Certfied", json.dumps(vav))
        misc = [i for i in self.cur["items"] if i["kind"] == "hvac_misc_item"]
        self.assertEqual(len(misc), 24)
        self.assertEqual({i["attributes"]["item"]: i["rates"] for i in self.new if i["kind"] == "hvac_misc_item"},
                         {"Digital Thermostat": {"cost_supply": 3000.0, "supply_markup": 0.4, "cost_install": 200.0, "install_markup": 1.5},
                          "Transformation Pieces": {"cost_supply": 800.0, "supply_markup": 0.6, "cost_install": 200.0, "install_markup": 0.25}})
        self.assertEqual({i["attributes"]["sensor"]: i["rates"] for i in self.new if i["kind"] == "hvac_sensor_item"},
                         {"CO2 Sensor": {"cost_supply": 7950.0, "supply_markup": 0.4, "cost_install": 500.0, "install_markup": 0.8},
                          "Differential Pressure Switch": {"cost_supply": 1550.0, "supply_markup": 0.4, "cost_install": 500.0, "install_markup": 0.8}})
        up = self.new[-1]
        self.assertEqual((up["kind"], up["attributes"]["item"], up["rates"]), ("hvac_pricing_input", UPLIFT, {"factor": 0.0}))
        # block 85: no VAV item is one of the five borrowed items, and VAV's pricing holds none of their figures (its Derivation reasons
        # may NAME them: the section lines say where each is priced)
        text = json.dumps(vav)
        for name in ("Digital Thermostat", "Temperature Gauge", "Transformation Pieces", "CO2 Sensor", "Differential Pressure Switch"):
            self.assertNotIn(name, text)
        pricing = json.dumps({k: v for k, v in self.cfg[VAV]["list_spec"]["pricing"].items() if k != "derivation_reasons"})
        for fig in ("3000", "4200", "1450", "2175", "1280", "7950", "11130", "1550", "2170"):
            self.assertIsNone(re.search(r"\b%s(\.0)?\b" % fig, pricing), fig)

    def test_03_the_question(self):
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        changed = []
        for k, c in cfgs_prev.items():
            if c.get("list_spec"):
                if json.dumps(extraction.build_items_spec(cfgs[k], cfgs, "HVAC"), sort_keys=True) != json.dumps(extraction.build_items_spec(c, cfgs_prev, "HVAC"), sort_keys=True):
                    changed.append(k[1])
        self.assertEqual(changed, [MISC])
        self.assertFalse(extraction.config_is_eligible(cfgs[("HVAC", MISC)], cfgs))

    def test_04_validates_and_b3(self):
        stored = list(_stored(self.cur).values())
        # VAV-2b2 K2 (R1, owner 2026-11-19 02:55 "removed in VAV-2b"; ANSWER 28): the frozen v76 VAV config carries calculator_only, now refused
        # by name - every config is validated with the key taken out ON THE COPY, and the VAV config AS IS is refused. BEFORE: validated as is
        for c in stored:
            config_validation._validate_config({k: v for k, v in c.items() if k != "calculator_only"})
        with self.assertRaises(Exception) as cm:
            config_validation._validate_config(_stored(self.cur)[("HVAC", VAV)])
        self.assertIn("Unknown top-level config key(s): calculator_only", str(cm.exception))
        self.assertEqual(config_validation.delegated_section_problems(stored, self.cur["items"]), [])
        self.assertEqual(config_validation.scope_problems(stored, self.cur["items"]), [])
        cfgs, cfgs_prev = _stored(self.cur), _stored(self.prev)
        eligible = sorted(k[1] for k, c in cfgs.items() if extraction.config_is_eligible(c, cfgs))
        # B3: VAV-filed rows stay out of Suggest until VAV-2 (QR-A); Sensors / Misc are borrow-only
        # VAV-2b2 K2 (R1): the switch's code is gone - VAV is eligible; every OTHER category's eligibility is unchanged. BEFORE: eligible == v75's
        # set and VAV not in it
        self.assertEqual([e for e in eligible if e != VAV], sorted(k[1] for k, c in cfgs_prev.items() if extraction.config_is_eligible(c, cfgs_prev)))
        self.assertIn(VAV, eligible)
        for cid in (SENS, MISC):
            self.assertNotIn(cid, eligible)
        s = self.cfg[SENS]
        self.assertEqual((s["attribute_definitions"], s["pipelines"], s["list_spec"]["borrowers_ask_offered_only"], s["list_spec"]["family_attribute_id"]),
                         ([], {}, True, "sensor"))
        self.assertIs(self.cfg[VAV]["list_spec"]["borrowers_ask_offered_only"], True)
        for cid in (VAV, SENS, MISC):
            self.assertIs(self.cfg[cid]["list_spec"]["second_opinion"], False, cid)

    def test_05_v76_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(CUR))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 84)  # VAV-2c3 K2 (HVAC v84 minted + loaded; mechanical authority; PIN K2-A): BEFORE nums[-1] == 83; VAV-2c2 K2 (HVAC v83 minted + loaded; mechanical authority; PIN K2-A, ANSWER 24): BEFORE nums[-1] == 82; VAV-2c1 K2 (HVAC v82 minted + loaded; mechanical authority; PIN K2-C, ANSWER 29): BEFORE nums[-1] == 81; VAV-2b2 K2 (HVAC v81 minted + loaded; mechanical authority): BEFORE nums[-1] == 80; VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE nums[-1] == 79; VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE nums[-1] == 78; VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE nums[-1] == 77; VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE nums[-1] == 76
        self.assertEqual(nums, list(range(1, 85)))  # VAV-2c3 K2 (HVAC v84 minted + loaded; mechanical authority; PIN K2-A): BEFORE list(range(1, 84)); VAV-2c2 K2 (HVAC v83 minted + loaded; mechanical authority; PIN K2-A, ANSWER 24): BEFORE list(range(1, 83)); VAV-2c1 K2 (HVAC v82 minted + loaded; mechanical authority; PIN K2-C, ANSWER 29): BEFORE list(range(1, 82)); VAV-2b2 K2 (HVAC v81 minted + loaded; mechanical authority): BEFORE list(range(1, 81)); VAV-2b1 K2 (HVAC v80 minted + loaded; mechanical authority): BEFORE list(range(1, 80)); VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE list(range(1, 79)); VAV-2a2 K2 (HVAC v78 minted + loaded; mechanical authority): BEFORE list(range(1, 78)); VAV-2a K2 (HVAC v77 minted + loaded; mechanical authority): BEFORE list(range(1, 77))

    def test_06_live_catalogue_is_v76(self):
        # VAV-2a K2 (HVAC v77 LOADED; mechanical authority): the live VAV config is v77's (v76 + the VAV-2a keys); Sensors and Misc are
        # still v76's byte for byte. BEFORE: every one of the three compared with v76's config.
        # VAV-2a2 K2 (HVAC v78 LOADED; mechanical authority): the live VAV config is v78's (band_from, source_tags, the shape default, the BACnet serves reading);
        # Sensors and Misc still v76's. BEFORE: the VAV config compared with v77's
        # VAV-2b1 K2 (HVAC v79 LOADED; mechanical authority; PIN 19, ANSWER 33): the live VAV config is the NEWEST file's (sheet_shares,
        # withdrawn_families, zero_rows, lower_limit, heading); Sensors and Misc still v76's. BEFORE: the VAV config compared with v78's
        # VAV-2b1 K2 (HVAC v80 LOADED; PIN 26, the hvac_sensors identity line, ANSWER 46): the live VAV AND Sensors configs are the NEWEST file's
        # (v80 adds the Duct Static Pressure Sensor family to Sensors); Misc still v76's byte for byte. BEFORE: line opened v79's file, the
        # VAV config compared with it, Sensors and Misc with v76's; the negative half widened: v76's Sensors config != the compared file's
        # VAV-2b2 K2 (HVAC v81 LOADED; mechanical authority): the live VAV and Sensors configs are the NEWEST file's (v81); Misc still v76's byte
        # for byte. BEFORE: the line opened v80's file
        with open(_asset_path("rate_master_hvac_all_v81.json"), "r", encoding="utf-8") as fh:
            v77 = {c["category_id"]: c for c in json.load(fh)["category_configs"]}
        for cid in (VAV, SENS, MISC):
            row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", cid))
            self.assertTrue(row, cid)
            live = as_v81(json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0], cid)   # VAV-2c1 K2 (HVAC v82 LOADED; PIN K2-C C2, ANSWER 29): this slice's text edits undone. BEFORE: as read
            self.assertEqual(_norm(live), _norm(v77[cid] if cid in (VAV, SENS) else self.cfg[cid]), cid)
        self.assertNotEqual(_norm(self.cfg[VAV]), _norm(v77[VAV]))
        self.assertNotEqual(_norm(self.cfg[SENS]), _norm(v77[SENS]))
        # ANSWER 46: the old guarantee in its narrower form -- v80's Sensors with ONLY the Duct Static Pressure Sensor family and its choice
        # value taken out == v76's Sensors byte for byte; the normaliser asserts it removed exactly those (so it cannot pass vacuously)
        s80 = json.loads(json.dumps(v77[SENS]))
        fams = s80["list_spec"]["pricing"]["families"]
        self.assertIn("Duct Static Pressure Sensor", fams)
        del fams["Duct Static Pressure Sensor"]
        fdef = [d for d in s80["list_spec"]["attribute_definitions"] if d["id"] == s80["list_spec"]["family_attribute_id"]][0]
        self.assertEqual(fdef["values"].count("Duct Static Pressure Sensor"), 1)
        fdef["values"].remove("Duct Static Pressure Sensor")
        self.assertEqual(_norm(s80), _norm(self.cfg[SENS]))
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 853)  # VAV-2b1 K2 (HVAC v79 LOADED; mechanical authority): BEFORE 848 (+ the DDC Panel/ Controller, the Duct Static Pressure Sensor, 3 VAV-2b1 Pricing Inputs); VAV-2a K2 (HVAC v77 LOADED; mechanical authority): BEFORE 840 (+ 8 VAV-2a Pricing Inputs)
        f = frappe.db.sql("""select rates from "tabBoQ Rate Master Item" where active=1 and discipline='HVAC' and kind='hvac_pricing_input'
                             and attributes::text like %s""", ('%"' + UPLIFT + '"%',))
        self.assertTrue(f)
        rates = json.loads(f[0][0]) if isinstance(f[0][0], str) else f[0][0]
        self.assertEqual(rates.get("factor"), 0.0)
