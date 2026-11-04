"""VRF-2b (2026-11-03) -- HVAC v57 = v56 WITH THE VRF CAPACITY READER, THE UNIT PICKER, THE MISC FOUR AND THE NOTES.

Minted by `scripts/_instruments/mint_hvac_v57_vrf2b.py` (the v56 shape) from v56. The prices and the screen are proved
through the product's own pricer in `frontend/src/pages/pricing/calculatorPanelParity.test.ts` (the VRF-2b block) and
`ruleReachability.test.ts` (R-39); the code, on fixtures, in `vrf2bCapacity.test.ts` and test_rate_master v2b_*. Here the
asset is pinned.

What these tests protect, in plain English (01-07 file-only; 08 reads the loaded catalogue):

  01  ONLY hvac_vrf MOVED: every v56 item byte-for-byte (537: VRF 150, Misc 4, inputs incl. the two VRF ones); every
      other config byte-for-byte; on hvac_vrf only `list_spec`, `impact_examples` and `notes` change; `calculator_only`
      is STILL true (owner Q1 A: removed at VRF-4); the top-level keys are v56's.
  02  THE CAPACITY READER (R-CONV / R-INPUTS / CFM / Q3): `numbers.capacity.units` -- the SKU attribute capacity_unit,
      HP / TR / kW and their words, base TR, the convert table naming vrf_hp_per_tr and vrf_kw_per_tr (both present in the
      catalogue: 1.25 / 3.517), the airflow words and the refusal naming them. NEGATIVE: no other config declares `units`.
  03  THE MISC FOUR (Q2 `extra_kinds`, QR-3 A): extra_kinds [hvac_misc_item]; the weight class (Kg, kg, kgs) beside the
      count class; the four families priced (two per Nos, two per Kg) at the sheet's figures through their pipelines --
      3,500 / 750; 50,000 / 4,500; 1,020 / 350; 140 / 40; each listed in the item definition before "none of these".
      NEGATIVE: no other config reads hvac_misc_item.
  04  THE NOTES: brand `unlisted` (several / off the sheet -> Blue Star, naming the row's words); "Nos/Ro" read as Nos
      with its line; the unit refusal names Kg.
  05  THE SWITCH STILL HOLDS: v57 validates; hvac_vrf's rules run but it is NOT eligible; the eligible set is v56's; every
      other item-list request is byte-identical; no section delegates to hvac_vrf. NEGATIVE: without the key it WOULD be
      eligible.
  06  THE WORKED EXAMPLES (U6 A): two per VRF input, item-list shape (items + unit + inputs), validated.
  07  v57 is the newest HVAC asset; the series is 1..57 with no gap; v56 stays on disk.
  08  LIVE (after the load): the active hvac_vrf config equals v57's and is not eligible; 537 active HVAC items; the
      used-by walk names hvac_vrf for both VRF inputs (10 uses each).
"""
import copy
import json
import math
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, csv_exporter, extraction, loader

V56 = "rate_master_hvac_all_v56.json"
V57 = "rate_master_hvac_all_v57.json"
VRF_KIND, MISC_KIND, INPUT_KIND, CATEGORY = "hvac_vrf_item", "hvac_misc_item", "hvac_pricing_input", "hvac_vrf"
MISC = {"Drain Pump": ("count", 3500, 750), "BACnet Integration Controller for VRF Units": ("count", 50000, 4500),
        "Refrigerant Gas Filling (R-410)": ("weight", 1020, 350), "MS Angle Base Frame Structure": ("weight", 140, 40)}


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _roundup(x):
    return math.ceil(round(x, 9))


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


def _run_steps(steps, rates):
    """The four step kinds the Misc pipelines use, over one SKU's stored rates (the interpreter's own arithmetic is
    proved on the TS side; this is the independent sum the figures are checked against)."""
    comp, val = {}, {}
    for s in steps:
        st = s["step"]
        if st == "component":
            comp[s["name"]] = rates[s["target"]]
        elif st == "sum_components":
            val[s["result"]] = sum(comp.values())
        elif st == "scale":
            val[s["result"]] = val[s["target"]] * (1 + rates[s["params"]["m_from_ctx"]])
        elif st == "roundup":
            val[s["target"]] = _roundup(val[s["target"]])
    return val


class TestVrf2bAssetV57(FrappeTestCase):
    ASSET = V57   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v56 = _read(V56)
        cls.v57 = _read(cls.ASSET)
        cls.cfg = next(c for c in cls.v57["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg56 = next(c for c in cls.v56["category_configs"] if c["category_id"] == CATEGORY)
        cls.pr = cls.cfg["list_spec"]["pricing"]

    def test_01_only_hvac_vrf_moved_and_the_switch_stays(self):
        self.assertEqual([_norm(it) for it in self.v57["items"]], [_norm(it) for it in self.v56["items"]])
        self.assertEqual(len(self.v57["items"]), 537)
        self.assertEqual([c["category_id"] for c in self.v57["category_configs"]], [c["category_id"] for c in self.v56["category_configs"]])
        for a, b in zip(self.v56["category_configs"], self.v57["category_configs"]):
            if a["category_id"] != CATEGORY:
                self.assertEqual(_norm(a), _norm(b), a["category_id"])
        changed = sorted(k for k in set(self.cfg) | set(self.cfg56) if _norm(self.cfg.get(k)) != _norm(self.cfg56.get(k)))
        self.assertEqual(changed, ["impact_examples", "list_spec", "notes"])
        self.assertIs(self.cfg["calculator_only"], True)
        self.assertTrue(self.cfg["notes"].startswith(self.cfg56["notes"]))
        self.assertEqual(list(self.v57.keys()), list(self.v56.keys()))
        self.assertEqual({k: v for k, v in self.v57.items() if k not in ("items", "category_configs")},
                         {k: v for k, v in self.v56.items() if k not in ("items", "category_configs")})

    def test_02_the_capacity_reader(self):
        u = self.pr["numbers"]["capacity"]["units"]
        self.assertEqual(u["unit_attr"], "capacity_unit")
        self.assertEqual(list(u["words"]), ["HP", "TR", "kW"])
        self.assertIn("tons", u["words"]["TR"])
        self.assertEqual(u["base"], "TR")
        self.assertEqual(u["convert"], {"HP": {"input": "vrf_hp_per_tr", "label": "HP per TR"}, "kW": {"input": "vrf_kw_per_tr", "label": "kW per TR"}})
        self.assertEqual(u["refuse_words"][:4], ["cfm", "cmh", "m3/h", "m3/hr"])
        self.assertIn("{said}", u["refuse"])
        factors = {it["attributes"]["item"]: it["rates"].get("factor") for it in self.v57["items"] if it["kind"] == INPUT_KIND}
        self.assertEqual((factors["vrf_hp_per_tr"], factors["vrf_kw_per_tr"]), (1.25, 3.517))
        units = {it["attributes"].get("capacity_unit") for it in self.v57["items"] if it["kind"] == VRF_KIND and "capacity" in it["attributes"]}
        self.assertEqual(units, {"HP", "TR"})
        for c in self.v57["category_configs"]:
            if c["category_id"] != CATEGORY:   # NEGATIVE: no other config's number reader converts units
                nums = (((c.get("list_spec") or {}).get("pricing") or {}).get("numbers") or {})
                self.assertEqual([n for n, rd in nums.items() if isinstance(rd, dict) and "units" in rd], [], c["category_id"])

    def test_03_the_misc_four_at_the_sheets_figures(self):
        self.assertEqual(self.pr["extra_kinds"], [MISC_KIND])
        self.assertEqual(self.pr["unit_classes"]["weight"], ["Kg", "kg", "kgs"])
        self.assertEqual(self.pr["unit_words"], {"count": "Nos", "weight": "Kg"})
        item_def = next(d for d in self.cfg["list_spec"]["attribute_definitions"] if d["id"] == "item")
        self.assertEqual(item_def["values"][-5:], list(MISC) + ["none of these"])
        misc_items = {it["attributes"]["item"]: it for it in self.v57["items"] if it["kind"] == MISC_KIND}
        for fam, (cls, sup, ins) in MISC.items():
            fd = self.pr["families"][fam]
            self.assertEqual((fd["needs"], list(fd["units"])), ([], [cls]), fam)
            pls = fd["units"][cls]["pipelines"]
            for p in pls.values():
                self.assertEqual(p["steps"][0], {"step": "match_master_row", "params": {"kind": MISC_KIND}, "explain": p["steps"][0]["explain"]})
            rates = misc_items[fam]["rates"]
            self.assertEqual((_run_steps(pls["supply"]["steps"], rates)["supply"], _run_steps(pls["install"]["steps"], rates)["install"]), (sup, ins), fam)
            self.assertEqual(misc_items[fam]["unit"], {"count": "Nos", "weight": "Kg"}[cls])
        for c in self.v57["category_configs"]:
            if c["category_id"] != CATEGORY:
                self.assertNotIn(MISC_KIND, json.dumps(c), c["category_id"])

    def test_04_the_notes(self):
        self.assertEqual(self.pr["defaults"]["brand"]["unlisted"], {
            "several": "several brands stated ({said}) - priced as Blue Star",
            "off_sheet": "brand {said} is not on the sheet - priced as Blue Star"})
        self.assertEqual(self.pr["unit_lines"], {"Nos/Ro": "unit 'Nos/Ro' read as Nos"})
        self.assertIn("Nos/Ro", self.pr["unit_classes"]["count"])
        self.assertIn("per Nos or per Kg", self.pr["unit_refusal"])

    def test_05_the_switch_still_holds(self):
        loader._validate_items(self.v57["items"])
        req, elig = {}, {}
        for name, payload in (("v56", self.v56), ("v57", self.v57)):
            cfgs = _stored(payload)
            for c in cfgs.values():
                config_validation._validate_config(c)
            elig[name] = sorted(k[1] for k, c in cfgs.items() if extraction.config_is_eligible(c, cfgs))
            req[name] = {k[1]: _norm(extraction.build_items_spec(c, cfgs, "HVAC")) for k, c in cfgs.items()
                         if c.get("list_spec") and k[1] != CATEGORY}
        self.assertEqual(elig["v57"], elig["v56"])
        self.assertNotIn(CATEGORY, elig["v57"])
        self.assertEqual(req["v57"], req["v56"])
        cfgs = _stored(self.v57)
        vrf = cfgs[("HVAC", CATEGORY)]
        self.assertTrue(extraction.has_runnable_pricing_rules(vrf))
        self.assertEqual([c["category_id"] for c in self.v57["category_configs"] for s in ((c.get("list_spec") or {}).get("sections") or [])
                          if isinstance(s, dict) and s.get("category_id") == CATEGORY], [])
        off = dict(vrf); off.pop("calculator_only")
        cfgs2 = dict(cfgs); cfgs2[("HVAC", CATEGORY)] = off
        self.assertTrue(extraction.config_is_eligible(off, cfgs2))      # NEGATIVE: the key is what holds it back

    def test_06_the_worked_examples(self):
        ex = self.cfg["impact_examples"]
        self.assertEqual([e["id"] for e in ex], ["VRF-1", "VRF-2", "VRF-3", "VRF-4"])
        self.assertEqual([e["inputs"] for e in ex], [["vrf_hp_per_tr"], ["vrf_hp_per_tr"], ["vrf_kw_per_tr"], ["vrf_kw_per_tr"]])
        self.assertEqual({e["unit"] for e in ex}, {"Nos"})
        self.assertEqual([e["items"][0]["capacity"] for e in ex], ["16 TR", "4 HP", "5 kW", "45 kW"])
        bad = copy.deepcopy(dict(self.cfg, discipline="HVAC"))
        bad["impact_examples"][0]["items"][0]["no_such"] = "x"
        with self.assertRaises(Exception):
            config_validation._validate_config(bad)

    def test_07_v57_is_the_newest_and_v56_stays(self):
        d = os.path.dirname(_asset_path(V57))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # INVERTED at VRF-3a (HVAC v58; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 57)`
        self.assertEqual(max(ns), 58)
        # INVERTED at VRF-3a (HVAC v58; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 58)))`
        self.assertEqual(sorted(ns), list(range(1, 59)))
        self.assertTrue(os.path.exists(_asset_path(V56)))
        # INVERTED at VRF-3a (HVAC v58; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v58.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v58.json")))
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v59.json")))

    def test_08_live_the_loaded_vrf_config_is_v57s(self):
        rows = frappe.get_all("BoQ Rate Category Config", filters={"discipline": "HVAC", "active": 1}, fields=["category_id", "config"])
        live = {r["category_id"]: (json.loads(r["config"]) if isinstance(r["config"], str) else r["config"]) for r in rows}
        cfg = live[CATEGORY]
        self.assertIs(cfg.get("calculator_only"), True)
        # INVERTED at VRF-3a (HVAC v58 loaded; a test failing solely because the live catalogue moved to the current asset) by
        # mechanical authority: BEFORE `self.assertEqual(_norm(cfg.get("list_spec")), _norm(self.cfg["list_spec"]))` (live == v57).
        # The live list_spec is v58's -- v57's plus the VRF-3a pricing keys (test_vrf_v58 07 pins it whole); v57's impact
        # examples, and every claim below, stand.
        with open(_asset_path("rate_master_hvac_all_v58.json"), "r", encoding="utf-8") as fh:
            v58cfg = next(c for c in json.load(fh)["category_configs"] if c["category_id"] == CATEGORY)
        self.assertEqual(_norm(cfg.get("list_spec")), _norm(v58cfg["list_spec"]))
        self.assertNotEqual(_norm(cfg.get("list_spec")), _norm(self.cfg["list_spec"]))
        self.assertEqual(_norm(cfg.get("impact_examples")), _norm(self.cfg["impact_examples"]))
        cfgs = {("HVAC", cid): dict(c, discipline="HVAC") for cid, c in live.items()}
        self.assertFalse(extraction.config_is_eligible(cfgs[("HVAC", CATEGORY)], cfgs))
        self.assertEqual(frappe.db.count("BoQ Rate Master Item", {"discipline": "HVAC", "active": 1}), 537)
        used = csv_exporter.pricing_input_used_by(live)
        self.assertEqual(used["vrf_hp_per_tr"], (10, [CATEGORY]))
        self.assertEqual(used["vrf_kw_per_tr"], (10, [CATEGORY]))
