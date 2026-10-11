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
        self.assertEqual(max(ns), 37)
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
        self.assertEqual(max(ns), 37)
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
        self.assertEqual(len(rows), 379, "load v36 first")
        norm = lambda it: _norm({"kind": it["kind"], "brand": it.get("brand") or None, "unit": it.get("unit"),
                                 "attributes": it["attributes"] if isinstance(it["attributes"], dict) else json.loads(it["attributes"] or "{}"),
                                 "rates": it["rates"] if isinstance(it["rates"], dict) else json.loads(it["rates"] or "{}")})
        live = {r["item_uid"]: norm(r) for r in rows}
        self.assertEqual(set(live), set(a))
        self.assertEqual([u for u in a if norm(a[u]) != live[u]], [])
        served = rate_master.get_rate_master_items(discipline="HVAC", kind=INPUT_KIND)
        self.assertEqual(served["count"], 11)
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
#     20  the config editor's save (`update_rate_config`) refuses the same, and refuses an edit to the
#         DELEGATED category that would break Piping's section (the reverse direction); the stored config is
#         unchanged after each.
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
        self.assertEqual(max(ns), 37)
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
        for word in ("sections", "include_when", "add_label", "from pipe", "hvac_insulation", "Nitrile Rubber Insulation"):
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
                with self.assertRaises(frappe.ValidationError) as cm:
                    rate_master.update_rate_config(name=name(cid), config=json.dumps(cfg))
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
