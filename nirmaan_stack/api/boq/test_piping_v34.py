"""SLICE 12e-1 -- HVAC v34 = v33 + THE PIPING CATALOGUE (owner rulings 2026-10-09; resume addendum 17:39).

What these tests protect, in plain English:

  TestSlice12e1AssetV34 (file-only, no DB)
    01  v34 is v33 plus Piping and NOTHING else: every v33 item is in v34 unchanged (by item_uid, both
        directions), every v33 config is in v34 unchanged (by category_id), every other top-level key is
        byte-identical. One category at a time (preamble block 17).
    02  the FORTY items are NAMED by family and size, and each carries the sheet's four figures exactly
        (Total BCS Supply, BCS Installation, supply markup, install markup), unit Mts, sheet provenance, a
        unique rmi- uid, the size in the sheet's own spelling and no inch attribute. Counts 13 / 13 / 8 / 6.
        Copper install is a flat 110 at every size (ruling); copper 31.7 carries 110 x (1 + 1.0) = 220.
    03  the two MS links are LIVE declarations in the config's `derived_rates` -- the same mechanism
        Insulation's 176 cells use -- on BOTH cost columns: MS 300 = 2 x MS 150; MS 250 = MS 150 + MS 100
        as a TWO-SOURCE list; and the stored values already satisfy them (what the loader re-checks).
    04  the config is DATA-ONLY: definitions for pipe_type + size_mm, pipelines {}, no list_spec -- so it
        is NOT eligible for pricing or extraction (the panel shows "coming soon", 12e-2 brings the rules).
    05  NEGATIVE: the validator refuses a Piping link that is not flattened (a term reading a derived
        cell) and the recompute refuses a link to a missing base -- a link that cannot be trusted is
        refused, never silently kept.
    06  the CURRENT asset (v35) is the newest HVAC asset on disk (derived from the directory, never a named
        future number).
    07  SLICE 12e-1b (owner 2026-10-10, "kept exactly as per the excel file", ruling option (a)): every one of
        the 40 Piping items carries `attributes.item_name` = its sheet column A text VERBATIM (by sheet row), the
        Piping config declares `item_name` FIRST as a plain choice over the four sheet texts in sheet order
        (label "Item", no attributes_from_spec, no selector / panel flag -- Insulation's `type` shape), and
        v35 differs from v34 by exactly that key and that definition. NEGATIVE: the same check REFUSES a
        Piping item whose name is missing, blank, or not one of the four sheet texts -- no validator in the
        loader checks that an item carries every declared attribute, so this test is the asset check.

  TestSlice12e1LiveLinks (the LIVE site, after the v35 load -- v34's forty rows plus their names)
    live_01  the grid's own write path (`update_rate_master_item`, rates_patch) on MS 150 BCS supply +10
             moves MS 300 by +20 and MS 250 by +10; restoring moves both back -- recorded and restored.
    live_02  the served items (what the Rate Master grid and every pricer reads) carry the 40 Piping rows
             with the sheet's figures, and the two MS rows are the category's only derived cells (stored, never projected).
    live_03  the rate file round trip: the category's own download previews against the live data as
             ZERO changes (the derived cells read as untouched).
"""
import copy
import hashlib
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_master
from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V33 = "rate_master_hvac_all_v33.json"
V34 = "rate_master_hvac_all_v34.json"
V35 = "rate_master_hvac_all_v35.json"   # 12e-1b: v34 + item_name on the 40 Piping items (+ its definition, first)
V36 = "rate_master_hvac_all_v36.json"   # 12e-2: cost_supply = the sheet's BCS Pipe (G); 4 accessories inputs; the item-list Piping config
KIND = "hvac_piping_item"
CATEGORY = "hvac_piping"
INPUT_KIND = "hvac_pricing_input"
# 12e-2 (owner "option b, yes", 2026-10-10): the sheet's BCS Accessories (column H) per family, as FOUR Pricing Inputs
ACCESSORIES = {"Copper": 0.3, "MS": 0.6, "PVC": 0.6, "CPVC": 0.6}
INPUT_IDS = {"Copper": "piping_accessories_copper", "MS": "piping_accessories_ms", "PVC": "piping_accessories_pvc", "CPVC": "piping_accessories_cpvc"}
INPUT_LABELS = {"Copper": "Piping accessories - Copper", "MS": "Piping accessories - MS", "PVC": "Piping accessories - PVC", "CPVC": "Piping accessories - CPVC"}


def _roundup(x):
    import math
    return math.ceil(round(x, 9))

# 12e-1b: the sheet's column A ("Item"), read 2026-10-10 from the same workbook: no merged cell, no blank, no trailing
# space; FOUR distinct texts, one per family, in sheet order. Rows 2-14 copper, 15-27 MS, 28-35 PVC, 36-41 CPVC.
SHEET_ITEM_TEXTS = ["Refrigerant Piping/Copper Piping", "Chilled Water Piping / MS Piping", "PVC Pipe", "CPVC Pipe"]
SHEET_ITEM_BY_ROW = {}
for _row in range(2, 42):
    SHEET_ITEM_BY_ROW[_row] = SHEET_ITEM_TEXTS[0 if _row <= 14 else 1 if _row <= 27 else 2 if _row <= 35 else 3]
ITEM_NAME_DEFINITION = {"id": "item_name", "label": "Item", "type": "choice", "values": SHEET_ITEM_TEXTS}

# The owner's workbook, sheet "Piping", read 2026-10-09 (HVAC_BOQ_BCS PRICING_ Nitesh Edits v3.xlsx, mtime
# 2026-10-08 21:40): (pipe_type, size_mm, Total BCS Supply, BCS Installation, supply markup, install markup).
SHEET = [
    ("Copper", 47.6, 3120.0, 110.0, 0.5, 1.0), ("Copper", 41.3, 2795.0, 110.0, 0.5, 1.0), ("Copper", 38.1, 2587.0, 110.0, 0.5, 1.0),
    ("Copper", 34.9, 2382.0, 110.0, 0.5, 1.0), ("Copper", 31.7, 1950.0, 110.0, 0.5, 1.0), ("Copper", 28.6, 1625.0, 110.0, 0.5, 1.0),
    ("Copper", 25.4, 1495.0, 110.0, 0.5, 1.0), ("Copper", 22.2, 1209.0, 110.0, 0.5, 1.0), ("Copper", 19.1, 1060.0, 110.0, 0.5, 1.0),
    ("Copper", 15.9, 865.0, 110.0, 0.5, 1.0), ("Copper", 12.7, 624.0, 110.0, 0.5, 1.0), ("Copper", 9.5, 286.0, 110.0, 0.5, 1.0),
    ("Copper", 6.4, 260.0, 110.0, 0.5, 1.0),
    ("MS", 300.0, 4480.0, 1200.0, 0.5, 0.4), ("MS", 250.0, 3744.0, 1000.0, 0.5, 0.4), ("MS", 200.0, 3200.0, 800.0, 0.5, 0.4),
    ("MS", 150.0, 2240.0, 600.0, 0.5, 0.4), ("MS", 125.0, 2080.0, 500.0, 0.5, 0.4), ("MS", 100.0, 1504.0, 400.0, 0.5, 0.4),
    ("MS", 80.0, 960.0, 300.0, 0.5, 0.4), ("MS", 65.0, 800.0, 250.0, 0.5, 0.4), ("MS", 50.0, 656.0, 200.0, 0.5, 0.4),
    ("MS", 40.0, 480.0, 150.0, 0.5, 0.4), ("MS", 32.0, 400.0, 125.0, 0.5, 0.4), ("MS", 25.0, 320.0, 100.0, 0.5, 0.4),
    ("MS", 19.0, 304.0, 80.0, 0.5, 0.4),
    ("PVC", 150.0, 808.0, 120.0, 0.5, 0.4), ("PVC", 100.0, 352.0, 100.0, 0.5, 0.4), ("PVC", 75.0, 200.0, 80.0, 0.5, 0.4),
    ("PVC", 65.0, 176.0, 60.0, 0.5, 0.4), ("PVC", 50.0, 168.0, 40.0, 0.5, 0.4), ("PVC", 40.0, 144.0, 30.0, 0.5, 0.4),
    ("PVC", 32.0, 112.0, 20.0, 0.5, 0.4), ("PVC", 25.0, 80.0, 20.0, 0.5, 0.4),
    ("CPVC", 75.0, 512.0, 80.0, 0.5, 0.4), ("CPVC", 65.0, 448.0, 60.0, 0.5, 0.4), ("CPVC", 50.0, 384.0, 40.0, 0.5, 0.4),
    ("CPVC", 40.0, 336.0, 30.0, 0.5, 0.4), ("CPVC", 32.0, 272.0, 20.0, 0.5, 0.4), ("CPVC", 25.0, 160.0, 20.0, 0.5, 0.4),
]
FAMILY_COUNTS = {"Copper": 13, "MS": 13, "PVC": 8, "CPVC": 6}

# 12e-2: the sheet's BCS Pipe (column G) and the two BoQ figures (K BoQ Supply, L BoQ Installation) per row, read
# 2026-10-10 from the same workbook (sheet "Piping", rows 2-41): (pipe_type, size_mm, G, K, L). The BoQ figures are
# what the calculator and the panel must reproduce to the rupee; G is what v36 stores as cost_supply.
SHEET_G_K_L = [
    ("Copper", 47.6, 2400.0, 4680.0, 220.0), ("Copper", 41.3, 2150.0, 4193.0, 220.0), ("Copper", 38.1, 1990.0, 3881.0, 220.0),
    ("Copper", 34.9, 1832.0, 3573.0, 220.0), ("Copper", 31.7, 1500.0, 2925.0, 220.0), ("Copper", 28.6, 1250.0, 2438.0, 220.0),
    ("Copper", 25.4, 1150.0, 2243.0, 220.0), ("Copper", 22.2, 930.0, 1814.0, 220.0), ("Copper", 19.1, 815.0, 1590.0, 220.0),
    ("Copper", 15.9, 665.0, 1298.0, 220.0), ("Copper", 12.7, 480.0, 936.0, 220.0), ("Copper", 9.5, 220.0, 429.0, 220.0),
    ("Copper", 6.4, 200.0, 390.0, 220.0),
    ("MS", 300.0, 2800.0, 6720.0, 1680.0), ("MS", 250.0, 2340.0, 5616.0, 1400.0), ("MS", 200.0, 2000.0, 4800.0, 1120.0),
    ("MS", 150.0, 1400.0, 3360.0, 840.0), ("MS", 125.0, 1300.0, 3120.0, 700.0), ("MS", 100.0, 940.0, 2256.0, 560.0),
    ("MS", 80.0, 600.0, 1440.0, 420.0), ("MS", 65.0, 500.0, 1200.0, 350.0), ("MS", 50.0, 410.0, 984.0, 280.0),
    ("MS", 40.0, 300.0, 720.0, 210.0), ("MS", 32.0, 250.0, 600.0, 175.0), ("MS", 25.0, 200.0, 480.0, 140.0),
    ("MS", 19.0, 190.0, 456.0, 112.0),
    ("PVC", 150.0, 505.0, 1212.0, 168.0), ("PVC", 100.0, 220.0, 528.0, 140.0), ("PVC", 75.0, 125.0, 300.0, 112.0),
    ("PVC", 65.0, 110.0, 264.0, 84.0), ("PVC", 50.0, 105.0, 252.0, 56.0), ("PVC", 40.0, 90.0, 216.0, 42.0),
    ("PVC", 32.0, 70.0, 168.0, 28.0), ("PVC", 25.0, 50.0, 120.0, 28.0),
    ("CPVC", 75.0, 320.0, 768.0, 112.0), ("CPVC", 65.0, 280.0, 672.0, 84.0), ("CPVC", 50.0, 240.0, 576.0, 56.0),
    ("CPVC", 40.0, 210.0, 504.0, 42.0), ("CPVC", 32.0, 170.0, 408.0, 28.0), ("CPVC", 25.0, 100.0, 240.0, 28.0),
]


def _asset_path(filename):
    return os.path.join(os.path.dirname(loader.__file__), "data", filename)


def _read(filename):
    with open(_asset_path(filename), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, default=str)


def _piping(asset):
    return [it for it in asset["items"] if it["kind"] == KIND]


def _by_key(items):
    return {(it["attributes"]["pipe_type"], float(it["attributes"]["size_mm"])): it for it in items}


class TestSlice12e1AssetV34(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v33 = _read(V33)
        cls.v34 = _read(V34)
        cls.v35 = _read(V35)   # 12e-1b: the CURRENT asset; v34 stays read for the v34 -> v35 comparison
        cls.cfg = next(c for c in cls.v35["category_configs"] if c["category_id"] == CATEGORY)

    def test_01_v34_is_v33_plus_piping_and_nothing_else(self):
        # 12e-1b: the current asset is v35 = v34 + item_name; this pin stays the record of the v33 -> v34 mint,
        # so v35 is compared to v34 with the ONE key and the ONE definition normalised (never deleted), and
        # then v35's non-Piping content to v33 exactly as before.
        a34 = {it["item_uid"]: _norm(it) for it in self.v34["items"]}
        b35 = {}
        for it in self.v35["items"]:
            it = copy.deepcopy(it)
            if it["kind"] == KIND:
                self.assertIn("item_name", it["attributes"], "12e-1b: every Piping item carries item_name")
                del it["attributes"]["item_name"]
            b35[it["item_uid"]] = _norm(it)
        self.assertEqual(a34, b35, "v35 minus item_name == v34, item by item, both directions")
        c34 = {c["category_id"]: _norm(c) for c in self.v34["category_configs"]}
        c35 = {}
        for c in self.v35["category_configs"]:
            c = copy.deepcopy(c)
            if c["category_id"] == CATEGORY:
                self.assertEqual(c["attribute_definitions"][0]["id"], "item_name", "12e-1b: the name definition is FIRST")
                c["attribute_definitions"] = c["attribute_definitions"][1:]
            c35[c["category_id"]] = _norm(c)
        self.assertEqual(c34, c35, "v35 minus the item_name definition == v34, config by config")
        for k in set(self.v34) | set(self.v35):
            if k in ("items", "category_configs"):
                continue
            self.assertEqual(_norm(self.v34.get(k)), _norm(self.v35.get(k)), "top-level key %r unchanged v34 -> v35" % k)
        # the 12e-1 record: the current asset is v33 + Piping and nothing else
        a = {it["item_uid"]: _norm(it) for it in self.v33["items"]}
        b = {it["item_uid"]: _norm(it) for it in self.v35["items"] if it["kind"] != KIND}
        self.assertEqual(sorted(a), sorted(b), "every non-Piping uid of v34 is a v33 uid and vice versa")
        self.assertEqual([u for u in a if a[u] != b[u]], [], "every v33 item is carried byte-equal")
        self.assertEqual(len(self.v33["items"]), 335)
        self.assertEqual(len(self.v35["items"]), 375)
        self.assertFalse(any(it["kind"] == KIND for it in self.v33["items"]), "v33 has no Piping item")
        ca = {c["category_id"]: _norm(c) for c in self.v33["category_configs"]}
        cb = {c["category_id"]: _norm(c) for c in self.v35["category_configs"] if c["category_id"] != CATEGORY}
        self.assertEqual(ca, cb, "the nine v33 configs are carried byte-equal; only hvac_piping is new")
        self.assertEqual(len(self.v35["category_configs"]), 10)
        for k in set(self.v33) | set(self.v35):
            if k in ("items", "category_configs"):
                continue
            self.assertEqual(_norm(self.v33.get(k)), _norm(self.v35.get(k)), "top-level key %r unchanged" % k)

    def test_02_the_forty_items_are_named_and_carry_the_sheets_four_figures(self):
        items = _piping(self.v35)
        self.assertEqual(len(items), 40)
        by = _by_key(items)
        self.assertEqual(len(by), 40, "no two items share (family, size)")
        counts = {}
        for fam, size, sup, inst, sm, im in SHEET:
            it = by.get((fam, size))
            self.assertIsNotNone(it, "%s %s is in the asset" % (fam, size))
            self.assertEqual(it["rates"], {"cost_supply": sup, "cost_install": inst, "supply_markup": sm, "install_markup": im},
                             "%s %s carries the sheet's four figures" % (fam, size))
            self.assertEqual(it["unit"], "Mts")
            self.assertIsNone(it["brand"])
            self.assertEqual(it["source"]["sheet"], "Piping")
            self.assertTrue(2 <= it["source"]["row"] <= 41)
            self.assertEqual(sorted(it["attributes"]), ["item_name", "pipe_type", "size_mm"], "no inch attribute, nothing beyond name + type + size (12e-1b: + item_name)")
            self.assertRegex(it["item_uid"], r"^rmi-[0-9a-f]{12}$")
            counts[fam] = counts.get(fam, 0) + 1
        self.assertEqual(counts, FAMILY_COUNTS)
        self.assertEqual(len({it["item_uid"] for it in items}), 40, "uids unique")
        self.assertEqual(len({it["item_uid"] for it in self.v35["items"]}), 375, "unique across the whole asset")
        # the rulings, by name
        self.assertTrue(all(by[("Copper", s)]["rates"]["cost_install"] == 110.0 for s in (6.4, 9.5, 12.7, 15.9, 19.1, 22.2, 25.4, 28.6, 31.7, 34.9, 38.1, 41.3, 47.6)))
        c317 = by[("Copper", 31.7)]["rates"]
        self.assertEqual(c317["cost_install"] * (1 + c317["install_markup"]), 220.0, "copper 31.7 install = 220 (owner), from the sheet's own 110 x (1 + 1.0)")
        self.assertEqual(by[("Copper", 31.7)]["rates"]["cost_supply"], 1950.0)

    def test_03_the_two_ms_links_are_live_declarations_on_both_cost_columns(self):
        by = _by_key(_piping(self.v35))
        uid = lambda size: by[("MS", size)]["item_uid"]
        dr = self.cfg["derived_rates"]
        self.assertEqual(sorted(dr), sorted([uid(300.0), uid(250.0)]), "exactly the two MS rows are derived")
        for key in ("cost_supply", "cost_install"):
            self.assertEqual(dr[uid(300.0)][key], [{"from": {"item_uid": uid(150.0), "rate_key": key}, "multiplier": 2.0, "constant": 0.0}])
            self.assertEqual(dr[uid(250.0)][key], [{"from": {"item_uid": uid(150.0), "rate_key": key}, "multiplier": 1.0, "constant": 0.0},
                                                   {"from": {"item_uid": uid(100.0), "rate_key": key}, "multiplier": 1.0, "constant": 0.0}])
        # the stored figures already satisfy the links -- the loader's post-load check would refuse otherwise
        by_uid = {it["item_uid"]: {"rates": it["rates"]} for it in self.v35["items"]}
        self.assertEqual(config_validation.derived_rate_updates([self.cfg], by_uid), {})
        want = config_validation.recompute_derived_values([self.cfg], by_uid)
        self.assertEqual(want[(uid(300.0), "cost_supply")], 4480.0)
        self.assertEqual(want[(uid(300.0), "cost_install")], 1200.0)
        self.assertEqual(want[(uid(250.0), "cost_supply")], 3744.0)
        self.assertEqual(want[(uid(250.0), "cost_install")], 1000.0)
        config_validation._validate_derived_rates(self.cfg)   # flattened, acyclic, well-shaped

    def test_04_the_config_is_data_only_and_not_eligible(self):
        self.assertEqual(self.cfg["item_kinds"], [KIND])
        self.assertEqual(self.cfg["pipelines"], {})
        self.assertNotIn("list_spec", self.cfg)
        self.assertEqual([d["id"] for d in self.cfg["attribute_definitions"]], ["item_name", "pipe_type", "size_mm"])   # 12e-1b: the name, FIRST
        self.assertEqual(self.cfg["attribute_definitions"][1]["values"], ["Copper", "MS", "PVC", "CPVC"])
        sizes = sorted({float(it["attributes"]["size_mm"]) for it in _piping(self.v35)})
        self.assertEqual(self.cfg["attribute_definitions"][2]["values"], sizes, "the size vocabulary is exactly the 27 stocked sizes")
        self.assertFalse(extraction.has_runnable_pricing_rules(self.cfg))
        configs = {c["category_id"]: c for c in self.v35["category_configs"]}
        self.assertFalse(extraction.config_is_eligible(self.cfg, configs), "never priced on a BoQ row, never extracted")
        config_validation._validate_config(dict(self.cfg, discipline="HVAC"))
        self.assertNotIn("helper_message", self.cfg, "no message of its own: the panel shows the generic coming-soon card")

    def test_05_NEGATIVE_an_unflattened_or_dangling_link_is_refused(self):
        by = _by_key(_piping(self.v35))
        uid = lambda size: by[("MS", size)]["item_uid"]
        bad = copy.deepcopy(self.cfg)
        # MS 250 reading MS 300 (itself derived) -- not flattened
        bad["derived_rates"][uid(250.0)]["cost_supply"] = [{"from": {"item_uid": uid(300.0), "rate_key": "cost_supply"}, "multiplier": 0.5, "constant": 0.0}]
        with self.assertRaises(frappe.ValidationError):
            config_validation._validate_derived_rates(bad)
        # a link to a base that does not exist
        dangling = copy.deepcopy(self.cfg)
        dangling["derived_rates"][uid(300.0)]["cost_supply"] = [{"from": {"item_uid": "rmi-000000000000", "rate_key": "cost_supply"}, "multiplier": 2.0, "constant": 0.0}]
        by_uid = {it["item_uid"]: {"rates": it["rates"]} for it in self.v35["items"]}
        with self.assertRaises(config_validation.DerivedRateError):
            config_validation.recompute_derived_values([dangling], by_uid)

    def test_06_v34_is_the_newest_hvac_asset_on_disk(self):
        # 12e-1b: INVERTED under mechanical authority -- v35 (v34 + item_name) is now the newest; v34 stays on disk
        d = os.path.dirname(_asset_path(V35))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        self.assertNotEqual(max(ns), 34, "12e-1b: v34 is no longer the newest")
        # 12e-2: INVERTED again under mechanical authority -- v36 (the Piping prices) is the newest; v35 stays on disk
        self.assertNotEqual(max(ns), 35, "12e-2: v35 is no longer the newest")
        # 12e-3a: INVERTED again under mechanical authority -- v37 (the Insulation section on Piping) is the newest;
        # BEFORE: self.assertEqual(max(ns), 36)
        self.assertNotEqual(max(ns), 36, "12e-3a: v36 is no longer the newest")
        # 12e-4b: INVERTED again under mechanical authority -- v38 (what a Piping row is asked) is the newest.
        # BEFORE: self.assertEqual(max(ns), 37)
        self.assertNotEqual(max(ns), 37, "12e-4b: v37 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 38)
        self.assertNotEqual(max(ns), 38, "12e-5b: v38 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 39)
        self.assertNotEqual(max(ns), 39, "12e-5b C3: v39 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 40)
        self.assertNotEqual(max(ns), 40, "12e-5b2: v40 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 41)
        self.assertNotEqual(max(ns), 41, "12e-5c: v41 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 42)
        self.assertNotEqual(max(ns), 42, "12e-6: v42 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 43)
        self.assertNotEqual(max(ns), 43, "12e-6b: v43 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 45)
        self.assertNotEqual(max(ns), 45, "12e-6c: v45 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 46)
        self.assertNotEqual(max(ns), 46, "ADP-1: v46 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 47)
        self.assertNotEqual(max(ns), 47, "ADP-2: v47 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        self.assertTrue(os.path.exists(_asset_path(V35)), "v35 stays on disk as the 12e-1b record")
        self.assertTrue(os.path.exists(_asset_path(V34)), "v34 stays on disk as the 12e-1 record")
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v%d.json" % (max(ns) + 1))))

    @staticmethod
    def _check_piping_names(items, cfg):
        """THE ASSET CHECK (12e-1b): every Piping item carries `attributes.item_name`, non-blank, equal to its sheet
        row's column A text, and one of the four sheet texts; the config declares `item_name` FIRST as a plain
        choice over exactly those texts in sheet order, with no spec flag. Raises AssertionError otherwise."""
        pip = [it for it in items if it["kind"] == KIND]
        assert len(pip) == 40, "40 Piping items, found %d" % len(pip)
        for it in pip:
            name = it["attributes"].get("item_name")
            assert isinstance(name, str) and name.strip(), "Piping item %s has no item_name" % it["item_uid"]
            assert name in SHEET_ITEM_TEXTS, "Piping item %s carries a name that is not on the sheet: %r" % (it["item_uid"], name)
            assert name == SHEET_ITEM_BY_ROW[it["source"]["row"]], "Piping item %s (row %d): %r is not that row's column A" % (
                it["item_uid"], it["source"]["row"], name)
            assert list(it["attributes"].keys())[0] == "item_name", "item_name is the first attribute key on %s" % it["item_uid"]
        d = cfg["attribute_definitions"][0]
        assert {k: d[k] for k in ("id", "label", "type", "values")} == ITEM_NAME_DEFINITION, "the first definition is the Item choice: %r" % d
        assert "selector" not in d and "panel" not in d, "a plain attribute like Insulation's `type`: no selector / panel flag"
        assert cfg.get("attributes_from_spec") is not True, "never a spec-read category"
        return True

    def test_07_every_piping_item_carries_its_sheet_name_verbatim_and_a_nameless_or_foreign_name_is_refused(self):
        # POSITIVE: the committed v35 passes the check; the 40 names are the sheet's column A, row by row
        self.assertTrue(self._check_piping_names(self.v35["items"], self.cfg))
        names = sorted({it["attributes"]["item_name"] for it in _piping(self.v35)}, key=SHEET_ITEM_TEXTS.index)
        self.assertEqual(names, SHEET_ITEM_TEXTS)
        counts = {t: sum(1 for it in _piping(self.v35) if it["attributes"]["item_name"] == t) for t in SHEET_ITEM_TEXTS}
        self.assertEqual(list(counts.values()), [13, 13, 8, 6])
        self.assertEqual(self.cfg["attribute_definitions"][0]["label"], "Item", "the sheet's own header")
        # v34 did NOT carry the key (the thing 12e-1b adds), and the check says so
        with self.assertRaises(AssertionError):
            self._check_piping_names(self.v34["items"], next(c for c in self.v34["category_configs"] if c["category_id"] == CATEGORY))
        # NEGATIVE: a Piping item with a MISSING name is refused
        items = copy.deepcopy(self.v35["items"])
        victim = next(it for it in items if it["kind"] == KIND)
        del victim["attributes"]["item_name"]
        with self.assertRaises(AssertionError):
            self._check_piping_names(items, self.cfg)
        # NEGATIVE: a BLANK name is refused
        items = copy.deepcopy(self.v35["items"])
        next(it for it in items if it["kind"] == KIND)["attributes"]["item_name"] = "   "
        with self.assertRaises(AssertionError):
            self._check_piping_names(items, self.cfg)
        # NEGATIVE: a FOREIGN name (not on the sheet) is refused, as is a sheet text on the wrong row
        items = copy.deepcopy(self.v35["items"])
        next(it for it in items if it["kind"] == KIND)["attributes"]["item_name"] = "Copper pipe"
        with self.assertRaises(AssertionError):
            self._check_piping_names(items, self.cfg)
        items = copy.deepcopy(self.v35["items"])
        row2 = next(it for it in items if it["kind"] == KIND and it["source"]["row"] == 2)
        row2["attributes"]["item_name"] = "PVC Pipe"
        with self.assertRaises(AssertionError):
            self._check_piping_names(items, self.cfg)
        # NEGATIVE: a config that does not declare the name first, or declares it spec-read, is refused
        cfg = copy.deepcopy(self.cfg)
        cfg["attribute_definitions"] = cfg["attribute_definitions"][1:] + cfg["attribute_definitions"][:1]
        with self.assertRaises(AssertionError):
            self._check_piping_names(self.v35["items"], cfg)
        cfg = copy.deepcopy(self.cfg)
        cfg["attributes_from_spec"] = True
        with self.assertRaises(AssertionError):
            self._check_piping_names(self.v35["items"], cfg)


class TestSlice12e1LiveLinks(FrappeTestCase):
    """LIVE site, after `loader.load_rate_master(v35, replace=True)` (12e-1b; v34 before it). Every write is restored."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        rows = frappe.get_all("BoQ Rate Master Item", filters={"discipline": "HVAC", "kind": KIND, "active": 1},
                              fields=["name", "item_uid", "attributes", "rates"])
        cls.live = {}
        for r in rows:
            a = r["attributes"] if isinstance(r["attributes"], dict) else json.loads(r["attributes"] or "{}")
            rt = r["rates"] if isinstance(r["rates"], dict) else json.loads(r["rates"] or "{}")
            cls.live[(a.get("pipe_type"), float(a.get("size_mm")))] = {"name": r["name"], "uid": r["item_uid"], "rates": rt}
        if len(cls.live) != 40:
            raise AssertionError("the LIVE site does not carry the 40 Piping items (found %d) -- load v35 first" % len(cls.live))

    @staticmethod
    def _rates(uid):
        r = frappe.get_all("BoQ Rate Master Item", filters={"discipline": "HVAC", "item_uid": uid, "active": 1}, fields=["name", "rates"])
        assert len(r) == 1, "exactly one active row per uid: %s" % uid
        rt = r[0]["rates"]
        return r[0]["name"], (rt if isinstance(rt, dict) else json.loads(rt or "{}"))

    def test_live_01_the_grid_write_path_moves_ms_300_by_twice_and_ms_250_by_once_and_restores(self):
        ms150, ms100, ms300, ms250 = (self.live[("MS", s)] for s in (150.0, 100.0, 300.0, 250.0))
        base = self._rates(ms150["uid"])[1]["cost_supply"]
        before300 = self._rates(ms300["uid"])[1]["cost_supply"]
        before250 = self._rates(ms250["uid"])[1]["cost_supply"]
        self.assertEqual(before300, 2 * base)
        self.assertEqual(before250, base + self._rates(ms100["uid"])[1]["cost_supply"])

        # CU-B AC2(b): leave the live master's PROVENANCE as found. Each edit re-mints the derived MS 300 / 250
        # rows in a new batch (loader.recompute_derived_after_write), so without this a run left the live rows
        # in a test batch (CU-0: 140 two-row batches, one of them live). Registered BEFORE `restore`, so it
        # runs after it (cleanups are LIFO) and also undoes a failed run.
        started = frappe.utils.now()
        derived = {u: self._rates(u)[0] for u in (ms300["uid"], ms250["uid"])}
        existing = {u: set(frappe.get_all("BoQ Rate Master Item", filters={"item_uid": u}, pluck="name")) for u in derived}

        def reinstate():
            frappe.db.rollback()
            for uid, original in derived.items():
                minted = [n for n in frappe.get_all("BoQ Rate Master Item", filters={"item_uid": uid}, pluck="name")
                          if n not in existing[uid]]
                # Raw on purpose: this puts back the exact pre-test rows, whose content the test has just
                # proved equal; no recompute is owed, and the item doctype carries no doc_events.
                frappe.db.sql('update "tabBoQ Rate Master Item" set active = 0 where item_uid = %s', (uid,))
                frappe.db.sql('update "tabBoQ Rate Master Item" set active = 1 where name = %s', (original,))
                if minted:
                    frappe.db.sql('delete from "tabBoQ Rate Master Item" where name in %s', (tuple(minted),))
            frappe.db.sql('''delete from "tabVersion" where ref_doctype = 'BoQ Rate Master Item' and docname = %s
                             and creation >= %s''', (ms150["name"], started))
            frappe.db.commit()
        self.addCleanup(reinstate)

        def restore():
            name, _ = self._rates(ms150["uid"])
            rate_master.update_rate_master_item(name=name, rates_patch=json.dumps({"cost_supply": base}))
            frappe.db.commit()
        self.addCleanup(restore)

        name, _ = self._rates(ms150["uid"])
        out = rate_master.update_rate_master_item(name=name, rates_patch=json.dumps({"cost_supply": base + 10}))   # the grid's write
        frappe.db.commit()
        self.assertTrue(out.get("ok"))
        self.assertEqual(self._rates(ms150["uid"])[1]["cost_supply"], base + 10)
        self.assertEqual(self._rates(ms300["uid"])[1]["cost_supply"], before300 + 20, "MS 300 follows +20")
        self.assertEqual(self._rates(ms250["uid"])[1]["cost_supply"], before250 + 10, "MS 250 follows +10")
        self.assertEqual(self._rates(ms300["uid"])[1]["cost_install"], 1200.0, "install untouched by a supply edit")
        restore()
        self.assertEqual(self._rates(ms150["uid"])[1]["cost_supply"], base)
        self.assertEqual(self._rates(ms300["uid"])[1]["cost_supply"], before300, "MS 300 back")
        self.assertEqual(self._rates(ms250["uid"])[1]["cost_supply"], before250, "MS 250 back")
        reinstate()
        for uid, original in derived.items():
            self.assertEqual(self._rates(uid)[0], original, "the live row is the one active before the test")
            self.assertEqual(set(frappe.get_all("BoQ Rate Master Item", filters={"item_uid": uid}, pluck="name")),
                             existing[uid], "the rows the test minted are gone")

    def test_live_02_the_served_payload_carries_the_forty_rows_with_the_sheets_figures(self):
        served = rate_master.get_rate_master_items(discipline="HVAC", kind=KIND)
        self.assertEqual(served["count"], 40)
        by = {(it["attributes"]["pipe_type"], float(it["attributes"]["size_mm"])): it for it in served["items"]}
        # 12e-2 (owner "option b"): INVERTED under mechanical authority -- the served cost_supply is the sheet's BCS
        # Pipe (column G), no longer its Total BCS Supply (column I); I is reproduced from G and the family's
        # accessories input on every row (the negative half: G is never I).
        g_by = {(fam, size): g for fam, size, g, _k, _l in SHEET_G_K_L}
        for fam, size, sup, inst, sm, im in SHEET:
            g = g_by[(fam, size)]
            self.assertEqual(by[(fam, size)]["rates"], {"cost_supply": g, "cost_install": inst, "supply_markup": sm, "install_markup": im})
            self.assertNotEqual(g, sup)
            self.assertEqual(_roundup(g * (1 + ACCESSORIES[fam])), sup, "%s %s: ROUNDUP(G x (1 + accessories)) == the sheet's I" % (fam, size))
            self.assertEqual(by[(fam, size)]["unit"], "Mts")
        # `computed_rates` is the cladding DISPLAY projection only (12d-2F); a Piping derived cell is a STORED figure the
        # loader / write paths keep in step, so no Piping uid is projected -- the grid marks it from the config's
        # derived_rates instead
        piping_uids = {it["item_uid"] for it in served["items"]}
        self.assertEqual([u for u in served["computed_rate_keys"] if u in piping_uids], [])
        cfg = rate_master.get_rate_category_config(discipline="HVAC", category_id=CATEGORY)["config"]
        self.assertEqual(sorted(cfg["derived_rates"]), sorted([by[("MS", 300.0)]["item_uid"], by[("MS", 250.0)]["item_uid"]]))

    def test_live_03_the_categorys_rate_file_previews_as_zero_changes(self):
        export = rate_master.export_rate_master_csv(discipline="HVAC", category_id=CATEGORY, fmt="csv")
        self.assertEqual(export["row_count"], 40)
        plan = rate_master.preview_rate_master_csv(discipline="HVAC", content_base64=export["content_base64"], category_id=CATEGORY)
        self.assertEqual(plan["errors"], [])
        counts = plan["counts"]
        self.assertEqual((counts.get("rates_changed", 0), counts.get("items_added", 0), counts.get("other_changed", 0)), (0, 0, 0))
        self.assertEqual(counts.get("unchanged"), 40)


# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# SLICE 12e-2 -- HVAC v36 = v35 + PIPING PRICES (owner option "1", 2026-10-10 10:58; rulings "option b, yes",
# Q14 / Q14a / Q17 / Q11 / Q16 / Q15 / Q10 / Q19 / Q18 / Q2 / Q12).
#
# What these tests protect, in plain English:
#   08  v36 is v35 plus EXACTLY the ruled changes and nothing else: the 40 Piping items differ by cost_supply alone
#       (now the sheet's BCS Pipe, column G), FOUR accessories inputs join the seven HVAC inputs in their shape,
#       the Piping config gains the item-list block (and ADP's two flags on item_name), every other item / config /
#       top-level key is byte-equal. NEGATIVE: a fifth input, a moved install cost or a touched Insulation item
#       is reported by the same comparison.
#   09  AC2(a) as a permanent pin: on every row ROUNDUP(G x (1 + the family's accessories)) == the sheet's Total
#       BCS Supply (v35's cost_supply), the two MS links hold on column G (verified, loader-checked), and the
#       sheet's BoQ figures K / L follow from G by the two-step rule -- so the stored BCS Pipe and the Pricing
#       Input reproduce every figure the pricer sees. NEGATIVE: a wrong accessories share breaks the identity.
#   10  the config is an ITEM-LIST config that RUNS (eligible on every surface -- owner S1, no staging switch):
#       the four families, one per-metre block each with the P5 pipeline reading its own input; the P1-P4 keys;
#       it validates through the loader's own gate. item_name is NEVER asked of the model (the model's questions
#       are pipe_type / size_mm / pipe_class) and NEVER a selectable / panel definition (ADP's two flags).
#   11  NEGATIVE, the validator: each 12e-2 config key refuses a wrong shape BY NAME (inch_mm_alt without inches
#       or equal to 25.4, a foreign typed_entry, a non-positive near, a foreign below_smallest, a unit_refusal
#       without {unit}, a family_text map to a non-family / from a family value / twice, a refuse of a family
#       value, a panel_optional naming a read attribute). The shipped config passes.
#   12  the four inputs are READ by the Piping pipelines only (the exporter's used-by walk sees them), each by
#       exactly one family; no Insulation / ADP pipeline reads them.
#   13  v36 is the newest HVAC asset on disk (derived, never a named future number); v35 stays.
#
#   TestSlice12e2Live (the LIVE site after the v36 load): live HVAC == v36 by content; the served inputs are
#       eleven with the four factors; the served Piping config is the item-list one; every served Piping
#       cost_supply is column G.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════
class TestSlice12e2AssetV36(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v35 = _read(V35)
        cls.v36 = _read(V36)
        cls.cfg = next(c for c in cls.v36["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg35 = next(c for c in cls.v35["category_configs"] if c["category_id"] == CATEGORY)

    @staticmethod
    def _inputs(asset):
        return [it for it in asset["items"] if it["kind"] == INPUT_KIND]

    def test_08_v36_is_v35_plus_the_ruled_changes_and_nothing_else(self):
        a = {it["item_uid"]: it for it in self.v35["items"]}
        b = {it["item_uid"]: it for it in self.v36["items"]}
        new = [u for u in b if u not in a]
        self.assertEqual([u for u in a if u not in b], [], "no v35 item is lost")
        self.assertEqual(len(new), 4, "exactly four new items")
        self.assertEqual(len(b), 379)
        # the carried items: the 40 Piping rows differ by cost_supply ALONE; every other item is byte-equal
        moved = [u for u in a if _norm(a[u]) != _norm(b[u])]
        self.assertEqual(len(moved), 40)
        for u in moved:
            x, y = a[u], b[u]
            self.assertEqual(x["kind"], KIND, "only a Piping item moves")
            self.assertEqual({k: v for k, v in x.items() if k != "rates"}, {k: v for k, v in y.items() if k != "rates"})
            self.assertEqual(list(x["rates"]), list(y["rates"]), "rate keys and their order kept")
            self.assertEqual({k: v for k, v in x["rates"].items() if k != "cost_supply"}, {k: v for k, v in y["rates"].items() if k != "cost_supply"})
            self.assertNotEqual(x["rates"]["cost_supply"], y["rates"]["cost_supply"])
        for u in a:
            if a[u]["kind"] != KIND:
                self.assertEqual(_norm(a[u]), _norm(b[u]), "%s %s untouched" % (a[u]["kind"], u))
        # the four inputs, in the shape of the seven (one value column each, unit factor, shared_by, name, remarks)
        seven = {it["attributes"]["item"]: it for it in self._inputs(self.v35)}
        self.assertEqual(len(seven), 7)
        eleven = {it["attributes"]["item"]: it for it in self._inputs(self.v36)}
        self.assertEqual(len(eleven), 11)
        self.assertEqual(sorted(set(eleven) - set(seven)), sorted(INPUT_IDS.values()))
        for fam, iid in INPUT_IDS.items():
            it = eleven[iid]
            self.assertEqual(sorted(it), sorted(seven["cladding_overlap"]), "the same top-level keys as an existing factor input")
            self.assertEqual(sorted(it["attributes"]), sorted(seven["cladding_overlap"]["attributes"]))
            self.assertEqual(it["unit"], "factor")
            self.assertEqual(it["rates"], {"factor": ACCESSORIES[fam]})
            self.assertEqual(it["attributes"]["name"], INPUT_LABELS[fam])
            self.assertEqual(it["attributes"]["shared_by"], "piping")
            self.assertEqual(it["source"], {"sheet": "Pricing Inputs", "row": 0})
            self.assertRegex(it["item_uid"], r"^rmi-[0-9a-f]{12}$")
            self.assertIn(it["item_uid"], new)
        # the configs: only hvac_piping differs, and by the ruled keys
        ca = {c["category_id"]: c for c in self.v35["category_configs"]}
        cb = {c["category_id"]: c for c in self.v36["category_configs"]}
        self.assertEqual([k for k in ca if _norm(ca[k]) != _norm(cb[k])], [CATEGORY])
        self.assertEqual([c["category_id"] for c in self.v36["category_configs"]], [c["category_id"] for c in self.v35["category_configs"]])
        p, q = self.cfg35, self.cfg
        self.assertEqual(sorted(set(q) - set(p)), ["list_spec", "matching_mode"])
        for k in p:
            if k == "attribute_definitions":
                self.assertEqual([{kk: v for kk, v in d.items() if kk not in ("selector", "panel")} for d in q[k]], p[k], "the three definitions' content is carried")
                self.assertEqual([(d.get("selector"), d.get("panel")) for d in q[k]], [(False, False), (None, None), (None, None)], "ADP's two flags on item_name only")
            elif k == "notes":
                self.assertTrue(q[k].startswith(p[k]))
            else:
                self.assertEqual(_norm(p[k]), _norm(q[k]), "config key %r carried" % k)
        self.assertEqual(q["derived_rates"], p["derived_rates"], "the two MS links are the same declarations, now on column G")
        for k in set(self.v35) | set(self.v36):
            if k in ("items", "category_configs"):
                continue
            self.assertEqual(_norm(self.v35.get(k)), _norm(self.v36.get(k)), "top-level key %r unchanged v35 -> v36" % k)
        # NEGATIVE: the comparison sees a stray change -- a fifth input, a moved install cost, a touched Insulation item
        bad = copy.deepcopy(self.v36)
        bad["items"].append(dict(eleven["piping_accessories_ms"], item_uid="rmi-000000000001"))
        self.assertEqual(len([it for it in bad["items"] if it["kind"] == INPUT_KIND]), 12)
        bad = copy.deepcopy(self.v36)
        victim = next(it for it in bad["items"] if it["kind"] == KIND)
        victim["rates"]["cost_install"] += 1
        self.assertNotEqual({k: v for k, v in a[victim["item_uid"]]["rates"].items() if k != "cost_supply"},
                            {k: v for k, v in victim["rates"].items() if k != "cost_supply"})
        bad = copy.deepcopy(self.v36)
        ins = next(it for it in bad["items"] if it["kind"] == "hvac_insulation_item")
        ins["rates"]["cost_insulation"] += 1
        self.assertNotEqual(_norm(a[ins["item_uid"]]), _norm(ins))

    def test_09_AC2a_the_sheet_reproduces_from_bcs_pipe_and_the_accessories_input_on_every_row(self):
        by36 = _by_key(_piping(self.v36))
        by35 = _by_key(_piping(self.v35))
        self.assertEqual(len(SHEET_G_K_L), 40)
        for fam, size, g, k, l in SHEET_G_K_L:
            it = by36[(fam, size)]
            acc = ACCESSORIES[fam]
            self.assertEqual(it["rates"]["cost_supply"], g, "%s %s stores the sheet's BCS Pipe" % (fam, size))
            i = _roundup(g * (1 + acc))
            self.assertEqual(i, by35[(fam, size)]["rates"]["cost_supply"], "%s %s: ROUNDUP(G x (1 + %s)) == the sheet's Total BCS Supply (v35)" % (fam, size, acc))
            self.assertEqual(_roundup(i * (1 + it["rates"]["supply_markup"])), k, "%s %s: BoQ Supply (K)" % (fam, size))
            self.assertEqual(_roundup(it["rates"]["cost_install"] * (1 + it["rates"]["install_markup"])), l, "%s %s: BoQ Installation (L)" % (fam, size))
        # the MS links hold on column G and the loader's own consistency check agrees
        uid = lambda size: by36[("MS", size)]["item_uid"]
        self.assertEqual(by36[("MS", 300.0)]["rates"]["cost_supply"], 2 * by36[("MS", 150.0)]["rates"]["cost_supply"])
        self.assertEqual(by36[("MS", 250.0)]["rates"]["cost_supply"], by36[("MS", 150.0)]["rates"]["cost_supply"] + by36[("MS", 100.0)]["rates"]["cost_supply"])
        by_uid = {it["item_uid"]: {"rates": it["rates"]} for it in self.v36["items"]}
        self.assertEqual(config_validation.derived_rate_updates([self.cfg], by_uid), {})
        want = config_validation.recompute_derived_values([self.cfg], by_uid)
        self.assertEqual(want[(uid(300.0), "cost_supply")], 2800.0)
        self.assertEqual(want[(uid(250.0), "cost_supply")], 2340.0)
        self.assertEqual(want[(uid(300.0), "cost_install")], 1200.0)
        # NEGATIVE: a wrong accessories share breaks the identity on at least one row of every family
        for fam in ACCESSORIES:
            broken = [s for f, s, g, _k, _l in SHEET_G_K_L if f == fam and _roundup(g * (1 + ACCESSORIES[fam] + 0.1)) == by35[(f, s)]["rates"]["cost_supply"]]
            self.assertEqual(broken, [], "%s: a share 0.1 too high reproduces no row" % fam)

    def test_10_the_config_is_an_item_list_config_that_runs_and_item_name_is_never_asked(self):
        cfg = self.cfg
        self.assertEqual(cfg["matching_mode"], "item_list")
        ls = cfg["list_spec"]
        self.assertEqual(ls["family_attribute_id"], "pipe_type")
        self.assertEqual([d["id"] for d in ls["attribute_definitions"]], ["pipe_type", "size_mm", "pipe_class"])
        self.assertEqual(ls["attribute_definitions"][0]["values"], ["Copper", "MS", "PVC", "CPVC"])
        self.assertIs(ls["second_opinion"], False)
        pr = ls["pricing"]
        self.assertEqual(pr["kind"], KIND)
        self.assertEqual(sorted(pr["families"]), ["CPVC", "Copper", "MS", "PVC"])
        for fam, f in pr["families"].items():
            self.assertEqual(sorted(f["units"]), ["length"], "%s: one per-metre block" % fam)
            steps = f["units"]["length"]["pipelines"]["supply"]["steps"]
            self.assertEqual([s["step"] for s in steps], ["rate_ref", "match_master_row", "component", "sum_components", "scale", "roundup", "scale", "roundup"])
            self.assertEqual(steps[0]["ref"], {"kind": INPUT_KIND, "item": INPUT_IDS[fam]}, "%s reads ITS accessories input" % fam)
            self.assertEqual((steps[0]["target"], steps[0]["result"]), ("factor", "acc"))
            self.assertEqual(steps[4]["params"], {"acc_from_ctx": "acc"})
            self.assertEqual(steps[6]["params"], {"m_from_ctx": "supply_markup"})
            isteps = f["units"]["length"]["pipelines"]["install"]["steps"]
            self.assertEqual([s["step"] for s in isteps], ["match_master_row", "component", "sum_components", "scale", "roundup"])
            self.assertEqual(isteps[3]["params"], {"m_from_ctx": "install_markup"})
            self.assertIn(INPUT_LABELS[fam], steps[2]["explain"], "the formula row names the accessories input (U7)")
        self.assertEqual(pr["unit_classes"]["length"][0], "mts")
        self.assertEqual(pr["unit_refusal"], "unit '{unit}' is not a length unit")
        self.assertEqual(pr["numbers"]["size_mm"], {"from": ["size_mm"], "name": "pipe size", "unit": "mm", "inches": True, "inch_mm_alt": 25, "typed_entry": "one_size"})
        self.assertEqual(pr["size_match"], {"dp": [2, 1], "near": 0.1, "below_smallest": "smallest"})
        self.assertEqual([(m["from"], m["to"]) for m in pr["family_text"]["map"]], [("GI", "MS"), ("uPVC", "PVC"), ("HDPE", "PVC")])
        self.assertEqual([(r["from"], r["refuse"]) for r in pr["family_text"]["refuse"]], [("SS", "No SKU in the catalogue for SS pipe - price this row by hand")])
        self.assertEqual(pr["family_text"]["line"], "BoQ says {from} -> priced as {to} (owner rule)")
        self.assertIn("{types}", pr["family_text"]["from_row"]["refuse"])
        self.assertEqual(pr["panel_controls"], {"pipe_type": "dropdown_or_other", "size_mm": "dropdown_or_other"})
        self.assertEqual(sorted(pr["panel_notes"]), ["pipe_type", "size_mm"])
        self.assertEqual(pr["panel_optional"], ["pipe_class"])
        self.assertEqual([(r["from_attr"], sorted(r["families"])) for r in pr["read_notes"]], [("pipe_class", ["CPVC", "Copper", "MS", "PVC"])])
        self.assertIn("{family}", pr["read_notes"][0]["line"])
        self.assertEqual(pr["label_attr"], "pipe_type")
        self.assertEqual(cfg["pipelines"], {}, "no top-level pipelines: the blocks carry their own (the Insulation shape)")
        # it RUNS, on every surface (owner S1: one predicate, no staging switch)
        self.assertTrue(extraction.has_runnable_pricing_rules(cfg))
        configs = {c["category_id"]: c for c in self.v36["category_configs"]}
        self.assertTrue(extraction.config_is_eligible(cfg, configs), "priced on a BoQ row AND on the calculator")
        self.assertFalse(extraction.has_runnable_pricing_rules(self.cfg35), "v35 did not run")
        # the loader's own gate, as stored
        config_validation._validate_config(loader._loaded_config(copy.deepcopy(cfg), "HVAC", self.v36.get("goldens") or {}))
        for c in self.v36["category_configs"]:
            config_validation._validate_config(loader._loaded_config(copy.deepcopy(c), "HVAC", self.v36.get("goldens") or {}))
        # item_name: declared for the Rate Master, NEVER asked of the model, NEVER a panel definition
        d0 = cfg["attribute_definitions"][0]
        self.assertEqual(d0["id"], "item_name")
        self.assertIs(d0["selector"], False)
        self.assertIs(d0["panel"], False)
        adp = next(c for c in self.v36["category_configs"] if c["category_id"] == "hvac_adp")
        adp_name = next(d for d in adp["attribute_definitions"] if d["id"] == "item_name")
        self.assertEqual((adp_name["selector"], adp_name["panel"]), (False, False), "the same two flags ADP's item_name carries")
        spec = extraction.build_items_spec(cfg)
        self.assertEqual([d["id"] for d in spec["attribute_definitions"]], ["pipe_type", "size_mm", "pipe_class"], "the model's questions (cert step 12)")
        self.assertEqual(spec["family_attribute_id"], "pipe_type")
        self.assertNotIn("item_name", [d["id"] for d in extraction.build_attribute_defs(cfg)])
        ctx = extraction._group_context({("HVAC", CATEGORY): dict(cfg, discipline="HVAC")}, "HVAC", CATEGORY)
        self.assertEqual(ctx["defs"], [], "an item-list config asks no row-level question")
        self.assertEqual([d["id"] for d in ctx["items_spec"]["attribute_definitions"]], ["pipe_type", "size_mm", "pipe_class"])
        # NEGATIVE: with the flags dropped item_name WOULD reach the row-level projection
        plain = copy.deepcopy(cfg)
        plain["attribute_definitions"][0] = {k: v for k, v in plain["attribute_definitions"][0].items() if k not in ("selector", "panel")}
        self.assertIn("item_name", [d["id"] for d in extraction.build_attribute_defs(plain)])

    def test_11_NEGATIVE_the_validator_refuses_every_12e2_key_in_a_wrong_shape_by_name(self):
        def refused(mutate, needle):
            cfg = copy.deepcopy(self.cfg)
            mutate(cfg["list_spec"]["pricing"])
            with self.assertRaises(frappe.ValidationError) as cm:
                config_validation._validate_config(loader._loaded_config(cfg, "HVAC", {}))
            self.assertIn(needle, str(cm.exception))
        config_validation._validate_config(loader._loaded_config(copy.deepcopy(self.cfg), "HVAC", {}))   # the shipped config passes
        refused(lambda pr: pr["numbers"]["size_mm"].pop("inches"), "inch_mm_alt needs inches: true")
        refused(lambda pr: pr["numbers"]["size_mm"].update(inch_mm_alt=25.4), "other than 25.4")
        refused(lambda pr: pr["numbers"]["size_mm"].update(inch_mm_alt=0), "positive number")
        refused(lambda pr: pr["numbers"]["size_mm"].update(typed_entry="any"), "typed_entry must be one of")
        refused(lambda pr: pr["size_match"].update(near=-0.1), "size_match.near must be a positive number")
        refused(lambda pr: pr["size_match"].update(below_smallest="largest"), "below_smallest must be one of")
        refused(lambda pr: pr.update(unit_refusal="not a length unit"), "carrying {unit}")
        refused(lambda pr: pr["family_text"]["map"].append({"from": "ABS", "to": "ABS pipe", "rule": "x"}), "must name a priceable family")
        refused(lambda pr: pr["family_text"]["map"].append({"from": "ms", "to": "MS", "rule": "x"}), "already a family value")
        refused(lambda pr: pr["family_text"]["map"].append({"from": "gi", "to": "MS", "rule": "x"}), "mapped twice")
        refused(lambda pr: pr["family_text"]["refuse"].append({"from": "GI", "refuse": "no", "rule": "x"}), "already mapped")
        refused(lambda pr: pr["family_text"]["refuse"].append({"from": "Copper", "refuse": "no", "rule": "x"}), "is a family value and cannot refuse")
        refused(lambda pr: pr["family_text"].update(line="priced as {to}"), "carrying {from} and {to}")
        refused(lambda pr: pr["family_text"].update(from_row={"rule": "x", "refuse": "two types"}), "carrying {types}")
        refused(lambda pr: pr["family_text"].update(extra=1), "unknown key(s): extra")
        refused(lambda pr: pr.update(panel_optional=["size_mm"]), "read by the pricing and cannot be an optional box")
        refused(lambda pr: pr.update(panel_optional=["pipe_type"]), "read by the pricing")
        refused(lambda pr: pr.update(panel_optional=["nothing"]), "not an item attribute")
        refused(lambda pr: pr.update(panel_readonly=["pipe_class"]), "also panel_readonly")
        refused(lambda pr: pr.update(family_text={}), "must carry map and line")

    def test_12_the_four_inputs_are_read_by_the_piping_pipelines_only_one_family_each(self):
        from nirmaan_stack.services.boq_rate_master import csv_exporter
        used = csv_exporter.pricing_input_used_by({c["category_id"]: c for c in self.v36["category_configs"]})
        for fam, iid in INPUT_IDS.items():
            n, cats = used.get(iid, (0, []))
            self.assertEqual((n, cats), (1, [CATEGORY]), "%s is read at ONE site, by the Piping config alone" % iid)
        # the seven Insulation inputs are untouched by the walk: still read by Insulation only
        self.assertEqual(used["gi_sheet_rate"][1], ["hvac_insulation"])
        # each input is read by exactly one family's pipeline, and every family reads exactly one input
        pr = self.cfg["list_spec"]["pricing"]
        reads = {}
        for fam, f in pr["families"].items():
            for pid, pl in f["units"]["length"]["pipelines"].items():
                for s in pl["steps"]:
                    if s["step"] == "rate_ref":
                        reads.setdefault(s["ref"]["item"], set()).add(fam)
        self.assertEqual(reads, {iid: {fam} for fam, iid in INPUT_IDS.items()})
        # no Insulation / ADP pipeline reads a Piping input
        for c in self.v36["category_configs"]:
            if c["category_id"] == CATEGORY:
                continue
            self.assertFalse(any(iid in json.dumps(c) for iid in INPUT_IDS.values()), "%s reads no Piping input" % c["category_id"])

    def test_13_v36_is_the_newest_hvac_asset_on_disk(self):
        d = os.path.dirname(_asset_path(V36))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # 12e-3a: INVERTED under mechanical authority -- v37 is the newest; v36 stays on disk as the 12e-2 record.
        # BEFORE: self.assertEqual(max(ns), 36)
        self.assertNotEqual(max(ns), 36, "12e-3a: v36 is no longer the newest")
        # 12e-4b: INVERTED again under mechanical authority -- v38 (what a Piping row is asked) is the newest.
        # BEFORE: self.assertEqual(max(ns), 37)
        self.assertNotEqual(max(ns), 37, "12e-4b: v37 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 38)
        self.assertNotEqual(max(ns), 38, "12e-5b: v38 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 39)
        self.assertNotEqual(max(ns), 39, "12e-5b C3: v39 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 40)
        self.assertNotEqual(max(ns), 40, "12e-5b2: v40 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 41)
        self.assertNotEqual(max(ns), 41, "12e-5c: v41 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 42)
        self.assertNotEqual(max(ns), 42, "12e-6: v42 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 43)
        self.assertNotEqual(max(ns), 43, "12e-6b: v43 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 45)
        self.assertNotEqual(max(ns), 45, "12e-6c: v45 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 46)
        self.assertNotEqual(max(ns), 46, "ADP-1: v46 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 47)
        self.assertNotEqual(max(ns), 47, "ADP-2: v47 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        self.assertTrue(os.path.exists(_asset_path(V36)))
        self.assertTrue(os.path.exists(_asset_path(V35)))
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v%d.json" % (max(ns) + 1))))


class TestSlice12e2Live(FrappeTestCase):
    """LIVE site, after `loader.load_rate_master(v36, replace=True)` (batch rmbulk-a656afd62046). Read-only."""

    def test_live_04_the_live_catalogue_is_v36_by_content_and_serves_eleven_inputs(self):
        v36 = _read(V36)
        a = {it["item_uid"]: it for it in v36["items"]}
        rows = frappe.get_all("BoQ Rate Master Item", filters={"discipline": "HVAC", "active": 1},
                              fields=["kind", "brand", "unit", "attributes", "rates", "item_uid"])
        # INVERTED at ADP-1 under mechanical authority (owner H4 / A4): BEFORE assertEqual(len(rows), 379, "load v36 first"). The live
        # catalogue is v47: v36's items less the two retired per-number plenum SKUs, plus the three ADP Pricing Inputs.
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(len(rows), 380, "load v47 first")`. The live catalogue is v53: v47 + the one
        # VCD Aluminium SKU (rmi-c1ebcadd4fd5, owner 2026-10-23 10:21), left out below like the ADP Pricing Inputs.
        self.assertEqual(len(rows), 381, "load v53 first")
        rows = [r for r in rows if r["item_uid"] != "rmi-c1ebcadd4fd5"]
        rows = [r for r in rows if not (r["kind"] == INPUT_KIND and json.loads(r["attributes"] if isinstance(r["attributes"], str) else json.dumps(r["attributes"])).get("shared_by") == "adp")]
        self.assertEqual(len(rows), 377)
        v36 = dict(v36, items=[it for it in v36["items"] if it["item_uid"] not in ("rmi-4184735331c3", "rmi-a23b43d34447")])
        a = {it["item_uid"]: it for it in v36["items"]}
        norm = lambda it: _norm({"kind": it["kind"], "brand": it.get("brand") or None, "unit": it.get("unit"),
                                 "attributes": it["attributes"] if isinstance(it["attributes"], dict) else json.loads(it["attributes"] or "{}"),
                                 "rates": it["rates"] if isinstance(it["rates"], dict) else json.loads(it["rates"] or "{}")})
        live = {r["item_uid"]: norm(r) for r in rows}
        self.assertEqual(set(live), set(a))
        self.assertEqual([u for u in a if norm(a[u]) != live[u]], [])
        served = rate_master.get_rate_master_items(discipline="HVAC", kind=INPUT_KIND)
        self.assertEqual(served["count"], 14)   # ADP-1: + the three ADP inputs (BEFORE: 11)
        self.assertEqual({it["attributes"]["item"]: it["rates"] for it in served["items"] if it["attributes"]["shared_by"] == "piping"},
                         {INPUT_IDS[f]: {"factor": ACCESSORIES[f]} for f in ACCESSORIES})
        cfg = rate_master.get_rate_category_config(discipline="HVAC", category_id=CATEGORY)["config"]
        self.assertEqual(cfg["matching_mode"], "item_list")
        self.assertEqual(sorted(cfg["list_spec"]["pricing"]["families"]), ["CPVC", "Copper", "MS", "PVC"])
        self.assertTrue(extraction.config_is_eligible(cfg))
        pip = rate_master.get_rate_master_items(discipline="HVAC", kind=KIND)
        by = {(it["attributes"]["pipe_type"], float(it["attributes"]["size_mm"])): it for it in pip["items"]}
        for fam, size, g, _k, _l in SHEET_G_K_L:
            self.assertEqual(by[(fam, size)]["rates"]["cost_supply"], g)


# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# SLICE 12e-3a (owner D1 / D1a / D3 / 13:40 / 13:42, 2026-10-11) -- HVAC v37 = v36 + THE INSULATION SECTION ON PIPING.
#
# What these tests protect, in plain English:
#
#   TestSlice12e3aSectionsV37 (file-only + the pure checks, no DB write)
#     14  v37 is v36 plus exactly two additions to the Piping config -- the `insulated` definition (last) and
#         `list_spec.sections`: every item unchanged and in order, every other config unchanged, every other
#         top-level key unchanged, the Piping config with the two additions taken out equal to v36's.
#     15  v37 is the newest HVAC asset on disk.
#     16  the shipped sections pass the shape check; NEGATIVE: each key in a wrong shape is refused BY NAME.
#     17  the cross-category check passes on the asset; NEGATIVE: a missing category, a category that is not an
#         item-list one, a family the delegated category does not have, a family it does not price per metre,
#         a family with no active SKU, a shared family attribute id and a bad mirror reader are each refused
#         with a plain sentence. FINDING pinned: "Cladding Only" is NOT refused by this check -- Insulation
#         stocks it per metre (5 SKUs); it is simply not offered (owner option 1).
#     18  the model's questions: the Piping ITEMS_SPEC grows by exactly `insulated`; Insulation's ITEMS_SPEC, its
#         group context and its assembled model call are BYTE-IDENTICAL between v36 and v37 (the il_14 shape);
#         NEGATIVE: nothing of `sections` reaches any model call.
#
#   TestSlice12e3aGates (the LIVE site; every refusal is verified to have written nothing)
#     19  `load_rate_master` refuses a payload whose section is broken, BEFORE the first write.
#     20  the config editor's save check (`validate_delegated_sections`, label "Config not saved") refuses the same,
#         and refuses an edit to the DELEGATED category that would break Piping's section (the reverse direction);
#         the stored config is unchanged after each. ADP-5a (owner D9): RE-POINTED from the removed endpoint
#         `update_rate_config`, which ran exactly this call before its write.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
V37 = "rate_master_hvac_all_v37.json"   # 12e-3a: v36 + Piping's `insulated` definition + `list_spec.sections`
INSULATION = "hvac_insulation"
SECTION_FAMILIES = ["Nitrile Rubber Insulation", "Tubular Puf Insulation"]
PIPING_SECTIONS = [
    {"id": "pipe", "label": "Pipe", "add_label": "Add pipe"},
    {"id": "insulation", "label": "Insulation", "add_label": "Add insulation",
     "category_id": INSULATION, "unit_class": "length", "families": SECTION_FAMILIES,
     "include_when": {"attr": "insulated", "equals": "Yes"},
     "absent": {"value": "No", "line": "insulation not mentioned -> No"},
     "mirror": {"from": "size_mm", "to": "pipe_size_mm", "tag": "from pipe", "line": "you chose {chosen} (pipe is {pipe})"}},
]


def _stored(asset):
    """Every config of an asset AS THE LOADER STORES IT (discipline stamped, goldens merged)."""
    return [loader._loaded_config(copy.deepcopy(c), asset["discipline"], asset.get("goldens") or {}) for c in asset["category_configs"]]


class TestSlice12e3aSectionsV37(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v36, cls.v37 = _read(V36), _read(V37)
        cls.cfg = next(c for c in cls.v37["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg36 = next(c for c in cls.v36["category_configs"] if c["category_id"] == CATEGORY)

    def _section(self, cfg):
        return cfg["list_spec"]["sections"][1]

    def test_14_v37_is_v36_plus_the_insulated_definition_and_the_sections_and_nothing_else(self):
        self.assertEqual(self.v37["items"], self.v36["items"], "every item unchanged, in the same order")
        self.assertEqual([c["category_id"] for c in self.v37["category_configs"]], [c["category_id"] for c in self.v36["category_configs"]])
        for a, b in zip(self.v37["category_configs"], self.v36["category_configs"]):
            if a["category_id"] != CATEGORY:
                self.assertEqual(a, b, "%s is unchanged" % a["category_id"])
        for k in set(self.v36) | set(self.v37):
            if k not in ("items", "category_configs"):
                self.assertEqual(self.v37.get(k), self.v36.get(k), "top-level key %s is unchanged" % k)
        ls = self.cfg["list_spec"]
        self.assertEqual([d["id"] for d in ls["attribute_definitions"]], ["pipe_type", "size_mm", "pipe_class", "insulated"])
        d = ls["attribute_definitions"][-1]
        self.assertEqual((d["label"], d["type"], d["values"]), ("Insulated", "choice", ["Yes", "No"]))
        self.assertNotIn("allow_none", d)
        self.assertEqual(ls["sections"], PIPING_SECTIONS)
        back = copy.deepcopy(self.cfg)
        back["list_spec"]["attribute_definitions"] = back["list_spec"]["attribute_definitions"][:-1]
        del back["list_spec"]["sections"]
        self.assertEqual(back, self.cfg36, "with the two additions taken out the Piping config IS v36's")
        # the toggle is its own attribute: nothing the pricing reads names it
        pr = ls["pricing"]
        self.assertNotIn("insulated", json.dumps(pr), "the pricing block never names the toggle")
        # NEGATIVE: Insulation and ADP gained nothing
        for cid in (INSULATION, "hvac_adp"):
            c = next(c for c in self.v37["category_configs"] if c["category_id"] == cid)
            self.assertNotIn("sections", c["list_spec"])

    def test_15_v37_is_the_newest_hvac_asset_on_disk(self):
        d = os.path.dirname(_asset_path(V37))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # 12e-4b: INVERTED under mechanical authority -- v38 is the newest; v37 stays on disk as the 12e-3a record.
        # BEFORE: self.assertEqual(max(ns), 37)
        self.assertNotEqual(max(ns), 37, "12e-4b: v37 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 38)
        self.assertNotEqual(max(ns), 38, "12e-5b: v38 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 39)
        self.assertNotEqual(max(ns), 39, "12e-5b C3: v39 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 40)
        self.assertNotEqual(max(ns), 40, "12e-5b2: v40 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 41)
        self.assertNotEqual(max(ns), 41, "12e-5c: v41 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 42)
        self.assertNotEqual(max(ns), 42, "12e-6: v42 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 43)
        self.assertNotEqual(max(ns), 43, "12e-6b: v43 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 45)
        self.assertNotEqual(max(ns), 45, "12e-6c: v45 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 46)
        self.assertNotEqual(max(ns), 46, "ADP-1: v46 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 47)
        self.assertNotEqual(max(ns), 47, "ADP-2: v47 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        self.assertTrue(os.path.exists(_asset_path(V37)))
        self.assertTrue(os.path.exists(_asset_path(V36)), "v36 stays on disk as the 12e-2 record")
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v%d.json" % (max(ns) + 1))))

    def test_16_the_shape_check_passes_the_shipped_sections_and_refuses_each_wrong_shape_by_name(self):
        def refused(mutate, needle):
            cfg = copy.deepcopy(self.cfg)
            mutate(cfg["list_spec"])
            with self.assertRaises(frappe.ValidationError) as cm:
                config_validation._validate_config(loader._loaded_config(cfg, "HVAC", {}))
            self.assertIn(needle, str(cm.exception))
        for c in _stored(self.v37):
            config_validation._validate_config(c)                      # every shipped config passes
        sec = lambda ls: ls["sections"][1]
        refused(lambda ls: ls.update(sections=[]), "must be a non-empty list")
        refused(lambda ls: ls.update(sections={"pipe": {}}), "must be a non-empty list")
        refused(lambda ls: ls["sections"].__setitem__(0, "pipe"), "must be an object")
        refused(lambda ls: ls["sections"].pop(0), "exactly one section without category_id")
        refused(lambda ls: ls["sections"].append({"id": "more", "label": "More", "add_label": "Add more"}), "exactly one section without category_id")
        refused(lambda ls: ls["sections"][0].update(families=["Copper"]), "unknown key(s): families")
        refused(lambda ls: sec(ls).update(extra=1), "unknown key(s): extra")
        refused(lambda ls: sec(ls).update(id="pipe"), "duplicate section id 'pipe'")
        refused(lambda ls: sec(ls).update(label=""), "needs a non-empty string 'label'")
        refused(lambda ls: sec(ls).pop("add_label"), "needs a non-empty string 'add_label'")
        refused(lambda ls: sec(ls).update(category_id=" "), "category_id must be a non-empty string")
        refused(lambda ls: sec(ls).update(category_id=CATEGORY), "may not name the config itself")
        refused(lambda ls: sec(ls).update(unit_class="area"), "unit_class must name one of this config's unit_classes")
        refused(lambda ls: sec(ls).update(families=[]), "families must be a non-empty list of distinct family names")
        refused(lambda ls: sec(ls).update(families=["Nitrile Rubber Insulation", "Nitrile Rubber Insulation"]), "distinct family names")
        refused(lambda ls: sec(ls).update(include_when={"attr": "insulated"}), "include_when needs exactly attr and equals")
        refused(lambda ls: sec(ls).update(include_when={"attr": "pipe_class", "equals": "Yes"}), "must name a two-value choice item attribute")
        refused(lambda ls: sec(ls).update(include_when={"attr": "nothing", "equals": "Yes"}), "must name a two-value choice item attribute")
        refused(lambda ls: sec(ls).update(include_when={"attr": "pipe_type", "equals": "MS"}), "must name a two-value choice item attribute")
        refused(lambda ls: sec(ls).update(include_when={"attr": "insulated", "equals": "Maybe"}), "is not a value of 'insulated'")
        refused(lambda ls: sec(ls).pop("absent"), "absent needs exactly value and line")
        refused(lambda ls: sec(ls).update(absent={"value": "Yes", "line": "x"}), "that does NOT open the section")
        refused(lambda ls: sec(ls).update(absent={"value": "No", "line": " "}), "absent.line must be a non-empty sentence")
        refused(lambda ls: sec(ls).pop("include_when"), "absent is only meaningful with include_when")
        refused(lambda ls: sec(ls).update(mirror={"from": "size_mm", "to": "pipe_size_mm"}), "mirror needs exactly from, to, tag and line")
        refused(lambda ls: sec(ls)["mirror"].update(**{"from": "pipe_class"}), "is not one of this config's number readers")
        refused(lambda ls: sec(ls)["mirror"].update(tag=""), "needs a non-empty 'to' and 'tag'")
        refused(lambda ls: sec(ls)["mirror"].update(line="you chose {chosen}"), "naming {chosen} and {pipe}")
        refused(lambda ls: ls.pop("pricing"), "needs list_spec.pricing")
        # the toggle may not be an attribute the pricing reads
        def priced_toggle(ls):
            ls["pricing"]["choice_attrs"] = ["insulated"]
            ls["pricing"]["panel_controls"]["insulated"] = "dropdown"     # (a priced choice must declare its control)
        refused(priced_toggle, "is read by the pricing; the toggle must be its own attribute")
        # an own-items-only declaration and a section with neither toggle nor mirror are both legal shapes
        ok = copy.deepcopy(self.cfg)
        for k in ("include_when", "absent", "mirror"):
            ok["list_spec"]["sections"][1].pop(k)
        config_validation._validate_config(loader._loaded_config(ok, "HVAC", {}))
        # NEGATIVE: `sections` is known ONLY inside list_spec -- at the top level it is still an unknown key
        top = copy.deepcopy(self.cfg)
        top["sections"] = PIPING_SECTIONS
        with self.assertRaises(frappe.ValidationError) as cm:
            config_validation._validate_config(loader._loaded_config(top, "HVAC", {}))
        self.assertIn("Unknown top-level config key(s): sections", str(cm.exception))

    def test_17_the_cross_category_check_passes_the_asset_and_refuses_each_broken_section_in_plain_words(self):
        problems = config_validation.delegated_section_problems
        self.assertEqual(problems(_stored(self.v37), self.v37["items"]), [])
        self.assertEqual(problems(_stored(self.v36), self.v36["items"]), [], "an asset declaring no section has nothing to refuse")

        def broken(mutate, needle, items=None):
            configs = _stored(self.v37)
            mutate({c["category_id"]: c for c in configs})
            out = problems(configs, self.v37["items"] if items is None else items)
            self.assertEqual(len(out), 1, out)
            self.assertIn(needle, out[0])
            self.assertTrue(out[0].startswith("hvac_piping: section 'insulation'"), out[0])
        sec = lambda by: by[CATEGORY]["list_spec"]["sections"][1]
        broken(lambda by: sec(by).update(category_id="hvac_lagging"), "names category 'hvac_lagging', which does not exist in HVAC")
        broken(lambda by: sec(by).update(category_id="hvac_pumps"), "names category 'hvac_pumps', which is not an item-list category with pricing rules")
        broken(lambda by: sec(by).update(families=["Rockwool"]), "offers 'Rockwool', which is not a priceable family of 'hvac_insulation'")
        broken(lambda by: sec(by).update(families=["Thermal Nitrile Insulation"]), "offers 'Thermal Nitrile Insulation', which 'hvac_insulation' does not price per length")
        broken(lambda by: sec(by)["mirror"].update(to="thickness"), "mirror.to 'thickness' is not one of the number readers of 'hvac_insulation'")
        def same_family_attr(by):
            by[CATEGORY]["list_spec"]["family_attribute_id"] = "item"
        broken(same_family_attr, "keeps its family in 'item', the same attribute as hvac_piping")
        no_puf = [it for it in self.v37["items"] if (it.get("attributes") or {}).get("item") != "Tubular Puf Insulation"]
        broken(lambda by: None, "offers 'Tubular Puf Insulation', which has no active SKU per length in 'hvac_insulation'", items=no_puf)
        # the reverse direction: an edit to the DELEGATED category that takes a family away breaks Piping's section
        def drop_family(by):
            del by[INSULATION]["list_spec"]["pricing"]["families"]["Tubular Puf Insulation"]
        broken(drop_family, "offers 'Tubular Puf Insulation', which is not a priceable family of 'hvac_insulation'")
        # another discipline's category of the same id does not satisfy a section
        configs = _stored(self.v37)
        for c in configs:
            if c["category_id"] == INSULATION:
                c["discipline"] = "Electrical"
        self.assertIn("does not exist in HVAC", problems(configs, self.v37["items"])[0])
        # FINDING (premise check): "Cladding Only" is NOT refused -- Insulation prices it per metre and stocks it
        # per metre (5 SKUs). It is absent from the section because the owner ruled the two families, not because
        # any check forbids it.
        configs = _stored(self.v37)
        next(c for c in configs if c["category_id"] == CATEGORY)["list_spec"]["sections"][1]["families"] = SECTION_FAMILIES + ["Cladding Only"]
        self.assertEqual(problems(configs, self.v37["items"]), [])
        self.assertEqual(len([it for it in self.v37["items"] if it["kind"] == "hvac_insulation_item"
                              and it["attributes"].get("item") == "Cladding Only" and it["unit"] == "Mts"]), 5)

    def test_18_the_piping_questions_grow_by_insulated_and_insulations_model_call_is_byte_identical(self):
        before = extraction.build_items_spec(self.cfg36)
        after = extraction.build_items_spec(self.cfg)
        self.assertEqual([d["id"] for d in before["attribute_definitions"]], ["pipe_type", "size_mm", "pipe_class"])
        self.assertEqual([d["id"] for d in after["attribute_definitions"]], ["pipe_type", "size_mm", "pipe_class", "insulated"])
        self.assertEqual(after["attribute_definitions"][:3], before["attribute_definitions"], "the three existing questions are unchanged")
        q = after["attribute_definitions"][3]
        self.assertEqual({k: q[k] for k in ("id", "label", "type", "values")}, {"id": "insulated", "label": "Insulated", "type": "choice", "values": ["Yes", "No"]})
        self.assertEqual({k: v for k, v in after.items() if k != "attribute_definitions"}, {k: v for k, v in before.items() if k != "attribute_definitions"})
        cfgs = lambda a: {("HVAC", c["category_id"]): dict(c, discipline="HVAC") for c in a["category_configs"]}
        c36, c37 = cfgs(self.v36), cfgs(self.v37)
        row = {"excel_row": 21, "description": "19 mm thick nitrile rubber insulation for 28 mm dia refrigerant pipe",
               "sheet_name": "S", "ancestors": [{"node_type": "Preamble", "description": "INSULATION"}],
               "own_notes_raw": [], "attached_notes": "", "append_notes_raw": []}
        payload = [extraction._ai_item(row)]
        def content(g):
            return extraction.batch_prompt_content(g["prompt"], g["defs"], payload, synonyms=g["synonyms"], defaults=g["defaults"],
                                                   none_guidance=g["none_guidance"], slot_spec=g["slot_spec"],
                                                   resolution_rules=g["resolution_rules"], rules=g["rules"],
                                                   items_spec=g.get("items_spec"))
        for cid in (INSULATION, "hvac_adp"):
            self.assertEqual(extraction.build_items_spec(c37[("HVAC", cid)]), extraction.build_items_spec(c36[("HVAC", cid)]))
            g36, g37 = extraction._group_context(c36, "HVAC", cid), extraction._group_context(c37, "HVAC", cid)
            self.assertEqual(g37, g36, "%s: the group context is identical" % cid)
            self.assertTrue(g37.get("items_spec"), "a context with no ITEMS_SPEC would be a vacuous match")
            self.assertEqual(content(g37), content(g36), "%s: the assembled model call is byte-identical" % cid)
        # Piping's own call differs by the one definition and by nothing of the section
        p36, p37 = content(extraction._group_context(c36, "HVAC", CATEGORY)), content(extraction._group_context(c37, "HVAC", CATEGORY))
        self.assertNotEqual(p37, p36)
        self.assertIn('"insulated"', p37)
        self.assertNotIn('"insulated"', p36)
        # INVERTED by SLICE 12e-4b under mechanical authority (owner D-2, 2026-10-13: a Piping row is also asked
        # Insulation's OWN questions, built from Insulation's config at asking time).
        # BEFORE: for word in ("sections", "include_when", "add_label", "from pipe", "hvac_insulation",
        #                      "Nitrile Rubber Insulation"): assertNotIn(word, p37)   -- nothing of the section reached the model
        # AFTER: the delegated category's QUESTIONS reach it (its spec under "sections", its material list) ...
        for word in ('"sections"', "Nitrile Rubber Insulation"):
            self.assertIn(word, p37, "the delegated category's own questions reach the model: %s" % word)
        self.assertIn(json.dumps(extraction.build_items_spec(c37[("HVAC", INSULATION)]), ensure_ascii=False), p37)
        self.assertNotIn('"sections"', p36)
        # ... NEGATIVE HALF KEPT: the section's DECLARATION (how the panel opens, mirrors and prices it) still does not
        for word in ("include_when", "add_label", "from pipe", "hvac_insulation"):
            self.assertNotIn(word, p37, "nothing of the section declaration reaches the model: %s" % word)


class TestSlice12e3aGates(FrappeTestCase):
    """The LIVE site. Every case is a REFUSAL; each is verified to have written nothing (the active HVAC batch, the
    item and config counts and the stored Piping / Insulation configs are read before and after)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v37 = _read(V37)

    def _state(self):
        items = frappe.get_all("BoQ Rate Master Item", filters={"discipline": "HVAC", "active": 1}, fields=["import_batch"])
        cfgs = frappe.get_all("BoQ Rate Category Config", filters={"discipline": "HVAC", "active": 1},
                              fields=["name", "category_id", "config", "modified"], order_by="category_id asc")
        return (len(items), sorted({i.import_batch for i in items}), [(c.name, c.category_id, c.modified, c.config) for c in cfgs],
                frappe.db.count("BoQ Rate Master Item", {"discipline": "HVAC"}), frappe.db.count("BoQ Rate Category Config", {"discipline": "HVAC"}))

    def _payload(self, mutate):
        p = copy.deepcopy(self.v37)
        mutate(next(c for c in p["category_configs"] if c["category_id"] == CATEGORY)["list_spec"]["sections"][1], p)
        return p

    def test_19_the_import_refuses_a_broken_section_before_the_first_write(self):
        cases = [
            (lambda s, p: s.update(category_id="hvac_lagging"), "names category 'hvac_lagging', which does not exist in HVAC"),
            (lambda s, p: s.update(category_id="hvac_pumps"), "which is not an item-list category with pricing rules"),
            (lambda s, p: s.update(families=["Thermal Nitrile Insulation"]), "does not price per length"),
            (lambda s, p: s["mirror"].update(to="thickness"), "is not one of the number readers of 'hvac_insulation'"),
            (lambda s, p: p.update(items=[it for it in p["items"] if (it.get("attributes") or {}).get("item") != "Tubular Puf Insulation"]),
             "has no active SKU per length"),
            (lambda s, p: s.update(include_when={"attr": "insulated", "equals": "Maybe"}), "is not a value of 'insulated'"),   # the shape half
        ]
        from unittest import mock
        before = self._state()
        # SAFETY: a load COMMITS on success. Should a refusal ever fail to fire, the commit itself raises here and
        # the rollback below undoes the load -- a failing negative test must never leave a broken catalogue live.
        with mock.patch.object(frappe.db, "commit", side_effect=AssertionError("a refused import must never reach a commit")):
            try:
                for mutate, needle in cases:
                    with self.assertRaises(frappe.ValidationError) as cm:
                        loader.load_rate_master(payload=self._payload(mutate), replace=True)
                    self.assertIn(needle, str(cm.exception))
                    self.assertEqual(self._state(), before, "refused BEFORE the first write: %s" % needle)
                msg = None
                try:
                    loader.load_rate_master(payload=self._payload(cases[0][0]), replace=True)
                except frappe.ValidationError as e:
                    msg = str(e)
                self.assertIn("Rate master import refused", msg)
                self.assertIn("Nothing was written", msg)
            finally:
                frappe.db.rollback()
        self.assertEqual(self._state(), before)

    def test_20_the_editor_save_refuses_a_broken_section_in_both_directions_and_stores_nothing(self):
        frappe.set_user("Administrator")
        name = lambda cid: frappe.db.get_value("BoQ Rate Category Config", {"discipline": "HVAC", "category_id": cid, "active": 1}, "name")
        live = lambda cid: frappe.parse_json(frappe.db.get_value("BoQ Rate Category Config", name(cid), "config"))
        piping, insulation = live(CATEGORY), live(INSULATION)
        self.assertIn("sections", piping["list_spec"], "load v37 first")
        from unittest import mock
        before = self._state()
        commit_guard = mock.patch.object(frappe.db, "commit", side_effect=AssertionError("a refused save must never reach a commit"))
        commit_guard.start()
        self.addCleanup(commit_guard.stop)
        try:
            # the shipped configs pass the same call the save makes -- nothing is saved here
            config_validation.validate_delegated_sections([copy.deepcopy(piping)], label="Config not saved")
            config_validation.validate_delegated_sections([copy.deepcopy(insulation)], label="Config not saved")
            def refused(cid, cfg, needle):
                # RE-POINTED at ADP-5a (owner D9, 2026-10-21: the endpoint "kept one slice, then removed"): BEFORE
                # `rate_master.update_rate_config(name=name(cid), config=json.dumps(cfg))`, whose cross-category half
                # was exactly this call
                with self.assertRaises(frappe.ValidationError) as cm:
                    config_validation.validate_delegated_sections([copy.deepcopy(cfg)], label="Config not saved")
                self.assertIn(needle, str(cm.exception))
                self.assertIn("Config not saved", str(cm.exception))
                self.assertEqual(self._state(), before, "nothing stored: %s" % needle)
            bad = copy.deepcopy(piping); bad["list_spec"]["sections"][1]["category_id"] = "hvac_lagging"
            refused(CATEGORY, bad, "names category 'hvac_lagging', which does not exist in HVAC")
            bad = copy.deepcopy(piping); bad["list_spec"]["sections"][1]["category_id"] = "hvac_pumps"
            refused(CATEGORY, bad, "which is not an item-list category with pricing rules")
            bad = copy.deepcopy(piping); bad["list_spec"]["sections"][1]["families"] = ["Thermal Nitrile Insulation"]
            refused(CATEGORY, bad, "does not price per length")
            bad = copy.deepcopy(piping); bad["list_spec"]["sections"][1]["mirror"]["to"] = "thickness"
            refused(CATEGORY, bad, "is not one of the number readers of 'hvac_insulation'")
            # the reverse direction, through the pure half of the same call: an Insulation config that no longer
            # prices a family Piping's section offers is refused on ITS save
            gone = copy.deepcopy(insulation)
            del gone["list_spec"]["pricing"]["families"]["Tubular Puf Insulation"]
            with self.assertRaises(frappe.ValidationError) as cm:
                config_validation.validate_delegated_sections([gone], label="Config not saved")
            self.assertIn("hvac_piping: section 'insulation' offers 'Tubular Puf Insulation', which is not a priceable family", str(cm.exception))
            self.assertEqual(self._state(), before)
        finally:
            frappe.db.rollback()
        self.assertEqual(self._state(), before)

    def test_21_the_production_call_with_a_file_path_reaches_the_cross_category_check(self):
        """SLICE 12e-3b AC7 (owner: "Add loader.py to scope" -- the check "must run on the path production uses").
        The production runbook's load is `loader.load_rate_master(path=<asset file>, replace=True)`. An HVAC asset
        carries `category_configs` (a LIST), so that call takes the multi-config path, which runs the cross-category
        check before the first write. Proved through EXACTLY that call: a v37 file with a broken section is
        refused, the check ran once, nothing was written. The single-config path (a payload with the singular
        `category_config`) is not what an HVAC asset file takes -- pinned by the file's own shape."""
        import os
        import tempfile
        from unittest import mock
        self.assertIsInstance(self.v37.get("category_configs"), list)
        self.assertNotIn("category_config", self.v37)
        bad = self._payload(lambda s, p: s.update(category_id="hvac_lagging"))
        fd, path = tempfile.mkstemp(prefix="rm_12e3b_ac7_", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(bad, fh)
        before = self._state()
        try:
            with mock.patch.object(frappe.db, "commit", side_effect=AssertionError("a refused import must never reach a commit")),                  mock.patch.object(config_validation, "validate_delegated_sections", wraps=config_validation.validate_delegated_sections) as check:
                with self.assertRaises(frappe.ValidationError) as cm:
                    loader.load_rate_master(path=path, replace=True)
            self.assertEqual(check.call_count, 1, "the production call reaches the cross-category check exactly once")
            self.assertIn("names category 'hvac_lagging', which does not exist in HVAC", str(cm.exception))
            self.assertIn("Rate master import refused", str(cm.exception))
            self.assertIn("Nothing was written", str(cm.exception))
            self.assertEqual(self._state(), before, "refused BEFORE the first write")
            # NEGATIVE: with the check disabled the same call would go on to write -- so the refusal above IS the check's
            with mock.patch.object(frappe.db, "commit", side_effect=AssertionError("stopped at the commit: the load got past the gate")),                  mock.patch.object(config_validation, "validate_delegated_sections", return_value=None):
                with self.assertRaises(AssertionError) as past:
                    loader.load_rate_master(path=path, replace=True)
            self.assertIn("the load got past the gate", str(past.exception))
        finally:
            frappe.db.rollback()
            os.unlink(path)
        self.assertEqual(self._state(), before)


class TestSlice12e3cSingleConfigLoad(FrappeTestCase):
    """SLICE 12e-3c AC3 (owner F9, 2026-10-12: "Loading a single config doesn't run the cross-category check" - "fix").

    What these protect, in plain English:
      test_22  the single-config load -- `loader.load_rate_master(payload={"category_config": ..., "items": ...})`,
               the real call -- runs the cross-category check: a config with a broken delegated section is REFUSED with
               the check's own message before anything is written; a good config LOADS; a good delegated section is
               ACCEPTED by the check (the call then stops at the loader's own "already loaded" refusal, which sits
               after it). Everything happens in a scratch discipline inside one transaction that is rolled back; the
               live HVAC catalogue is read before and after.
      test_23  the corpus check: the check ACCEPTS every config shipping today -- HVAC v37 all 10 and Electrical v66
               all 13 -- one at a time (as a single write) and as whole assets; and names which of them the
               single-config path's own shape gate would let through at all.
    """

    SCRATCH = "ZZ 12e3c scratch"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v37 = _read(V37)
        cls.e66 = _read("rate_master_electrical_all_v66.json")

    def _live(self):
        return (frappe.db.count("BoQ Rate Master Item", {"discipline": "HVAC", "active": 1}),
                frappe.db.count("BoQ Rate Category Config", {"discipline": "HVAC", "active": 1}),
                frappe.db.count("BoQ Rate Master Item", {"discipline": "HVAC"}),
                frappe.db.count("BoQ Rate Category Config", {"discipline": "HVAC"}),
                frappe.db.count("BoQ Rate Master Item", {"discipline": "Electrical"}),
                frappe.db.count("BoQ Rate Category Config", {"discipline": "Electrical"}))

    def _scratch_rows(self):
        return (frappe.db.count("BoQ Rate Master Item", {"discipline": self.SCRATCH}),
                frappe.db.count("BoQ Rate Category Config", {"discipline": self.SCRATCH}))

    def _cfg(self, category_id):
        c = copy.deepcopy(next(x for x in self.v37["category_configs"] if x["category_id"] == category_id))
        c["discipline"] = self.SCRATCH
        return c

    def _items(self, kind):
        return [copy.deepcopy(it) for it in self.v37["items"] if it["kind"] == kind]

    def _section(self, **over):
        """A delegated section an ADP-shaped config can carry: independent (no toggle, no mirror), per metre."""
        s = {"id": "insulation", "label": "Insulation", "add_label": "Add insulation", "category_id": INSULATION,
             "unit_class": "length", "families": ["Nitrile Rubber Insulation", "Tubular Puf Insulation"]}
        s.update(over)
        return s

    def _adp(self, section=None):
        """The shipped ADP config (the one HVAC config with top-level pipelines, so the single-config path's own
        shape gate lets it through), optionally declaring a delegated section."""
        c = self._cfg("hvac_adp")
        if section is not None:
            c["list_spec"]["sections"] = [{"id": "item", "label": "Item", "add_label": "Add item"}, section]
        return {"category_config": c, "items": self._items("hvac_adp_item"), "source_workbook": "12e-3c test"}

    def test_22_the_single_config_load_runs_the_cross_category_check(self):
        from unittest import mock
        live_before = self._live()
        self.assertEqual(self._scratch_rows(), (0, 0), "the scratch discipline starts empty")
        try:
            # every commit inside the loader is held back: the whole test is one transaction, rolled back below
            with mock.patch.object(frappe.db, "commit"), \
                 mock.patch.object(config_validation, "validate_delegated_sections", wraps=config_validation.validate_delegated_sections) as check:
                # (a) the delegated category, loaded first through the multi path (it has no top-level pipeline, so
                #     the single-config path's shape gate refuses it -- pinned in test_23)
                ins = self._cfg(INSULATION)
                del ins["discipline"]
                # the scratch copy drops the derived-cell links: they name item uids, which belong to the LIVE
                # discipline's rows, and the section check reads families and units, not derived cells
                ins.pop("derived_rates", None)
                loader.load_rate_master(payload={"discipline": self.SCRATCH, "category_configs": [ins],
                                                 "items": self._items("hvac_insulation_item"), "goldens": {}}, replace=False)
                n_after_a = self._scratch_rows()
                self.assertGreater(n_after_a[0], 100)
                check.reset_mock()

                # (b) BROKEN, through the single-config call: refused with the check's own message, nothing written
                for over, needle in [({"category_id": "hvac_lagging"}, "names category 'hvac_lagging', which does not exist in"),
                                     ({"families": ["Thermal Nitrile Insulation"]}, "does not price per length")]:
                    with self.assertRaises(frappe.ValidationError) as cm:
                        loader.load_rate_master(payload=self._adp(self._section(**over)), replace=False)
                    self.assertIn(needle, str(cm.exception))
                    self.assertIn("Rate master import refused", str(cm.exception))
                    self.assertIn("Nothing was written", str(cm.exception))
                    self.assertEqual(self._scratch_rows(), n_after_a, "refused BEFORE the first write: %s" % needle)
                self.assertEqual(check.call_count, 2, "the single-config call reached the check each time")
                check.reset_mock()

                # (c) a GOOD delegated section is ACCEPTED by the check: the call goes on to the loader's own
                #     "already loaded" refusal (replace=False with active items), which sits AFTER the check
                with self.assertRaises(frappe.ValidationError) as cm:
                    loader.load_rate_master(payload=self._adp(self._section()), replace=False)
                self.assertIn("Rate master already loaded for discipline", str(cm.exception))
                self.assertNotIn("Rate master import refused", str(cm.exception))
                self.assertEqual(check.call_count, 1)
                self.assertEqual(self._scratch_rows(), n_after_a)
                check.reset_mock()

                # (d) a GOOD config LOADS through the single-config call (replace=True supersedes the scratch rows)
                out = loader.load_rate_master(payload=self._adp(), replace=True)
                self.assertEqual(out["status"], "loaded")
                self.assertEqual(out["config_loaded"], 1)
                self.assertEqual(out["items_total"], len(self._items("hvac_adp_item")))
                self.assertEqual(check.call_count, 1, "a good load runs the check too")
                self.assertEqual(frappe.db.count("BoQ Rate Category Config", {"discipline": self.SCRATCH, "category_id": "hvac_adp", "active": 1}), 1)

            # NEGATIVE (vacuity inside the test): with the check disabled the broken load of (b) is NOT refused for
            # its section -- it reaches the loader's later refusal instead -- so the refusal in (b) IS the check's
            with mock.patch.object(frappe.db, "commit"), \
                 mock.patch.object(config_validation, "validate_delegated_sections", return_value=None):
                with self.assertRaises(frappe.ValidationError) as cm:
                    loader.load_rate_master(payload=self._adp(self._section(category_id="hvac_lagging")), replace=False)
                self.assertNotIn("hvac_lagging", str(cm.exception))
                self.assertIn("Rate master already loaded for discipline", str(cm.exception))
        finally:
            frappe.db.rollback()
        self.assertEqual(self._scratch_rows(), (0, 0), "nothing of the scratch discipline is left")
        self.assertEqual(self._live(), live_before, "the live catalogue was not touched")

    def test_23_the_check_accepts_every_config_shipping_today(self):
        """The corpus check (v1.8 lesson 3: a new gate must be run over everything it will meet before it ships).
        READ-ONLY: the check reads the live catalogue and writes nothing."""
        live_before = self._live()
        shipped = [("HVAC", self.v37), ("Electrical", self.e66)]
        self.assertEqual([len(a["category_configs"]) for _d, a in shipped], [10, 13])
        accepted, through_single_gate = [], []
        for disc, asset in shipped:
            loaded = [loader._loaded_config(c, disc, asset.get("goldens") or {}) for c in asset["category_configs"]]
            # the whole asset, as `_load_multi` checks it
            config_validation.validate_delegated_sections(loaded, asset["items"], label="corpus")
            for cfg in loaded:
                # one config at a time, as a single write: with its own items (an import) and with none (the editor)
                kinds = set(cfg.get("item_kinds") or [])
                own_items = [it for it in asset["items"] if it["kind"] in kinds]
                config_validation.validate_delegated_sections([cfg], own_items, label="corpus")
                config_validation.validate_delegated_sections([cfg], label="corpus")
                accepted.append("%s/%s" % (disc, cfg["category_id"]))
                pl = cfg.get("pipelines")
                if isinstance(pl, dict) and pl:
                    through_single_gate.append("%s/%s" % (disc, cfg["category_id"]))
        self.assertEqual(len(accepted), 23)
        # which shipping configs the single-config path's OWN shape gate (non-empty top-level pipelines) lets
        # through at all: ADP and twelve Electrical categories -- and none of them declares a delegated section
        self.assertEqual(sorted(through_single_gate), sorted(
            ["HVAC/hvac_adp"] + ["Electrical/" + c for c in (
                "cabletray_raceway", "conduit_piping", "db_switchgear", "earthing", "industrial_sockets", "junction_box_raceway",
                "lighting_mgmt_system", "miscellaneous", "point_wiring", "popup_boxes", "switches_sockets", "wiring_cabling")]))
        declaring = [c["category_id"] for _d, a in shipped for c in a["category_configs"]
                     if isinstance(c.get("list_spec"), dict) and config_validation.SECTIONS_KEY in c["list_spec"]]
        self.assertEqual(declaring, [CATEGORY])
        # the one config that declares a section cannot take the single-config path: its shape gate refuses it first
        piping = next(c for c in self.v37["category_configs"] if c["category_id"] == CATEGORY)
        with self.assertRaises(frappe.ValidationError) as cm:
            loader._validate_payload({"category_config": dict(copy.deepcopy(piping), discipline="HVAC"),
                                      "items": [it for it in self.v37["items"] if it["kind"] == "hvac_piping_item"]})
        self.assertIn("category_config is missing 'pipelines'", str(cm.exception))
        self.assertEqual(self._live(), live_before)


V38 = "rate_master_hvac_all_v38.json"   # 12e-4b: v37 + what a Piping row is asked (D-1 / D-2 / D-3, F-3) + Insulation's one key (F-1)
AS_WRITTEN = "pipe_type_as_written"
SS_SENTENCE = "No SKU in the catalogue for SS pipe - price this row by hand"
# AC0 -- BOQ-26-00073 / sheet "HVAC" / rows 53 and 60, as `assemble_population` yields them (read 2026-10-13): each
# row's own text and its parent heading are the BoQ's, word for word; the grandparent ("VRF SYSTEM") is carried by
# its description alone (its 2.5 KB specification note says nothing about a pipe and is left out of the fixture).
AC0_PARENT_53 = (
    "Supplying, Installing, testing and commissioning of interconnecting Liquid / Gas refrigerant copper piping duly "
    "insulated with Close cell elastomeric Nitrile rubber Class ‘O’ tubular insulation of thickness 13 or 19 mm as "
    "mentioned below with minimum 45 Kg/ m2 density, thermal conductivity 0.037 W/MK or better at 20 deg mean "
    "temperature. The exposed to sun refrigerant pipe insulation shall be cover with UL certified UV protective coating "
    "with 7 mill fiber glass cloth applied by suitable adhesive. All the copper piping shall be eddy current test "
    "certified. All piping inside & outside the building shall run inside and propoerly supported using cable trays. "
    "Notes: 1. This items shall include cost of refrigerant filling for required lenghth of pipe. 2. The piping upto "
    "15.1 mm will be soft drawn and higher sizes will be hard drawn. 3. Insulation thickness to be 13mm for liquid line "
    "and 19mm for suction line 4. The cost of cable trays has been has been considered elsewhere in the tender. 5. The "
    "cost of UL certified UV protective coating has been has been considered elsewhere in the tender."
)
AC0_PARENT_60 = (
    "Supply, installation, testing and commissioning Rigid heavy class (10KG) uPVC Condensate Drain piping of following "
    "sizes with minimum 6/9 mm nitrile rubber insulation over the pipes, complete with fittings, supports, U trap "
    "arrangement, clean plug and accessories for units as per specifications and technical specification."
)


def _ac0_row(excel_row, description, parent):
    return {"excel_row": excel_row, "node_type": "Line Item", "description": description, "sheet_name": "HVAC",
            "committed_version": 1, "notes": "", "own_notes_raw": None, "attached_notes": None, "append_notes_raw": None,
            "ancestors": [{"node_type": "Preamble", "description": "VRF SYSTEM", "notes": "", "own_notes_raw": None, "attached_notes": None, "append_notes_raw": None},
                          {"node_type": "Preamble", "description": parent, "notes": "", "own_notes_raw": None, "attached_notes": None, "append_notes_raw": None}],
            "warnings": [], "category_id": CATEGORY, "discipline": "HVAC"}


AC0_ROWS = [_ac0_row(53, "22.3 mm O.D (wall Thickness-1.0 mm) (insulation : 13/19 mm)", AC0_PARENT_53),
            _ac0_row(60, "25 mm dia", AC0_PARENT_60)]
_c = lambda v, conf=0.9: {"value": v, "confidence": conf}
# the 12e-4a stub answers (X1, X2), as a model would write them: a pipe item, then the marked insulation item
AC0_REPLY = [
    {"id": 53, "items": [
        {"attributes": {"pipe_type": _c("Copper"), AS_WRITTEN: _c("copper"), "size_mm": _c("22.3 mm O.D"),
                        "pipe_class": _c("wall Thickness-1.0 mm"), "insulated": _c("Yes")}},
        {"section": "insulation", "attributes": {"item": _c("Nitrile Rubber Insulation"), "cladding": _c("None", 0.6), "thickness_mm": _c("13/19 mm"),
                                                 "material_as_written": _c("Nitrile rubber")}}]},
    {"id": 60, "items": [
        {"attributes": {AS_WRITTEN: _c("uPVC"), "size_mm": _c("25 mm dia"), "pipe_class": _c("heavy class (10KG)"), "insulated": _c("Yes")}},
        {"section": "insulation", "attributes": {"item": _c("Nitrile Rubber Insulation"), "cladding": _c("None", 0.6), "thickness_mm": _c("6/9 mm")}}]},
]
_z = {"value": None, "confidence": 0.0}
# WHAT THE RUN STORES for those two rows (`run_extraction`'s result rows): every definition of each item's own kind
# present, the insulation item marked. The frontend half of AC0 (`slice12e4b.test.ts`) prices THIS shape; the two
# halves are tied by `AC0_STORED_SHA256`, the digest of this list in canonical JSON, pinned in both files.
AC0_STORED = [
    {"excel_row": 53, "description": "22.3 mm O.D (wall Thickness-1.0 mm) (insulation : 13/19 mm)", "category_id": CATEGORY, "attributes": {},
     "items": [
         {"attributes": {"pipe_type": _c("Copper"), AS_WRITTEN: _c("copper"), "size_mm": _c("22.3 mm O.D"),
                         "pipe_class": _c("wall Thickness-1.0 mm"), "insulated": _c("Yes")}},
         {"attributes": {"item": _c("Nitrile Rubber Insulation"), "cladding": _c("None", 0.6), "thickness_mm": _c("13/19 mm"), "pipe_size_mm": dict(_z),
                         "brand": dict(_z), "material_as_written": _c("Nitrile rubber")}, "section": "insulation"}],
     "item_flags": []},
    {"excel_row": 60, "description": "25 mm dia", "category_id": CATEGORY, "attributes": {},
     "items": [
         {"attributes": {"pipe_type": dict(_z), AS_WRITTEN: _c("uPVC"), "size_mm": _c("25 mm dia"), "pipe_class": _c("heavy class (10KG)"),
                         "insulated": _c("Yes")}},
         {"attributes": {"item": _c("Nitrile Rubber Insulation"), "cladding": _c("None", 0.6), "thickness_mm": _c("6/9 mm"), "pipe_size_mm": dict(_z),
                         "brand": dict(_z), "material_as_written": dict(_z)}, "section": "insulation"}],
     "item_flags": []},
]
AC0_STORED_SHA256 = "8fb71189d4f1302d9f3d689b5170bf256297f40e1fad750eac3d808b6d4cd72d"


def _canonical(obj):
    """The canonical JSON both AC0 halves hash: sorted keys, no spaces, UTF-8 as written, and a whole-number float
    written as the integer it is (Python writes 0.0 where JavaScript writes 0 -- the run document is JSON, so the
    frontend reads the same number either way)."""
    def norm(x):
        if isinstance(x, float) and x.is_integer():
            return int(x)
        if isinstance(x, dict):
            return {k: norm(v) for k, v in x.items()}
        if isinstance(x, list):
            return [norm(v) for v in x]
        return x
    return json.dumps(norm(obj), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class TestSlice12e4bAssetV38(FrappeTestCase):
    """SLICE 12e-4b (2026-10-13) -- HVAC v38 = v37 + what the model is asked on a Piping row + one Insulation key.

      test_24  THE DIFF: every item and every other config byte-equal; Insulation differs by `numbers.pipe_size_mm.near`
               alone; Piping by the five notes, the as-written definition, the second opinion, `family_text.from_attr`,
               "Stainless steel" in the refuse list and `panel_readonly` -- taken out again, the config IS v37's.
      test_25  v38 is the newest HVAC asset on disk; v37 stays as the 12e-3a record.
      test_26  THE VALIDATOR admits `family_text.from_attr` and `numbers.<axis>.near`, and refuses each in a wrong
               shape by name (NEGATIVE, one refusal per mistake).
      test_27  WHAT THE MODEL IS SENT with v38: the five notes with their rulings in them, the as-written question,
               Insulation's block whole, the second opinion on; NEGATIVE: every other HVAC category's request is
               byte-identical v37 -> v38 (Insulation's too -- its new key is a pricing key and never reaches the model).
      test_28  AC0, the backend half: the 12e-4a stub answers for BOQ-26-00073 rows 53 and 60 through the REAL
               `run_extraction` (the real request builder, the real `_extract_batch`, the real result row) with a
               stub client -- no network, no capture-log line -- store exactly `AC0_STORED`.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v37, cls.v38 = _read(V37), _read(V38)
        cls.cfg = next(c for c in cls.v38["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg37 = next(c for c in cls.v37["category_configs"] if c["category_id"] == CATEGORY)
        cls.ins = next(c for c in cls.v38["category_configs"] if c["category_id"] == INSULATION)
        cls.ins37 = next(c for c in cls.v37["category_configs"] if c["category_id"] == INSULATION)
        cls.cfgs38 = {("HVAC", c["category_id"]): c for c in _stored(cls.v38)}
        cls.cfgs37 = {("HVAC", c["category_id"]): c for c in _stored(cls.v37)}

    def test_24_v38_is_v37_plus_the_ruled_changes_and_nothing_else(self):
        self.assertEqual(self.v38["items"], self.v37["items"], "every item unchanged, in the same order")
        self.assertEqual(json.dumps(self.v38["items"]), json.dumps(self.v37["items"]))
        self.assertEqual([c["category_id"] for c in self.v38["category_configs"]], [c["category_id"] for c in self.v37["category_configs"]])
        changed = [a["category_id"] for a, b in zip(self.v38["category_configs"], self.v37["category_configs"]) if a != b]
        self.assertEqual(changed, [INSULATION, CATEGORY])
        for k in set(self.v37) | set(self.v38):
            if k not in ("items", "category_configs"):
                self.assertEqual(self.v38.get(k), self.v37.get(k), "top-level key %s is unchanged" % k)
        # Insulation: the ONE key
        self.assertEqual(self.ins["list_spec"]["pricing"]["numbers"]["pipe_size_mm"]["near"], 0.1)
        back = copy.deepcopy(self.ins)
        del back["list_spec"]["pricing"]["numbers"]["pipe_size_mm"]["near"]
        self.assertEqual(back, self.ins37, "with the one key taken out the Insulation config IS v37's")
        self.assertEqual(json.dumps(back), json.dumps(self.ins37), "and in the same key order")
        self.assertNotIn("near", self.ins["list_spec"]["pricing"]["numbers"]["thickness_mm"])
        self.assertEqual(self.ins["list_spec"]["pricing"]["size_match"], {"dp": [2, 1]})
        # Piping: the listed changes, and nothing else
        ls = self.cfg["list_spec"]
        self.assertEqual([d["id"] for d in ls["attribute_definitions"]], ["pipe_type", AS_WRITTEN, "size_mm", "pipe_class", "insulated"])
        d = ls["attribute_definitions"][1]
        self.assertEqual({k: d[k] for k in ("id", "label", "type")}, {"id": AS_WRITTEN, "label": "Pipe type as written", "type": "text"})
        self.assertEqual(sorted(d), ["id", "label", "note", "type"])
        self.assertIs(ls["second_opinion"], True)
        pr = ls["pricing"]
        self.assertEqual(pr["family_text"]["from_attr"], AS_WRITTEN)
        self.assertEqual([r["from"] for r in pr["family_text"]["refuse"]], ["SS", "Stainless steel"])
        self.assertEqual({r["refuse"] for r in pr["family_text"]["refuse"]}, {SS_SENTENCE})
        self.assertEqual(pr["panel_readonly"], [AS_WRITTEN])
        self.assertEqual(ls["attribute_definitions"][0]["values"], ["Copper", "MS", "PVC", "CPVC"], "the dropdown stays the four stocked types")
        back = copy.deepcopy(self.cfg)
        bl = back["list_spec"]
        bl["attribute_definitions"] = [x for x in bl["attribute_definitions"] if x["id"] != AS_WRITTEN]
        for x, old in zip(bl["attribute_definitions"], self.cfg37["list_spec"]["attribute_definitions"]):
            self.assertNotEqual(x["note"], old["note"], x["id"])
            self.assertEqual({k: v for k, v in x.items() if k != "note"}, {k: v for k, v in old.items() if k != "note"}, x["id"])
            x["note"] = old["note"]
        bl["second_opinion"] = False
        bl["pricing"]["family_text"]["refuse"] = bl["pricing"]["family_text"]["refuse"][:1]
        del bl["pricing"]["family_text"]["from_attr"]
        del bl["pricing"]["panel_readonly"]
        self.assertEqual(back, self.cfg37, "with the listed changes taken out the Piping config IS v37's")
        self.assertEqual(json.dumps(back), json.dumps(self.cfg37), "and in the same key order")
        # the two placeholders are gone from the whole asset
        self.assertNotIn("is written in 12e-4", json.dumps(self.v38))
        self.assertIn("is written in 12e-4", json.dumps(self.v37))

    def test_25_v38_is_the_newest_hvac_asset_on_disk(self):
        d = os.path.dirname(_asset_path(V38))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # BEFORE: self.assertEqual(max(ns), 38)
        self.assertNotEqual(max(ns), 38, "12e-5b: v38 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 39)
        self.assertNotEqual(max(ns), 39, "12e-5b C3: v39 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 40)
        self.assertNotEqual(max(ns), 40, "12e-5b2: v40 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 41)
        self.assertNotEqual(max(ns), 41, "12e-5c: v41 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 42)
        self.assertNotEqual(max(ns), 42, "12e-6: v42 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 43)
        self.assertNotEqual(max(ns), 43, "12e-6b: v43 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 45)
        self.assertNotEqual(max(ns), 45, "12e-6c: v45 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 46)
        self.assertNotEqual(max(ns), 46, "ADP-1: v46 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 47)
        self.assertNotEqual(max(ns), 47, "ADP-2: v47 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        self.assertTrue(os.path.exists(_asset_path(V37)), "v37 stays on disk as the 12e-3a record")
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v%d.json" % (max(ns) + 1))))

    def test_26_the_validator_admits_the_two_new_keys_and_refuses_each_wrong_shape_by_name(self):
        def refused(base, mutate, needle):
            cfg = copy.deepcopy(base)
            mutate(cfg["list_spec"])
            with self.assertRaises(frappe.ValidationError) as cm:
                config_validation._validate_config(loader._loaded_config(cfg, "HVAC", {}))
            self.assertIn(needle, str(cm.exception))
        for c in _stored(self.v38):
            config_validation._validate_config(c)                      # every shipped config passes
        self.assertEqual(config_validation.delegated_section_problems(_stored(self.v38), self.v38["items"]), [])
        ft = lambda ls: ls["pricing"]["family_text"]
        # `from_attr`: a text definition of this category that the pricing does not match on
        refused(self.cfg, lambda ls: ft(ls).update(from_attr=""), "from_attr must be an item attribute id")
        refused(self.cfg, lambda ls: ft(ls).update(from_attr=7), "from_attr must be an item attribute id")
        refused(self.cfg, lambda ls: ft(ls).update(from_attr="pipe_word"), "from_attr names 'pipe_word', which is not an item attribute of this category")
        refused(self.cfg, lambda ls: ft(ls).update(from_attr="pipe_type"), "from_attr: 'pipe_type' is read by the pricing")
        refused(self.cfg, lambda ls: ft(ls).update(from_attr="size_mm"), "from_attr: 'size_mm' is read by the pricing")
        refused(self.cfg, lambda ls: ft(ls).update(from_attr="insulated"), "from_attr: 'insulated' must be a text definition")
        # ... and it MAY be shown read-only: that is the ruled shape (D-3), so the shipped pair passes; a definition
        # the config does not carry cannot be read-only
        refused(self.cfg, lambda ls: ls.update(attribute_definitions=[d for d in ls["attribute_definitions"] if d["id"] != AS_WRITTEN]),
                "which is not an item attribute of this category")
        # v37 (no such key) is still refused the key under its old closed list only by NAME of a wrong shape, never for lacking it
        config_validation._validate_config(loader._loaded_config(copy.deepcopy(self.cfg37), "HVAC", {}))
        # `near` on one axis: a positive number, on a ladder
        num = lambda ls: ls["pricing"]["numbers"]["pipe_size_mm"]
        for bad in (0, -0.1, "0.1", True, None):
            refused(self.ins, lambda ls, bad=bad: num(ls).update(near=bad), "numbers['pipe_size_mm'].near must be a positive number")
        refused(self.ins, lambda ls: ls["pricing"].update(ladders=["thickness_mm"]), "numbers['pipe_size_mm'].near needs 'pipe_size_mm' in list_spec.pricing.ladders")
        refused(self.ins, lambda ls: num(ls).update(nearest=0.1), "nearest")          # an unknown reader key is still refused by name
        ok = copy.deepcopy(self.ins)
        ok["list_spec"]["pricing"]["numbers"]["thickness_mm"]["near"] = 0.5       # a second ladder may declare its own
        config_validation._validate_config(loader._loaded_config(ok, "HVAC", {}))

    def test_27_what_the_model_is_sent_with_v38_and_nothing_else_moves(self):
        row = AC0_ROWS[0]
        payload = [extraction._ai_item(row)]

        def content(g):
            return extraction.batch_prompt_content(g["prompt"], g["defs"], payload, synonyms=g["synonyms"], defaults=g["defaults"],
                                                   none_guidance=g["none_guidance"], slot_spec=g["slot_spec"],
                                                   resolution_rules=g["resolution_rules"], rules=g["rules"], items_spec=g.get("items_spec"))
        g38 = extraction._group_context(self.cfgs38, "HVAC", CATEGORY)
        spec = g38["items_spec"]
        self.assertEqual([d["id"] for d in spec["attribute_definitions"]], ["pipe_type", AS_WRITTEN, "size_mm", "pipe_class", "insulated"])
        self.assertIs(spec["second_opinion"], True)
        self.assertEqual([s["id"] for s in spec["sections"]], ["insulation"])
        self.assertEqual(spec["sections"][0]["items_spec"], extraction.build_items_spec(self.cfgs38[("HVAC", INSULATION)]))
        self.assertIs(spec["sections"][0]["items_spec"]["second_opinion"], False, "Insulation's own switch is Insulation's (D-1: Piping only)")
        req = content(g38)
        notes = {d["id"]: d["note"] for d in spec["attribute_definitions"]}
        # each ruling, in the note that carries it
        for aid, sentences in {
            "pipe_type": ["LEAVE THIS OUT - never choose the nearest stocked type",                       # D-3
                          "The row's own word wins over a heading",                                       # Q15
                          "Testing, painting, sleeves, welding, nitrogen or vacuum work, civil work, identification and valves named with the pipe are NOT items"],   # decision 8
            AS_WRITTEN: ["in the BoQ's OWN WORD, copied exactly as written", "also when 'Pipe type' is answered", "('MS / GI', 'uPVC/ CPVC')"],
            "size_mm": ["take the UNIT - never the size - from a heading that describes this row's pipe, or from the neighbouring rows of the same list",   # F-3 (1)
                        "write the unit with the size ('1 inch')",
                        "return the number bare, exactly as written",                                     # F-3 (2)
                        "is a THICKNESS and is never the pipe size",                                      # F6
                        "is NEVER the pipe size: in '22.3 mm O.D (wall Thickness-1.0 mm)' the size is 22.3 mm"],
            "pipe_class": ["it goes here and is never an insulation thickness", "it never changes the price"],
            "insulated": ["Leave it out when the text does not mention insulation for this pipe",        # decision 1
                          "also return the insulation as its own item in the insulation section, in the same position as its pipe"],
        }.items():
            for s in sentences:
                self.assertIn(s, notes[aid], aid)
                self.assertIn(json.dumps(s, ensure_ascii=False)[1:-1], req, aid)
        for d in spec["attribute_definitions"]:                                     # decision 9: no "service" attribute
            self.assertNotIn("service", (d["id"] + " " + d["label"]).lower(), d["id"])
        self.assertEqual(req.count(extraction.SECTION_ITEMS_GUIDANCE), 1)
        self.assertEqual(req.count(json.dumps(extraction.build_items_spec(self.cfgs38[("HVAC", INSULATION)]), ensure_ascii=False)), 1)
        # the second opinion reads the same spec, the same notes and the same paragraph
        review = extraction.second_opinion_content(extraction._read_review_prompt(), payload[0], [], spec)
        for s in ("LEAVE THIS OUT - never choose the nearest stocked type", "valves named with the pipe are NOT items", "return the number bare"):
            self.assertIn(s, review)
        self.assertEqual(review.count(extraction.SECTION_ITEMS_GUIDANCE), 1)
        # nothing of the pricing block reaches the model
        for word in ("from_attr", "panel_readonly", "family_text", "Stainless steel", '"near"', "inch_mm_alt"):
            self.assertNotIn(word, req, word)
        # NEGATIVE: every other HVAC category's request is byte-identical v37 -> v38 (NAMED), Insulation's included
        checked = []
        for key in sorted(self.cfgs37):
            if key[1] == CATEGORY or not extraction.config_is_eligible(self.cfgs37[key], self.cfgs37):
                continue
            g37, g = extraction._group_context(self.cfgs37, *key), extraction._group_context(self.cfgs38, *key)
            self.assertEqual(g, g37, key[1])
            self.assertEqual(content(g), content(g37), key[1])
            checked.append(key[1])
        self.assertEqual(checked, ["hvac_adp", "hvac_insulation"])
        self.assertNotEqual(content(g38), content(extraction._group_context(self.cfgs37, "HVAC", CATEGORY)))

    def test_28_ac0_the_stub_answers_through_the_real_run_store_the_pinned_rows(self):
        from nirmaan_stack.api.boq.wizard import ai_settings
        seen = {"contents": []}

        class _Usage:
            input_tokens, output_tokens = 11, 7

        class _Block:
            def __init__(self, t): self.text = t

        class _Resp:
            def __init__(self, t): self.content = [_Block(t)]; self.stop_reason = "end_turn"; self.usage = _Usage()

        class _Msgs:
            def create(self, **kw):
                c = kw["messages"][0]["content"]
                seen["contents"].append(c)
                m = re.search(r'ROW:\n\{"id": (\d+)', c)
                if m:
                    return _Resp(json.dumps({"id": int(m.group(1)), "verdict": "agree", "issues": []}))
                return _Resp(json.dumps(AC0_REPLY))

        class _Client:
            messages = _Msgs()

        captured = []
        patches = [(extraction, "assemble_population", lambda boq, sheet: (1, copy.deepcopy(AC0_ROWS))),
                   (extraction, "load_configs_with_alias_targets", lambda discs=None: self.cfgs38),
                   (extraction, "_capture_write", lambda rec: captured.append(rec)),
                   (ai_settings, "get_boq_ai_settings", lambda: {"enabled": True, "model": "stub-model"})]
        originals = [(mod, name, getattr(mod, name)) for mod, name, _new in patches]
        try:
            for mod, name, new in patches:
                setattr(mod, name, new)
            out = extraction.run_extraction("BOQ-AC0-STUB", "HVAC", client=_Client())
        finally:
            for mod, name, orig in originals:
                setattr(mod, name, orig)
        self.assertEqual(out["ai_status"], "ran")
        self.assertIs(out["complete"], True)
        self.assertEqual(out["attempted_rows"], [53, 60])
        # one batch call for the two rows, then ONE review per row (the second opinion is on for Piping in v38)
        self.assertEqual(len(seen["contents"]), 3)
        batch = seen["contents"][0]
        self.assertEqual(batch.count(extraction.SECTION_ITEMS_GUIDANCE), 1)
        self.assertIn(json.dumps(extraction.build_items_spec(self.cfgs38[("HVAC", INSULATION)]), ensure_ascii=False), batch)
        self.assertIn(json.dumps(AC0_PARENT_60, ensure_ascii=False), batch)          # the heading that names uPVC is in the payload
        reviews = {int(re.search(r'ROW:\n\{"id": (\d+)', c).group(1)): c for c in seen["contents"][1:]}
        self.assertEqual(sorted(reviews), [53, 60])
        self.assertEqual(json.loads(reviews[60].split("\n\nITEMS:\n")[1]), [
            {"attributes": {AS_WRITTEN: "uPVC", "size_mm": "25 mm dia", "pipe_class": "heavy class (10KG)", "insulated": "Yes"}},
            {"section": "insulation", "attributes": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "6/9 mm"}}])
        # THE STORED ROWS -- the shape the panel reads
        self.assertEqual(out["results"], AC0_STORED)
        self.assertEqual(hashlib.sha256(_canonical(out["results"]).encode("utf-8")).hexdigest(), AC0_STORED_SHA256)
        for r in out["results"]:
            self.assertEqual([it.get("section") for it in r["items"]], [None, "insulation"])
            self.assertEqual(list(r["items"][0]["attributes"]), ["pipe_type", AS_WRITTEN, "size_mm", "pipe_class", "insulated"])
            self.assertEqual(list(r["items"][1]["attributes"]), ["item", "cladding", "thickness_mm", "pipe_size_mm", "brand", "material_as_written"])
        # nothing was dropped, flagged or left unread; every capture record went to the in-memory collector
        drops = [rec["drops"] for rec in captured if "drops" in rec]
        self.assertEqual(len(drops), 1)
        for k in ("items_coerce_failed", "items_unknown_section", "items_not_in_row_text", "items_family_unrecognised"):
            self.assertEqual(drops[0][k], {}, k)
        self.assertEqual(drops[0]["second_opinion_verdicts"], {"53": "agree", "60": "agree"})
        self.assertEqual(drops[0]["second_opinion_usage"]["calls"], 2)
        # NEGATIVE: the same answer with the as-written question not asked (v37's definitions) keeps no such value
        patches[1] = (extraction, "load_configs_with_alias_targets", lambda discs=None: self.cfgs37)
        originals = [(mod, name, getattr(mod, name)) for mod, name, _new in patches]
        try:
            for mod, name, new in patches:
                setattr(mod, name, new)
            old = extraction.run_extraction("BOQ-AC0-STUB", "HVAC", client=_Client())
        finally:
            for mod, name, orig in originals:
                setattr(mod, name, orig)
        self.assertNotEqual(old["results"], AC0_STORED)
        self.assertNotIn(AS_WRITTEN, old["results"][1]["items"][0]["attributes"])
        self.assertEqual(old["results"][1]["items"][1]["section"], "insulation")     # the marker is code, not this asset


V39 = "rate_master_hvac_all_v39.json"   # 12e-5b: v38 + the 2026-10-15 rulings (R1-R5, R7, R9) -- Piping and Insulation configs only
CLADDING_AS_WRITTEN = "cladding_as_written"


class TestSlice12e5bAssetV39(FrappeTestCase):
    """SLICE 12e-5b (2026-10-15) -- HVAC v39 = v38 + the owner's rulings on the Stage A audit, Piping and Insulation ONLY.

      test_29  THE DIFF: every item and every other config byte-equal; Piping differs by two notes (R1) and the
               second opinion OFF (R9); Insulation by two notes (R3 / R4), the "Cladding as written (BoQ)" definition
               and its `panel_readonly` entry, `choice_text` (R2), `material_text` (R5), `compose.outer_surface` (R7)
               and `unit_refusal` (AC8b) -- taken out again, each config IS v38's, in v38's key order.
      test_30  v39 is the newest HVAC asset on disk; v38 stays as the 12e-4b record.
      test_31  THE VALIDATOR admits the three new keys and refuses each wrong shape by name (one refusal per mistake).
      test_32  WHAT THE MODEL IS SENT (AC5 / AC6): Piping's request differs from v38's by its two notes alone, and its
               second opinion is off; Insulation's by its two notes and the new definition; ADP's is byte-identical.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v38, cls.v39 = _read(V38), _read(V39)
        pick = lambda a, cid: next(c for c in a["category_configs"] if c["category_id"] == cid)
        cls.pip, cls.pip38 = pick(cls.v39, CATEGORY), pick(cls.v38, CATEGORY)
        cls.ins, cls.ins38 = pick(cls.v39, INSULATION), pick(cls.v38, INSULATION)
        cls.cfgs39 = {("HVAC", c["category_id"]): c for c in _stored(cls.v39)}
        cls.cfgs38 = {("HVAC", c["category_id"]): c for c in _stored(cls.v38)}

    @staticmethod
    def _notes(cfg):
        return {d["id"]: d.get("note") for d in cfg["list_spec"]["attribute_definitions"]}

    def test_29_v39_is_v38_plus_the_ruled_changes_and_nothing_else(self):
        self.assertEqual(json.dumps(self.v39["items"]), json.dumps(self.v38["items"]), "every item unchanged, in the same order")
        self.assertEqual([c["category_id"] for c in self.v39["category_configs"]], [c["category_id"] for c in self.v38["category_configs"]])
        changed = [a["category_id"] for a, b in zip(self.v39["category_configs"], self.v38["category_configs"]) if a != b]
        self.assertEqual(sorted(changed), sorted([INSULATION, CATEGORY]))
        for k in set(self.v38) | set(self.v39):
            if k not in ("items", "category_configs"):
                self.assertEqual(self.v39.get(k), self.v38.get(k), "top-level key %s is unchanged" % k)
        # Piping: two notes, the switch
        n39, n38 = self._notes(self.pip), self._notes(self.pip38)
        self.assertEqual([k for k in n39 if n39[k] != n38[k]], ["pipe_type", "pipe_type_as_written"])
        self.assertIn("copper, refrigerant, VRF or VRV piping is Copper, also where the word copper is not written", n39["pipe_type"])
        self.assertIn("chilled water piping that names no type is MS", n39["pipe_type"])
        self.assertIn("never a type the text does not contain", n39["pipe_type_as_written"])
        self.assertIs(self.pip["list_spec"]["second_opinion"], False)
        back = copy.deepcopy(self.pip)
        for d in back["list_spec"]["attribute_definitions"]:
            d["note"] = n38[d["id"]]
        back["list_spec"]["second_opinion"] = True
        self.assertEqual(json.dumps(back), json.dumps(self.pip38), "with the listed changes taken out the Piping config IS v38's")
        # Insulation
        ls, pr = self.ins["list_spec"], self.ins["list_spec"]["pricing"]
        self.assertEqual([d["id"] for d in ls["attribute_definitions"]],
                         ["item", "cladding", CLADDING_AS_WRITTEN, "thickness_mm", "pipe_size_mm", "brand", "material_as_written"])
        d = ls["attribute_definitions"][2]
        self.assertEqual({k: d[k] for k in ("id", "label", "type")}, {"id": CLADDING_AS_WRITTEN, "label": "Cladding as written (BoQ)", "type": "text"})
        n39, n38 = self._notes(self.ins), self._notes(self.ins38)
        self.assertEqual([k for k in n38 if n39[k] != n38[k]], ["item", "cladding"])
        self.assertIn("'Tubular Puf Insulation' only where PUF or polyurethane is named", n39["item"])
        for s in ("answer 'None' - never leave it out for that reason", "'Al. foil', 'Alu foil' or aluminium foil is 'Aluminium Foil'",
                  "LEAVE THIS OUT and copy the cladding exactly as written into 'Cladding as written (BoQ)'"):
            self.assertIn(s, n39["cladding"])
        self.assertIn("A GI frame, grid or framework", n39["cladding"], "the ruled GI Framework sentence stands")
        self.assertEqual(pr["panel_readonly"], ["brand", CLADDING_AS_WRITTEN])
        self.assertEqual(pr["choice_text"][0]["to_by_gauge"], {"24": "24G Aluminium", "26": "26G Aluminium"})
        self.assertEqual(pr["choice_text"][0]["default_to"], "26G Aluminium")
        self.assertEqual(pr["material_text"]["map"][0]["to_by_unit_class"],
                         {"length": "Nitrile Rubber Insulation", "area": "Thermal Nitrile Insulation"})
        self.assertEqual(pr["compose"]["outer_surface"]["girth_step"]["formula"], "3.14*od/1000")
        self.assertIn("{unit}", pr["unit_refusal"])
        back = copy.deepcopy(self.ins)
        bl, bp = back["list_spec"], back["list_spec"]["pricing"]
        bl["attribute_definitions"] = [x for x in bl["attribute_definitions"] if x["id"] != CLADDING_AS_WRITTEN]
        for x in bl["attribute_definitions"]:
            x["note"] = n38[x["id"]]
        bp["panel_readonly"] = ["brand"]
        for k in ("choice_text", "material_text", "unit_refusal"):
            del bp[k]
        del bp["compose"]["outer_surface"]
        self.assertEqual(json.dumps(back), json.dumps(self.ins38), "with the listed changes taken out the Insulation config IS v38's")
        # the v38 girth step is untouched: catalogue-row paths (Derivation, impact panel, cladding cost) still run it
        self.assertEqual(json.dumps(self.ins["list_spec"]["pricing"]["families"]), json.dumps(self.ins38["list_spec"]["pricing"]["families"]))

    def test_30_v39_is_the_newest_hvac_asset_on_disk(self):
        d = os.path.dirname(_asset_path(V39))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # BEFORE: self.assertEqual(max(ns), 39)
        self.assertNotEqual(max(ns), 39, "12e-5b C3: v39 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 40)
        self.assertNotEqual(max(ns), 40, "12e-5b2: v40 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 41)
        self.assertNotEqual(max(ns), 41, "12e-5c: v41 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 42)
        self.assertNotEqual(max(ns), 42, "12e-6: v42 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 43)
        self.assertNotEqual(max(ns), 43, "12e-6b: v43 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 45)
        self.assertNotEqual(max(ns), 45, "12e-6c: v45 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 46)
        self.assertNotEqual(max(ns), 46, "ADP-1: v46 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 47)
        self.assertNotEqual(max(ns), 47, "ADP-2: v47 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        self.assertTrue(os.path.exists(_asset_path(V38)), "v38 stays on disk as the 12e-4b record")
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v%d.json" % (max(ns) + 1))))

    def test_31_the_validator_admits_the_new_keys_and_refuses_each_wrong_shape_by_name(self):
        def refused(mutate, needle):
            cfg = copy.deepcopy(self.ins)
            mutate(cfg["list_spec"]["pricing"])
            with self.assertRaises(frappe.ValidationError) as cm:
                config_validation._validate_config(loader._loaded_config(cfg, "HVAC", {}))
            self.assertIn(needle, str(cm.exception))
        for c in _stored(self.v39):
            config_validation._validate_config(c)                      # every shipped config passes
        self.assertEqual(config_validation.delegated_section_problems(_stored(self.v39), self.v39["items"]), [])
        ct = lambda pr: pr["choice_text"][0]
        mt = lambda pr: pr["material_text"]
        osf = lambda pr: pr["compose"]["outer_surface"]
        # choice_text
        refused(lambda pr: pr.update(choice_text=[]), "choice_text must be a non-empty list")
        refused(lambda pr: ct(pr).update(attr="brand"), "is not a choice SKU attribute")
        refused(lambda pr: ct(pr).update(from_attr="cladding"), "is read by the pricing")
        refused(lambda pr: ct(pr).update(from_attr="gi_word"), "which is not an item attribute of this category")
        refused(lambda pr: ct(pr).update(default_to="GI sheet"), "default_to 'GI sheet' is not one of 'cladding's values")
        refused(lambda pr: ct(pr)["to_by_gauge"].update({"22": "22G Aluminium"}), "to_by_gauge['22'] '22G Aluminium' is not one of")
        refused(lambda pr: ct(pr).update(gauge_pattern="\\d{2}"), "gauge_pattern must be a pattern whose first group")
        refused(lambda pr: ct(pr).pop("to_by_gauge"), "gauge_pattern and to_by_gauge go together")
        refused(lambda pr: ct(pr).update(line="priced as {to}"), "line must be a sentence carrying {from} and {to}")
        refused(lambda pr: ct(pr).update(unlisted_line="price by hand"), "unlisted_line must be a sentence carrying {from}")
        refused(lambda pr: ct(pr).update(colour="x"), "unknown key(s): colour")
        # material_text
        refused(lambda pr: mt(pr).update(when_family=["polyethylene"]), "when_family must list family values")
        refused(lambda pr: mt(pr)["map"][0]["to_by_unit_class"].update(count="Nitrile Rubber Insulation"), "'count' is not a unit class")
        refused(lambda pr: mt(pr)["map"][0]["to_by_unit_class"].update(length="none of these"), "is not a priceable family")
        refused(lambda pr: mt(pr)["map"][0].update(all_of=[[]]), "all_of must be a non-empty list of non-empty word lists")
        refused(lambda pr: mt(pr)["map"][0].update(line="priced as nitrile"), "line must be a sentence carrying {to}")
        # compose.outer_surface
        refused(lambda pr: osf(pr).update(attr="pipe_size_mm"), "collides with an attribute of this category")
        refused(lambda pr: osf(pr).update(thickness="pipe_size_mm"), "thickness must be the composed axis 'thickness_mm'")
        refused(lambda pr: osf(pr)["girth_step"].update(params={"od_from_attr": "pipe_size_mm"}), "exactly one _from_attr naming 'cladding_od_mm'")
        refused(lambda pr: osf(pr)["girth_step"].update(result="area"), "is produced by no scale step of this category's pipelines")
        refused(lambda pr: osf(pr).pop("girth_step"), "needs exactly attr, pipe, thickness and girth_step")
        # v38 (none of the keys) still validates: the keys are optional
        config_validation._validate_config(loader._loaded_config(copy.deepcopy(self.ins38), "HVAC", {}))

    def test_32_what_the_model_is_sent_with_v39_and_nothing_else_moves(self):
        row = AC0_ROWS[0]
        payload = [extraction._ai_item(row)]

        def content(g):
            return extraction.batch_prompt_content(g["prompt"], g["defs"], payload, synonyms=g["synonyms"], defaults=g["defaults"],
                                                   none_guidance=g["none_guidance"], slot_spec=g["slot_spec"],
                                                   resolution_rules=g["resolution_rules"], rules=g["rules"], items_spec=g.get("items_spec"))
        g39, g38 = extraction._group_context(self.cfgs39, "HVAC", CATEGORY), extraction._group_context(self.cfgs38, "HVAC", CATEGORY)
        self.assertIs(g39["items_spec"]["second_opinion"], False, "AC6: the second opinion is off for Piping")
        self.assertIs(g38["items_spec"]["second_opinion"], True)
        req39, req38 = content(g39), content(g38)
        # AC5: put v38's words back where v39 changed them -- the requests are then byte-identical
        swaps = []
        for cid in (CATEGORY, INSULATION):
            a = self._notes(self.cfgs39[("HVAC", cid)])
            b = self._notes(self.cfgs38[("HVAC", cid)])
            swaps += [(json.dumps(a[k], ensure_ascii=False)[1:-1], json.dumps(b[k], ensure_ascii=False)[1:-1]) for k in b if a[k] != b[k]]
        self.assertEqual(len(swaps), 4)
        back = req39
        for new, old in swaps:
            self.assertEqual(back.count(new), 1, new[:60])
            back = back.replace(new, old)
        ins_def = next(d for d in extraction.build_items_spec(self.cfgs39[("HVAC", INSULATION)])["attribute_definitions"] if d["id"] == CLADDING_AS_WRITTEN)
        frag = json.dumps(ins_def, ensure_ascii=False)
        self.assertEqual(back.count(frag), 1)
        back = back.replace(", " + frag, "", 1) if (", " + frag) in back else back.replace(frag + ", ", "", 1)
        back = back.replace('"second_opinion": false', '"second_opinion": true', 1)
        self.assertEqual(back, req38, "only the four notes, the one definition and the switch differ")
        # nothing of the new pricing keys reaches the model
        for word in ("choice_text", "material_text", "outer_surface", "cladding_od_mm", "unit_refusal", "unlisted_line"):
            self.assertNotIn(word, req39, word)
        # NEGATIVE: ADP's request is byte-identical v38 -> v39
        g, g0 = extraction._group_context(self.cfgs39, "HVAC", "hvac_adp"), extraction._group_context(self.cfgs38, "HVAC", "hvac_adp")
        self.assertEqual(g, g0)
        self.assertEqual(content(g), content(g0))


V40 = "rate_master_hvac_all_v40.json"   # 12e-5b cert C3: v39 + the "Cladding as written" label fix, Insulation only


class TestSlice12e5bAssetV40(FrappeTestCase):
    """SLICE 12e-5b, cert C3 (owner 2026-10-15: "Mint v40 now") -- HVAC v40 = v39 + ONE label fix. The panel renders a
    read-only field as "<label> (BoQ): <value>", so v39's label "Cladding as written (BoQ)" showed "(BoQ) (BoQ)".

      test_33  THE DIFF: every item and every other config byte-equal; Insulation differs by the definition's label and
               the cladding note's reference to it, and nothing else; "(BoQ)" appears in no Insulation label.
      test_34  v40 is the newest HVAC asset on disk; v39 stays as the 12e-5b record.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v39, cls.v40 = _read(V39), _read(V40)

    def test_33_v40_is_v39_plus_the_label_fix_and_nothing_else(self):
        self.assertEqual(json.dumps(self.v40["items"]), json.dumps(self.v39["items"]))
        changed = [a["category_id"] for a, b in zip(self.v40["category_configs"], self.v39["category_configs"]) if a != b]
        self.assertEqual(changed, [INSULATION])
        new = next(c for c in self.v40["category_configs"] if c["category_id"] == INSULATION)
        old = next(c for c in self.v39["category_configs"] if c["category_id"] == INSULATION)
        dn = {d["id"]: d for d in new["list_spec"]["attribute_definitions"]}
        self.assertEqual(dn[CLADDING_AS_WRITTEN]["label"], "Cladding as written")
        self.assertNotIn("(BoQ)", " ".join(d["label"] for d in new["list_spec"]["attribute_definitions"]))
        self.assertIn("copy the cladding exactly as written into 'Cladding as written'.", dn["cladding"]["note"])
        back = copy.deepcopy(new)
        bd = {d["id"]: d for d in back["list_spec"]["attribute_definitions"]}
        bd[CLADDING_AS_WRITTEN]["label"] = "Cladding as written (BoQ)"
        bd["cladding"]["note"] = bd["cladding"]["note"].replace("into 'Cladding as written'.", "into 'Cladding as written (BoQ)'.")
        self.assertEqual(json.dumps(back), json.dumps(old), "with the label fix taken out the Insulation config IS v39's")

    def test_34_v40_is_the_newest_hvac_asset_on_disk(self):
        d = os.path.dirname(_asset_path(V40))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # BEFORE: self.assertEqual(max(ns), 40)
        self.assertNotEqual(max(ns), 40, "12e-5b2: v40 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 41)
        self.assertNotEqual(max(ns), 41, "12e-5c: v41 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 42)
        self.assertNotEqual(max(ns), 42, "12e-6: v42 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 43)
        self.assertNotEqual(max(ns), 43, "12e-6b: v43 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 45)
        self.assertNotEqual(max(ns), 45, "12e-6c: v45 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 46)
        self.assertNotEqual(max(ns), 46, "ADP-1: v46 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 47)
        self.assertNotEqual(max(ns), 47, "ADP-2: v47 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        self.assertTrue(os.path.exists(_asset_path(V39)), "v39 stays on disk as the 12e-5b record")


V41 = "rate_master_hvac_all_v41.json"   # 12e-5b2: v40 + four notes (owner R1, R2, R7), Piping and Insulation only


class TestSlice12e5b2AssetV41(FrappeTestCase):
    """SLICE 12e-5b2 (owner, 2026-10-15, on the 12e-5b review) -- HVAC v41 = v40 + FOUR note changes, nothing else.

      test_35  THE DIFF: every item, every other config and every other key byte-equal; Insulation differs by the
               `item` note (R1: a generic insulation takes its heading's material) and the `cladding` note (R7: a
               heading's cladding applies to a row naming none); Piping by `pipe_type` (R2: VRF / refrigerant = Copper
               on every row under such a heading, a nearer type wins) and `pipe_type_as_written` (R2: the type word
               before the service word). With those four notes put back, each config IS v40's.
      test_36  v41 is the newest HVAC asset on disk; v40 stays as the 12e-5b record.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v40, cls.v41 = _read(V40), _read(V41)

    def test_35_v41_is_v40_plus_four_notes_and_nothing_else(self):
        self.assertEqual(json.dumps(self.v41["items"]), json.dumps(self.v40["items"]))
        self.assertEqual({k: v for k, v in self.v41.items() if k != "category_configs"}, {k: v for k, v in self.v40.items() if k != "category_configs"})
        changed = {}
        for a, b in zip(self.v41["category_configs"], self.v40["category_configs"]):
            if a == b:
                continue
            da = {d["id"]: d for d in a["list_spec"]["attribute_definitions"]}
            db = {d["id"]: d for d in b["list_spec"]["attribute_definitions"]}
            changed[a["category_id"]] = sorted(i for i in da if da[i] != db[i])
            back = copy.deepcopy(a)
            for d in back["list_spec"]["attribute_definitions"]:
                d["note"] = db[d["id"]].get("note") if "note" in db[d["id"]] else d.get("note")
            self.assertEqual(json.dumps(back), json.dumps(b), "%s: with the notes put back the config IS v40's" % a["category_id"])
        self.assertEqual(changed, {INSULATION: ["cladding", "item"], CATEGORY: ["pipe_type", "pipe_type_as_written"]})
        ins = {d["id"]: d["note"] for d in next(c for c in self.v41["category_configs"] if c["category_id"] == INSULATION)["list_spec"]["attribute_definitions"] if "note" in d}
        pip = {d["id"]: d["note"] for d in next(c for c in self.v41["category_configs"] if c["category_id"] == CATEGORY)["list_spec"]["attribute_definitions"] if "note" in d}
        self.assertIn("takes the material its heading names", ins["item"])
        self.assertIn("A cladding a heading names applies to every row under it", ins["cladding"])
        self.assertIn("applies only to a row that meets that condition", ins["cladding"], "the conditional ruling stands")
        self.assertIn("on EVERY pipe row under such a heading", pip["pipe_type"])
        self.assertIn("a uPVC drain under a VRF heading is uPVC", pip["pipe_type"], "a nearer type still wins")
        self.assertIn("it is 'COPPER', never 'Refrigerant'", pip["pipe_type_as_written"])

    def test_36_v41_is_the_newest_hvac_asset_on_disk(self):
        d = os.path.dirname(_asset_path(V41))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # BEFORE: self.assertEqual(max(ns), 41)
        self.assertNotEqual(max(ns), 41, "12e-5c: v41 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 42)
        self.assertNotEqual(max(ns), 42, "12e-6: v42 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 43)
        self.assertNotEqual(max(ns), 43, "12e-6b: v43 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 45)
        self.assertNotEqual(max(ns), 45, "12e-6c: v45 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 46)
        self.assertNotEqual(max(ns), 46, "ADP-1: v46 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 47)
        self.assertNotEqual(max(ns), 47, "ADP-2: v47 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        self.assertTrue(os.path.exists(_asset_path(V40)), "v40 stays on disk as the 12e-5b record")


V42 = "rate_master_hvac_all_v42.json"   # 12e-5c: v41 + the copied-text sentence on eight Piping / Insulation notes


class TestSlice12e5cAssetV42(FrappeTestCase):
    """SLICE 12e-5c AC3 (owner R1, 2026-10-15: "ok") -- HVAC v42 = v41 + ONE sentence on every copied-text note.

      test_37  THE DIFF: every item, every other config and every other key byte-equal; Piping's and Insulation's
               eight `type: text` definitions (and nothing else) gain the sentence at the end of their note; with it
               taken out, each config IS v41's.
      test_38  v42 is the newest HVAC asset on disk; v41 stays as the 12e-5b2 record.
    """

    SENTENCE = ("Copy the words exactly as the BoQ writes them, as one continuous piece; never shorten, never join pieces "
                "with '...' or any other mark; if the words are long, copy the shortest continuous piece that holds the value.")

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v41, cls.v42 = _read(V41), _read(V42)

    def test_37_v42_is_v41_plus_the_copied_text_sentence_and_nothing_else(self):
        self.assertEqual(json.dumps(self.v42["items"]), json.dumps(self.v41["items"]))
        self.assertEqual({k: v for k, v in self.v42.items() if k != "category_configs"}, {k: v for k, v in self.v41.items() if k != "category_configs"})
        changed = {}
        for a, b in zip(self.v42["category_configs"], self.v41["category_configs"]):
            if a == b:
                continue
            da = {d["id"]: d for d in a["list_spec"]["attribute_definitions"]}
            db = {d["id"]: d for d in b["list_spec"]["attribute_definitions"]}
            changed[a["category_id"]] = sorted(i for i in da if da[i] != db[i])
            self.assertEqual(changed[a["category_id"]], sorted(d["id"] for d in a["list_spec"]["attribute_definitions"] if d.get("type") == "text"),
                             "every copied-text definition, and only those")
            back = copy.deepcopy(a)
            for d in back["list_spec"]["attribute_definitions"]:
                if d["id"] in changed[a["category_id"]]:
                    self.assertTrue(d["note"].endswith(" " + self.SENTENCE))
                    d["note"] = d["note"][: -len(" " + self.SENTENCE)]
            self.assertEqual(json.dumps(back), json.dumps(b), "%s: with the sentence taken out the config IS v41's" % a["category_id"])
        self.assertEqual(changed, {INSULATION: ["brand", "cladding_as_written", "material_as_written", "pipe_size_mm", "thickness_mm"],
                                   CATEGORY: ["pipe_class", "pipe_type_as_written", "size_mm"]})

    def test_38_v42_is_the_newest_hvac_asset_on_disk(self):
        d = os.path.dirname(_asset_path(V42))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # BEFORE: self.assertEqual(max(ns), 42)
        self.assertNotEqual(max(ns), 42, "12e-6: v42 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 43)
        self.assertNotEqual(max(ns), 43, "12e-6b: v43 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 45)
        self.assertNotEqual(max(ns), 45, "12e-6c: v45 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 46)
        self.assertNotEqual(max(ns), 46, "ADP-1: v46 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 47)
        self.assertNotEqual(max(ns), 47, "ADP-2: v47 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        self.assertTrue(os.path.exists(_asset_path(V41)), "v41 stays on disk as the 12e-5b2 record")


V43 = "rate_master_hvac_all_v43.json"   # 12e-6: v42 + Insulation notes only


class TestSlice12e6AssetV43(FrappeTestCase):
    """SLICE 12e-6 AC11 (owner rulings 2026-10-16) -- HVAC v43 = v42 + NOTES ONLY, on the Insulation config.

      test_39  THE DIFF: every item, every other config and every other key byte-equal; Insulation's `item`, `cladding`
               and `material_as_written` notes (and nothing else) change; the v41 / v42 "..." of the example list is gone.
      test_40  the notes carry the rulings: (a) "none of these" only for a NAMED material, alternatives copied in full;
               (b) R6 a fibre / glass cloth facing is the glass cloth; (c) R4 / R5 a coating with no glass cloth and a
               co-extruded jacket are copied, never mapped; (d) R9 closed cell on a duct is Thermal Nitrile.
      test_41  the Piping section asks Insulation's OWN (new) notes; v43 is the newest HVAC asset; v42 stays on disk.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v42, cls.v43 = _read(V42), _read(V43)

    def _notes(self, asset):
        c = next(c for c in asset["category_configs"] if c["category_id"] == INSULATION)
        return {d["id"]: d.get("note", "") for d in c["list_spec"]["attribute_definitions"]}

    def test_39_v43_is_v42_plus_insulation_notes_and_nothing_else(self):
        self.assertEqual(json.dumps(self.v43["items"]), json.dumps(self.v42["items"]))
        self.assertEqual({k: v for k, v in self.v43.items() if k != "category_configs"}, {k: v for k, v in self.v42.items() if k != "category_configs"})
        changed = {}
        for a, b in zip(self.v43["category_configs"], self.v42["category_configs"]):
            if a == b:
                continue
            da = {d["id"]: d for d in a["list_spec"]["attribute_definitions"]}
            db = {d["id"]: d for d in b["list_spec"]["attribute_definitions"]}
            changed[a["category_id"]] = sorted(i for i in da if da[i] != db[i])
            for i in changed[a["category_id"]]:
                self.assertEqual({k: v for k, v in da[i].items() if k != "note"}, {k: v for k, v in db[i].items() if k != "note"}, "%s: the note only" % i)
            back = copy.deepcopy(a)
            for d in back["list_spec"]["attribute_definitions"]:
                d["note"] = db[d["id"]].get("note", d.get("note"))
            self.assertEqual(json.dumps(back), json.dumps(b), "with the v42 notes put back the config IS v42's")
        self.assertEqual(changed, {INSULATION: ["cladding", "item", "material_as_written"]})
        self.assertIn("(XLPE, rockwool, nitrile rubber ...)", self._notes(self.v42)["material_as_written"])
        self.assertNotIn("nitrile rubber ...)", self._notes(self.v43)["material_as_written"])   # the example list (the copied-text sentence quotes '...' on purpose)

    def test_40_the_notes_carry_the_rulings(self):
        n = self._notes(self.v43)
        self.assertIn("Answer 'none of these' only for a material the BoQ NAMES", n["item"])
        self.assertIn("leave this out -- the pricer applies the ruled default", n["item"])
        self.assertIn("copy the material as written in full, both names", n["item"])
        self.assertIn("('acoustic insulation ... with closed cell nitrile rubber' on a duct is Thermal Nitrile Insulation)", n["item"])
        self.assertIn("A factory-laminated or reinforced glass cloth or fibre cloth facing", n["cladding"])
        self.assertIn("never answer 'Glass Cloth with paint' for it", n["cladding"])
        self.assertIn("A co-extruded polymer jacket or covering is copied as written into 'Cladding as written'", n["cladding"])
        self.assertIn("A co-extruded polymer jacket or covering is copied here as written too.", n["material_as_written"])
        # NEGATIVE: every v42 sentence is still there, word for word (notes only ADD)
        old = self._notes(self.v42)
        for fid in ("item", "cladding"):
            for sentence in re.split(r"[.;] ", old[fid]):
                self.assertIn(sentence.rstrip("."), n[fid], "%s keeps: %s" % (fid, sentence[:60]))

    def test_41_the_section_asks_the_new_notes_and_v43_is_the_newest(self):
        from nirmaan_stack.services.boq_rate_master import extraction
        stored = [dict(c, discipline=self.v43["discipline"]) for c in self.v43["category_configs"]]
        cfgs = {(self.v43["discipline"], c["category_id"]): c for c in stored}
        spec = extraction.build_items_spec(cfgs[(self.v43["discipline"], CATEGORY)], cfgs, self.v43["discipline"])
        sec = {d["id"]: d.get("note", "") for d in spec["sections"][0]["items_spec"]["attribute_definitions"]}
        self.assertEqual(sec["cladding"], self._notes(self.v43)["cladding"])
        d = os.path.dirname(_asset_path(V43))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # BEFORE: self.assertEqual(max(ns), 43)
        self.assertNotEqual(max(ns), 43, "12e-6b: v43 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 45)
        self.assertNotEqual(max(ns), 45, "12e-6c: v45 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 46)
        self.assertNotEqual(max(ns), 46, "ADP-1: v46 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 47)
        self.assertNotEqual(max(ns), 47, "ADP-2: v47 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        self.assertTrue(os.path.exists(_asset_path(V42)), "v42 stays on disk as the 12e-5c record")


V45 = "rate_master_hvac_all_v45.json"   # 12e-6b: v43 + one Piping note (v44 reverted in 12e-6)
R1_NOTE = "A drain pipe whose material the BoQ does not name: leave the pipe type out (do not guess); the code prices it as CPVC."


class TestSlice12e6bAssetV45(FrappeTestCase):
    """SLICE 12e-6b AC2 (owner R1, 2026-10-16 23:43 IST: "for drain pipes consider CPVC if no material is mentioned") --
    HVAC v45 = v43 + ONE NOTE, on the Piping config's `pipe_type`.

      test_42  THE DIFF: every item, every other config, every other attribute and every other key byte-equal; only
               Piping's `pipe_type` note changes, and with v43's note put back the config IS v43's.
      test_43  the note: the R1 sentence directly after "A drain or condensate line takes the type the text names for it.";
               every v43 sentence kept word for word (the note only ADDS); the Piping request asks it.
      test_44  v45 is the newest HVAC asset; v43 stays on disk; v44 (reverted in 12e-6) is on disk as history only
               (owner option B), never the newest.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v43, cls.v45 = _read(V43), _read(V45)

    def _defs(self, asset):
        c = next(c for c in asset["category_configs"] if c["category_id"] == CATEGORY)
        return {d["id"]: d for d in c["list_spec"]["attribute_definitions"]}

    def test_42_v45_is_v43_plus_one_piping_note_and_nothing_else(self):
        self.assertEqual(json.dumps(self.v45["items"]), json.dumps(self.v43["items"]))
        self.assertEqual({k: v for k, v in self.v45.items() if k != "category_configs"}, {k: v for k, v in self.v43.items() if k != "category_configs"})
        changed = {}
        for a, b in zip(self.v45["category_configs"], self.v43["category_configs"]):
            self.assertEqual(a["category_id"], b["category_id"])
            if a == b:
                continue
            da = {d["id"]: d for d in a["list_spec"]["attribute_definitions"]}
            db = {d["id"]: d for d in b["list_spec"]["attribute_definitions"]}
            changed[a["category_id"]] = sorted(i for i in da if da[i] != db[i])
            back = copy.deepcopy(a)
            for d in back["list_spec"]["attribute_definitions"]:
                d["note"] = db[d["id"]].get("note", d.get("note"))
            self.assertEqual(json.dumps(back), json.dumps(b), "with the v43 note put back the config IS v43's")
        self.assertEqual(changed, {CATEGORY: ["pipe_type"]})
        self.assertNotIn("do not guess", self._defs(self.v43)["pipe_type"]["note"])

    def test_43_the_note_carries_r1_and_keeps_every_v43_sentence(self):
        n45, n43 = self._defs(self.v45)["pipe_type"]["note"], self._defs(self.v43)["pipe_type"]["note"]
        self.assertIn("A drain or condensate line takes the type the text names for it. " + R1_NOTE, n45)
        self.assertEqual(n45.count(R1_NOTE), 1)
        self.assertEqual(n45.replace(" " + R1_NOTE, ""), n43, "the note only ADDS the one sentence")
        from nirmaan_stack.services.boq_rate_master import extraction
        stored = [dict(c, discipline=self.v45["discipline"]) for c in self.v45["category_configs"]]
        cfgs = {(self.v45["discipline"], c["category_id"]): c for c in stored}
        spec = extraction.build_items_spec(cfgs[(self.v45["discipline"], CATEGORY)], cfgs, self.v45["discipline"])
        asked = {d["id"]: d.get("note", "") for d in spec["attribute_definitions"]}
        self.assertIn(R1_NOTE, asked["pipe_type"])

    def test_44_v45_is_the_newest_and_v43_stays(self):
        d = os.path.dirname(_asset_path(V45))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # BEFORE: self.assertEqual(max(ns), 45)
        self.assertNotEqual(max(ns), 45, "12e-6c: v45 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 46)
        self.assertNotEqual(max(ns), 46, "ADP-1: v46 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 47)
        self.assertNotEqual(max(ns), 47, "ADP-2: v47 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        # owner option B (12e-6b, 2026-10-17): BEFORE `self.assertNotIn(44, ns, "v44 was reverted in 12e-6 and is not on disk")`.
        # v44: reverted in 12e-6, kept on disk for the version series -- history only, never loaded, never current.
        self.assertIn(44, ns, "v44 stays on disk as history for the contiguous version series")
        self.assertNotEqual(max(ns), 44)
        self.assertTrue(os.path.exists(_asset_path(V43)), "v43 stays on disk as the 12e-6 record")


V46 = "rate_master_hvac_all_v46.json"   # 12e-6c: v45 + typed_entry on Insulation's pipe size (owner U1)


class TestSlice12e6cAssetV46(FrappeTestCase):
    """SLICE 12e-6c AC7 (owner U1, 2026-10-18: a typed Insulation pipe size refuses like the Piping tab's) -- HVAC v46 =
    v45 + ONE PRICING KEY: `typed_entry: "one_size"` on Insulation's `list_spec.pricing.numbers.pipe_size_mm`.

      test_45  THE DIFF: every item, every other config and every other key byte-equal; with the key removed v46 IS v45.
      test_46  the key is Piping's own (`size_mm` carries the same) and v46 validates; no request the model receives changes.
      test_47  v46 is the newest HVAC asset; v45 stays on disk.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v45, cls.v46 = _read(V45), _read(V46)

    def test_45_the_one_key_is_the_whole_diff(self):
        self.assertEqual(self.v45["items"], self.v46["items"])
        c45 = {c["category_id"]: c for c in self.v45["category_configs"]}
        c46 = {c["category_id"]: c for c in self.v46["category_configs"]}
        self.assertEqual(sorted(c45), sorted(c46))
        for cid in c45:
            if cid != "hvac_insulation":
                self.assertEqual(c45[cid], c46[cid], cid)
        rd = c46["hvac_insulation"]["list_spec"]["pricing"]["numbers"]["pipe_size_mm"]
        self.assertEqual(rd["typed_entry"], "one_size")
        self.assertNotIn("typed_entry", c45["hvac_insulation"]["list_spec"]["pricing"]["numbers"]["pipe_size_mm"])
        put_back = json.loads(json.dumps(c46["hvac_insulation"]))
        del put_back["list_spec"]["pricing"]["numbers"]["pipe_size_mm"]["typed_entry"]
        self.assertEqual(put_back, c45["hvac_insulation"])

    def test_46_the_key_is_pipings_own_and_no_request_changes(self):
        from nirmaan_stack.services.boq_rate_master import config_validation, extraction
        c46 = {c["category_id"]: c for c in self.v46["category_configs"]}
        self.assertEqual(c46["hvac_piping"]["list_spec"]["pricing"]["numbers"]["size_mm"]["typed_entry"], "one_size")
        for c in self.v46["category_configs"]:
            config_validation._validate_config(dict(c, discipline=self.v46["discipline"]))
        for payload in (self.v45, self.v46):
            payload["_req"] = {}
            cfgs = {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}
            for c in payload["category_configs"]:
                if c.get("list_spec"):
                    payload["_req"][c["category_id"]] = json.dumps(extraction.build_items_spec(cfgs[(payload["discipline"], c["category_id"])], cfgs, payload["discipline"]), sort_keys=True)
        self.assertEqual(sorted(self.v46["_req"]), ["hvac_adp", "hvac_insulation", "hvac_piping"])
        self.assertEqual(self.v45["_req"], self.v46["_req"])

    def test_47_v46_is_the_newest_and_v45_stays(self):
        d = os.path.dirname(_asset_path(V46))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # BEFORE: self.assertEqual(max(ns), 46)
        self.assertNotEqual(max(ns), 46, "ADP-1: v46 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 47)
        self.assertNotEqual(max(ns), 47, "ADP-2: v47 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        self.assertTrue(os.path.exists(_asset_path(V45)))
        # INVERTED at ADP-1 (mechanical authority): BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v47.json")))`.
        # v47 is minted; nothing past it exists.
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v47.json")))
        # INVERTED at ADP-2 (mechanical authority): BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v48.json")))`.
        # v48 is minted; nothing past it exists.
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v48.json")))
        # INVERTED at ADP-3b (mechanical authority): BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v49.json")))`.
        # v49 is minted; nothing past it exists.
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v49.json")))
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v50.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v50.json")))
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v51.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v51.json")))
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v52.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v52.json")))
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v53.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v53.json")))
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v54.json")))


V47 = "rate_master_hvac_all_v47.json"   # ADP-1: v46 + the ADP-1 rules (H3 / H4 / A4 / F1), the two per-number plenum SKUs deactivated


class TestAdp1AssetV47(FrappeTestCase):
    """ADP-1 AC10 (owner rulings 2026-10-19) -- HVAC v47 = v46 + exactly this slice's changes, minted by
    `scripts/_instruments/mint_hvac_v47_adp1.py` from the database export taken after the two SKUs were deactivated.

      test_48  THE ITEMS: v47 = v46 less the two per-number plenum SKUs (H4) plus the three Pricing Inputs (A4); every
               other item byte-equal. THE CONFIGS: only ADP and Insulation differ, and Insulation by its one F1 key.
      test_49  v47 validates; no request the model receives changes (the stub proof); the three inputs are read by ADP.
      test_50  v47 is the newest HVAC asset; v46 stays on disk.
    """

    RETIRED = ("rmi-4184735331c3", "rmi-a23b43d34447")

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v46, cls.v47 = _read(V46), _read(V47)

    def test_48_the_diff_is_exactly_the_slices(self):
        i46 = {i["item_uid"]: i for i in self.v46["items"]}
        i47 = {i["item_uid"]: i for i in self.v47["items"]}
        self.assertEqual(sorted(set(i46) - set(i47)), sorted(self.RETIRED))
        added = [i47[u] for u in sorted(set(i47) - set(i46))]
        self.assertEqual(sorted(a["attributes"]["item"] for a in added),
                         ["crosstalk_assumed_depth_mm", "flexible_duct_length_m", "mixing_box_supply_adder"])
        self.assertEqual({a["attributes"]["item"]: a["rates"] for a in added},
                         {"mixing_box_supply_adder": {"amount": 150.0}, "crosstalk_assumed_depth_mm": {"factor": 300.0}, "flexible_duct_length_m": {"factor": 2.5}})
        self.assertTrue(all(a["kind"] == "hvac_pricing_input" for a in added))
        for u in set(i46) & set(i47):
            self.assertEqual(i46[u], i47[u], u)
        for u in self.RETIRED:
            self.assertEqual((i46[u]["unit"], i46[u]["attributes"]["family"]), ("Nos", "mixing box / LP plenum"))
        c46 = {c["category_id"]: c for c in self.v46["category_configs"]}
        c47 = {c["category_id"]: c for c in self.v47["category_configs"]}
        self.assertEqual([c["category_id"] for c in self.v46["category_configs"]], [c["category_id"] for c in self.v47["category_configs"]])
        self.assertEqual(sorted(cid for cid in c46 if c46[cid] != c47[cid]), ["hvac_adp", "hvac_insulation"])
        put_back = json.loads(json.dumps(c47["hvac_insulation"]))
        self.assertEqual(put_back["list_spec"]["pricing"]["numbers"]["pipe_size_mm"].pop("bare_above_largest"), "refuse")
        self.assertEqual(put_back, c46["hvac_insulation"])
        self.assertEqual({k: v for k, v in self.v47.items() if k not in ("items", "category_configs")},
                         {k: v for k, v in self.v46.items() if k not in ("items", "category_configs")})

    def test_49_v47_validates_no_request_changes_and_the_inputs_are_read_by_adp(self):
        from nirmaan_stack.services.boq_rate_master import config_validation, csv_exporter, extraction
        for c in self.v47["category_configs"]:
            config_validation._validate_config(dict(c, discipline=self.v47["discipline"]))
        req = {}
        for name, payload in (("v46", self.v46), ("v47", self.v47)):
            cfgs = {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}
            req[name] = {c["category_id"]: json.dumps(extraction.build_items_spec(cfgs[(payload["discipline"], c["category_id"])], cfgs, payload["discipline"]), sort_keys=True)
                         for c in payload["category_configs"] if c.get("list_spec")}
        self.assertEqual(sorted(req["v47"]), ["hvac_adp", "hvac_insulation", "hvac_piping"])
        self.assertEqual(req["v46"], req["v47"])
        used = csv_exporter.pricing_input_used_by({c["category_id"]: dict(c, discipline="HVAC") for c in self.v47["category_configs"]})
        for iid in ("mixing_box_supply_adder", "crosstalk_assumed_depth_mm", "flexible_duct_length_m"):
            self.assertIn("hvac_adp", used[iid][1], iid)
        # NEGATIVE: on v46 nothing reads them
        used46 = csv_exporter.pricing_input_used_by({c["category_id"]: dict(c, discipline="HVAC") for c in self.v46["category_configs"]})
        self.assertNotIn("mixing_box_supply_adder", used46)

    def test_50_v47_is_the_newest_and_v46_stays(self):
        d = os.path.dirname(_asset_path(V47))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # BEFORE: self.assertEqual(max(ns), 47)
        self.assertNotEqual(max(ns), 47, "ADP-2: v47 is no longer the newest")
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        # INVERTED at ADP-2 (HVAC v48) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 48)))`
        # INVERTED at ADP-3b (HVAC v49) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 49)))`
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 50)))`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 51)))`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 52)))`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 53)))`
        self.assertEqual(sorted(ns), list(range(1, 54)))
        self.assertTrue(os.path.exists(_asset_path(V46)))


V48 = "rate_master_hvac_all_v48.json"   # ADP-2: v47 + the ADP-2 config (H5 air stream, H7 plenum fields, B3 neck Other); no item change


class TestAdp2AssetV48(FrappeTestCase):
    """ADP-2 AC8 (owner rulings H5 / H7 / B3) -- HVAC v48 = v47 + exactly this slice's config, minted by
    `scripts/_instruments/mint_hvac_v48_adp2.py` from the database export.

      test_51  THE ITEMS: v48 = v47, item for item. THE CONFIGS: only ADP differs, and by exactly H5 (the four air-stream
               rules replacing R13), H7 (the four plenum boxes, the area conversion first) and B3 (the neck control).
      test_52  v48 validates; no request the model receives changes (the stub proof).
      test_53  v48 is the newest HVAC asset; v47 stays on disk.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v47, cls.v48 = _read(V47), _read(V48)

    def test_51_the_diff_is_exactly_the_slices(self):
        self.assertEqual(self.v47["items"], self.v48["items"])
        c47 = {c["category_id"]: c for c in self.v47["category_configs"]}
        c48 = {c["category_id"]: c for c in self.v48["category_configs"]}
        self.assertEqual(sorted(cid for cid in c47 if c47[cid] != c48[cid]), ["hvac_adp"])
        p47, p48 = c47["hvac_adp"]["list_spec"]["pricing"], c48["hvac_adp"]["list_spec"]["pricing"]
        self.assertEqual([r["rule"] for r in p47["derive_when_none"]], ["R13 supply-air linear / plain grille = with damper"])
        self.assertEqual([(r["when"]["equals"], r["then"], len(r["families"])) for r in p48["derive_when_none"]],
                         [("supply", "with", 6), ("return", "without", 6), ("exhaust", "without", 6), ("fresh", "without", 6)])
        self.assertEqual(sorted(set(p48["numbers"]) - set(p47["numbers"])), ["plenum_area_sqm", "plenum_height_mm", "plenum_length_mm", "plenum_width_mm"])
        self.assertEqual([p48["numbers"][k].get("box_side") for k in ("plenum_length_mm", "plenum_width_mm", "plenum_height_mm")], ["length", "width", "height"])
        self.assertEqual((p47["panel_controls"]["neck_mm"], p48["panel_controls"]["neck_mm"]), ("dropdown", "dropdown_or_other"))
        conv = p48["families"]["mixing box / LP plenum"]["convert"]["count"]
        self.assertEqual([o["needs"] for o in conv], [["plenum_area_sqm"], ["plenum_length_mm", "plenum_width_mm", "plenum_height_mm"]])
        # NEGATIVE: everything else on ADP's config is v47's, key for key
        strip = lambda p: {k: v for k, v in p.items() if k not in ("derive_when_none", "numbers", "match_attrs", "panel_controls", "families")}
        self.assertEqual(strip(p47), strip(p48))
        self.assertEqual({k: v for k, v in p48["families"].items() if k != "mixing box / LP plenum"}, {k: v for k, v in p47["families"].items() if k != "mixing box / LP plenum"})
        self.assertEqual({k: v for k, v in self.v48.items() if k not in ("items", "category_configs")},
                         {k: v for k, v in self.v47.items() if k not in ("items", "category_configs")})

    def test_52_v48_validates_and_no_request_changes(self):
        from nirmaan_stack.services.boq_rate_master import config_validation, extraction
        for c in self.v48["category_configs"]:
            config_validation._validate_config(dict(c, discipline=self.v48["discipline"]))
        req = {}
        for name, payload in (("v47", self.v47), ("v48", self.v48)):
            cfgs = {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}
            req[name] = {c["category_id"]: json.dumps(extraction.build_items_spec(cfgs[(payload["discipline"], c["category_id"])], cfgs, payload["discipline"]), sort_keys=True)
                         for c in payload["category_configs"] if c.get("list_spec")}
        self.assertEqual(sorted(req["v48"]), ["hvac_adp", "hvac_insulation", "hvac_piping"])
        self.assertEqual(req["v47"], req["v48"])

    def test_53_v48_is_the_newest_and_v47_stays(self):
        d = os.path.dirname(_asset_path(V48))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # BEFORE: self.assertEqual(max(ns), 48)
        self.assertNotEqual(max(ns), 48, "ADP-3b: v48 is no longer the newest")
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        # INVERTED at ADP-3b (HVAC v49) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 49)))`
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 50)))`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 51)))`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 52)))`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 53)))`
        self.assertEqual(sorted(ns), list(range(1, 54)))
        self.assertTrue(os.path.exists(_asset_path(V47)))
        # INVERTED at ADP-3b (mechanical authority): BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v49.json")))`.
        # v49 is minted; nothing past it exists.
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v49.json")))
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v50.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v50.json")))
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v51.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v51.json")))
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v52.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v52.json")))
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v53.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v53.json")))
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v54.json")))


V49 = "rate_master_hvac_all_v49.json"   # ADP-3b: v48 + the ADP-3b config (B1 face boxes, D4 depth retired); no item change


class TestAdp3bAssetV49(FrappeTestCase):
    """ADP-3b AC5 (owner B1; D1-D4) -- HVAC v49 = v48 + exactly this slice's config, minted by
    `scripts/_instruments/mint_hvac_v49_adp3b.py` from the database export.

      test_54  THE ITEMS: v49 = v48, item for item. THE CONFIGS: only ADP differs, and by exactly B1 (face_w_mm / face_h_mm
               typed face boxes, ids unchanged), D4 (the depth axis retired: number, match attribute, control, note) and the
               per-box notes; every need, conversion and pipeline is v48's.
      test_55  v49 validates; no request the model receives changes (the stub proof).
      test_56  v49 is the newest HVAC asset; v48 stays on disk; the series is 1..49 with no gap.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v48, cls.v49 = _read(V48), _read(V49)

    def test_54_the_diff_is_exactly_the_slices(self):
        self.assertEqual(self.v48["items"], self.v49["items"])
        c48 = {c["category_id"]: c for c in self.v48["category_configs"]}
        c49 = {c["category_id"]: c for c in self.v49["category_configs"]}
        self.assertEqual(sorted(cid for cid in c48 if c48[cid] != c49[cid]), ["hvac_adp"])
        p48, p49 = c48["hvac_adp"]["list_spec"]["pricing"], c49["hvac_adp"]["list_spec"]["pricing"]
        self.assertEqual({k: p49["numbers"][k] for k in ("face_w_mm", "face_h_mm")}, {
            "face_w_mm": {"from": ["face_w_mm"], "name": "width", "unit": "mm", "typed_only": True, "length_from": "size_mm", "face_side": "width", "label": "Width (mm)"},
            "face_h_mm": {"from": ["face_h_mm"], "name": "height", "unit": "mm", "typed_only": True, "length_from": "size_mm", "face_side": "height", "label": "Height (mm)"}})
        self.assertEqual([p48["numbers"][k].get("component") for k in ("face_w_mm", "face_h_mm", "depth_mm")], [1, 2, 3])
        self.assertNotIn("depth_mm", p49["numbers"])
        self.assertEqual([a for a in p48["match_attrs"] if a != "depth_mm"], p49["match_attrs"])
        self.assertEqual({k: v for k, v in p48["panel_controls"].items() if k != "depth_mm"}, p49["panel_controls"])
        self.assertEqual(p49["panel_notes"]["face_w_mm"], [{"text": "Type the width the BoQ states, in mm."}])
        self.assertEqual(p49["panel_notes"]["face_h_mm"], [{"text": "Type the height the BoQ states, in mm."}])
        # NEGATIVE: every other key of ADP's pricing is v48's, key for key -- the needs, conversions and pipelines included
        strip = lambda p: {k: v for k, v in p.items() if k not in ("numbers", "match_attrs", "panel_controls", "panel_notes")}
        self.assertEqual(strip(p48), strip(p49))
        self.assertEqual({k: v for k, v in p48["numbers"].items() if k not in ("face_w_mm", "face_h_mm", "depth_mm")},
                         {k: v for k, v in p49["numbers"].items() if k not in ("face_w_mm", "face_h_mm")})
        self.assertEqual({k: v for k, v in p48["panel_notes"].items() if k not in ("face_w_mm", "face_h_mm")},
                         {k: v for k, v in p49["panel_notes"].items() if k not in ("face_w_mm", "face_h_mm")})
        self.assertEqual({k: v for k, v in c48["hvac_adp"].items() if k != "list_spec"}, {k: v for k, v in c49["hvac_adp"].items() if k != "list_spec"})
        self.assertEqual({k: v for k, v in self.v49.items() if k not in ("items", "category_configs")},
                         {k: v for k, v in self.v48.items() if k not in ("items", "category_configs")})

    def test_55_v49_validates_and_no_request_changes(self):
        from nirmaan_stack.services.boq_rate_master import config_validation, extraction
        for c in self.v49["category_configs"]:
            config_validation._validate_config(dict(c, discipline=self.v49["discipline"]))
        req = {}
        for name, payload in (("v48", self.v48), ("v49", self.v49)):
            cfgs = {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}
            req[name] = {c["category_id"]: json.dumps(extraction.build_items_spec(cfgs[(payload["discipline"], c["category_id"])], cfgs, payload["discipline"]), sort_keys=True)
                         for c in payload["category_configs"] if c.get("list_spec")}
        self.assertEqual(sorted(req["v49"]), ["hvac_adp", "hvac_insulation", "hvac_piping"])
        self.assertEqual(req["v48"], req["v49"])

    def test_56_v49_is_the_newest_and_v48_stays(self):
        d = os.path.dirname(_asset_path(V49))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(max(ns), 49)`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 50)`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 51)`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 52)`
        self.assertEqual(max(ns), 53)
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 50)))`
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 51)))`
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 52)))`
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 53)))`
        self.assertEqual(sorted(ns), list(range(1, 54)))
        self.assertTrue(os.path.exists(_asset_path(V48)))
        # INVERTED at ADP-4a (HVAC v50; owner PY-1, the latest-asset pins) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v50.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v50.json")))
        # INVERTED at ADP-5a (HVAC v51; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v51.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v51.json")))
        # INVERTED at ADP-5b (HVAC v52; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v52.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v52.json")))
        # INVERTED at ADP-5c (HVAC v53; standing authority for this slice: a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v53.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v53.json")))
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v54.json")))
