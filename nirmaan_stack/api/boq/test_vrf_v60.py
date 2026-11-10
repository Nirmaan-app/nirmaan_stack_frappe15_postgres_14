"""VRF-4 (2026-11-06) -- HVAC v60 = v59 WITH VRF SWITCHED ON: calculator_only REMOVED, THE MODEL'S QUESTIONS, THE SECOND
OPINION ON, AND THE KEYS THE PRICER READS THE ANSWERS THROUGH.

Minted by `scripts/_instruments/mint_hvac_v60_vrf4.py` (the v59 shape) from v59. The prices and the screen are proved through
the product's own pricer in `vrf4Model.test.ts` / `vrf4Borrowed.test.ts`, `calculatorPanelParity.test.ts` (the VRF-4 block) and
`ruleReachability.test.ts` (R-39); the validator in test_rate_master v4_*. Here the asset is pinned.

What these tests protect, in plain English (01-06 file-only; 07 reads the loaded catalogue):

  01  ONLY hvac_vrf CHANGES: every v59 item byte-for-byte (566); every other config byte-for-byte; on hvac_vrf only
      `calculator_only` (GONE -- owner Q1 A "removed at VRF-4", D-10), `list_spec` (attribute_definitions, second_opinion,
      pricing: defaults / extras / per_set / working_standby) and `notes` change.
  02  THE VRF-4 KEYS AND QUESTIONS = THE SHARED FIXTURE (`vrf4Model.json`), byte for byte.
  03  THE OWNER'S RULINGS: q1 the four per-item Yes / No includes; q3 the capacity note copies a stated split WHOLE on one
      item; q4 capacity_label NOT asked; q5 the second opinion ON; q2 refnet counts from the sheet; R-WS words + D-9 text;
      R-BRAND (a) from brand_as_written; every set_covers value is one of the refnet's covers options.
  04  THE QUESTIONS REACH THE MODEL: build_items_spec carries exactly the 20 questions, in order, with the second opinion on;
      every answer the pricer reads (includes_*, *_as_written, set_covers, working_standby) is a declared question, so the
      reply parser keeps it (an undeclared key is dropped, EX parse_item_list).
  05  SWITCHED ON: v60 validates (with the cross-category extras check); hvac_vrf IS eligible; the eligible set is v59's plus
      hvac_vrf; every other item-list request is byte-identical; no other config declares `extras` / `working_standby`.
  06  v60 is the newest HVAC asset; the series is 1..60 with no gap; v59 stays on disk.
  07  LIVE (after the load): the active hvac_vrf config equals v60's and IS eligible; 566 active HVAC items.
"""
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V59 = "rate_master_hvac_all_v59.json"
V60 = "rate_master_hvac_all_v60.json"
CATEGORY = "hvac_vrf"


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _fixture():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "pricing",
                        "__fixtures__", "vrf4Model.json")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload, strip_retired=False):
    out = {}
    for c in payload["category_configs"]:
        c = dict(c, discipline=payload["discipline"])
        if strip_retired:
            c.pop("calculator_only", None)
        out[(payload["discipline"], c["category_id"])] = c
    return out


class TestVrf4AssetV60(FrappeTestCase):
    ASSET = V60   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v59 = _read(V59)
        cls.v60 = _read(cls.ASSET)
        cls.fx = _fixture()
        cls.cfg = next(c for c in cls.v60["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg59 = next(c for c in cls.v59["category_configs"] if c["category_id"] == CATEGORY)
        cls.pr = cls.cfg["list_spec"]["pricing"]

    def test_01_only_hvac_vrf_moved_and_the_switch_is_gone(self):
        self.assertEqual(_norm(self.v60["items"]), _norm(self.v59["items"]))
        self.assertEqual(len(self.v60["items"]), 566)
        self.assertEqual([c["category_id"] for c in self.v60["category_configs"]], [c["category_id"] for c in self.v59["category_configs"]])
        for a, b in zip(self.v59["category_configs"], self.v60["category_configs"]):
            if a["category_id"] != CATEGORY:
                self.assertEqual(_norm(a), _norm(b), a["category_id"])
        changed = sorted(k for k in set(self.cfg) | set(self.cfg59) if _norm(self.cfg.get(k)) != _norm(self.cfg59.get(k)))
        self.assertEqual(changed, ["calculator_only", "list_spec", "notes"])
        self.assertNotIn("calculator_only", self.cfg)
        self.assertIs(self.cfg59.get("calculator_only"), True)      # NEGATIVE half: v59 still carries it (frozen)
        po, pn = self.cfg59["list_spec"]["pricing"], self.pr
        self.assertEqual(sorted(k for k in set(po) | set(pn) if _norm(po.get(k)) != _norm(pn.get(k))),
                         ["defaults", "extras", "per_set", "working_standby"])
        ls, ls59 = self.cfg["list_spec"], self.cfg59["list_spec"]
        self.assertEqual(sorted(k for k in set(ls) | set(ls59) if _norm(ls.get(k)) != _norm(ls59.get(k))),
                         ["attribute_definitions", "pricing", "second_opinion"])

    def test_02_the_keys_and_questions_equal_the_shared_fixture(self):
        fx = self.fx
        self.assertEqual(_norm(self.cfg["list_spec"]["attribute_definitions"]), _norm(fx["questions"]))
        self.assertEqual(_norm(self.pr["extras"]["from_model"]), _norm(fx["extras_from_model"]))
        self.assertEqual(self.pr["extras"]["lines"]["boq_note"], fx["extras_words"]["boq_note"])
        self.assertEqual(self.pr["defaults"]["brand"]["unlisted"]["from_attr"], fx["brand_from_attr"])
        self.assertEqual(_norm(self.pr["per_set"]["counted"]["from_sheet"]), _norm(fx["counted_from_sheet"]))
        self.assertEqual(_norm(self.pr["working_standby"]), _norm(fx["working_standby"]))
        self.assertEqual((self.pr["extras"]["cable"]["conductor_attr"], self.pr["extras"]["cable"]["armour_attr"]), ("material", "insulation"))
        # "closest" is gone from VRF's words (BORROWED "option a"; R5 (e) 9)
        self.assertNotIn("closest", self.pr["extras"]["lines"]["typed_note"])
        self.assertIn("closest", self.cfg59["list_spec"]["pricing"]["extras"]["lines"]["typed_note"])
        # the rest of extras is v59's, byte for byte
        strip = lambda ex: {k: (v if k != "lines" else {kk: vv for kk, vv in v.items() if kk not in ("boq_note", "typed_note")})
                            for k, v in ex.items() if k not in ("from_model",)}
        e59, e60 = self.cfg59["list_spec"]["pricing"]["extras"], dict(self.pr["extras"])
        e60 = dict(e60, cable={k: v for k, v in e60["cable"].items() if k not in ("conductor_attr", "armour_attr")})
        self.assertEqual(_norm(strip(e60)), _norm(strip(e59)))

    def test_03_the_owners_rulings(self):
        q = {d["id"]: d for d in self.cfg["list_spec"]["attribute_definitions"]}
        self.assertNotIn("capacity_label", q)                                          # q4
        self.assertIn("capacity_label", {d["id"] for d in self.cfg59["list_spec"]["attribute_definitions"]})
        for inc in ("copper", "insulation", "power", "comm"):                          # q1: per item, Yes / No
            d = q[f"includes_{inc}"]
            self.assertEqual((d["type"], d["values"], d["allow_none"]), ("choice", ["Yes", "No"], True))
            self.assertEqual(self.pr["extras"]["from_model"]["includes"][inc], f"includes_{inc}")
        self.assertIn("WHOLE on this ONE item", q["capacity"]["note"])                  # q3
        self.assertIn("never one item per module", q["capacity"]["note"])
        self.assertIs(self.cfg["list_spec"]["second_opinion"], True)                    # q5
        self.assertIs(self.cfg59["list_spec"]["second_opinion"], False)
        covers = [o["value"] for o in self.pr["per_set"]["counted"]["covers"]["options"]]
        self.assertEqual(q["set_covers"]["values"], covers)
        sides = self.pr["per_set"]["counted"]["from_sheet"]["sides"]                     # q2
        self.assertEqual(sides["outdoor"], [f for f, r in self.pr["extras"]["roles"].items() if r == "outdoor"])
        self.assertEqual(sides["indoor"], [f for f, r in self.pr["extras"]["roles"].items() if r == "indoor"])
        ws = self.pr["working_standby"]                                                  # R-WS / D-9
        self.assertEqual(ws["attr"], "working_standby_as_written")
        self.assertIn("check that the quantity covers both", ws["bar"]["line"])
        self.assertNotIn("doubled", ws["bar"]["line"])
        for t in ("1W+1S", "N+N", "2N+N", "W+S", "WORKING + STANDBY"):
            self.assertTrue(any(re.search(w, t, re.I) for w in ws["words"]), t)
        for t in ("(Standby)", "Standby units for Lab area", "Working/Standby Mode"):
            self.assertFalse(any(re.search(w, t, re.I) for w in ws["words"]), t)
        self.assertEqual(self.pr["defaults"]["brand"]["unlisted"]["from_attr"], "brand_as_written")   # R-BRAND (a)
        self.assertIn("Touch Screen Central Controller", q["item"]["note"])           # D-4
        self.assertIn("BACnet", q["item"]["note"])
        self.assertIn("Drain Pump", q["item"]["note"])

    def test_04_the_questions_reach_the_model_and_survive_the_parser(self):
        cfgs = _stored(self.v60)
        spec = extraction.build_items_spec(cfgs[("HVAC", CATEGORY)], cfgs, "HVAC")
        self.assertEqual([a["id"] for a in spec["attribute_definitions"]], [d["id"] for d in self.fx["questions"]])
        self.assertIs(spec["second_opinion"], True)
        asked = {a["id"] for a in spec["attribute_definitions"]}
        fm = self.pr["extras"]["from_model"]
        read = set(fm["includes"].values()) | {fm[k] for k in ("copper_size", "insulation_thickness", "cable_spec", "length")}
        read |= {self.pr["working_standby"]["attr"], self.pr["defaults"]["brand"]["unlisted"]["from_attr"], "set_covers"}
        self.assertEqual(read - asked, set())
        # the parser keeps a declared answer and drops an undeclared one (the reason the questions exist)
        drops = {"items_rows_without_list": [], "items_empty_rows": [], "items_not_objects": {}, "items_family_unrecognised": {},
                 "items_coerce_failed": {}, "items_unknown_section": {}}
        el = {"id": 7, "items": [{"attributes": {"item": {"value": "Outdoor Unit", "confidence": 0.9}, "includes_copper": {"value": "Yes", "confidence": 0.9},
                                                 "extra_copper_size_as_written": {"value": "12.7 / 6.4", "confidence": 0.9},
                                                 "extra_copper_supply_size": {"value": "12.7", "confidence": 0.9}}}]}
        items = extraction.parse_item_list(el, spec, drops, 7)
        self.assertEqual(items[0]["attributes"]["includes_copper"]["value"], "Yes")
        self.assertEqual(items[0]["attributes"]["extra_copper_size_as_written"]["value"], "12.7 / 6.4")
        self.assertNotIn("extra_copper_supply_size", items[0]["attributes"])

    def test_05_validates_eligible_requests_unchanged(self):
        stored = list(_stored(self.v60).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.v60["items"]), [])
        self.assertEqual(config_validation.extras_problems(stored, self.v60["items"]), [])
        cfgs, cfgs59 = _stored(self.v60), _stored(self.v59, strip_retired=True)
        self.assertTrue(extraction.config_is_eligible(cfgs[("HVAC", CATEGORY)], cfgs))
        el = lambda cf: sorted(k[1] for k, c in cf.items() if extraction.config_is_eligible(c, cf))
        el59 = sorted(k[1] for k, c in cfgs59.items() if k[1] != CATEGORY and extraction.config_is_eligible(c, cfgs59))
        self.assertEqual(el(cfgs), sorted(el59 + [CATEGORY]))
        for k, c in cfgs.items():
            if c.get("list_spec") and k[1] != CATEGORY:
                self.assertEqual(json.dumps(extraction.build_items_spec(c, cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(cfgs59[k], cfgs59, "HVAC"), sort_keys=True), k)
        self.assertEqual([k[1] for k, c in cfgs.items() if k[1] != CATEGORY and any(x in ((c.get("list_spec") or {}).get("pricing") or {}) for x in ("extras", "working_standby"))], [])

    def test_06_v60_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V60))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        # INVERTED at VRF-5 (HVAC v61 minted + LOADED; mechanical authority -- fails solely because it reads the current HVAC asset): BEFORE `nums[-1] == 60` and `range(1, 61)`
        self.assertEqual(nums[-1], 63)  # VRF-7 (HVAC v63 minted + loaded; mechanical authority): BEFORE nums[-1] == 62
        self.assertEqual(nums, list(range(1, 64)))  # VRF-7 (HVAC v63 minted + loaded; mechanical authority): BEFORE list(range(1, 63))
        self.assertTrue(os.path.exists(_asset_path(V59)))

    def test_07_live_catalogue_is_v60(self):
        row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", CATEGORY))
        self.assertTrue(row)
        live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
        # INVERTED at VRF-5 (HVAC v61 minted + LOADED; mechanical authority -- fails solely because it reads the current HVAC asset): BEFORE `assertEqual(_norm(live), _norm(self.cfg))` (live == v60) and `n == 566`. The live VRF config is v61's
        # (test_vrf_v61 07 pins it whole): v60's twenty questions and second opinion stand inside it
        self.assertNotEqual(_norm(live), _norm(self.cfg))
        # INVERTED at VRF-7 (HVAC v63 LOADED; mechanical authority -- fails solely because it reads the live catalogue): BEFORE the live
        # config's first twenty ids == v60's twenty. v63 drops the shared length question (owner A3), so v60's other nineteen stand in it, in order
        v60ids = [q["id"] for q in self.cfg["list_spec"]["attribute_definitions"]]
        self.assertEqual([q["id"] for q in live["list_spec"]["attribute_definitions"] if q["id"] in v60ids], [i for i in v60ids if i != "extra_length_as_written"])
        # INVERTED at VRF-6 (owner 2026-11-09 18:52: "run with second opinion off ... from now onwards we will keep it off"; v62 LOADED): BEFORE
        # `assertIs(live["list_spec"]["second_opinion"], True)`
        self.assertIs(live["list_spec"]["second_opinion"], False)
        self.assertNotIn("calculator_only", live)
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 585)  # VRF-6 (HVAC v62 minted + loaded; mechanical authority): BEFORE n == 579