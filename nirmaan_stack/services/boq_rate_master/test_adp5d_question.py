"""ADP-5d (owner rulings 2026-10-23 22:20-23:48; Phase A Q1-Q8, 2026-10-24) -- HVAC v54. v54 is v53 with exactly the
approved changes:

  ADP question   the family note gains R19 (a discrete grille is 'grille, type not stated'; a size-only row buys its
                 heading's item), R13 (on a per-sq.m row an unsettled diffuser shape is 'square diffuser'), R17 / R18 / R21
                 (a double deflection grille is 'linear grille', a grille damper is 'collar damper', a floor tile / rigid
                 floor / rigid tile grille is 'floor grille'), R4 (a return air baffle is 'cross-talk'), R1 (a canvas
                 connection is NOT a plenum accessory) and R9 (a motorised VCD's heading control panel / actuator / cabling
                 are not items).
  ADP pricing    `stream_heading_default` (R6b), `text_notes` (R9 / R13), `companion_items` (R4), and the floor grille in
                 `number_defaults` face_w_mm / face_h_mm with its own line (`rule_by_family`, R21) -- the forms in
                 `test_config_validation_adp5d.py`, which `adp5d.test.ts` prices.
  Insulation     the cladding note gains R12 ('exposed insulation material with <cladding>' is the insulation's face) and
                 R2 (a foil facing is 'Aluminium Foil').

Piping asks Insulation's questions as its delegated section, so R2 / R12 change the Piping question ONLY inside that
section. No item changes; every other category, every other key and every top-level key is unchanged. NOT in v54 (owner
Q7): the optional R7 (louvre) and R23 (stocked alternative) texts.

Pure: reads the committed assets and calls the extraction's own `build_items_spec` (no database, no model). Run: bench
--site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_adp5d_question
"""
import copy
import hashlib
import json
import os
import unittest

from nirmaan_stack.services.boq_rate_master import config_validation, extraction
from nirmaan_stack.services.boq_rate_master.test_config_validation_adp5d import (
    COMPANION_ITEMS, FLOOR_GRILLE_LINE, STREAM_HEADING_DEFAULT, TEXT_NOTES, add_adp5d)

DATA = os.path.join(os.path.dirname(__file__), "data")
ADP, INS, PIP = "hvac_adp", "hvac_insulation", "hvac_piping"

R19_OLD = "(owner ruling 6b: no SKU in the catalogue means the row is left blank for the user to decide)."
R19_NEW = (R19_OLD + " A discrete grille is 'grille, type not stated'. A row that gives only a size, or a size and a place "
           "('600x600 for hub room'), buys the item its heading or that heading's note describes: answer that family, never "
           "'none of these' with the size as its name.")
R13_OLD = "a tegular or plaque diffuser is 'square diffuser';"
R13_NEW = (R13_OLD + " on a row priced per sq.m, a diffuser whose shape the row and its headings do not settle -- no shape named, "
           "or round and square both offered ('round/square') -- is 'square diffuser' (owner 2026-10-23);")
R17_OLD = "a multi-blade louver damper is 'VCD'."
R17_NEW = ("a multi-blade louver damper is 'VCD'; a double deflection grille is 'linear grille' (a curved grille stays 'curved "
           "grille'); a grille damper is 'collar damper'; a floor tile grille, a rigid floor grille or a rigid tile grille is "
           "'floor grille'.")
R4_OLD = "(a Z type baffle under an ACTUATORS heading is 'cross-talk')."
R4_NEW = R4_OLD + " A return air baffle is 'cross-talk' (owner 2026-10-23); return it alone -- code adds its return air grille."
R1_OLD = "return the plenum alone; its rate includes them."
R1_NEW = (R1_OLD + " A canvas connection is NOT an accessory: where the row says its price includes canvas connections, return "
          "'canvas connection' as a second item beside the plenum (owner 2026-10-23).")
R9_OLD = "A damper is its own item only where the row buys the damper itself and names no host."
R9_NEW = (R9_OLD + " A MOTORISED VCD'S CONTROL PANEL, ACTUATOR AND CABLING named in its heading are not separate items (owner "
          "2026-10-23): return the VCD alone; code says on the panel that they are not included.")
R12_OLD = ("Only a condition that names WHERE the item is (pipes exposed to sun or atmosphere, outdoor, exposed areas) limits the "
           "cladding to rows that meet that condition.")
R12_NEW = (R12_OLD + " 'Exposed insulation material with <a cladding>' describes the insulation's own outer face, not a place: that "
           "cladding applies to every row under the heading (owner 2026-10-23). Aluminium foil and glass cloth offered as "
           "alternatives ('Al Foil / GC cloth') is 'Aluminium Foil'.")
R2_OLD = ("A factory-laminated or reinforced glass cloth or fibre cloth facing ('factory laminated fire resistant fibre cloth fabric', "
          "'reinforced glass cloth') IS the glass cloth cladding: 'Glass Cloth with paint', or '<gauge> Aluminium with Glass Cloth' "
          "where aluminium is also named.")
R2_NEW = (R2_OLD + " A FOIL facing ('reinforced foil facing', 'foil facing', 'foil-faced', 'FSK') is 'Aluminium Foil', never a "
          "glass cloth (owner 2026-10-23); an aluminium cladding and a foil facing offered as alternatives ('aluminum cladding / "
          "reinforced foil facing') is 'Aluminium Foil'.")
ADP_EDITS = [(R19_OLD, R19_NEW), (R13_OLD, R13_NEW), (R17_OLD, R17_NEW), (R4_OLD, R4_NEW), (R1_OLD, R1_NEW), (R9_OLD, R9_NEW)]
INS_EDITS = [(R12_OLD, R12_NEW), (R2_OLD, R2_NEW)]
# the items-spec shas, json.dumps(spec, sort_keys=True), as `extraction._group_context` builds them (measured 2026-10-24)
SHA_V53 = {ADP: "72712eb4897526a95b68122ae4dc4286dbb7ea5fe17977b46203633261d36fd1", INS: "66639b0cb8182afe82e03a452074ff10d3b813ca6f956b00212a328042936052", PIP: "ee6848a58d275dd5ebc1ce380e5c9774f6001a7790f81457ac828fe1386e43d4"}
SHA_V54 = {ADP: "39f2e4d7f1ca7ba6", INS: "3fbc3b784ed00e82", PIP: "bbdbf548c2a33715"}   # the first 16 hex of the full sha


def _asset(n):
    with open(os.path.join(DATA, "rate_master_hvac_all_v%d.json" % n), encoding="utf-8") as f:
        return json.load(f)


def _cfg(payload, cid):
    return next(c for c in payload["category_configs"] if c["category_id"] == cid)


def _def(cfg, did):
    return next(d for d in cfg["list_spec"]["attribute_definitions"] if d["id"] == did)


def _specs(payload):
    st = [dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]]
    cfgs = {(payload["discipline"], c["category_id"]): c for c in st}
    return {c["category_id"]: extraction.build_items_spec(cfgs[(payload["discipline"], c["category_id"])], cfgs, payload["discipline"])
            for c in st if c.get("list_spec")}


def _sha(o):
    return hashlib.sha256(json.dumps(o, sort_keys=True).encode()).hexdigest()


def _ruled(v53):
    """v53 with ONLY the approved edits applied -- the test's own reconstruction, compared with the committed v54."""
    p = copy.deepcopy(v53)
    fam = _def(_cfg(p, ADP), "family")
    for old, new in ADP_EDITS:
        fam["note"] = fam["note"].replace(old, new)
    add_adp5d(_cfg(p, ADP)["list_spec"]["pricing"])
    cl = _def(_cfg(p, INS), "cladding")
    for old, new in INS_EDITS:
        cl["note"] = cl["note"].replace(old, new)
    return p


class TestAdp5dQuestion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v53, cls.v54 = _asset(53), _asset(54)
        cls.s53, cls.s54 = _specs(cls.v53), _specs(cls.v54)

    def test_01_v54_validates(self):
        stored = [dict(c, discipline=self.v54["discipline"]) for c in self.v54["category_configs"]]
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.v54["items"]), [])

    def test_02_each_old_text_is_in_v53_once_and_its_new_text_in_v54(self):
        fam53, fam54 = _def(_cfg(self.v53, ADP), "family")["note"], _def(_cfg(self.v54, ADP), "family")["note"]
        cl53, cl54 = _def(_cfg(self.v53, INS), "cladding")["note"], _def(_cfg(self.v54, INS), "cladding")["note"]
        for (old, new), n53, n54 in [(e, fam53, fam54) for e in ADP_EDITS] + [(e, cl53, cl54) for e in INS_EDITS]:
            self.assertEqual(n53.count(old), 1, old[:60])
            self.assertEqual(n54.count(new), 1, new[:60])
        # negative: the optional texts NOT approved (owner Q7) are not in v54
        self.assertNotIn("LOUVRE OR DIFFUSER", fam54)
        self.assertNotIn("The item is then the stocked one", _def(_cfg(self.v54, INS), "item")["note"])

    def test_03_v54_is_v53_with_exactly_the_approved_edits(self):
        want = _ruled(self.v53)
        self.assertEqual({c["category_id"]: c for c in self.v54["category_configs"]},
                         {c["category_id"]: c for c in want["category_configs"]})
        self.assertEqual({k: v for k, v in self.v54.items() if k not in ("category_configs", "items")},
                         {k: v for k, v in self.v53.items() if k not in ("category_configs", "items")})
        changed = sorted(a["category_id"] for a, b in zip(self.v53["category_configs"], self.v54["category_configs"]) if a != b)
        self.assertEqual(changed, [ADP, INS])

    def test_04_no_item_changed(self):
        self.assertEqual({i["item_uid"]: i for i in self.v54["items"]}, {i["item_uid"]: i for i in self.v53["items"]})

    def test_05_the_items_spec_shas(self):
        self.assertEqual({k: _sha(self.s53[k]) for k in (ADP, INS, PIP)}, SHA_V53)
        self.assertEqual({k: _sha(self.s54[k])[:16] for k in (ADP, INS, PIP)}, SHA_V54)
        # Piping: only its delegated insulation section moved, and it IS the new Insulation spec
        strip = lambda s: {k: v for k, v in s.items() if k != "sections"}
        self.assertEqual(strip(self.s53[PIP]), strip(self.s54[PIP]))
        self.assertTrue(all(sec["items_spec"] == self.s54[INS] for sec in self.s54[PIP]["sections"]))
        # every other category's question is unchanged
        for k in self.s53:
            if k not in (ADP, INS, PIP):
                self.assertEqual(self.s53[k], self.s54[k], k)

    def test_06_the_pricing_keys_are_the_tested_forms_and_never_reach_the_model(self):
        pr = _cfg(self.v54, ADP)["list_spec"]["pricing"]
        self.assertEqual(pr["stream_heading_default"], STREAM_HEADING_DEFAULT)
        self.assertEqual(pr["companion_items"], COMPANION_ITEMS)
        self.assertEqual(pr["text_notes"], TEXT_NOTES)
        for a in ("face_w_mm", "face_h_mm"):
            self.assertEqual(pr["number_defaults"][a]["families"], ["cross-talk", "floor grille"])
            self.assertEqual(pr["number_defaults"][a]["rule_by_family"], {"floor grille": FLOOR_GRILLE_LINE})
            # the cross-talk rows' own line is byte-identical to v53's (owner Q5 (b))
            self.assertEqual(pr["number_defaults"][a]["rule"], _cfg(self.v53, ADP)["list_spec"]["pricing"]["number_defaults"][a]["rule"])
        dumped = json.dumps(self.s54[ADP])
        for k in ("stream_heading_default", "companion_items", "text_notes", "rule_by_family"):
            self.assertNotIn(k, dumped)
        for cid in (INS, PIP):
            self.assertFalse({"stream_heading_default", "companion_items", "text_notes"} & set(_cfg(self.v54, cid)["list_spec"]["pricing"]))


if __name__ == "__main__":
    unittest.main()
