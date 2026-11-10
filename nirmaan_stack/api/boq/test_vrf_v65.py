"""VRF-9 (2026-11-11) -- HVAC v65 = v64 + THE VRF-8 REVIEW'S FIXES S1-S7, THE OWNER'S RULINGS R1-R4 (2026-11-11 00:36-00:43) AND
ANSWER 2 / 3 (S8-S10, 00:59-01:15): SEVERAL UNIT TYPES ONLY WHEN THE ROW NAMES NONE (+ THE CALCULATOR'S TYPED CASE), THE SCOPE NOTE
ALWAYS, INSTALLATION AT ANY LEVEL, EXACT QUOTES WITH THEIR ROWS, THE FEEDER NOTE PER MODULE, THE TFA CAPACITY, THE PER-HP CALCULATOR
REFUSAL, FIRST CHARGE = GAS, BMS CABLES ARE NOT THE COMM CABLE, CIVIL SUPPORTS ARE NOT THE MS FRAME, THE FAN COIL REFUSAL, A SET THE
BoQ DEFINES = 1 REFNET, GAS CHARGING ALWAYS SUPPLY + INSTALLATION, THE GAS / FRAME ITEM WHERE NONE WAS READ.

Minted by `scripts/_instruments/mint_hvac_v65_vrf9.py` (the v64 shape) from v64. The prices and the screen are proved through the
product's own pricer in `vrf9Model.test.ts`, `calculatorPanelParity.test.ts` (the VRF-9 block) and `ruleReachability.test.ts` (R-39);
the validator here (05b) and in test_rate_master. Here the asset is pinned.

What these tests protect, in plain English (01-06 file-only; 07 reads the loaded catalogue):

  01  ONLY hvac_vrf's list_spec CHANGES: every v64 item byte-for-byte and in order; every other config byte-for-byte; on hvac_vrf
      only `attribute_definitions` (notes) and `pricing.extras` (accessories / prepare / safeguard / scope), `pricing.per_set` and
      `pricing.lot_units`; the 68 questions and their required / allow_none flags are v64's.
  02  THE VRF-9 KEYS AND NOTES = THE SHARED FIXTURE (`vrf9Model.json`), applied to v64 exactly as the mint does.
  03  THE OWNER'S RULINGS read the BoQ's own words: "Wall Mounted Type" names a Hi-Wall; first / factory charge = the gas; BMS
      cables, civil pedestals and the Fan Coil heading; the scope wordings; liquid + gas = one Set; the gas / frame rows; every extra
      question still REQUIRED; second_opinion OFF.
  04  THE GUIDANCE REACHES THE MODEL: build_items_spec carries the 68 questions with the VRF-9 notes on the seven questions.
  05  VALIDATES: v65 passes the validator and the cross-category check; hvac_vrf eligible; every other item-list request
      byte-identical to v64's; the Pricing Inputs hvac_vrf reads are v64's. 05b: every new key refused by name when malformed.
  06  v65 is the newest HVAC asset; the series is 1..65 with no gap; v64 stays on disk.
  07  LIVE (after the load): the active hvac_vrf config equals v65's; 585 active HVAC items.
"""
import copy
import json
import os
import re

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, loader

V64 = "rate_master_hvac_all_v64.json"
V65 = "rate_master_hvac_all_v65.json"
CATEGORY = "hvac_vrf"
REQUIRED = ["includes_copper", "includes_insulation", "includes_power", "includes_comm", "includes_frame", "includes_gas",
            "includes_drain_pump", "includes_remote", "includes_refnet", "includes_mccb"]
NOTED = ["includes_gas", "includes_comm", "includes_frame", "scope", "capacity", "item", "set_contents_as_written"]


def _asset_path(name):
    return os.path.join(os.path.dirname(loader.__file__), "data", name)


def _read(name):
    with open(name if os.path.isabs(name) else _asset_path(name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _fixture():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "pricing",
                        "__fixtures__", "vrf9Model.json")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _stored(payload):
    return {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}


def _apply(cfg64, fx):
    """The fixture applied to v64's hvac_vrf -- written here a second time on purpose (not imported from the mint), so a wrong step
    in either shows as a difference."""
    c = copy.deepcopy(cfg64)
    p = c["list_spec"]["pricing"]
    x = p["extras"]
    for k, v in fx["prepare_patch"].items():
        merged = dict(x["prepare"].get(k) or {})
        merged.update(copy.deepcopy(v))
        x["prepare"][k] = merged
    for k, v in fx["prepare_add"].items():
        x["prepare"][k] = copy.deepcopy(v)
    ii = list(x["prepare"].get("implied_includes", [])) + copy.deepcopy(fx["implied_includes_add"])
    for i in ii:
        if i["question"] in fx["implied_not_words_append"] and isinstance(i.get("not_words"), str):
            i["not_words"] = i["not_words"] + fx["implied_not_words_append"][i["question"]]
    x["prepare"]["implied_includes"] = ii
    for k, v in fx["scope_add"].items():
        x["scope"][k] = copy.deepcopy(v)
    for k, v in fx["safeguard_add"].items():
        x["safeguard"][k] = copy.deepcopy(v)
    for a in x["accessories"]:
        pt = fx["accessories_patch"].get(a["id"], {})
        if a.get("note_words") and "note_words_words" in pt:
            a["note_words"]["words"] = pt["note_words_words"]
        if a.get("note_words") and "note_words_line" in pt:
            a["note_words"]["line"] = pt["note_words_line"]
        if (a.get("choice") or {}).get("conflict"):
            if "conflict_line" in pt:
                a["choice"]["conflict"]["line"] = pt["conflict_line"]
            if "conflict_both_line" in pt:
                a["choice"]["conflict"]["both_line"] = pt["conflict_both_line"]
    for k, v in fx["per_set_counted_add"].items():
        p["per_set"]["counted"][k] = copy.deepcopy(v)
    for k, v in (fx.get("pricing_patch") or {}).items():
        p[k] = dict(p.get(k) or {}, **copy.deepcopy(v))
    ap = fx["question_notes_append"]
    defs = []
    for q in c["list_spec"]["attribute_definitions"]:
        q = dict(q)
        if q["id"] in ap:
            q["note"] = q.get("note", "") + ap[q["id"]]
        defs.append(q)
    c["list_spec"]["attribute_definitions"] = defs
    c["list_spec"]["second_opinion"] = fx["second_opinion"]
    return c


class TestVrf9AssetV65(FrappeTestCase):
    ASSET = V65   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v64 = _read(V64)
        cls.v65 = _read(cls.ASSET)
        cls.fx = _fixture()
        cls.cfg = next(c for c in cls.v65["category_configs"] if c["category_id"] == CATEGORY)
        cls.cfg64 = next(c for c in cls.v64["category_configs"] if c["category_id"] == CATEGORY)
        cls.x = cls.cfg["list_spec"]["pricing"]["extras"]

    def test_01_only_hvac_vrf_list_spec_moved(self):
        self.assertEqual(_norm(self.v65["items"]), _norm(self.v64["items"]))
        for a, b in zip(self.v64["category_configs"], self.v65["category_configs"]):
            self.assertEqual(a["category_id"], b["category_id"])
            if a["category_id"] != CATEGORY:
                self.assertEqual(_norm(a), _norm(b), a["category_id"])
        changed = sorted(k for k in set(self.cfg) | set(self.cfg64) if _norm(self.cfg.get(k)) != _norm(self.cfg64.get(k)))
        self.assertEqual(changed, ["list_spec"])
        ls, ls64 = self.cfg["list_spec"], self.cfg64["list_spec"]
        self.assertEqual(sorted(k for k in set(ls) | set(ls64) if _norm(ls.get(k)) != _norm(ls64.get(k))), ["attribute_definitions", "pricing"])
        p, p64 = ls["pricing"], ls64["pricing"]
        self.assertEqual(sorted(k for k in set(p) | set(p64) if _norm(p.get(k)) != _norm(p64.get(k))), ["extras", "lot_units", "per_set"])
        x64 = p64["extras"]
        self.assertEqual(sorted(k for k in set(self.x) | set(x64) if _norm(self.x.get(k)) != _norm(x64.get(k))),
                         ["accessories", "prepare", "safeguard", "scope"])
        flags = lambda l: [(q["id"], q.get("required"), q.get("allow_none")) for q in l["attribute_definitions"]]
        self.assertEqual(flags(ls), flags(ls64))
        self.assertEqual(sorted(q["id"] for q, q0 in zip(ls["attribute_definitions"], ls64["attribute_definitions"]) if q != q0), sorted(NOTED))

    def test_02_the_keys_and_notes_equal_the_shared_fixture(self):
        self.assertEqual(_norm(self.cfg), _norm(_apply(self.cfg64, self.fx)))
        # NEGATIVE: the fixture without one key is not v65
        fx = copy.deepcopy(self.fx)
        fx["prepare_add"].pop("not_includes")
        self.assertNotEqual(_norm(self.cfg), _norm(_apply(self.cfg64, fx)))

    def test_03_the_owners_rulings(self):
        pp = self.x["prepare"]
        hw = pp["unit_words"]["Hi-Wall"]
        self.assertTrue(re.search(hw, "Wall Mounted Type (2.0TR)", re.I))                            # S2
        self.assertFalse(re.search(hw, "with wall mounted corded remote with LCD display", re.I))     # S2 negative: a remote
        self.assertIs(pp["several_types"]["typed"], True)                                          # S1
        self.assertIs(pp["feeder_length"]["every_module"], True)                                   # S7
        gas = next(i for i in pp["implied_includes"] if i["question"] == "includes_gas")           # R1
        self.assertTrue(re.search(gas["words"], "The unit shall be factory charged with first charge of refrigerant and oil", re.I))
        self.assertTrue(re.search(gas["words"], "The unit shall be filled with first charge of the refrigerant", re.I))
        self.assertNotIn("only_blank", gas)
        ni = {n["question"]: n for n in pp["not_includes"]}
        self.assertTrue(re.search(ni["includes_comm"]["words"], "Suitable provison for BMS interface bacnet / Modbus, communication cables", re.I))   # R2
        self.assertTrue(re.search(ni["includes_comm"]["unless"], "control cabling between indoor & outdoor units", re.I))
        self.assertTrue(re.search(ni["includes_frame"]["words"], "Including Civil pedestal supports for outdoor units", re.I))                     # R3
        self.assertTrue(re.search(ni["includes_frame"]["unless"], "MS base frame duly painted", re.I))
        sup = next(i for i in pp["implied_includes"] if i["question"] == "includes_frame")
        self.assertTrue(re.search(sup["not_words"], "Including Civil pedestal supports for outdoor units", re.I))
        self.assertEqual(pp["family_refusals"][0]["refusal"], "Fan Coil Unit - pick the indoor type")                                      # R4
        self.assertTrue(re.search(pp["family_refusals"][0]["words"], "Fan Coil Units", re.I))
        rf = {r["family"]: r for r in pp["row_family"]}
        self.assertTrue(re.search(rf["MS frame / stand for ODU"]["words"], "Supply and installation of MS base frames coated with anti corrosive paint", re.I))   # S10
        self.assertTrue(re.search(rf["MS frame / stand for ODU"]["not_words"], "Construction of civil pedestal for outdoor units", re.I))
        self.assertTrue(re.search(rf["Refrigerant Gas Filling (R-410)"]["words"], "including topping up of Refrigerant R-410A", re.I))         # S9
        self.assertEqual(rf["Refrigerant Gas Filling (R-410)"]["unit_classes"], ["weight"])
        sc = self.x["scope"]
        self.assertTrue(re.search(sc["always_note"]["row_words"], "Supply of VRV/VRF outdoor unit as per the specification", re.I))           # S3
        self.assertTrue(re.search(sc["any_level"]["install_words"], "Design, Supply, delivery, hoisting, installing, testing", re.I))          # S4
        self.assertTrue(re.search(sc["any_level"]["keep_words"], "38 HP outdoor unit - supply only", re.I))
        self.assertEqual(sc["always_both"]["families"], ["Refrigerant Gas Filling (R-410)"])                                               # S9
        self.assertIs(self.x["safeguard"]["exact_quotes"], True)                                                                         # S5
        remote = next(a for a in self.x["accessories"] if a["id"] == "remote")
        self.assertIn("{first_where}", remote["choice"]["conflict"]["line"])
        mcb = next(a for a in self.x["accessories"] if a["id"] == "mcb")
        self.assertIn("{where}", mcb["note_words"]["line"])
        df = self.cfg["list_spec"]["pricing"]["per_set"]["counted"]["defined"]                                                           # S8
        self.assertTrue(re.search(df["words"], "Liquid and Gas considered as a one Set", re.I))
        self.assertIs(self.cfg["list_spec"]["pricing"]["lot_units"]["calculator_refuses"], True)                                         # S7 (per HP)
        defs = {q["id"]: q for q in self.cfg["list_spec"]["attribute_definitions"]}
        self.assertEqual(sorted(q for q, d in defs.items() if d.get("required")), sorted(REQUIRED))
        self.assertIs(self.cfg["list_spec"]["second_opinion"], False)

    def test_04_the_guidance_reaches_the_model(self):
        cfgs = _stored(self.v65)
        spec = extraction.build_items_spec(cfgs[("HVAC", CATEGORY)], cfgs, "HVAC")
        sent = {a["id"]: a for a in spec["attribute_definitions"]}
        self.assertEqual(len(sent), 68)
        for q in NOTED:
            self.assertIn("VRF-9", sent[q].get("note", ""), q)
        self.assertIn("first charge", sent["includes_gas"]["note"])
        self.assertIn("BMS interface", sent["includes_comm"]["note"])
        self.assertIn("civil pedestal", sent["includes_frame"]["note"])
        self.assertEqual(sorted(i for i, a in sent.items() if a.get("required")), sorted(REQUIRED))
        self.assertIs(spec.get("second_opinion"), False)
        # NEGATIVE: v64's spec carries none of the VRF-9 guidance
        cfgs64 = _stored(self.v64)
        spec64 = extraction.build_items_spec(cfgs64[("HVAC", CATEGORY)], cfgs64, "HVAC")
        self.assertFalse(any("VRF-9" in (a.get("note") or "") for a in spec64["attribute_definitions"]))

    def test_05_validates_eligible_requests_unchanged_inputs_same(self):
        stored = list(_stored(self.v65).values())
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.v65["items"]), [])
        self.assertEqual(config_validation.extras_problems(stored, self.v65["items"]), [])
        cfgs, cfgs64 = _stored(self.v65), _stored(self.v64)
        self.assertTrue(extraction.config_is_eligible(cfgs[("HVAC", CATEGORY)], cfgs))
        for k, c in cfgs.items():
            if c.get("list_spec") and k[1] != CATEGORY:
                self.assertEqual(json.dumps(extraction.build_items_spec(c, cfgs, "HVAC"), sort_keys=True),
                                 json.dumps(extraction.build_items_spec(cfgs64[k], cfgs64, "HVAC"), sort_keys=True), k)
        self.assertEqual(set(config_validation.extras_input_ids(cfgs[("HVAC", CATEGORY)])),
                         set(config_validation.extras_input_ids(cfgs64[("HVAC", CATEGORY)])))

    def test_05b_every_new_key_is_refused_by_name_when_malformed(self):
        """config_validation: each VRF-9 key's shape -- a broken copy of v65's hvac_vrf is refused, naming the key (v65 validates)."""
        base = dict(self.cfg, discipline="HVAC")
        config_validation._validate_config(base)

        def refused(mut, needle):
            c = copy.deepcopy(base)
            mut(c["list_spec"]["pricing"])
            with self.assertRaises(frappe.ValidationError) as cm:
                config_validation._validate_config(c)
            self.assertIn(needle, str(cm.exception))

        pp = lambda p: p["extras"]["prepare"]
        sc = lambda p: p["extras"]["scope"]
        refused(lambda p: pp(p)["several_types"].update(typed=False), "several_types.typed")
        refused(lambda p: pp(p)["feeder_length"].update(every_module="yes"), "feeder_length.every_module")
        refused(lambda p: pp(p)["family_refusals"][0].update(words="(unclosed"), "family_refusals[0].words")
        refused(lambda p: pp(p)["family_refusals"][0].pop("refusal"), "family_refusals[0]")
        refused(lambda p: pp(p)["not_includes"][0].update(line="no placeholders"), "not_includes[0].line")
        refused(lambda p: pp(p)["not_includes"][1].update(role="sideways"), "not_includes[1].role")
        refused(lambda p: pp(p)["tfa_capacity"].update(family="Not A Family"), "tfa_capacity.family")
        refused(lambda p: pp(p)["tfa_capacity"].update(hp_words="\\d+ HP"), "tfa_capacity.hp_words")
        refused(lambda p: pp(p)["row_family"][1].update(unit_classes=["litre"]), "row_family[1].unit_classes")
        refused(lambda p: pp(p)["row_family"][0].update(family="Not A Family"), "row_family[0].family")
        refused(lambda p: sc(p)["always_note"].update(note="no placeholders"), "always_note.note")
        refused(lambda p: sc(p)["any_level"].update(keep_words="(unclosed"), "any_level.keep_words")
        refused(lambda p: sc(p)["always_both"].update(families=[]), "always_both")
        refused(lambda p: sc(p)["panel_pick"].update(note="no placeholder"), "panel_pick.note")
        refused(lambda p: p["extras"]["safeguard"].update(exact_quotes=False), "safeguard.exact_quotes")
        refused(lambda p: p["per_set"]["counted"]["defined"].update(line="no quantity"), "counted.defined.line")
        refused(lambda p: p["per_set"]["counted"]["defined"].pop("line_plain"), "counted.defined")
        refused(lambda p: p["lot_units"].update(calculator_refuses=1), "lot_units.calculator_refuses")

    def test_06_v65_is_the_newest_and_the_series_has_no_gap(self):
        data = os.path.dirname(_asset_path(V65))
        nums = sorted(int(m.group(1)) for f in os.listdir(data) for m in [re.match(r"^rate_master_hvac_all_v(\d+)\.json$", f)] if m)
        self.assertEqual(nums[-1], 65)
        self.assertEqual(nums, list(range(1, 66)))
        self.assertTrue(os.path.exists(_asset_path(V64)))

    def test_07_live_catalogue_is_v65(self):
        row = frappe.db.sql('select config from "tabBoQ Rate Category Config" where active=1 and discipline=%s and category_id=%s', ("HVAC", CATEGORY))
        self.assertTrue(row)
        live = json.loads(row[0][0]) if isinstance(row[0][0], str) else row[0][0]
        self.assertEqual(_norm(live), _norm(self.cfg))
        n = frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where active=1 and discipline=%s', ("HVAC",))[0][0]
        self.assertEqual(n, 585)
